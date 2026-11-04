import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';import {createHash} from 'node:crypto';import path from 'node:path';
export const FULL_WINDOW_MS=5*24*60*60*1000;
export function contained(parent,child){const r=path.relative(parent,child);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r))}
export function safeRelative(name){return typeof name==='string'&&name.length>0&&!path.isAbsolute(name)&&!name.split(/[\\/]/).some(p=>p==='..'||p==='')&&!/^[A-Za-z]:/.test(name)}
export function identityPath(value){const normalized=path.normalize(value);return process.platform==='win32'?normalized.toLowerCase():normalized}
export function scopeIdentity(device,sources,destination){return createHash('sha256').update(JSON.stringify({version:1,device,sources:sources.map(identityPath),destination:identityPath(destination)})).digest('hex')}
export async function hashFile(file,onBytes=()=>{}){const hash=createHash('sha256');for await(const chunk of createReadStream(file)){hash.update(chunk);onBytes(chunk.length)}return hash.digest('hex')}
export async function readManifest(snapshot){
 const m=JSON.parse(await readFile(path.join(snapshot,'manifest.json'),'utf8'));
 if(!['backupdesk-files-v1','backupdesk-files-v2'].includes(m.format)||m.status!=='success'||!Array.isArray(m.files))throw Error('Manifesto de backup inválido.');
 const names=new Set();for(const f of m.files){if(!safeRelative(f.path)||!/^[a-f0-9]{64}$/.test(f.hash)||!Number.isSafeInteger(f.size)||f.size<0)throw Error('Arquivo inválido no manifesto.');const key=identityPath(f.path);if(names.has(key))throw Error('Arquivo duplicado no manifesto.');names.add(key)}return m;
}
export async function storedFile(snapshot,relative,repository){
 const base=await realpath(snapshot);if(repository&&!contained(repository,base))throw Error('A versão do backup aponta para fora do repositório.');
 const files=await realpath(path.join(base,'files'));if(!contained(base,files))throw Error('Os arquivos apontam para fora da versão do backup.');
 const file=await realpath(path.join(files,...relative.split('/')));if(!contained(files,file))throw Error('Arquivo fora do backup.');return file;
}
export async function findFullBaseline({repository,target,device,sources,scopeKey,now,knownRuns}){
 const cutoff=now.getTime()-FULL_WINDOW_MS,candidates=[];let directories;
 try{directories=await readdir(repository,{withFileTypes:true})}catch(e){if(e.code==='ENOENT')return null;throw e}
 for(const routine of directories){if(!routine.isDirectory()||!/^\d+$/.test(routine.name))continue;
  const folder=path.join(repository,routine.name);for(const run of await readdir(folder,{withFileTypes:true})){
   if(!run.isDirectory()||! /^[a-zA-Z0-9_-]+$/.test(run.name)||run.name.startsWith('.'))continue;
   const snapshot=path.join(folder,run.name);try{
    const canonical=await realpath(snapshot);if(!contained(repository,canonical))continue;
    if(knownRuns){const known=knownRuns.find(r=>r.id===run.name);if(!known?.snapshot||identityPath(await realpath(known.snapshot))!==identityPath(canonical))continue}
    const m=await readManifest(canonical),finished=Date.parse(m.finished||m.created);
    if(m.device!==device||m.run!==run.name||m.backup_type==='differential'||!Number.isFinite(finished)||finished<cutoff||finished>now.getTime())continue;
    if(m.format==='backupdesk-files-v2'){if(m.scope_key!==scopeKey||m.backup_type!=='full'||m.files.some(f=>f.source_run&&f.source_run!==m.run))continue}
    else{if(!Array.isArray(m.sources)||m.sources.length!==sources.length||m.sources.some((s,i)=>identityPath(s)!==identityPath(sources[i])))continue}
    candidates.push({snapshot:canonical,manifest:m,finished});
   }catch(e){if(['EACCES','EPERM','EIO'].includes(e.code))throw e;/* Broken/incomplete manifests cannot be a full baseline. */}
  }
 }
 candidates.sort((a,b)=>b.finished-a.finished);return candidates[0]||null;
}
export async function verifyFullBaseline(candidate,repository,onBytes=()=>{}){
 for(const f of candidate.manifest.files){const file=await storedFile(candidate.snapshot,f.path,repository);if((await stat(file)).size!==f.size||await hashFile(file,onBytes)!==f.hash)throw Error('A base completa está incompleta ou corrompida: '+f.path)}
}
