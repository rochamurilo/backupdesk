import {spawn} from 'node:child_process';
import {readFile,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
export async function pickFolder(purpose='source'){
 const titles={source:'Selecione a pasta de origem do backup',destination:'Selecione onde salvar o backup',restore:'Selecione onde restaurar os arquivos',repository:'Selecione a pasta BackupDesk ou a pasta que a contém'};
 if(!Object.hasOwn(titles,purpose))throw Error('Seleção de pasta inválida.');
 if(process.platform!=='win32')throw Error('A seleção nativa de pasta está disponível no Windows.');
 const script=await readFile(new URL('./windows/folder-picker.ps1',import.meta.url),'utf8');
 const encoded=Buffer.from(script,'utf16le').toString('base64');
 const result=await new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-STA','-EncodedCommand',encoded],{env:{...process.env,BACKUPDESK_PICKER_TITLE:titles[purpose]},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='',errors='';const timer=setTimeout(()=>{child.kill();reject(Error('Tempo de seleção esgotado. Clique em Selecionar pasta para tentar novamente.'))},300000);
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',c=>{output+=c;if(output.length>1048576)child.kill()});child.stderr.on('data',c=>{errors=(errors+c).slice(-4000)});
  child.once('error',e=>{clearTimeout(timer);reject(Error('Não foi possível abrir o seletor do Windows: '+e.message))});
  child.once('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error('Não foi possível abrir o seletor de pasta: '+errors));try{resolve(JSON.parse(output.replace(/^\uFEFF/,'').trim()))}catch{reject(Error('O seletor do Windows não retornou uma pasta válida.'))}});
 });
 if(result.cancelled)return {cancelled:true,path:null};
 if(typeof result.path!=='string'||!isAbsolute(result.path)||!(await stat(result.path)).isDirectory())throw Error('A pasta selecionada não está acessível.');
 return {cancelled:false,path:result.path};
}
