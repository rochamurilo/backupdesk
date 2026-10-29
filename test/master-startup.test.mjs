import {test} from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {createServer} from 'node:http';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('master registra logs, reutiliza painel e encerra pelo botão local',{timeout:20000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'backupdesk-startup-'));const env={...process.env,DATA_DIR:dir,PORT:'3150'};const child=spawn(process.execPath,['master.mjs'],{env,stdio:'ignore'});let second;
 try{
  const base='http://127.0.0.1:3150';let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/health');if((await r.json()).mode==='master'){ready=true;break}}catch{}await pause(50)}assert.ok(ready);
  for(let i=0;i<50;i++){if((await readFile(join(dir,'startup.log'),'utf8')).includes('Painel pronto.'))break;await pause(50)}assert.ok((await readFile(join(dir,'startup.log'),'utf8')).includes('Painel pronto.'));
  second=spawn(process.execPath,['master.mjs'],{env,stdio:'ignore'});const [code]=await once(second,'exit');assert.equal(code,0);assert.ok((await readFile(join(dir,'startup.log'),'utf8')).includes('já está em execução'));
  const login=await fetch(base+'/api/local-session',{method:'POST',headers:{Origin:base}});const {token}=await login.json();
  const bad=await fetch(base+'/api/local-stop',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'https://example.test'}});assert.equal(bad.status,403);
  const stopped=await fetch(base+'/api/local-stop',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:base}});assert.equal(stopped.status,200);const [exit]=await once(child,'exit');assert.equal(exit,0);
 }finally{for(const p of [second,child])if(p&&p.exitCode===null&&p.signalCode===null){p.kill();await once(p,'exit')}await rm(dir,{recursive:true,force:true})}
});
test('falha de inicialização produz log e página de diagnóstico',{timeout:15000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'backupdesk-startup-error-'));const occupied=createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"ok":true}')});await new Promise(r=>occupied.listen(3151,'127.0.0.1',r));
 const child=spawn(process.execPath,['master.mjs'],{env:{...process.env,DATA_DIR:dir,PORT:'3151'},stdio:'ignore'});
 try{const [code]=await once(child,'exit');assert.equal(code,1);assert.ok((await readFile(join(dir,'startup.log'),'utf8')).includes('EADDRINUSE'));assert.ok((await readFile(join(dir,'startup-error.html'),'utf8')).includes('Não foi possível abrir'))}finally{if(child.exitCode===null){child.kill();await once(child,'exit')}await new Promise(r=>occupied.close(r));await rm(dir,{recursive:true,force:true})}
});
