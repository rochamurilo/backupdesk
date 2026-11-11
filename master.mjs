import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {instanceLock,supervise,isUpdating,lowerPriority} from './background.mjs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdirSync,openSync,closeSync,appendFileSync,writeFileSync} from 'node:fs';
lowerPriority();
const cwd=dirname(fileURLToPath(import.meta.url));process.chdir(cwd);
if(isUpdating(cwd))process.exit(0);
const data=resolve(process.env.DATA_DIR||'data');mkdirSync(data,{recursive:true});
const logfile=join(data,'startup.log');
const log=text=>appendFileSync(logfile,new Date().toISOString()+' '+text+'\n');
const port=process.env.PORT||'3000',url=`http://127.0.0.1:${port}`;
const background=process.argv.includes('--background');
const vssAdmin=process.argv.includes('--vss-admin');const access=vssAdmin?randomBytes(32).toString('hex'):'';
const panelUrl=vssAdmin?url+'/#access='+access:url;
function openBrowser(target){if(process.platform==='win32')spawn('explorer.exe',[target],{stdio:'ignore',windowsHide:true}).on('error',e=>log('Falha ao abrir navegador: '+e.message))}
async function healthy(){try{const r=await fetch(url+'/api/health',{signal:AbortSignal.timeout(500)});const state=await r.json();return r.ok&&state.app==='backupdesk'&&state.mode==='master'}catch{return false}}
async function openWhenReady(){
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){if(await healthy()){log('Painel pronto.');if(!background)openBrowser(panelUrl);return true}await new Promise(r=>setTimeout(r,150))}
 log('O painel não respondeu; consulte startup.log. Novas tentativas continuam em segundo plano.');
 if(!background){const errorPage=join(data,'startup-error.html');writeFileSync(errorPage,'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>BackupDesk — diagnóstico</title><body style="font:18px system-ui;padding:40px"><h1>Não foi possível abrir o painel do BackupDesk</h1><p>O aplicativo foi iniciado, mas o painel ainda não respondeu. Ele continuará tentando em segundo plano.</p><p>Abra o arquivo <a href="startup.log">startup.log</a> nesta pasta para consultar o motivo.</p><p>Se outra aplicação estiver usando a porta 3000, feche-a antes de tentar novamente pelo atalho BackupDesk.</p></body></html>');openBrowser(pathToFileURL(errorPage).href)}return false;
}
const lock=await instanceLock(cwd+'-master');
if(!lock){log('Atalho acionado; aguardando a instância existente.');const ready=await openWhenReady();if(!ready)process.exitCode=1}
else{
 log('Iniciando master em segundo plano.');const fd=openSync(logfile,'a');
 const worker=supervise(process.execPath,['server.mjs'],{cwd,env:{...process.env,BACKUPDESK_LOCAL_MASTER:'1',BACKUPDESK_VSS_MODE:vssAdmin?'1':'0',BACKUPDESK_LOCAL_ACCESS:access},stdio:['ignore',fd,fd],windowsHide:true},(event,detail)=>log('Servidor '+event+': '+detail));
 function stop(){worker.stop();closeSync(fd);lock.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref()}
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
 await openWhenReady();
}
