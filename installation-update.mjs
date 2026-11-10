// This module has no enrollment, key generation or configuration write path.
import {inspectClientInstallation,readEnrollment} from './client-package.mjs';
import {inspectDeviceIdentity,inspectMasterIdentity} from './crypto-vault.mjs';
import {lstat,readFile,readdir,realpath} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';import {fileURLToPath} from 'node:url';
async function regular(file,directory=false){const info=await lstat(file);if(info.isSymbolicLink()||!(directory?info.isDirectory():info.isFile()))throw Error('Instalação redirecionada ou incompleta. Atualização bloqueada.');return info}
async function rejectKeyLinks(directory){await regular(directory,true);for(const entry of await readdir(directory,{withFileTypes:true})){const file=path.join(directory,entry.name);if(entry.isSymbolicLink())throw Error('O cofre está redirecionado. Atualização bloqueada.');if(entry.isDirectory())await rejectKeyLinks(file);else await regular(file)}}
async function localIdentity(file,{required=false}={}){
 try{await regular(file)}catch(e){if(!required&&e.code==='ENOENT')return null;throw e}
 const db=new DatabaseSync(file,{readOnly:true});try{
  const saved=db.prepare("SELECT value FROM settings WHERE name='local_master_device'").get();
  const device=saved&&db.prepare('SELECT d.id,d.token,u.role FROM devices d JOIN users u ON u.id=d.owner WHERE d.id=?').get(saved.value);
  if(!device||!/^[a-f0-9]{64}$/.test(device.id)||!/^[a-f0-9]{64}$/.test(device.token))throw Error('A identificação no banco existente está incompleta. Atualização bloqueada.');return device;
 }finally{db.close()}
}
export async function inspectInstalledApplication(directory,product,{installer}={}){
 if(!['client','master'].includes(product))throw Error('Tipo de atualização inválido.');
 if(!path.isAbsolute(directory))throw Error('Selecione a pasta da instalação existente.');
 await regular(directory,true);const root=await realpath(directory),data=path.join(root,'data');
 for(const file of ['node.exe',product==='client'?'BackupDeskClient.exe':'BackupDesk.exe'])await regular(path.join(root,file));
 await regular(data,true);await rejectKeyLinks(path.join(data,'keys'));
 if(installer&&await readEnrollment(installer))throw Error('O atualizador não pode conter identificação ou chave de um novo cadastro.');
 if(product==='client'){
  const {existing,identity}=await inspectClientInstallation(root,null);if(!existing)throw Error('Client existente não encontrado.');if((existing.mode==='local'||!existing.url)&&!/^[-a-f0-9]{36}$/i.test(existing.installation_id||''))throw Error('A identificação da instalação local está incompleta. Atualização bloqueada.');
  if(existing.mode==='local'||!existing.url)await inspectMasterIdentity(data);
  const device=await localIdentity(path.join(data,'backupdesk.sqlite'));if(device&&(device.id!==existing.device_id||device.token!==existing.token||device.role!=='client'))throw Error('O banco e o cadastro deste client são inconsistentes. Atualização bloqueada.');
  return {product,device:existing.device_id,key_id:identity.key_id};
 }
 try{await lstat(path.join(root,'agent-config.json'));throw Error('Esta pasta pertence a um client. Use a Atualização do Client.')}catch(e){if(e.code!=='ENOENT')throw e}
 const device=await localIdentity(path.join(data,'backupdesk.sqlite'),{required:true});if(device.role!=='master')throw Error('Esta instalação não é um master.');
 const master=await inspectMasterIdentity(data),identity=await inspectDeviceIdentity(data,{device:device.id,masterPublicKey:master.publicKey});
 master.verifyComputer(JSON.parse(await readFile(path.join(data,'keys','device.json'),'utf8')).header);
 return {product,device:device.id,key_id:identity.key_id,master_fingerprint:master.fingerprint};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv[2]!=='--check')throw Error('Operação inválida.');await inspectInstalledApplication(process.argv[3],process.argv[4],{installer:process.argv[5]})}
 catch(e){console.error('Não foi possível validar a instalação existente. Nenhuma chave foi criada ou substituída. '+e.message);process.exitCode=10}
}
