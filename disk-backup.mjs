import {encryptFile,decryptFile,encryptedSize} from './encrypted-files.mjs';
import {readdir,lstat,stat,realpath,open,unlink,mkdir,rename,writeFile,statfs,utimes} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';import {pipeline} from 'node:stream/promises';
import {createHash,randomUUID} from 'node:crypto';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {parseSources} from './filesystem.mjs';
import {withVssSources} from './vss.mjs';
import {writeEncryptedManifest,manifestKey,fileAAD,resolveBaseSnapshot,scopeIdentity,identityPath,modifiedDate,findFullBaseline,verifyFullBaseline,readManifest,storedFile} from './backup-repository.mjs';
const execute=promisify(execFile);
function contained(parent,child){const relative=path.relative(parent,child);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))}
function safeRelative(name){return typeof name==='string'&&name.length>0&&!path.isAbsolute(name)&&!name.split(/[\\/]/).some(p=>p==='..'||p==='')&&!/^[A-Za-z]:/.test(name)}
export async function fileHash(file,onBytes=()=>{},throttle=async()=>{}){const hash=createHash('sha256');for await(const chunk of createReadStream(file)){await throttle(chunk.length);hash.update(chunk);onBytes(chunk.length)}return hash.digest('hex')}
async function outlookCheck(files){
 if(process.platform!=='win32'||!files.some(f=>/\.(pst|ost)$/i.test(f.absolute)))return;
 const {stdout}=await execute('tasklist.exe',['/FI','IMAGENAME eq OUTLOOK.EXE','/FO','CSV','/NH'],{windowsHide:true,timeout:15000});
 if(/"OUTLOOK\.EXE"/i.test(stdout))throw Error('Esta rotina está sem VSS. Para copiar PST/OST, feche o Outlook ou edite a rotina, marque Usar VSS e salve. O componente automático utiliza a autorização concedida na instalação. O VSS continua experimental e exige validar a restauração do PST.');
}
async function plan(source,onProgress=()=>{}){onProgress({stage:'scanning',currentFile:'',processedBytes:0,totalBytes:null,filesDone:0,totalFiles:null});const roots=parseSources(source),files=[],directories=[];for(let i=0;i<roots.length;i++){
 const root=path.resolve(roots[i]),rootInfo=await lstat(root,{bigint:true});if(rootInfo.isSymbolicLink())throw Error('Selecione a pasta real, não um link: '+root);
 const prefix=roots.length>1?`${i+1}-${path.basename(root)||'unidade'}/`:'';
 async function visit(file,info){onProgress({stage:'scanning',currentFile:file,filesFound:files.length});if(info.isSymbolicLink())throw Error('Link simbólico encontrado; selecione o destino real: '+file);if(info.isDirectory()){directories.push({absolute:file,mtime:info.mtimeNs});for(const e of await readdir(file,{withFileTypes:true}))await visit(path.join(file,e.name),await lstat(path.join(file,e.name),{bigint:true}))}else if(info.isFile()){const relative=path.relative(root,file)||path.basename(root);files.push({absolute:file,path:prefix+relative.split(path.sep).join('/'),size:info.size,mtime:info.mtimeNs})}else throw Error('Arquivo especial não suportado: '+file)}
 await visit(root,rootInfo);
 }return {roots,files,directories}}
export async function validateDestination(source,destination,{useVss=false,onProgress=()=>{},deferCapacity=false,allowEmpty=false}={}){
 if(typeof destination!=='string'||!path.isAbsolute(destination))throw Error('Selecione uma pasta de destino com caminho absoluto.');
 const target=await realpath(destination);if(!(await stat(target)).isDirectory())throw Error('O destino não é uma pasta.');
 const {roots,files,directories}=await plan(source,onProgress);onProgress({stage:'checking_destination',currentFile:'',totalFiles:files.length});
 // Shadow devices have no DOS mount point; realpath() may fail even though files are readable.
 // Live source containment was checked in vssPreflight before creating this snapshot.
 for(const root of roots){
  if(useVss){if(!/^\\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy\d+(?:\\|$)/i.test(root))throw Error('Origem VSS não pertence a um snapshot válido.');continue}
  const real=await realpath(root);if((await stat(real)).isDirectory()&&contained(real,target))throw Error('O destino não pode ser a origem nem ficar dentro dela.');
 }
 if(!files.length&&!allowEmpty)throw Error('A origem não contém arquivos para copiar.');
 const bytes=files.reduce((n,f)=>n+f.size,0n);const space=await statfs(target,{bigint:true});const available=space.bavail*space.bsize;
 const estimated=bytes+BigInt(files.length*2+directories.length+10)*space.bsize+1048576n;
 if(!deferCapacity&&available<estimated)throw Error('Espaço insuficiente no destino para esta versão do backup.');
 const probe=path.join(target,'.backupdesk-check-'+randomUUID());let handle;
 try{handle=await open(probe,'wx');await handle.writeFile('BackupDesk');await handle.sync()}finally{await handle?.close();if(handle)await unlink(probe)}
 if(!useVss)await outlookCheck(files);
 return {target,files,directories,requiredBytes:estimated.toString(),availableBytes:available.toString()};
}
async function copyVerified(source,destination,expected,onBytes=()=>{},onPhase=()=>{},throttle=async()=>{},verifyThrottle=async()=>{}){onPhase('copying');
 const before=await lstat(source,{bigint:true});if(before.isSymbolicLink()||!before.isFile())throw Error('A origem deixou de ser um arquivo regular.');
 if(expected&&(before.size!==expected.size||before.mtimeNs!==expected.mtime))throw Error('Arquivo alterado antes da cópia: '+source);
 const hash=createHash('sha256');const tap=new Transform({transform(chunk,encoding,callback){throttle(chunk.length).then(()=>{hash.update(chunk);onBytes(chunk.length);callback(null,chunk)},callback)}});
 await mkdir(path.dirname(destination),{recursive:true});
 await pipeline(createReadStream(source),tap,createWriteStream(destination,{flags:'wx',flush:true}));
 const after=await lstat(source,{bigint:true});if(before.size!==after.size||before.mtimeNs!==after.mtimeNs)throw Error('Arquivo alterado durante a cópia: '+source);
 const digest=hash.digest('hex');onPhase('verifying');if(await fileHash(destination,onBytes,verifyThrottle)!==digest)throw Error('Falha de integridade ao verificar a cópia.');return digest;
}
async function vssPreflight(source,destination){
 if(typeof destination!=='string'||!path.isAbsolute(destination))throw Error('Selecione a pasta de destino.');
 const target=await realpath(destination);if(!(await stat(target)).isDirectory())throw Error('O destino não é uma pasta.');
 const original=parseSources(source),canonical=[];
 for(const root of original){let resolved;try{resolved=await realpath(root)}catch(e){if(!['EACCES','EPERM','EBUSY'].includes(e.code))throw e;resolved=path.join(await realpath(path.dirname(root)),path.basename(root))}
  if(contained(resolved,target))throw Error('O destino não pode ficar dentro da origem.');canonical.push(resolved);
 }
 return {original,canonical};
}
export async function validateVssDestination(source,destination,{onProgress=()=>{}}={}){onProgress({stage:'preparing',processedBytes:0,totalBytes:null});
 const checked=await vssPreflight(source,destination);
 return withVssSources(checked.canonical,async(mapped)=>{const result=await validateDestination(JSON.stringify(mapped),destination,{useVss:true,onProgress});return {target:result.target,requiredBytes:result.requiredBytes,availableBytes:result.availableBytes}},undefined,onProgress);
}
export async function backupToDisk(options){
 const {source,destination,onProgress=()=>{}}=options;const useVss=process.platform==='win32'||!!options.useVss;onProgress({stage:'preparing',processedBytes:0,totalBytes:null});
 if(useVss){const checked=await vssPreflight(source,destination);const sources=[...new Set(checked.canonical)].sort((a,b)=>identityPath(a).localeCompare(identityPath(b)));return withVssSources(sources,async(mapped,snapshots)=>copyToDisk({...options,source:JSON.stringify(mapped),originalSources:sources,snapshots,useVss:true}),undefined,onProgress)}
 const sources=[];for(const root of parseSources(source)){if((await lstat(root)).isSymbolicLink())throw Error('Selecione a pasta real, não um link: '+root);sources.push(await realpath(root))}
 const canonical=[...new Set(sources)].sort((a,b)=>identityPath(a).localeCompare(identityPath(b)));return copyToDisk({...options,source:JSON.stringify(canonical),originalSources:canonical,useVss:false});
}
async function copyToDisk({source,destination,device,routine,run,onFile=()=>{},onPlan=()=>{},useVss=false,originalSources,snapshots=[],onProgress=()=>{},knownRuns,deviceName,throttle=async()=>{},clock=()=>new Date(),encryption}){
 const captured=clock();const checked=await validateDestination(source,destination,{useVss,onProgress,deferCapacity:true,allowEmpty:true});
 if(!/^[a-zA-Z0-9_-]+$/.test(device)||!/^\d+$/.test(String(routine))||!/^[a-zA-Z0-9_-]+$/.test(run))throw Error('Identificação de backup inválida.');
 const parent=path.join(checked.target,'BackupDesk',device,String(routine));await mkdir(parent,{recursive:true});const canonicalParent=await realpath(parent);if(!contained(checked.target,canonicalParent))throw Error('O repositório aponta para fora do destino.');
 const repository=await realpath(path.dirname(parent));const scopeKey=scopeIdentity(device,originalSources,checked.target);
 let baseline=await findFullBaseline({repository,target:checked.target,device,sources:originalSources,scopeKey,now:captured,knownRuns,encryption}),baseRejected=null;
 let processedBytes=0,filesDone=0,totalBytes=null,currentFile='',stage='checking_base';
 const report=()=>onProgress({stage,currentFile,processedBytes,totalBytes,filesDone,totalFiles:checked.files.length});
 if(baseline){totalBytes=baseline.manifest.files.reduce((n,f)=>n+f.size,0);report();try{await verifyFullBaseline(baseline,repository,n=>{processedBytes+=n;report()},n=>throttle(n,'download'))}catch(e){baseRejected=e.message;baseline=null}}
 const type=baseline?'differential':'full',baseFiles=new Map((baseline?.manifest.files||[]).map(f=>[f.path,f])),sourceHashes=new Map(),changed=[];
 if(baseline){stage='comparing';processedBytes=0;totalBytes=checked.files.reduce((n,f)=>n+Number(f.size),0);report();for(const file of checked.files){currentFile=file.path;report();const digest=await fileHash(file.absolute,n=>{processedBytes+=n;report()});sourceHashes.set(file.path,digest);if(baseFiles.get(file.path)?.hash!==digest||baseFiles.get(file.path)?.size!==Number(file.size))changed.push(file)}}else changed.push(...checked.files);
 const required=changed.reduce((n,f)=>n+(encryption?BigInt(encryptedSize(Number(f.size))):f.size),0n)+BigInt(checked.files.length*3+checked.directories.length+10)*4096n+1048576n;
 if(BigInt(checked.availableBytes)<required)throw Error('Espaço insuficiente no destino para os arquivos desta versão.');
 const partial=path.join(parent,'.partial-'+run),snapshot=path.join(parent,run),changedNames=new Set(changed.map(f=>f.path)),currentNames=new Set(checked.files.map(f=>f.path));await mkdir(partial,{recursive:false});
 const pst=checked.files.filter(f=>/\.(pst|ost)$/i.test(f.path)).map(f=>f.path);
 const manifest={format:encryption?'backupdesk-files-v3':'backupdesk-files-v2',encryption_id:encryption?.header.key_id||null,device,device_name:deviceName||null,routine,run,created:captured.toISOString(),captured_at:captured.toISOString(),sources:originalSources,destination:checked.target,scope_key:scopeKey,backup_type:type,base_run:baseline?.manifest.run||null,base_snapshot:baseline?.snapshot||null,base_rejected:baseRejected,consistency:useVss?'vss-crash-consistent-no-writers':'closed-file-copy',vss:snapshots.map(s=>({id:s.id,volume:s.volume})),warning:baseRejected?'A base anterior estava indisponível; um novo backup completo foi criado.':null,pst_validation:pst.length?{copy_integrity:'sha256',outlook:'not-tested',files:pst}:null,deleted:baseline?.manifest.files.filter(f=>!currentNames.has(f.path)).map(f=>f.path)||[],files:[],status:'running'};
 processedBytes=0;totalBytes=changed.reduce((sum,f)=>sum+Number(f.size)*2,0);stage='copying';currentFile='';report();
 try{
  await onPlan({backup_type:type,base_run:manifest.base_run,scope_key:scopeKey,scope_sources:JSON.stringify(originalSources),scope_destination:checked.target,captured_at:manifest.captured_at,encryption_id:manifest.encryption_id});
  for(const file of checked.files){
   if(!safeRelative(file.path))throw Error('Nome de arquivo inválido.');currentFile=file.path;let digest;
   let object=changedNames.has(file.path)?(encryption?randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','')+'.bde':null):baseFiles.get(file.path)?.object;
   if(changedNames.has(file.path)){
    if(encryption){stage='copying';report();digest=await encryptFile(file.absolute,path.join(partial,'files',object),encryption.dataKey,fileAAD(manifest,object),{onBytes:n=>{processedBytes+=n;report()},throttle:n=>throttle(n,'upload')});stage='verifying';report();const {decryptHash}=await import('./encrypted-files.mjs');if(await decryptHash(path.join(partial,'files',object),encryption.dataKey,fileAAD(manifest,object),{onBytes:n=>{processedBytes+=n;report()},throttle:n=>throttle(n,'download')})!==digest)throw Error('Falha de integridade ao verificar a cópia criptografada.');}
    else digest=await copyVerified(file.absolute,path.join(partial,'files',...file.path.split('/')),file,n=>{processedBytes+=n;report()},phase=>{stage=phase;report()},n=>throttle(n,'upload'),n=>throttle(n,'download'));
    if(sourceHashes.has(file.path)&&sourceHashes.get(file.path)!==digest)throw Error('Origem alterada após comparação: '+file.path);
   }else digest=sourceHashes.get(file.path);
   const record={path:file.path,hash:digest,size:Number(file.size),mtime_ns:String(file.mtime),modified_at:modifiedDate(String(file.mtime)),source_run:changedNames.has(file.path)?run:baseline.manifest.run,...(object?{object}:{})};if(changedNames.has(file.path)&&!encryption){const modified=Number(file.mtime)/1e9;await utimes(path.join(partial,'files',...file.path.split('/')),modified,modified)}manifest.files.push(record);filesDone++;report();await onFile(record);
  }
  stage='finalizing';currentFile='';report();
  for(const file of checked.files){const current=await lstat(file.absolute,{bigint:true});if(current.isSymbolicLink()||current.size!==file.size||current.mtimeNs!==file.mtime)throw Error('Origem alterada antes de concluir: '+file.absolute)}
  for(const folder of checked.directories){const current=await lstat(folder.absolute,{bigint:true});if(current.isSymbolicLink()||current.mtimeNs!==folder.mtime)throw Error('A pasta de origem mudou durante o backup: '+folder.absolute)}
  if(!useVss)await outlookCheck(checked.files);
  manifest.changed_files=changed.length;manifest.logical_bytes=checked.files.reduce((n,f)=>n+Number(f.size),0);manifest.stored_bytes=changed.reduce((n,f)=>n+Number(f.size),0);manifest.status='success';manifest.finished=clock().toISOString();
  if(encryption)await writeEncryptedManifest(partial,manifest,encryption);else await writeFile(path.join(partial,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',flush:true});await rename(partial,snapshot);
  return {snapshot,encryption_id:manifest.encryption_id,files:manifest.files,consistency:manifest.consistency,warning:manifest.warning,pst_validation:manifest.pst_validation,backup_type:type,base_run:manifest.base_run,scope_key:scopeKey,scope_sources:manifest.sources,scope_destination:checked.target,captured_at:manifest.captured_at,logical_bytes:manifest.logical_bytes,stored_bytes:manifest.stored_bytes,changed_files:changed.length};
 }catch(e){manifest.status='failed';manifest.error=e.message;if(!encryption)await writeFile(path.join(partial,'manifest.failed.json'),JSON.stringify(manifest,null,2)).catch(()=>{});throw e}
}
export async function restoreFromDisk({snapshot,files,target,job,onProgress=()=>{},throttle=async()=>{},getKey}){onProgress({stage:'preparing',processedBytes:0,totalBytes:null});
 if(!path.isAbsolute(snapshot)||!path.isAbsolute(target)||!/^[a-zA-Z0-9_-]+$/.test(job))throw Error('Destino de restauração inválido.');
 const repository=await realpath(snapshot),base=await realpath(target);if(!(await stat(base)).isDirectory()||contained(repository,base))throw Error('Escolha uma pasta de restauração fora do backup.');
 if(!Array.isArray(files)||!files.length||files.some(f=>!safeRelative(f.path)||!/^[a-f0-9]{64}$/.test(f.hash)))throw Error('Seleção de restauração inválida.');
 const capacity=await statfs(base,{bigint:true});const needed=files.reduce((n,f)=>n+BigInt(f.size),0n);if(capacity.bavail*capacity.bsize<needed+1048576n)throw Error('Espaço insuficiente para restaurar os arquivos.');
 const deviceRepository=await realpath(path.resolve(repository,'../..'));if(contained(deviceRepository,base))throw Error('Escolha uma pasta de restauração fora do repositório de backup.');
 const destination=path.join(base,'BackupDesk-Restaurado',job);await mkdir(path.dirname(destination),{recursive:true});
 const parent=await realpath(path.dirname(destination));if(!contained(base,parent))throw Error('Destino de restauração redirecionado.');await mkdir(destination,{recursive:false});
 let processedBytes=0,filesDone=0;let totalBytes=files.reduce((sum,f)=>sum+f.size*3,0);let stage='verifying',currentFile='';const report=()=>onProgress({stage,currentFile,processedBytes,totalBytes,filesDone,totalFiles:files.length});
 const manifest=await readManifest(repository,{getKey}),catalog=new Map(manifest.files.map(f=>[f.path,f])),baseSnapshots=new Map();if(manifest.format==='backupdesk-files-v3')totalBytes=files.reduce((sum,f)=>sum+f.size*2,0);
 const restored=[];for(const file of files){currentFile=file.path;stage='verifying';report();const recorded=catalog.get(file.path);if(!recorded||recorded.hash!==file.hash||recorded.size!==file.size)throw Error('Arquivo não corresponde à versão escolhida.');const sourceRun=recorded.source_run||manifest.run;let sourceSnapshot=repository,sourceManifest=manifest,sourceRecord=recorded;if(sourceRun!==manifest.run){if(sourceRun!==manifest.base_run||!manifest.base_snapshot)throw Error('Referência diferencial inválida.');let baseVersion=baseSnapshots.get(sourceRun);if(!baseVersion){const location=await resolveBaseSnapshot(manifest,deviceRepository);const full=await readManifest(location,{getKey});if(full.run!==sourceRun||full.device!==manifest.device||full.backup_type==='differential'||full.scope_key&&full.scope_key!==manifest.scope_key)throw Error('A base do diferencial não é válida.');baseVersion={location,manifest:full,files:new Map(full.files.map(f=>[f.path,f]))};baseSnapshots.set(sourceRun,baseVersion)}const original=baseVersion.files.get(file.path);if(!original||original.hash!==file.hash||original.size!==file.size)throw Error('Arquivo não corresponde ao catálogo da base completa.');sourceSnapshot=baseVersion.location;sourceManifest=baseVersion.manifest;sourceRecord=original;}const source=await storedFile(sourceSnapshot,sourceRecord.object||file.path,deviceRepository);
 if(sourceManifest.format==='backupdesk-files-v3'){stage='copying';report();await decryptFile(source,path.join(destination,...file.path.split('/')),manifestKey(sourceManifest),fileAAD(sourceManifest,sourceRecord.object),file.hash,{onBytes:n=>{processedBytes+=n;report()},throttle:n=>throttle(n,'download')});report();}
 else{if(await fileHash(source,n=>{processedBytes+=n;report()},n=>throttle(n,'download'))!==file.hash)throw Error('Backup corrompido: '+file.path);const digest=await copyVerified(source,path.join(destination,...file.path.split('/')),undefined,n=>{processedBytes+=n;report()},phase=>{stage=phase;report()},n=>throttle(n,'download'));if(digest!==file.hash)throw Error('Falha de integridade na restauração.');}const modified=recorded.modified_at||modifiedDate(recorded.mtime_ns);if(modified){const date=new Date(modified);await utimes(path.join(destination,...file.path.split('/')),date,date)}restored.push(file.path);filesDone++;report()}stage='finalizing';currentFile='';report();return {destination,files:restored};
}
