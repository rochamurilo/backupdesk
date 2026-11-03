import {readdir,lstat,stat,realpath,open,unlink,mkdir,rename,writeFile,statfs} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {Transform} from 'node:stream';import {pipeline} from 'node:stream/promises';
import {createHash,randomUUID} from 'node:crypto';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {parseSources} from './filesystem.mjs';
const execute=promisify(execFile);
function contained(parent,child){const relative=path.relative(parent,child);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))}
function safeRelative(name){return typeof name==='string'&&name.length>0&&!path.isAbsolute(name)&&!name.split(/[\\/]/).some(p=>p==='..'||p==='')&&!/^[A-Za-z]:/.test(name)}
export async function fileHash(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex')}
async function outlookCheck(files){
 if(process.platform!=='win32'||!files.some(f=>/\.(pst|ost)$/i.test(f.absolute)))return;
 const {stdout}=await execute('tasklist.exe',['/FI','IMAGENAME eq OUTLOOK.EXE','/FO','CSV','/NH'],{windowsHide:true,timeout:15000});
 if(/"OUTLOOK\.EXE"/i.test(stdout))throw Error('Feche o Outlook antes de copiar PST/OST. Backup consistente com Outlook aberto exige VSS e ainda não está disponível.');
}
async function plan(source){const roots=parseSources(source),files=[],directories=[];for(let i=0;i<roots.length;i++){
 const root=path.resolve(roots[i]),rootInfo=await lstat(root,{bigint:true});if(rootInfo.isSymbolicLink())throw Error('Selecione a pasta real, não um link: '+root);
 const prefix=roots.length>1?`${i+1}-${path.basename(root)||'unidade'}/`:'';
 async function visit(file,info){if(info.isSymbolicLink())throw Error('Link simbólico encontrado; selecione o destino real: '+file);if(info.isDirectory()){directories.push({absolute:file,mtime:info.mtimeNs});for(const e of await readdir(file,{withFileTypes:true}))await visit(path.join(file,e.name),await lstat(path.join(file,e.name),{bigint:true}))}else if(info.isFile()){const relative=path.relative(root,file)||path.basename(root);files.push({absolute:file,path:prefix+relative.split(path.sep).join('/'),size:info.size,mtime:info.mtimeNs})}else throw Error('Arquivo especial não suportado: '+file)}
 await visit(root,rootInfo);
 }return {roots,files,directories}}
export async function validateDestination(source,destination){
 if(typeof destination!=='string'||!path.isAbsolute(destination))throw Error('Selecione uma pasta de destino com caminho absoluto.');
 const target=await realpath(destination);if(!(await stat(target)).isDirectory())throw Error('O destino não é uma pasta.');
 const {roots,files,directories}=await plan(source);
 for(const root of roots){const real=await realpath(root);if((await stat(real)).isDirectory()&&contained(real,target))throw Error('O destino não pode ser a origem nem ficar dentro dela.');}
 if(!files.length)throw Error('A origem não contém arquivos para copiar.');
 const bytes=files.reduce((n,f)=>n+f.size,0n);const space=await statfs(target,{bigint:true});const available=space.bavail*space.bsize;
 const estimated=bytes+BigInt(files.length*2+directories.length+10)*space.bsize+1048576n;
 if(available<estimated)throw Error('Espaço insuficiente no destino para esta versão do backup.');
 const probe=path.join(target,'.backupdesk-check-'+randomUUID());let handle;
 try{handle=await open(probe,'wx');await handle.writeFile('BackupDesk');await handle.sync()}finally{await handle?.close();if(handle)await unlink(probe)}
 await outlookCheck(files);
 return {target,files,directories,requiredBytes:estimated.toString(),availableBytes:available.toString()};
}
async function copyVerified(source,destination,expected){
 const before=await lstat(source,{bigint:true});if(before.isSymbolicLink()||!before.isFile())throw Error('A origem deixou de ser um arquivo regular.');
 if(expected&&(before.size!==expected.size||before.mtimeNs!==expected.mtime))throw Error('Arquivo alterado antes da cópia: '+source);
 const hash=createHash('sha256');const tap=new Transform({transform(chunk,encoding,callback){hash.update(chunk);callback(null,chunk)}});
 await mkdir(path.dirname(destination),{recursive:true});
 await pipeline(createReadStream(source),tap,createWriteStream(destination,{flags:'wx',flush:true}));
 const after=await lstat(source,{bigint:true});if(before.size!==after.size||before.mtimeNs!==after.mtimeNs)throw Error('Arquivo alterado durante a cópia: '+source);
 const digest=hash.digest('hex');if(await fileHash(destination)!==digest)throw Error('Falha de integridade ao verificar a cópia.');return digest;
}
export async function backupToDisk({source,destination,device,routine,run,onFile=()=>{}}){
 const checked=await validateDestination(source,destination);
 if(!/^[a-zA-Z0-9_-]+$/.test(device)||!/^\d+$/.test(String(routine))||!/^[a-zA-Z0-9_-]+$/.test(run))throw Error('Identificação de backup inválida.');
 const parent=path.join(checked.target,'BackupDesk',device,String(routine));await mkdir(parent,{recursive:true});const canonicalParent=await realpath(parent);if(!contained(checked.target,canonicalParent))throw Error('O repositório aponta para fora do destino.');
 const partial=path.join(parent,'.partial-'+run),snapshot=path.join(parent,run);await mkdir(partial,{recursive:false});
 const manifest={format:'backupdesk-files-v1',device,routine,run,created:new Date().toISOString(),sources:parseSources(source),files:[],status:'running'};
 try{for(const file of checked.files){if(!safeRelative(file.path))throw Error('Nome de arquivo inválido.');const hash=await copyVerified(file.absolute,path.join(partial,'files',...file.path.split('/')),file);const record={path:file.path,hash,size:Number(file.size)};manifest.files.push(record);await onFile(record)}
  for(const file of checked.files){const current=await lstat(file.absolute,{bigint:true});if(current.isSymbolicLink()||current.size!==file.size||current.mtimeNs!==file.mtime)throw Error('Origem alterada antes de concluir: '+file.absolute)}
  for(const folder of checked.directories){const current=await lstat(folder.absolute,{bigint:true});if(current.isSymbolicLink()||current.mtimeNs!==folder.mtime)throw Error('A pasta de origem mudou durante o backup: '+folder.absolute)}
  await outlookCheck(checked.files);
  manifest.status='success';manifest.finished=new Date().toISOString();await writeFile(path.join(partial,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',flush:true});await rename(partial,snapshot);return {snapshot,files:manifest.files};
 }catch(e){manifest.status='failed';manifest.error=e.message;await writeFile(path.join(partial,'manifest.failed.json'),JSON.stringify(manifest,null,2)).catch(()=>{});throw e}
}
export async function restoreFromDisk({snapshot,files,target,job}){
 if(!path.isAbsolute(snapshot)||!path.isAbsolute(target)||!/^[a-zA-Z0-9_-]+$/.test(job))throw Error('Destino de restauração inválido.');
 const repository=await realpath(snapshot),base=await realpath(target);if(!(await stat(base)).isDirectory()||contained(repository,base))throw Error('Escolha uma pasta de restauração fora do backup.');
 if(!Array.isArray(files)||!files.length||files.some(f=>!safeRelative(f.path)||!/^[a-f0-9]{64}$/.test(f.hash)))throw Error('Seleção de restauração inválida.');
 const capacity=await statfs(base,{bigint:true});const needed=files.reduce((n,f)=>n+BigInt(f.size),0n);if(capacity.bavail*capacity.bsize<needed+1048576n)throw Error('Espaço insuficiente para restaurar os arquivos.');
 const destination=path.join(base,'BackupDesk-Restaurado',job);await mkdir(path.dirname(destination),{recursive:true});
 const parent=await realpath(path.dirname(destination));if(!contained(base,parent))throw Error('Destino de restauração redirecionado.');await mkdir(destination,{recursive:false});
 const restored=[];for(const file of files){const source=await realpath(path.join(repository,'files',...file.path.split('/')));if(!contained(path.join(repository,'files'),source))throw Error('Arquivo fora do backup.');if(await fileHash(source)!==file.hash)throw Error('Backup corrompido: '+file.path);const digest=await copyVerified(source,path.join(destination,...file.path.split('/')));if(digest!==file.hash)throw Error('Falha de integridade na restauração.');restored.push(file.path)}return {destination,files:restored};
}
