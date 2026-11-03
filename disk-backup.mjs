import {readdir,lstat,stat,realpath,open,unlink,mkdir,rename,writeFile,statfs} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';import {pipeline} from 'node:stream/promises';
import {createHash,randomUUID} from 'node:crypto';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {parseSources} from './filesystem.mjs';
import {withVssSources} from './vss.mjs';
const execute=promisify(execFile);
function contained(parent,child){const relative=path.relative(parent,child);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))}
function safeRelative(name){return typeof name==='string'&&name.length>0&&!path.isAbsolute(name)&&!name.split(/[\\/]/).some(p=>p==='..'||p==='')&&!/^[A-Za-z]:/.test(name)}
export async function fileHash(file,onBytes=()=>{}){const hash=createHash('sha256');for await(const chunk of createReadStream(file)){hash.update(chunk);onBytes(chunk.length)}return hash.digest('hex')}
async function outlookCheck(files){
 if(process.platform!=='win32'||!files.some(f=>/\.(pst|ost)$/i.test(f.absolute)))return;
 const {stdout}=await execute('tasklist.exe',['/FI','IMAGENAME eq OUTLOOK.EXE','/FO','CSV','/NH'],{windowsHide:true,timeout:15000});
 if(/"OUTLOOK\.EXE"/i.test(stdout))throw Error('Esta rotina está sem VSS. Para copiar PST/OST, feche o Outlook ou edite a rotina, marque Usar VSS, salve e abra BackupDesk VSS (administrador). O VSS continua experimental e exige validar a restauração do PST.');
}
async function plan(source,onProgress=()=>{}){onProgress({stage:'scanning',currentFile:'',processedBytes:0,totalBytes:null,filesDone:0,totalFiles:null});const roots=parseSources(source),files=[],directories=[];for(let i=0;i<roots.length;i++){
 const root=path.resolve(roots[i]),rootInfo=await lstat(root,{bigint:true});if(rootInfo.isSymbolicLink())throw Error('Selecione a pasta real, não um link: '+root);
 const prefix=roots.length>1?`${i+1}-${path.basename(root)||'unidade'}/`:'';
 async function visit(file,info){onProgress({stage:'scanning',currentFile:file,filesFound:files.length});if(info.isSymbolicLink())throw Error('Link simbólico encontrado; selecione o destino real: '+file);if(info.isDirectory()){directories.push({absolute:file,mtime:info.mtimeNs});for(const e of await readdir(file,{withFileTypes:true}))await visit(path.join(file,e.name),await lstat(path.join(file,e.name),{bigint:true}))}else if(info.isFile()){const relative=path.relative(root,file)||path.basename(root);files.push({absolute:file,path:prefix+relative.split(path.sep).join('/'),size:info.size,mtime:info.mtimeNs})}else throw Error('Arquivo especial não suportado: '+file)}
 await visit(root,rootInfo);
 }return {roots,files,directories}}
export async function validateDestination(source,destination,{useVss=false,onProgress=()=>{}}={}){
 if(typeof destination!=='string'||!path.isAbsolute(destination))throw Error('Selecione uma pasta de destino com caminho absoluto.');
 const target=await realpath(destination);if(!(await stat(target)).isDirectory())throw Error('O destino não é uma pasta.');
 const {roots,files,directories}=await plan(source,onProgress);onProgress({stage:'checking_destination',currentFile:'',totalFiles:files.length});
 for(const root of roots){const real=await realpath(root);if((await stat(real)).isDirectory()&&contained(real,target))throw Error('O destino não pode ser a origem nem ficar dentro dela.');}
 if(!files.length)throw Error('A origem não contém arquivos para copiar.');
 const bytes=files.reduce((n,f)=>n+f.size,0n);const space=await statfs(target,{bigint:true});const available=space.bavail*space.bsize;
 const estimated=bytes+BigInt(files.length*2+directories.length+10)*space.bsize+1048576n;
 if(available<estimated)throw Error('Espaço insuficiente no destino para esta versão do backup.');
 const probe=path.join(target,'.backupdesk-check-'+randomUUID());let handle;
 try{handle=await open(probe,'wx');await handle.writeFile('BackupDesk');await handle.sync()}finally{await handle?.close();if(handle)await unlink(probe)}
 if(!useVss)await outlookCheck(files);
 return {target,files,directories,requiredBytes:estimated.toString(),availableBytes:available.toString()};
}
async function copyVerified(source,destination,expected,onBytes=()=>{},onPhase=()=>{}){onPhase('copying');
 const before=await lstat(source,{bigint:true});if(before.isSymbolicLink()||!before.isFile())throw Error('A origem deixou de ser um arquivo regular.');
 if(expected&&(before.size!==expected.size||before.mtimeNs!==expected.mtime))throw Error('Arquivo alterado antes da cópia: '+source);
 const hash=createHash('sha256');const tap=new Transform({transform(chunk,encoding,callback){hash.update(chunk);onBytes(chunk.length);callback(null,chunk)}});
 await mkdir(path.dirname(destination),{recursive:true});
 await pipeline(createReadStream(source),tap,createWriteStream(destination,{flags:'wx',flush:true}));
 const after=await lstat(source,{bigint:true});if(before.size!==after.size||before.mtimeNs!==after.mtimeNs)throw Error('Arquivo alterado durante a cópia: '+source);
 const digest=hash.digest('hex');onPhase('verifying');if(await fileHash(destination,onBytes)!==digest)throw Error('Falha de integridade ao verificar a cópia.');return digest;
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
 const {source,destination,useVss=false,onProgress=()=>{}}=options;onProgress({stage:'preparing',processedBytes:0,totalBytes:null});
 if(useVss){const checked=await vssPreflight(source,destination);return withVssSources(checked.canonical,async(mapped,snapshots)=>copyToDisk({...options,source:JSON.stringify(mapped),originalSources:checked.original,snapshots,useVss:true}),undefined,onProgress)}
 return copyToDisk(options);
}
async function copyToDisk({source,destination,device,routine,run,onFile=()=>{},useVss=false,originalSources,snapshots=[],onProgress=()=>{}}){
 const checked=await validateDestination(source,destination,{useVss,onProgress});
 if(!/^[a-zA-Z0-9_-]+$/.test(device)||!/^\d+$/.test(String(routine))||!/^[a-zA-Z0-9_-]+$/.test(run))throw Error('Identificação de backup inválida.');
 const parent=path.join(checked.target,'BackupDesk',device,String(routine));await mkdir(parent,{recursive:true});const canonicalParent=await realpath(parent);if(!contained(checked.target,canonicalParent))throw Error('O repositório aponta para fora do destino.');
 const partial=path.join(parent,'.partial-'+run),snapshot=path.join(parent,run);await mkdir(partial,{recursive:false});
 let processedBytes=0,filesDone=0;const totalBytes=checked.files.reduce((sum,f)=>sum+Number(f.size)*2,0);let currentFile='',stage='copying';
 const report=()=>onProgress({stage,currentFile,processedBytes,totalBytes,filesDone,totalFiles:checked.files.length});
 const manifest={format:'backupdesk-files-v1',device,routine,run,created:new Date().toISOString(),sources:originalSources||parseSources(source),consistency:useVss?'vss-crash-consistent-no-writers':'closed-file-copy',vss:snapshots.map(s=>({id:s.id,volume:s.volume})),warning:useVss?'PST requer validação de recuperação no Outlook; VSS sem writers não garante consistência da aplicação.':null,files:[],status:'running'};
 try{for(const file of checked.files){if(!safeRelative(file.path))throw Error('Nome de arquivo inválido.');currentFile=file.path;const hash=await copyVerified(file.absolute,path.join(partial,'files',...file.path.split('/')),file,n=>{processedBytes+=n;report()},phase=>{stage=phase;report()});filesDone++;report();const record={path:file.path,hash,size:Number(file.size)};manifest.files.push(record);await onFile(record)}
  stage='finalizing';currentFile='';report();
  for(const file of checked.files){const current=await lstat(file.absolute,{bigint:true});if(current.isSymbolicLink()||current.size!==file.size||current.mtimeNs!==file.mtime)throw Error('Origem alterada antes de concluir: '+file.absolute)}
  for(const folder of checked.directories){const current=await lstat(folder.absolute,{bigint:true});if(current.isSymbolicLink()||current.mtimeNs!==folder.mtime)throw Error('A pasta de origem mudou durante o backup: '+folder.absolute)}
  if(!useVss)await outlookCheck(checked.files);
  manifest.status='success';manifest.finished=new Date().toISOString();await writeFile(path.join(partial,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',flush:true});await rename(partial,snapshot);return {snapshot,files:manifest.files,consistency:manifest.consistency,warning:manifest.warning};
 }catch(e){manifest.status='failed';manifest.error=e.message;await writeFile(path.join(partial,'manifest.failed.json'),JSON.stringify(manifest,null,2)).catch(()=>{});throw e}
}
export async function restoreFromDisk({snapshot,files,target,job,onProgress=()=>{}}){onProgress({stage:'preparing',processedBytes:0,totalBytes:null});
 if(!path.isAbsolute(snapshot)||!path.isAbsolute(target)||!/^[a-zA-Z0-9_-]+$/.test(job))throw Error('Destino de restauração inválido.');
 const repository=await realpath(snapshot),base=await realpath(target);if(!(await stat(base)).isDirectory()||contained(repository,base))throw Error('Escolha uma pasta de restauração fora do backup.');
 if(!Array.isArray(files)||!files.length||files.some(f=>!safeRelative(f.path)||!/^[a-f0-9]{64}$/.test(f.hash)))throw Error('Seleção de restauração inválida.');
 const capacity=await statfs(base,{bigint:true});const needed=files.reduce((n,f)=>n+BigInt(f.size),0n);if(capacity.bavail*capacity.bsize<needed+1048576n)throw Error('Espaço insuficiente para restaurar os arquivos.');
 const destination=path.join(base,'BackupDesk-Restaurado',job);await mkdir(path.dirname(destination),{recursive:true});
 const parent=await realpath(path.dirname(destination));if(!contained(base,parent))throw Error('Destino de restauração redirecionado.');await mkdir(destination,{recursive:false});
 let processedBytes=0,filesDone=0;const totalBytes=files.reduce((sum,f)=>sum+f.size*3,0);let stage='verifying',currentFile='';const report=()=>onProgress({stage,currentFile,processedBytes,totalBytes,filesDone,totalFiles:files.length});
 const restored=[];for(const file of files){currentFile=file.path;stage='verifying';report();const source=await realpath(path.join(repository,'files',...file.path.split('/')));if(!contained(path.join(repository,'files'),source))throw Error('Arquivo fora do backup.');if(await fileHash(source,n=>{processedBytes+=n;report()})!==file.hash)throw Error('Backup corrompido: '+file.path);const digest=await copyVerified(source,path.join(destination,...file.path.split('/')),undefined,n=>{processedBytes+=n;report()},phase=>{stage=phase;report()});if(digest!==file.hash)throw Error('Falha de integridade na restauração.');restored.push(file.path);filesDone++;report()}stage='finalizing';currentFile='';report();return {destination,files:restored};
}
