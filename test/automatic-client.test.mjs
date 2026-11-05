import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,readdir,copyFile,cp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installEnrollment} from '../client-package.mjs';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('client identificado aparece sozinho no master web e reporta backup em rede sem servidor do escritório',{timeout:40000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'backupdesk-auto-client-')),url='http://127.0.0.1:3202';let server,agent;
 try{
  for(const file of await readdir('.'))if(file.endsWith('.mjs'))await copyFile(file,join(root,file));await cp('public',join(root,'public'),{recursive:true});await mkdir(join(root,'dist'));await writeFile(join(root,'dist','BackupDesk-Client-0.14.0-x64.exe'),'MZ-test');
  server=spawn(process.execPath,[join(root,'server.mjs')],{cwd:root,env:{...process.env,PORT:'3202',HOST:'127.0.0.1',DATA_DIR:join(root,'data'),ADMIN_PASSWORD:'automatic-master-password',BACKUPDESK_CLOUD_MODE:'1',BACKUPDESK_KEY_PASSWORD:'server-private-key-password',BACKUPDESK_PUBLIC_URL:url}});await once(server.stdout,'data');
  let token;const api=async(p,b)=>{const r=await fetch(url+'/api/'+p,{method:b?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});return {status:r.status,body:await r.json()}};
  token=(await api('login',{name:'admin',password:'automatic-master-password'})).body.token;
  const response=await fetch(url+'/api/download/client',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name:'FINANCEIRO-AUTO'})});assert.equal(response.status,200);const installer=join(root,'client.exe');await writeFile(installer,Buffer.from(await response.arrayBuffer()));assert.equal((await api('state')).body.devices.length,0);
  const installation=join(root,'installed');await installEnrollment(installer,installation);const config=JSON.parse(await readFile(join(installation,'agent-config.json'),'utf8'));assert.equal(config.url,url);assert.equal(config.name,'FINANCEIRO-AUTO');assert.equal(config.username,undefined);assert.equal(config.password,undefined);
  agent=spawn(process.execPath,['agent.mjs'],{env:{...process.env,BACKUPDESK_URL:config.url,BACKUPDESK_TOKEN:config.token,BACKUPDESK_INSTALLATION_ID:config.installation_id,BACKUPDESK_RECOVERY_PUBLIC_KEY:config.recovery_public_key,BACKUPDESK_KEY_DIR:join(installation,'data'),BACKUPDESK_AGENT_STATE:join(installation,'schedule.json')},stdio:'ignore'});
  let state;for(let i=0;i<150;i++){state=(await api('state')).body;if(state.devices.length&&state.reports.length)break;await pause(40)}assert.equal(state.devices.length,1);assert.equal(state.devices[0].name,config.name);assert.equal(state.reports[0].online,true);assert.equal(state.office[config.device_id].enabled,false);
  const source=join(root,'source'),destination=join(root,'network-share');await mkdir(source);await mkdir(destination);await writeFile(join(source,'documento.txt'),'conteúdo protegido');assert.equal((await api('devices/'+config.device_id+'/preferences',{destinations:[{type:'network',path:destination}],bandwidth:{enabled:false,start:'00:00',end:'00:00',upload_mbps:null,download_mbps:null}})).status,200);
  const routine=(await api('routines',{name:'Backup em rede',device:config.device_id,source:JSON.stringify([source]),cadence:'daily',hour:'23:59'})).body.id,queued=await api('jobs',{kind:'backup',routine_id:routine});assert.equal(queued.status,201);let job;
  for(let i=0;i<300;i++){job=(await api('jobs/'+queued.body.id)).body;if(['success','failed'].includes(job.status))break;await pause(40)}assert.equal(job.status,'success',job.error);assert.equal(job.result.office_status,'not-configured');assert.ok(job.result.snapshot.startsWith(destination));assert.equal(job.result.encryption_id.length,64);assert.ok((await readdir(join(job.result.snapshot,'files'))).every(n=>n.endsWith('.bde')));assert.equal((await readdir(join(root,'data','blobs'))).length,0);
  for(let i=0;i<150;i++){state=(await api('state')).body;if(state.reports[0].last_backup_status==='success')break;await pause(40)}assert.equal(state.reports[0].last_backup_status,'success');assert.equal(state.runs[0].status,'success');assert.equal(state.runs[0].office_status,'not-configured');assert.equal(state.users.length,1,'Sem usuário de client');
 }finally{for(const child of [agent,server])if(child?.exitCode===null){child.kill();await once(child,'exit')}await rm(root,{recursive:true,force:true})}
});
