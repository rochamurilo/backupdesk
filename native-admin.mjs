import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
export async function launchVssAdmin(){
 if(process.platform!=='win32')throw Error('O modo VSS está disponível somente no Windows.');
 const helper=fileURLToPath(new URL('./BackupDeskVSS.exe',import.meta.url));
 try{await access(helper)}catch{throw Error('O inicializador VSS não foi encontrado. Reinstale a versão atual do BackupDesk.')}
 // Explorer invokes the installed helper's administrator manifest and the Windows UAC prompt.
 // No caller-controlled command or path is accepted.
 await new Promise((resolve,reject)=>{const child=spawn('explorer.exe',[helper],{windowsHide:true,detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve()})});
}
