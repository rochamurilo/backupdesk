import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
test('API diferencia bytes gravados de catálogo lógico e recusa referências de outra base ou computador',{timeout:15000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'backupdesk-diff-api-'));const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3194',DATA_DIR:dir,ADMIN_PASSWORD:'differential-test'},stdio:['ignore','pipe','pipe']});let db;
 const api=async(p,b,t)=>{const r=await fetch('http://127.0.0.1:3194/api/'+p,{method:b?'POST':'GET',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json','X-BackupDesk-Version':'0.9.0','X-BackupDesk-Platform':'linux'},body:b?JSON.stringify(b):undefined});return {status:r.status,body:await r.json()}};
 try{await once(child.stdout,'data');const master=(await api('login',{name:'admin',password:'differential-test'})).body.token;const a=(await api('devices',{name:'A'},master)).body,b=(await api('devices',{name:'B'},master)).body;db=new DatabaseSync(join(dir,'backupdesk.sqlite'));
 const scope='f'.repeat(64),hash='a'.repeat(64),time=new Date().toISOString();
 const start=async device=>(await api('agent/runs',{storage_type:'local'},device.token)).body.id;
 // Standalone legacy upload defaults server; this fixture models confirmed disk versions.
 const full=await start(a);db.prepare("UPDATE runs SET storage_type='local' WHERE id=?").run(full);
 const plan={backup_type:'full',base_run:null,scope_key:scope,scope_sources:'["/source"]',scope_destination:'/target',captured_at:time};assert.equal((await api('agent/runs/'+full+'/plan',plan,a.token)).status,200);
 assert.equal((await api('agent/runs/'+full+'/files',{path:'stable.txt',hash,size:10,source_run:full},a.token)).status,201);assert.equal((await api('agent/runs/'+full+'/finish',{status:'success',snapshot:'/target/full'},a.token)).status,200);
 const diff=await start(a);db.prepare("UPDATE runs SET storage_type='local' WHERE id=?").run(diff);assert.equal((await api('agent/runs/'+diff+'/plan',{...plan,backup_type:'differential',base_run:full},a.token)).status,200);
 assert.equal((await api('agent/runs/'+diff+'/files',{path:'stable.txt',hash:'b'.repeat(64),size:10,source_run:full},a.token)).status,400);
 assert.equal((await api('agent/runs/'+diff+'/files',{path:'stable.txt',hash,size:10,source_run:'c'.repeat(64)},a.token)).status,400);
 assert.equal((await api('agent/runs/'+diff+'/files',{path:'stable.txt',hash,size:10,source_run:full},a.token)).status,201);
 assert.equal((await api('agent/runs/'+diff+'/files',{path:'new.txt',hash,size:5,source_run:diff},a.token)).status,201);
 assert.equal((await api('agent/runs/'+diff+'/plan',plan,a.token)).status,400);
 assert.equal((await api('agent/runs/'+diff+'/finish',{status:'success',snapshot:'/target/diff',changed_files:1},a.token)).status,200);
 const row=(await api('state',null,master)).body.runs.find(r=>r.id===diff);assert.equal(row.bytes,5);assert.equal(row.logical_bytes,15);assert.equal(row.changed_files,1);
 const other=await start(b);for(const base of [full,diff])assert.equal((await api('agent/runs/'+other+'/plan',{...plan,backup_type:'differential',base_run:base},b.token)).status,400);
 const another=await start(a);assert.equal((await api('agent/runs/'+another+'/plan',{...plan,backup_type:'differential',base_run:diff},a.token)).status,400);assert.equal((await api('agent/runs/'+another+'/plan',{...plan,scope_key:'c'.repeat(64),backup_type:'differential',base_run:full},a.token)).status,400);
 db.prepare('UPDATE runs SET finished=? WHERE id=?').run(new Date(Date.now()-6*86400000).toISOString(),full);assert.equal((await api('agent/runs/'+another+'/plan',{...plan,backup_type:'differential',base_run:full},a.token)).status,400);
 }finally{db?.close();child.kill();await once(child,'exit');await rm(dir,{recursive:true,force:true})}
});
