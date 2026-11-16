import {test} from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {spawn} from 'node:child_process';import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {isNetworkSourcePath,sourceMode} from '../filesystem.mjs';

test('modo de origem exige escolha explícita e distingue SMB de discos e dispositivos locais',()=>{
 assert.equal(sourceMode(),'local');assert.equal(sourceMode('network'),'network');
 for(const bad of [false,null,'auto','',{}])assert.throws(()=>sourceMode(bad));
 for(const root of [String.raw`\\servidor\engenharia`,String.raw`\\servidor\engenharia\pasta`, '//servidor/engenharia/pasta'])assert.equal(isNetworkSourcePath(root),true);
 for(const root of [String.raw`H:\Dados`,String.raw`C:\Dados`,String.raw`\\?\GLOBALROOT\Device\x`,String.raw`\\.\C:\Dados`,String.raw`\\servidor`, '/tmp/local'])assert.equal(isNetworkSourcePath(root),false);
});

test('origem de rede persiste separada do VSS local, aplica preferências e bloqueia clients antigos',{timeout:25000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'backupdesk-network-source-'));let child,db,token;
 async function start(){child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3188',DATA_DIR:dir,ADMIN_PASSWORD:'network-source-test'},stdio:['ignore','pipe','pipe']});await once(child.stdout,'data')}
 const api=async(p,b,t=token,method,version='0.37.0')=>{const r=await fetch('http://127.0.0.1:3188/api/'+p,{method:method||(b?'POST':'GET'),headers:{Authorization:'Bearer '+t,'Content-Type':'application/json','X-BackupDesk-Version':version,'X-BackupDesk-Platform':'win32'},body:b?JSON.stringify(b):undefined});return {status:r.status,body:await r.json()}};
 try{
  await start();token=(await api('login',{name:'admin',password:'network-source-test'})).body.token;
  const device=(await api('devices',{name:'Network PC'})).body;await api('agent/config',null,device.token);
  const routine={device:device.id,name:'Engineering',source:JSON.stringify([String.raw`\\server\engineering`]),source_mode:'network',destination_type:'network',destination:String.raw`\\other\backups`,cadence:'daily',hour:'23:59'};
  const saved=await api('routines',routine);assert.equal(saved.status,201,JSON.stringify(saved));const id=saved.body.id;
  let stored=(await api('state')).body.routines.find(r=>r.id===id);assert.equal(stored.source_mode,'network');assert.equal(stored.use_vss,0);
  await api('routines/'+id,{...routine,name:'Engineering updated'},token,'PATCH');
  const config=(await api('agent/config',null,device.token)).body;assert.equal(config.routines[0].source_mode,'network');assert.equal(config.routines[0].use_vss,0);
  assert.equal((await api('agent/config',null,device.token,undefined,'0.35.0')).body.routines.length,0);assert.equal((await api('routines/'+id,routine,token,'PATCH')).status,400);
  assert.equal((await api('jobs',{kind:'backup',routine_id:id})).status,400);
  await api('agent/config',null,device.token);
  const job=await api('jobs',{kind:'backup',routine_id:id});assert.equal(job.status,201,JSON.stringify(job));
  const command=(await api('agent/commands',null,device.token)).body.commands[0];assert.equal(command.payload.routine.source_mode,'network');assert.equal(command.payload.routine.use_vss,0);
  await api('agent/jobs/'+job.body.id,{status:'failed',error:'fixture'},device.token);
  const queued=(await api('jobs',{kind:'backup',routine_id:id})).body;
  assert.equal((await api('agent/commands',null,device.token,undefined,'0.35.0')).body.commands.length,0);
  assert.equal((await api('jobs/'+queued.id)).body.status,'failed');
  await api('agent/config',null,device.token);
  const prefs={destinations:[{path:String.raw`E:\Backups`,type:'local'}],bandwidth:{enabled:false,start:'00:00',end:'00:00',upload_mbps:50,download_mbps:null}};
  assert.equal((await api('devices/'+device.id+'/preferences',prefs)).status,200);
  stored=(await api('state')).body.routines.find(r=>r.id===id);assert.equal(stored.source_mode,'network');assert.equal(stored.use_vss,0);
  assert.equal((await api('routines',{...routine,name:'bad',source_mode:'automatic'})).status,400);
  assert.equal((await api('routines',{...routine,name:'local',source_mode:'local',source:JSON.stringify([String.raw`C:\Dados`])})).status,201);
  const local=(await api('state')).body.routines.find(r=>r.name==='local');assert.equal(local.use_vss,1);
  child.kill();await once(child,'exit');await start();db=new DatabaseSync(join(dir,'backupdesk.sqlite'));
  assert.equal(db.prepare('SELECT use_vss FROM routines WHERE id=?').get(id).use_vss,0);assert.equal(db.prepare('SELECT use_vss FROM routines WHERE id=?').get(local.id).use_vss,1);
 }finally{db?.close();if(child?.exitCode===null){child.kill();await once(child,'exit')}await rm(dir,{recursive:true,force:true})}
});
