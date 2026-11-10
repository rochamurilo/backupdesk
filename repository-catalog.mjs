import {readdir,realpath,lstat} from 'node:fs/promises';import path from 'node:path';
import {readManifest,readKeyHeader,contained,modifiedDate} from './backup-repository.mjs';
export async function scanRepository(source,{onSnapshot=async()=>{},onProgress=()=>{},getKey,computerName,keyId}={}){
 const root=await realpath(source);if(!(await lstat(root)).isDirectory())throw Error('Selecione uma pasta de backups.');
 const pending=[root],visited=new Set(),seenRuns=new Set(),fulls=new Set(),differentials=[];
 let runs=0,files=0,skipped=0,headers=0,matchingKeys=0,opened=0,matchingNames=0,accessFailures=0,links=0,duplicates=0;
 const permission=e=>['EACCES','EPERM'].includes(e.code),name=value=>String(value||'').normalize('NFC').trim().toLocaleLowerCase('pt-BR');
 while(pending.length){
  const directory=pending.pop();let current,entries;
  try{
   const info=await lstat(directory);if(info.isSymbolicLink()){links++;continue}if(!info.isDirectory())continue;
   current=await realpath(directory);if(!contained(root,current)){links++;continue}if(visited.has(current))continue;visited.add(current);
   entries=await readdir(current,{withFileTypes:true});
  }catch(e){if(permission(e)){accessFailures++;continue}if(e.code==='ENOENT')continue;throw e}
  onProgress({stage:'cataloging',currentFile:current,filesDone:files,totalFiles:null});
  const runName=path.basename(current),routineName=path.basename(path.dirname(current)),deviceName=path.basename(path.resolve(current,'../..'));
  const shape=/^[a-zA-Z0-9_-]+$/.test(runName)&&/^\d+$/.test(routineName)&&/^[a-zA-Z0-9_-]+$/.test(deviceName);
  const encrypted=entries.some(e=>e.name==='manifest.bde'||e.name==='key-envelope.json'),plain=entries.some(e=>e.name==='manifest.json');let recognized=false;
  if(shape&&(encrypted||plain)){
   let manifest;
   try{
    if(encrypted){const header=await readKeyHeader(current);recognized=true;headers++;if(keyId&&header.key_id!==keyId)continue;if(keyId)matchingKeys++}
    manifest=await readManifest(current,{getKey});recognized=true;
    // Plain legacy catalogs have no proof of a portable encryption key.
    if(keyId&&!encrypted)continue;
    opened++;if(computerName&&name(manifest.device_name)!==name(computerName))continue;matchingNames++;
    if(manifest.device!==deviceName||manifest.run!==runName||!Number.isFinite(Date.parse(manifest.finished||manifest.created)))throw Error('Identificação inválida.');
   }catch(e){
    if(e.code==='KEY_REQUIRED')throw e;if(permission(e))accessFailures++;
    if(encrypted||recognized){skipped++;recognized=true}
    manifest=null;
   }
   if(manifest){
    const physical=path.resolve(current,'../..'),identity=manifest.device+':'+manifest.run;
    if(manifest.backup_type!=='differential')fulls.add(physical+'\0'+identity);
    if(seenRuns.has(identity)){duplicates++;continue}seenRuns.add(identity);
    const {files:catalog,...metadata}=manifest;
    await onSnapshot({root,snapshot:current,metadata:{...metadata,file_count:catalog.length},files:catalog.map(f=>({...f,modified_at:f.modified_at||modifiedDate(f.mtime_ns)}))});runs++;files+=catalog.length;
    if(manifest.backup_type==='differential')differentials.push({manifest,physical});
   }
   // A snapshot's payload and Restic object store are not other backup catalogs.
   if(recognized)continue;
  }
  const objectDirectories=new Set(['data','index','keys','snapshots','locks']),directoryNames=new Set(entries.filter(e=>e.isDirectory()).map(e=>e.name));const resticStore=entries.some(e=>e.name==='config'&&e.isFile())&&[...objectDirectories].every(name=>directoryNames.has(name));
  for(const entry of entries){
   if(entry.isSymbolicLink()){links++;continue}if(!entry.isDirectory()||entry.name.startsWith('.partial-')||resticStore&&objectDirectories.has(entry.name))continue;
   pending.push(path.join(current,entry.name));
  }
 }
 if(!runs){
  if(accessFailures)throw Error('Não foi possível ler os backups. Confira a permissão de leitura desta pasta e as credenciais do compartilhamento.');
  if(opened&&!matchingNames&&!skipped)throw Error(keyId?'A chave abriu os backups, mas o nome informado não corresponde ao nome registrado. Confira o nome do computador de origem.':'O nome informado não corresponde ao nome registrado nos backups.');
  if(skipped||matchingKeys)throw Error('Foram encontrados backups, mas seus catálogos não puderam ser lidos ou estão incompletos.');
  if(keyId&&headers)throw Error('Não há backups com esta chave de segurança na pasta selecionada. Confira o local dos backups e a chave original.');
  throw Error('Nenhuma versão concluída do BackupDesk foi encontrada nesta pasta ou nas subpastas.'+(links?' Pastas redirecionadas não são percorridas; selecione o destino real dos backups.':''));
 }
 const missing=differentials.filter(({manifest:m,physical})=>!fulls.has(physical+'\0'+m.device+':'+m.base_run)).length;
 return {root,runs,files,skipped,duplicates,warning:[skipped?skipped+' manifesto(s) inválido(s) ignorado(s).':'',missing?missing+' diferencial(is) sem a base completa neste disco.':'',accessFailures?'Algumas subpastas ou catálogos não puderam ser lidos; confira as permissões.':''].filter(Boolean).join(' ')||null};
}
