import {readdir,realpath,lstat} from 'node:fs/promises';import path from 'node:path';
import {readManifest,readKeyHeader,contained,modifiedDate} from './backup-repository.mjs';
export async function scanRepository(source,{onSnapshot=async()=>{},onProgress=()=>{},getKey,computerName,keyId}={}){
 const root=await realpath(source);if(!(await lstat(root)).isDirectory())throw Error('Selecione uma pasta de backups.');let repository=root;
 if(path.basename(root).toLowerCase()!=='backupdesk'){const candidate=path.join(root,'BackupDesk');try{if(!(await lstat(candidate)).isDirectory()||(await lstat(candidate)).isSymbolicLink())throw Error('Pasta BackupDesk inválida.');repository=await realpath(candidate)}catch(e){if(e.code==='ENOENT')throw Error('Selecione a pasta BackupDesk ou a pasta que a contém.');throw e}}
 if(!contained(root,repository))throw Error('Repositório redirecionado para fora da pasta selecionada.');let runs=0,files=0,skipped=0;const fulls=new Set(),differentials=[];
 for(const device of await readdir(repository,{withFileTypes:true})){if(!device.isDirectory()||!/^[a-zA-Z0-9_-]+$/.test(device.name))continue;
  for(const routine of await readdir(path.join(repository,device.name),{withFileTypes:true})){if(!routine.isDirectory()||!/^\d+$/.test(routine.name))continue;
   for(const run of await readdir(path.join(repository,device.name,routine.name),{withFileTypes:true})){if(!run.isDirectory()||!/^[a-zA-Z0-9_-]+$/.test(run.name))continue;const snapshot=path.join(repository,device.name,routine.name,run.name);let manifest;
    try{if(keyId&&(await readKeyHeader(snapshot)).key_id!==keyId)continue;manifest=await readManifest(snapshot,{getKey});if(computerName&&String(manifest.device_name||'').normalize('NFC').trim().toLocaleLowerCase('pt-BR')!==computerName.normalize('NFC').trim().toLocaleLowerCase('pt-BR'))continue;if(manifest.device!==device.name||manifest.run!==run.name||!Number.isFinite(Date.parse(manifest.finished||manifest.created)))throw Error('Identificação inválida.')}catch(e){if(e.code==='KEY_REQUIRED')throw e;skipped++;continue}
    const {files:catalog,...metadata}=manifest;onProgress({stage:'cataloging',currentFile:snapshot,filesDone:files,totalFiles:null});
    await onSnapshot({root,snapshot,metadata:{...metadata,file_count:catalog.length},files:catalog.map(f=>({...f,modified_at:f.modified_at||modifiedDate(f.mtime_ns)}))});runs++;files+=catalog.length;
    if(manifest.backup_type==='differential')differentials.push(manifest);else fulls.add(manifest.device+':'+manifest.run);
   }
  }
 }
 if(!runs)throw Error(computerName?'Nome ou chave de segurança não correspondem a backups disponíveis nesta pasta.':'Nenhuma versão concluída do BackupDesk foi encontrada nesta pasta.');const missing=differentials.filter(m=>!fulls.has(m.device+':'+m.base_run)).length;
 return {root,runs,files,skipped,warning:[skipped?skipped+' manifesto(s) inválido(s) ignorado(s).':'',missing?missing+' diferencial(is) sem a base completa neste disco.':''].filter(Boolean).join(' ')||null};
}
