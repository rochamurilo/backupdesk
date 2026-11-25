import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {lstat,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {openJSON,sealJSON} from './crypto-vault.mjs';

const decimal=s=>typeof s==='string'&&/^(0|[1-9]\d{0,19})$/.test(s);
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const LIMIT=128*1024*1024;
const epoch=116444736000000000n;
export function validJournal(j){
 try{return !!j&&typeof j.volume_id==='string'&&/^\\\\\?\\Volume\{[a-f0-9-]{36}\}\\$/i.test(j.volume_id)&&['journal_id','first_usn','next_usn','lowest_valid_usn','serial'].every(k=>decimal(j[k]))&&BigInt(j.journal_id)>0n&&BigInt(j.first_usn)<=BigInt(j.next_usn)&&BigInt(j.lowest_valid_usn)<=BigInt(j.next_usn)}catch{return false}
}
export function continuousJournal(previous,current){
 return validJournal(previous)&&validJournal(current)&&previous.volume_id===current.volume_id&&previous.serial===current.serial&&previous.journal_id===current.journal_id&&BigInt(previous.next_usn)>=BigInt(current.first_usn)&&BigInt(previous.next_usn)>=BigInt(current.lowest_valid_usn)&&BigInt(previous.next_usn)<=BigInt(current.next_usn);
}

// One unprivileged helper per backup, not one PowerShell process per file.
// Paths travel over stdin; neither file names nor credentials enter command args.
export async function readWindowsUsn(requests,{signal}={}){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./windows/usn-files.ps1',import.meta.url))],{windowsHide:true,signal,stdio:['pipe','pipe','pipe']});
  const rows=new Map();let buffer='',invalid=false;
  const fail=()=>{invalid=true;child.kill()};
  const timer=setTimeout(fail,600000);timer.unref();
  child.stderr.resume();child.stdout.setEncoding('utf8');child.stdin.on('error',()=>{invalid=true});
  child.stdout.on('data',chunk=>{
   buffer+=chunk;let end;
   while((end=buffer.indexOf('\n'))>=0){
    const parts=buffer.slice(0,end).replace(/\r$/,'').split('\t');buffer=buffer.slice(end+1);
    const index=Number(parts.shift());
    if(!Number.isSafeInteger(index)||index<0||index>=requests.length||rows.has(index)||!(parts.length===1&&parts[0]==='-'||parts.length===6&&parts.every(decimal))){fail();return}
    rows.set(index,parts[0]==='-'?null:parts);
   }
   if(buffer.length>8192)fail();
  });
  child.once('error',()=>{clearTimeout(timer);reject(Error('USN helper unavailable'))});
  child.once('close',code=>{clearTimeout(timer);if(signal?.aborted)return reject(signal.reason);if(code!==0||invalid||buffer.trim()||rows.size!==requests.length)return reject(Error('USN metadata unavailable'));resolve(rows)});
  (async()=>{
   try{for(let i=0;i<requests.length;i++){
    signal?.throwIfAborted();const r=requests[i];
    if(!child.stdin.write(i+'\t'+Buffer.from(r.snapshot).toString('base64')+'\t'+Buffer.from(r.live).toString('base64')+'\n'))await once(child.stdin,'drain');
   }child.stdin.end()}catch{fail()}
  })();
 });
}

export async function createUsnCache({files,snapshots=[],scopeKey,device,encryption,cacheFile,signal,onProgress=()=>{},platform=process.platform,readStamps=readWindowsUsn}){
 const stats={method:'sha256',reused_files:0,reused_bytes:0,hashed_files:0,reason:'unsupported-source'};
 const noop={stats,get:()=>null,remember:()=>{},async save(){}};
 if(platform!=='win32'||!encryption?.dataKey||!snapshots.length)return noop;
 const volumes=new Map(),requests=[],candidates=[];
 for(const snapshot of snapshots){if(validJournal(snapshot.usn))volumes.set(snapshot.usn.volume_id,snapshot.usn)}
 if(!volumes.size){stats.reason='journal-unavailable';return noop}
 for(const file of files){
  const snapshot=snapshots.find(s=>validJournal(s.usn)&&file.absolute.toLowerCase().startsWith((s.device+'\\').toLowerCase()));
  if(!snapshot)continue;
  requests.push({snapshot:file.absolute,live:path.win32.join(snapshot.volume,file.absolute.slice(snapshot.device.length+1))});candidates.push({file,journal:snapshot.usn});
 }
 if(!requests.length)return noop;
 let previous=null;
 try{const info=await lstat(cacheFile);if(!info.isFile()||info.isSymbolicLink()||info.size>LIMIT)throw Error();previous=openJSON(JSON.parse(await readFile(cacheFile,'utf8')),encryption.dataKey);if(previous.format!=='backupdesk-usn-cache-v1'||previous.scope!==scopeKey||previous.device!==device||!previous.entries||!previous.volumes)previous=null}catch{stats.reason='cache-unavailable'}
 signal?.throwIfAborted();onProgress({stage:'usn_scanning',currentFile:'',processedBytes:0,totalBytes:null,totalFiles:requests.length});
 let rows;
 try{rows=await readStamps(requests,{signal})}catch{signal?.throwIfAborted();stats.reason='metadata-unavailable';return noop}
 const proofs=new Map();
 for(let i=0;i<candidates.length;i++){
  const parts=rows.get(i),{file,journal}=candidates[i];
  // The native helper has compared the snapshot against a live handle that
  // denies writes/deletes. Recheck the scan metadata and journal bounds here.
  if(!Array.isArray(parts)||parts.length!==6||!parts.every(decimal))continue;
  const [serial,id,usn,size,written]=parts;
  if(serial!==journal.serial||BigInt(usn)<=0n||BigInt(usn)>=BigInt(journal.next_usn)||BigInt(size)!==file.size||(BigInt(written)-epoch)*100n!==file.mtime)continue;
  proofs.set(file.path,{volume:journal.volume_id,value:[journal.volume_id,journal.journal_id,...parts].join('|')});
 }
 const entries=Object.create(null);stats.method='ntfs-usn';stats.reason=previous?'validated':'first-scan';
 return {stats,
  get(file){const proof=proofs.get(file.path),old=previous?.entries?.[file.path];if(!proof||!old||!hash(old.hash)||old.proof!==proof.value||!continuousJournal(previous.volumes[proof.volume],volumes.get(proof.volume)))return null;stats.reused_files++;stats.reused_bytes+=Number(file.size);return old.hash},
  remember(file,digest){const proof=proofs.get(file.path);if(!hash(digest))throw Error('Hash USN inválido.');if(proof)entries[file.path]={hash:digest,proof:proof.value}},
  async save(){
   signal?.throwIfAborted();const temporary=cacheFile+'.'+randomUUID()+'.tmp';
   try{const encoded=JSON.stringify(sealJSON({format:'backupdesk-usn-cache-v1',scope:scopeKey,device,volumes:Object.fromEntries(volumes),entries},encryption.dataKey));if(Buffer.byteLength(encoded)>LIMIT)throw Error();await writeFile(temporary,encoded,{flag:'wx',mode:0o600,flush:true});signal?.throwIfAborted();await rename(temporary,cacheFile)}
   catch{signal?.throwIfAborted();stats.reason='cache-write-failed'}finally{await unlink(temporary).catch(()=>{})}
  }
 };
}
