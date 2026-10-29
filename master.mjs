import {spawn} from 'node:child_process';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const cwd=dirname(fileURLToPath(import.meta.url));
process.chdir(cwd);
const port=process.env.PORT||'3000';
const child=spawn(process.execPath,['server.mjs'],{cwd,env:{...process.env,BACKUPDESK_LOCAL_MASTER:'1'},stdio:'inherit'});
let exited=false;child.on('exit',code=>{exited=true;process.exitCode=code??1});
for(let i=0;i<100&&!exited;i++){
 await new Promise(r=>setTimeout(r,100));
 try{const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(500)});if(r.ok){
  if(process.platform==='win32')spawn('explorer.exe',[`http://127.0.0.1:${port}`],{stdio:'ignore'}).on('error',e=>console.error('Abra o painel pelo navegador:',e.message));
  break;
 }}catch{}
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{child.kill(signal)});
