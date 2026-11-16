import {availableParallelism} from 'node:os';
import {lowerPriority} from './background.mjs';
import {localResticTransport} from './restic-local-transport.mjs';import {createBandwidthLimiter} from './bandwidth.mjs';
import {spawn} from 'node:child_process';import {createHash,hkdfSync} from 'node:crypto';import {createReadStream} from 'node:fs';import {fileURLToPath} from 'node:url';import path from 'node:path';import {RESTIC_BINARIES} from './restic-release.mjs';
let verified;
export async function resticBinary(){const file=fileURLToPath(new URL(process.platform==='win32'?'./windows/restic.exe':'./bin/restic',import.meta.url));if(!verified)verified=(async()=>{const hash=createHash('sha256');try{for await(const c of createReadStream(file))hash.update(c)}catch{throw Error('Restic não está instalado. Atualize o BackupDesk.')}if(hash.digest('hex')!==RESTIC_BINARIES[process.platform])throw Error('O executável Restic não corresponde à versão validada.');return file})().catch(e=>{verified=null;throw e});return verified}
export function repositoryPassword(key,device){return Buffer.from(hkdfSync('sha256',key,Buffer.from(device),Buffer.from('BackupDesk Restic password v1'),32)).toString('base64url')}
export function resticResourcePolicy(args,paced,cores=availableParallelism(),requested=process.env.GOMAXPROCS){const n=Number(requested),limit=Number.isInteger(n)&&n>=1?n:2;return {cpu:String(Math.max(1,Math.min(2,cores,limit))),args:['--no-cache',...(paced?['-o','rest.connections=2']:[]),...(args[0]==='backup'?['backup','--read-concurrency','1',...args.slice(1)]:args)]}}
export function parseResticCheckProgress(line){
 const text=line.replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').trim(),match=/^\[[0-9:]+\]\s+[0-9.]+%\s+(\d+)\s*\/\s*(\d+)\s+packs$/.exec(text);
 if(!match)return null;const packsDone=Number(match[1]),totalPacks=Number(match[2]);
 return Number.isSafeInteger(packsDone)&&Number.isSafeInteger(totalPacks)&&packsDone>=0&&packsDone<=totalPacks?{packsDone,totalPacks}:null;
}
const operations=['init','cat','ls','backup','check','dump','snapshots','unlock'];
const operationOf=args=>args.find(arg=>operations.includes(arg))||'unknown';
function resticFailureMessage(code,stderr){
 if(code===11){
  const holder=/\bPID (\d{1,10}) on ([A-Za-z0-9_.-]{1,253}) by\b/.exec(stderr);
  return 'O repositório Restic está bloqueado por outra operação'+(holder?' em '+holder[2]+' (PID '+holder[1]+')':'')+'. Aguarde a outra execução terminar e tente novamente.';
 }
 if(code===12)return 'A chave de segurança não conseguiu abrir o repositório Restic. Use a chave original deste computador.';
 if(code===10)return 'O repositório Restic não foi encontrado. Confira o destino do backup e o acesso à pasta.';
 return code===3?'Restic não conseguiu ler todos os arquivos. A cópia não foi aprovada.':'Restic não concluiu a operação (código '+code+'). Confira acesso, chave e integridade do repositório.';
}
export async function runRestic(options){
 try{return await executeRestic(options)}catch(error){
  if(error.code!=='RESTIC_FAILED'||error.exitCode!==11||!['backup','check','snapshots','ls'].includes(operationOf(options.args)))throw error;
  options.signal?.throwIfAborted();
  // Restic's normal unlock authenticates/decrypts locks and applies its own stale
  // process/heartbeat rules. Never force removal or disable locking. Retry only
  // once after a lock-acquisition failure, before that command can write data.
  try{
   await executeRestic({...options,args:['unlock'],input:undefined,onJSON:undefined,onData:undefined,onTransfer:undefined,onCheckProgress:undefined,captureOutput:false});
   options.signal?.throwIfAborted();
   return await executeRestic(options);
  }catch(recoveryError){
   if(options.signal?.aborted)throw options.signal.reason;
   recoveryError.lockRecoveryAttempted=true;throw recoveryError;
  }
 }
}
async function executeRestic({repository,key,device,args,onJSON=()=>{},onData,signal,policy,input,throttle,onTransfer,onCheckProgress,captureOutput=true}){if(!path.isAbsolute(repository))throw Error('Repositório Restic inválido.');const binary=await resticBinary(),env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('RESTIC_')));Object.assign(env,{GOMAXPROCS:resticResourcePolicy(args,false).cpu,RESTIC_REPOSITORY:repository,RESTIC_PASSWORD:repositoryPassword(key,device)});// Pace the repository I/O itself: local/UNC backends ignore Restic HTTP flags.
 if(onCheckProgress)env.RESTIC_PROGRESS_FPS='1';
 const paced=throttle||createBandwidthLimiter({getPolicy:()=>policy});let transport;signal?.throwIfAborted();if(policy?.enabled||throttle||onCheckProgress)transport=await localResticTransport(repository,{throttle:paced,onTransfer});if(transport)env.RESTIC_REPOSITORY=transport.url;
 try{
 return await new Promise((resolve,reject)=>{const child=spawn(binary,resticResourcePolicy(args,!!transport).args,{env,windowsHide:true,signal,stdio:[input===undefined?'ignore':'pipe','pipe','pipe']});child.once('spawn',()=>lowerPriority(child.pid));let output='',buffer='',stderr='',done=false,pending=Promise.resolve(),streamError;const kill=()=>{if(child.exitCode===null)child.kill()};process.once('exit',kill);const finish=(error,value)=>{if(done)return;done=true;process.removeListener('exit',kill);error?reject(error):resolve(value)};if(input!==undefined){child.stdin.on('error',()=>{});child.stdin.end(input)}child.stderr.setEncoding('utf8');child.stderr.on('data',s=>{stderr=(stderr+s).slice(-8192)});if(!onData)child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{if(onData){child.stdout.pause();pending=pending.then(()=>onData(chunk)).catch(e=>{streamError=e;kill()}).finally(()=>child.stdout.resume());return}const s=chunk.toString('utf8');if(captureOutput)output+=s;if(output.length>64*1024*1024){streamError=Error('O catálogo Restic excedeu o limite do piloto.');kill();return}buffer+=s;let i;while((i=onCheckProgress?buffer.search(/[\r\n]/):buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(onCheckProgress){const value=parseResticCheckProgress(line);if(value)try{onCheckProgress(value)}catch{}}try{onJSON(JSON.parse(line))}catch{}}if(onCheckProgress&&buffer.length>65536)buffer=buffer.slice(-65536)});child.on('error',()=>{if(!signal?.aborted)finish(Error('Não foi possível iniciar o Restic.'))});child.on('close',async code=>{await pending;if(signal?.aborted)return finish(signal.reason);if(streamError)return finish(streamError);if(code!==0){const error=Error(resticFailureMessage(code,stderr));error.code='RESTIC_FAILED';error.exitCode=code;error.operation=operationOf(args);if(process.env.BACKUPDESK_RESTIC_TEST_DIAGNOSTICS==='1')error.testDiagnostic=stderr.replaceAll(env.RESTIC_PASSWORD,'[redacted]');return finish(error)}finish(null,output)})})}finally{await transport?.close()}
}
