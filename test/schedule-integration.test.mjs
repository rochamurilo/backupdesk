import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const stop=async child=>{if(child?.exitCode===null){child.kill();await once(child,'exit')}};
test('agente real migra tentativa anterior, executa novo horário e recupera o slot sem repetir backup',{timeout:45000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'bkd-schedule-api-')),url='http://127.0.0.1:3296';let server,agent,token,logs='';
 // Use a fixed-offset zone whose local hour is midday, so both slots are due
 // without changing the OS clock or waiting until the evening.
 const offset=12-new Date().getUTCHours(),zone='Etc/GMT'+(offset>=0?'-':'+')+Math.abs(offset),date=new Intl.DateTimeFormat('sv-SE',{timeZone:zone}).format(new Date());
 const api=async(path,body,auth=token,method=body?'POST':'GET')=>{const r=await fetch(url+'/api/'+path,{method,headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json','X-BackupDesk-Version':'0.32.0','X-BackupDesk-Platform':'linux'},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()}};
 const wait=async fn=>{for(let i=0;i<400;i++){const value=await fn();if(value)return value;await pause(40)}throw Error('Espera excedida. '+logs.slice(-2000))};
 try{
  server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3296',HOST:'127.0.0.1',DATA_DIR:join(root,'server'),ADMIN_PASSWORD:'schedule-integration-password',TZ:zone},stdio:['ignore','pipe','pipe']});await once(server.stdout,'data');server.stderr.on('data',s=>{logs+=s});
  token=(await api('login',{name:'admin',password:'schedule-integration-password'})).body.token;
  const device=(await api('devices',{name:'Scheduled Client'})).body,other=(await api('devices',{name:'Other Client'})).body;
  await api('agent/config',undefined,device.token);
  const source=join(root,'source'),destination=join(root,'backup'),stateFile=join(root,'schedule.json');await mkdir(source);await mkdir(destination);await writeFile(join(source,'document.txt'),'scheduled content');
  assert.equal((await api('devices/'+device.id+'/preferences',{engine:'native',destinations:[{path:destination,type:'local'}],bandwidth:{enabled:false,start:'00:00',end:'00:00',upload_mbps:null,download_mbps:null}})).status,200);
  const config={device:device.id,name:'Scheduled',source:JSON.stringify([source]),cadence:'daily',hour:'09:00'},routine=(await api('routines',config)).body.id;
  const failed=(await api('agent/runs',{routine_id:routine,storage_type:'local',destination,schedule_hour:'09:00',schedule_date:date},device.token)).body;
  await api('agent/runs/'+failed.id+'/finish',{status:'failed',error:'previous VSS failure'},device.token);
  assert.equal((await api('agent/runs',{routine_id:routine,schedule_hour:'24:00'},device.token)).status,400);
  assert.equal((await api('agent/runs',{schedule_hour:'12:00'},device.token)).status,400);
  assert.equal((await api('agent/schedule-history',undefined,other.token)).body.attempts.length,0);
  await writeFile(stateFile,JSON.stringify({[routine]:date}));
  assert.equal((await api('routines/'+routine,{...config,hour:'12:00'},token,'PATCH')).status,200);
  async function startAgent(){agent=spawn(process.execPath,['agent.mjs'],{env:{...process.env,BACKUPDESK_URL:url,BACKUPDESK_TOKEN:device.token,BACKUPDESK_AGENT_STATE:stateFile,BACKUPDESK_KEY_DIR:join(root,'keys'),TZ:zone},stdio:['ignore','pipe','pipe']});for(const stream of [agent.stdout,agent.stderr])stream.on('data',s=>{logs+=s})}
  await startAgent();
  const completed=await wait(async()=>{const state=(await api('state')).body;return state.runs.find(r=>r.status==='success')});assert.equal(completed.schedule_hour,'12:00');assert.equal(completed.schedule_date,date);
  const history=(await api('agent/schedule-history',undefined,device.token)).body.attempts;assert.deepEqual(history.map(a=>a.schedule_hour).sort(),['09:00','12:00']);
  assert.deepEqual(JSON.parse(await readFile(stateFile,'utf8'))[routine].hours.sort(),['09:00','12:00']);
  await stop(agent);agent=null;await writeFile(stateFile,'{invalid');await startAgent();
  await wait(async()=>{try{return (await readdir(root)).some(n=>n.startsWith('schedule.json.invalid-'))}catch{return false}});await pause(2500);
  assert.equal((await api('state')).body.runs.length,2);
  const manual=(await api('jobs',{kind:'backup',routine_id:routine})).body;
  const result=await wait(async()=>{const job=(await api('jobs/'+manual.id)).body;if(job.status==='failed')throw Error(job.error);return job.status==='success'&&job.result});assert.ok(result.snapshot);
  assert.equal((await api('agent/schedule-history',undefined,device.token)).body.attempts.length,2,'Backup manual não consome slot agendado');
  const target=join(root,'restored');await mkdir(target);const restore=(await api('jobs',{kind:'restore',run:completed.id,path:'document.txt',target})).body;
  const restored=await wait(async()=>{const job=(await api('jobs/'+restore.id)).body;if(job.status==='failed')throw Error(job.error);return job.status==='success'&&job.result});
  assert.equal(await readFile(join(restored.destination,'document.txt'),'utf8'),'scheduled content');
 }finally{await stop(agent);await stop(server);await rm(root,{recursive:true,force:true})}
});
