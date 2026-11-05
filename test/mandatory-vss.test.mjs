import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
test('VSS obrigatório no Windows ignora opção antiga, corrige filas e migra rotinas',{timeout:20000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'backupdesk-required-vss-'));let child,db,token;
 async function start(){child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3193',DATA_DIR:dir,ADMIN_PASSWORD:'mandatory-vss-test'},stdio:['ignore','pipe','pipe']});await once(child.stdout,'data')}
 const api=async(p,b,t=token,method,platform,version='0.18.0')=>{const r=await fetch('http://127.0.0.1:3193/api/'+p,{method:method||(b?'POST':'GET'),headers:{Authorization:'Bearer '+t,'Content-Type':'application/json','X-BackupDesk-Version':version,...(platform?{'X-BackupDesk-Platform':platform}:{})},body:b?JSON.stringify(b):undefined});return {status:r.status,body:await r.json()}};
 try{
 await start();token=(await api('login',{name:'admin',password:'mandatory-vss-test'})).body.token;
 const device=(await api('devices',{name:'Windows desktop'})).body;await api('agent/config',null,device.token,undefined,'win32');
 const routine={device:device.id,name:'PST',source:'["C:\\\\Dados"]',destination_type:'local',destination:'E:\\Backups',cadence:'daily',hour:'23:59',use_vss:false};
 const saved=await api('routines',routine);assert.equal(saved.status,201);const id=saved.body.id;assert.equal((await api('state')).body.routines[0].use_vss,1);
 await api('routines/'+id,routine,token,'PATCH');assert.equal((await api('agent/config',null,device.token,undefined,'win32')).body.routines[0].use_vss,1);
 const job=(await api('jobs',{kind:'backup',routine_id:id})).body;db=new DatabaseSync(join(dir,'backupdesk.sqlite'));db.prepare("UPDATE jobs SET payload=json_set(payload,'$.routine.use_vss',0) WHERE id=?").run(job.id);
 db.prepare('UPDATE routines SET use_vss=0 WHERE id=?').run(id);assert.equal((await api('agent/config',null,device.token,undefined,'win32')).body.routines[0].use_vss,1);
 const command=(await api('agent/commands',null,device.token,undefined,'win32')).body.commands[0];assert.equal(command.payload.routine.use_vss,1);await api('agent/jobs/'+job.id,{status:'failed',error:'teste'},device.token,undefined,'win32');
 const validated=(await api('jobs',{kind:'validate',device:device.id,source:routine.source,destination:routine.destination,use_vss:false})).body;
 const validation=(await api('agent/commands',null,device.token,undefined,'win32')).body.commands[0];assert.equal(validation.payload.useVss,true);await api('agent/jobs/'+validated.id,{status:'success',result:{}},device.token,undefined,'win32');
 const oldClientJob=(await api('jobs',{kind:'backup',routine_id:id})).body;
 assert.equal((await api('agent/commands',null,device.token,undefined,'win32','0.5.0')).body.commands.length,0);assert.equal((await api('jobs/'+oldClientJob.id)).body.status,'failed');
 db.prepare('UPDATE routines SET use_vss=0 WHERE id=?').run(id);db.close();db=null;child.kill();await once(child,'exit');await start();db=new DatabaseSync(join(dir,'backupdesk.sqlite'));assert.equal(db.prepare('SELECT use_vss FROM routines WHERE id=?').get(id).use_vss,1);db.close();db=null;
 // Linux has no Windows VSS; its existing copy mechanism must remain usable.
 assert.equal((await api('agent/config',null,device.token,undefined,'linux')).body.routines[0].use_vss,0);
 }finally{db?.close();if(child?.exitCode===null){child.kill();await once(child,'exit')}await rm(dir,{recursive:true,force:true})}
});
