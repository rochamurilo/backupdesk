import {spawn} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdirSync,openSync,closeSync,appendFileSync,writeFileSync} from 'node:fs';
const cwd=dirname(fileURLToPath(import.meta.url));process.chdir(cwd);
const data=resolve(process.env.DATA_DIR||'data');mkdirSync(data,{recursive:true});
const logfile=join(data,'startup.log');
const log=text=>appendFileSync(logfile,new Date().toISOString()+' '+text+'\n');
const port=process.env.PORT||'3000',url=`http://127.0.0.1:${port}`;
function openBrowser(target){if(process.platform==='win32')spawn('explorer.exe',[target],{stdio:'ignore',windowsHide:true}).on('error',e=>log('Falha ao abrir navegador: '+e.message))}
async function healthy(){try{const r=await fetch(url+'/api/health',{signal:AbortSignal.timeout(500)});const state=await r.json();return r.ok&&state.app==='backupdesk'&&state.mode==='master'}catch{return false}}
if(await healthy()){
 log('Master já está em execução; abrindo painel existente.');openBrowser(url);
}else{
 log('Iniciando master.');const fd=openSync(logfile,'a');
 const child=spawn(process.execPath,['server.mjs'],{cwd,env:{...process.env,BACKUPDESK_LOCAL_MASTER:'1'},stdio:['ignore',fd,fd],windowsHide:true});closeSync(fd);
 let exited=false,ready=false;
 child.on('error',e=>{log('Falha ao iniciar servidor: '+e.message);exited=true;process.exitCode=1});
 child.on('exit',code=>{exited=true;process.exitCode=code??1;log('Servidor encerrado: '+code)});
 for(let i=0;i<150&&!exited;i++){
  if(await healthy()){ready=true;log('Painel pronto.');openBrowser(url);break}
  await new Promise(r=>setTimeout(r,100));
 }
 if(!ready){
  log('O painel não ficou disponível. Confira os erros acima.');child.kill();process.exitCode=1;
  const errorPage=join(data,'startup-error.html');
  writeFileSync(errorPage,'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>BackupDesk — inicialização</title><body style="font:18px system-ui;padding:40px"><h1>Não foi possível abrir o BackupDesk</h1><p>Confira o arquivo <b>startup.log</b> nesta pasta para identificar o erro.</p><p>Se outra versão estiver aberta, feche-a e abra novamente pelo atalho BackupDesk.</p></body></html>');openBrowser(pathToFileURL(errorPage).href);
 }
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
}
