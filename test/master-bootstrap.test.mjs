import {test} from 'node:test';import {DatabaseSync} from 'node:sqlite';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawn,spawnSync} from 'node:child_process';import {once} from 'node:events';
test('master registra computador uma vez e inicia agente local sem configuração manual',{timeout:20000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'backupdesk master '));const env={...process.env,DATA_DIR:join(dir,'data'),ADMIN_PASSWORD:'master-test-password',PORT:'3120',BACKUPDESK_LOCAL_MASTER:'1'};let child;
 try{
  for(let i=0;i<2;i++){const prepared=spawnSync(process.execPath,['server.mjs','--prepare-master'],{env,encoding:'utf8'});assert.equal(prepared.status,0,prepared.stderr)}
  const db=new DatabaseSync(join(dir,'data','backupdesk.sqlite'));
  const local=db.prepare('SELECT * FROM devices').get();assert.equal(db.prepare('SELECT COUNT(*) AS n FROM devices').get().n,1);
  db.prepare('INSERT INTO runs(id,device,started,status) VALUES(?,?,?,?)').run('interrupted-local',local.id,new Date().toISOString(),'running');
  db.prepare('INSERT INTO devices(id,name,owner,token) VALUES(?,?,?,?)').run('remote-device','Remote',local.owner,'remote-token');
  db.prepare('INSERT INTO runs(id,device,started,status) VALUES(?,?,?,?)').run('active-remote','remote-device',new Date().toISOString(),'running');db.close();
  child=spawn(process.execPath,['server.mjs'],{env});await once(child.stdout,'data');
  const api=async(p,b,t)=>{const r=await fetch('http://127.0.0.1:3120/api/'+p,{method:b?'POST':'GET',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});return {status:r.status,body:await r.json()}};
  const {token}= (await api('login',{name:'admin',password:'master-test-password'})).body;
  const state=(await api('state',null,token)).body;assert.equal(state.devices.length,2);const masterDevice=state.devices.find(d=>d.name.includes('Master local'));assert.ok(masterDevice);assert.equal(state.runs.find(r=>r.id==='interrupted-local').status,'failed');assert.equal(state.runs.find(r=>r.id==='active-remote').status,'running');
  await writeFile(join(dir,'amostra.txt'),'teste');const listing=await api('devices/'+masterDevice.id+'/browse',{path:dir},token);assert.equal(listing.status,200);assert.ok(listing.body.entries.some(e=>e.name==='amostra.txt'));
  await api('users',{name:'client',password:'client-test-password'},token);const client=(await api('login',{name:'client',password:'client-test-password'})).body.token;
  assert.equal((await api('download/client',null,client)).status,403);assert.equal((await api('download/client')).status,401);assert.equal((await api('download/windows',null,client)).status,403);
 }finally{if(child){child.kill();await once(child,'exit')}await rm(dir,{recursive:true,force:true})}
});
