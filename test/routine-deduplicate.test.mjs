import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
test('limpeza de cópias idênticas preserva histórico, arquivos e outras contas',{timeout:15000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'backupdesk-identical-'));let db;const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3192',DATA_DIR:dir,ADMIN_PASSWORD:'dedup-test-password'},stdio:['ignore','pipe','pipe']});
 try{await once(child.stdout,'data');const api=async(p,b,t,method)=>{const r=await fetch('http://127.0.0.1:3192/api/'+p,{method:method||(b?'POST':'GET'),headers:{Authorization:'Bearer '+t,'Content-Type':'application/json','X-BackupDesk-Version':'0.26.0'},body:b?JSON.stringify(b):undefined});return {status:r.status,body:await r.json()}};
 const admin=(await api('login',{name:'admin',password:'dedup-test-password'})).body.token;
 for(const name of ['ownerA','ownerB'])await api('users',{name,password:'dedup-test-password'},admin);
 const users=(await api('state',null,admin)).body.users;const devices={},tokens={};
 for(const name of ['ownerA','ownerB']){tokens[name]=(await api('login',{name,password:'dedup-test-password'})).body.token;devices[name]=(await api('devices',{name,owner:users.find(u=>u.name===name).id},admin)).body}
 const routine={name:'Teste1',source:'["C:\\\\Dados"]',cadence:'daily',hour:'23:59',destination_type:'local',destination:'E:\\Backups',use_vss:false};
 const ids={};for(const name of ['ownerA','ownerB'])ids[name]=(await api('routines',{...routine,device:devices[name].id},tokens[name])).body.id;
 db=new DatabaseSync(join(dir,'backupdesk.sqlite'));const clone=id=>Number(db.prepare('INSERT INTO routines(device,name,cadence,hour,source,destination,destination_type,use_vss,enabled,deleted) SELECT device,name,cadence,hour,source,destination,destination_type,use_vss,enabled,deleted FROM routines WHERE id=?').run(id).lastInsertRowid);
 const duplicateA=clone(ids.ownerA);clone(ids.ownerB);
 await api('agent/config',null,devices.ownerA.token);const run=(await api('agent/runs',{routine_id:duplicateA,storage_type:'local'},devices.ownerA.token)).body;
 await api('agent/runs/'+run.id+'/files',{path:'file.txt',hash:'a'.repeat(64),size:5},devices.ownerA.token);await api('agent/runs/'+run.id+'/finish',{status:'success',snapshot:'E:\\Backups\\snapshot'},devices.ownerA.token);
 const queued=(await api('jobs',{kind:'backup',routine_id:duplicateA},tokens.ownerA)).body;
 const cleaned=(await api('routines/deduplicate',{},tokens.ownerA)).body;assert.equal(cleaned.removed,1);assert.equal(cleaned.replacements[duplicateA],ids.ownerA);
 const state=(await api('state',null,tokens.ownerA)).body;assert.deepEqual(state.routines.map(r=>r.id),[ids.ownerA]);assert.equal(state.runs.find(r=>r.id===run.id).status,'success');assert.equal((await api('runs/'+run.id+'/files',null,tokens.ownerA)).body[0].size,5);
 assert.equal((await api('jobs/'+queued.id,null,tokens.ownerA)).body.status,'failed');assert.equal((await api('state',null,tokens.ownerB)).body.routines.length,2);assert.equal((await api('routines/deduplicate',{},tokens.ownerA)).body.removed,0);
 assert.equal((await api('routines',{...routine,device:devices.ownerA.id},tokens.ownerA)).body.id,ids.ownerA);
 }finally{db?.close();child.kill();await once(child,'exit');await rm(dir,{recursive:true,force:true})}
});
