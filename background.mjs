import {statSync} from 'node:fs';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
export function isUpdating(directory=process.cwd(),now=Date.now()){
 try{const age=now-statSync(join(directory,'data','update-lock.json')).mtimeMs;return age>=0&&age<15*60*1000}catch{return false}
}
export async function instanceLock(key){
 const id=createHash('sha256').update(key).digest('hex').slice(0,24);
 // Windows named pipes are released by the OS when a process exits.
 const address=process.platform==='win32'?'\\\\.\\pipe\\backupdesk-'+id:join(tmpdir(),'backupdesk-'+id+'.sock');
 const server=createServer(s=>s.end());
 return new Promise((resolve,reject)=>{server.once('error',e=>(e.code==='EADDRINUSE'||(process.platform==='win32'&&e.code==='EACCES'))?resolve(null):reject(e));server.listen(address,()=>resolve(server))});
}
export function supervise(command,args,options={},onEvent=()=>{}){
 let child,timer,stopping=false;
 function start(){if(stopping)return;if(isUpdating(options.cwd||process.cwd())){timer=setTimeout(start,2000);return}child=spawn(command,args,options);onEvent('started',child.pid);let handled=false;const ended=(code)=>{if(handled)return;handled=true;onEvent('exited',code);if(!stopping)timer=setTimeout(start,2000)};child.once('exit',ended);child.once('error',e=>{onEvent('error',e.message);ended(-1)})}
 start();return {stop(){stopping=true;clearTimeout(timer);child?.kill()},get pid(){return child?.pid}};
}
