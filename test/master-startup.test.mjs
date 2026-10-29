import {test} from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('master permanece em segundo plano, reinicia servidor e evita instância duplicada',{timeout:25000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'backupdesk-startup-'));const env={...process.env,DATA_DIR:dir,PORT:'3150'};const child=spawn(process.execPath,['master.mjs','--background'],{env,stdio:'ignore'});let second;
 try{
  const base='http://127.0.0.1:3150';async function ready(){for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/health');if((await r.json()).mode==='master')return}catch{}await pause(100)}throw Error('Servidor não iniciou')}
  await ready();second=spawn(process.execPath,['master.mjs','--background'],{env,stdio:'ignore'});const [code]=await once(second,'exit');assert.equal(code,0);
  const log=await readFile(join(dir,'startup.log'),'utf8');const pid=Number(log.match(/Servidor started: (\d+)/)[1]);process.kill(pid,'SIGTERM');await pause(2500);await ready();
  const logs=await readFile(join(dir,'startup.log'),'utf8');assert.ok((logs.match(/Servidor started:/g)||[]).length>=2);
  const session=await fetch(base+'/api/local-session',{method:'POST',headers:{Origin:base}});const {token}=await session.json();const removed=await fetch(base+'/api/local-stop',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:base}});assert.equal(removed.status,404);
 }finally{for(const p of [second,child])if(p&&p.exitCode===null&&p.signalCode===null){p.kill();await once(p,'exit')}await rm(dir,{recursive:true,force:true})}
});
