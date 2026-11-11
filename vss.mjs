import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {readFile} from 'node:fs/promises';import path from 'node:path';
const execute=promisify(execFile);
export function mapSnapshotPaths(sources,snapshots){return sources.map(source=>{
 const absolute=path.win32.resolve(source),volume=path.win32.parse(absolute).root;
 if(!/^[A-Za-z]:\\$/.test(volume))throw Error('VSS suporta origens locais com letra de unidade; caminhos de rede precisam de snapshot no servidor.');
 const snapshot=snapshots.find(s=>s.volume.toLowerCase()===volume.toLowerCase());if(!snapshot||!/^\\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy\d+$/i.test(snapshot.device))throw Error('Caminho do snapshot VSS inválido.');
 return path.win32.join(snapshot.device+'\\',path.win32.relative(volume,absolute));
})}
export function powershellErrorText(value){
 const decode=text=>text.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&amp;/g,'&').replace(/_x([0-9a-f]{4})_/gi,(_,n)=>String.fromCharCode(parseInt(n,16)));
 const raw=String(value||''),errors=[...raw.matchAll(/<S\b[^>]*\bS=["']Error["'][^>]*>([\s\S]*?)<\/S>/gi)].map(m=>decode(m[1]));
 const plain=raw.replace(/#<\s*CLIXML\s*/g,'').replace(/<Objs\b[\s\S]*?<\/Objs>/gi,'').replace(/<Objs\b[\s\S]*$/gi,'').trim();
 return [plain,...errors].filter(Boolean).join('\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,2500);
}
async function requestVss(request){
 if(process.platform!=='win32')throw Error('VSS está disponível apenas no Windows.');
 const script=(await readFile(new URL('./windows/vss-client.ps1',import.meta.url),'utf8')).replace(/^\uFEFF/,'');
 const client=createHash('sha256').update(new URL('.',import.meta.url).href.toLowerCase()).digest('hex');
 const product=process.env.BACKUPDESK_VSS_PRODUCT||'master';
 try{const {stdout}=await execute('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,env:{...process.env,BACKUPDESK_VSS_REQUEST:JSON.stringify({...request,protocol:1,client}),BACKUPDESK_VSS_PRODUCT:product},encoding:'utf8',timeout:220000,maxBuffer:1048576});return JSON.parse(stdout.replace(/^\uFEFF/,'').trim())}catch(e){throw Error(powershellErrorText(e.stderr)||(e.killed?'O componente VSS excedeu o tempo de resposta. Repare o componente pelo atualizador do BackupDesk.':'Não foi possível comunicar com o componente VSS. Execute o atualizador do BackupDesk nesta conta e autorize o reparo.'))}
}
let cachedStatus=null,statusAt=0,statusPending=null;
export async function automaticVssStatus(){
 if(cachedStatus&&Date.now()-statusAt<15000)return cachedStatus;
 if(statusPending)return statusPending;
 statusPending=(async()=>{try{const result=await requestVss({action:'probe'});cachedStatus={available:result.protocol===1&&result.automatic===true,automatic:true};}
 catch(e){cachedStatus={available:false,automatic:true,error:e.message}}
 statusAt=Date.now();return cachedStatus;})();
 try{return await statusPending}finally{statusPending=null}
}
export async function withVssSources(sources,operation,backend=requestVss,onProgress=()=>{}){
 const volumes=[...new Set(sources.map(p=>{if(!/^[A-Za-z]:[\\/]/.test(p))throw Error('VSS requer origem em disco local NTFS.');return path.win32.parse(path.win32.resolve(p)).root.toUpperCase()}))];const snapshots=[];
 if(backend===requestVss){onProgress({stage:'vss_prepare',currentFile:''});await backend({action:'cleanup'})}
 try{for(const volume of volumes){onProgress({stage:'vss_snapshot',currentFile:volume});snapshots.push(await backend({action:'create',volume}))}const mapped=mapSnapshotPaths(sources,snapshots);return await operation(mapped,snapshots)}
 finally{onProgress({stage:'vss_cleanup',currentFile:''});const failures=[];for(const snapshot of snapshots.reverse()){try{await backend({action:'delete',id:snapshot.id})}catch(e){failures.push(snapshot.id+': '+e.message)}}if(backend===requestVss){try{await backend({action:'cleanup'})}catch(e){failures.push(e.message)}}if(failures.length)throw Error('Não foi possível remover os snapshots VSS desta execução: '+failures.join('; '))}
}
