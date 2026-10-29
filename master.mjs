import {spawn} from 'node:child_process';
import {instanceLock,supervise} from './background.mjs';
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
const lock=await instanceLock(cwd+'-master');
if(!lock){if(!process.argv.includes('--background'))openBrowser(url)}else{
 log('Iniciando master em segundo plano.');const fd=openSync(logfile,'a');
 const worker=supervise(process.execPath,['server.mjs'],{cwd,env:{...process.env,BACKUPDESK_LOCAL_MASTER:'1'},stdio:['ignore',fd,fd],windowsHide:true},(event,detail)=>log('Servidor '+event+': '+detail));
 let ready=false;
 for(let i=0;i<150;i++){if(await healthy()){ready=true;log('Painel pronto.');if(!process.argv.includes('--background'))openBrowser(url);break}await new Promise(r=>setTimeout(r,100))}
 if(!ready){log('O painel não ficou disponível; novas tentativas continuam em segundo plano.');if(!process.argv.includes('--background')){const errorPage=join(data,'startup-error.html');writeFileSync(errorPage,'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>BackupDesk</title><body><h1>O BackupDesk ainda está iniciando</h1><p>O programa continuará tentando em segundo plano. Consulte startup.log nesta pasta.</p></body></html>');openBrowser(pathToFileURL(errorPage).href)}}
 function stop(){worker.stop();closeSync(fd);lock.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref()}
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
}
