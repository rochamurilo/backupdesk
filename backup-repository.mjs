import {openJSON,sealJSON,validateHeader} from './crypto-vault.mjs';
import {decryptHash,encryptedSize} from './encrypted-files.mjs';
import {readFile,readdir,realpath,stat,lstat,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';import {createHash} from 'node:crypto';import path from 'node:path';
export const FULL_WINDOW_MS=5*24*60*60*1000;
export function contained(parent,child){const r=path.relative(parent,child);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r))}
export function safeRelative(name){return typeof name==='string'&&name.length>0&&!path.isAbsolute(name)&&!name.split(/[\\/]/).some(p=>p==='..'||p==='')&&!/^[A-Za-z]:/.test(name)}
export function identityPath(value){const normalized=path.normalize(value);return process.platform==='win32'?normalized.toLowerCase():normalized}
export function scopeIdentity(device,sources,destination){return createHash('sha256').update(JSON.stringify({version:1,device,sources:sources.map(identityPath),destination:identityPath(destination)})).digest('hex')}
export async function hashFile(file,onBytes=()=>{},throttle=async()=>{}){const hash=createHash('sha256');for await(const chunk of createReadStream(file)){await throttle(chunk.length);hash.update(chunk);onBytes(chunk.length)}return hash.digest('hex')}
const manifestKeys=new WeakMap();
export const manifestKey=manifest=>manifestKeys.get(manifest);
export async function readKeyHeader(snapshot){const file=path.join(snapshot,'key-envelope.json');if((await lstat(file)).isSymbolicLink())throw Error('Cabeçalho redirecionado.');return validateHeader(JSON.parse(await readFile(file,'utf8')))}
export async function writeEncryptedManifest(snapshot,manifest,encryption,filename='manifest.bde'){
 await writeFile(path.join(snapshot,'key-envelope.json'),JSON.stringify(encryption.header),{flag:'wx',flush:true});
 await writeFile(path.join(snapshot,filename),JSON.stringify(sealJSON(manifest,encryption.dataKey)),{flag:'wx',flush:true});
}
export async function readManifest(snapshot,{getKey}={}){
 let m,key,encrypted=false;const encryptedFile=path.join(snapshot,'manifest.bde');
 try{const info=await lstat(encryptedFile);if(info.isSymbolicLink())throw Error('Manifesto redirecionado não é aceito.');encrypted=true;const header=await readKeyHeader(snapshot);if(!getKey)throw Object.assign(Error('Este backup está criptografado. Importe a chave de recuperação no master.'),{code:'KEY_REQUIRED'});key=await getKey(header);m=openJSON(JSON.parse(await readFile(encryptedFile,'utf8')),key);if(m.encryption_id!==header.key_id)throw Error('Identificação de criptografia divergente.');}
 catch(e){if(e.code!=='ENOENT'||encrypted)throw e;const file=path.join(snapshot,'manifest.json');if((await lstat(file)).isSymbolicLink())throw Error('Manifesto redirecionado não é aceito.');m=JSON.parse(await readFile(file,'utf8'))}
 if(!(encrypted?m.format==='backupdesk-files-v3':['backupdesk-files-v1','backupdesk-files-v2'].includes(m.format))||m.status!=='success'||!Array.isArray(m.files))throw Error('Manifesto de backup inválido.');
 const names=new Set();for(const f of m.files){if(!safeRelative(f.path)||!/^[a-f0-9]{64}$/.test(f.hash)||!Number.isSafeInteger(f.size)||f.size<0||encrypted&&!/^[a-f0-9]{64}\.bde$/.test(f.object||''))throw Error('Arquivo inválido no manifesto.');const name=identityPath(f.path);if(names.has(name))throw Error('Arquivo duplicado no manifesto.');names.add(name)}if(key)manifestKeys.set(m,key);return m;
}
export const fileAAD=(manifest,object)=>'BackupDesk file v1:'+manifest.encryption_id+':'+object;
export async function storedFile(snapshot,relative,repository){
 const base=await realpath(snapshot);if(repository&&!contained(repository,base))throw Error('A versão do backup aponta para fora do repositório.');
 const files=await realpath(path.join(base,'files'));if(!contained(base,files))throw Error('Os arquivos apontam para fora da versão do backup.');
 const file=await realpath(path.join(files,...relative.split('/')));if(!contained(files,file))throw Error('Arquivo fora do backup.');return file;
}
export async function findFullBaseline({repository,target,device,sources,scopeKey,now,knownRuns,encryption}){
 const cutoff=now.getTime()-FULL_WINDOW_MS,candidates=[];let directories;
 try{directories=await readdir(repository,{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return null;throw e}
 for(const routine of directories){if(!routine.isDirectory()||!/^\d+$/.test(routine.name))continue;
  const folder=path.join(repository,routine.name);for(const run of await readdir(folder,{withFileTypes:true})){
   if(!run.isDirectory()||! /^[a-zA-Z0-9_-]+$/.test(run.name)||run.name.startsWith('.'))continue;
   const snapshot=path.join(folder,run.name);try{
    const canonical=await realpath(snapshot);if(!contained(repository,canonical))continue;
    if(knownRuns){const known=knownRuns.find(r=>r.id===run.name);if(!known?.snapshot||identityPath(await realpath(known.snapshot))!==identityPath(canonical))continue}
    const m=await readManifest(canonical,{getKey:encryption?.getKey}),finished=Date.parse(m.finished||m.created);
    if(encryption&&(m.format!=='backupdesk-files-v3'||m.encryption_id!==encryption.header.key_id))continue;
    if(m.device!==device||m.run!==run.name||m.backup_type==='differential'||!Number.isFinite(finished)||finished<cutoff||finished>now.getTime())continue;
    if(['backupdesk-files-v2','backupdesk-files-v3'].includes(m.format)){if(m.scope_key!==scopeKey||m.backup_type!=='full'||m.files.some(f=>f.source_run&&f.source_run!==m.run))continue}
    else{if(!Array.isArray(m.sources)||m.sources.length!==sources.length||m.sources.some((s,i)=>identityPath(s)!==identityPath(sources[i])))continue}
    candidates.push({snapshot:canonical,manifest:m,finished});
   }catch(e){if(['EACCES','EPERM','EIO'].includes(e.code))throw e;/* Broken/incomplete manifests cannot be a full baseline. */}
  }
 }
 candidates.sort((a,b)=>b.finished-a.finished);return candidates[0]||null;
}
export async function verifyFullBaseline(candidate,repository,onBytes=()=>{},throttle=async()=>{}){
 for(const f of candidate.manifest.files){const file=await storedFile(candidate.snapshot,f.object||f.path,repository);const encrypted=candidate.manifest.format==='backupdesk-files-v3';if((await stat(file)).size!==(encrypted?encryptedSize(f.size):f.size)||(encrypted?await decryptHash(file,manifestKey(candidate.manifest),fileAAD(candidate.manifest,f.object),{onBytes,throttle}):await hashFile(file,onBytes,throttle))!==f.hash)throw Error('A base completa está incompleta ou corrompida: '+f.path)}
}

// The source LastWriteTime is distinct from the time a backup was performed.
export function modifiedDate(nanoseconds){
 if(typeof nanoseconds!=='string'||!/^-?\d{1,24}$/.test(nanoseconds))return null;
 const date=new Date(Number(BigInt(nanoseconds)/1000000n));return Number.isNaN(date.getTime())?null:date.toISOString();
}
export function backupDestination(run){
 if(run.storage_type==='server')return 'Armazenamento do master';
 if(run.scope_destination)return run.scope_destination;
 if(typeof run.snapshot!=='string')return null;
 const p=/^(?:[a-z]:|\\)/i.test(run.snapshot)?path.win32:path.posix;
 const snapshot=p.normalize(run.snapshot),routine=p.dirname(snapshot),device=p.dirname(routine),repository=p.dirname(device);
 if(p.basename(snapshot)!==run.id||p.basename(device)!==run.device||p.basename(repository).toLowerCase()!=='backupdesk')return null;
 return p.dirname(repository);
}

export async function resolveBaseSnapshot(manifest,deviceRepository){
 if(!/^[a-zA-Z0-9_-]+$/.test(manifest.base_run||''))throw Error('Referência diferencial inválida.');
 if(manifest.base_snapshot){try{const original=await realpath(manifest.base_snapshot);if(contained(deviceRepository,original))return original}catch{}}
 for(const routine of await readdir(deviceRepository,{withFileTypes:true})){if(!routine.isDirectory()||!/^\d+$/.test(routine.name))continue;try{const candidate=await realpath(path.join(deviceRepository,routine.name,manifest.base_run));if(contained(deviceRepository,candidate))return candidate}catch{}}
 throw Error('A base completa deste diferencial não foi encontrada neste repositório. Conecte também a cópia completa.');
}
