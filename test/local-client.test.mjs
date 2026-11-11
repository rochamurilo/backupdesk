import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readFile,readdir,copyFile,cp,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
import {installEnrollment,readEnrollment} from '../client-package.mjs';
import {masterVault,deviceVault,formatComputerKey} from '../crypto-vault.mjs';
import {signedStatus,verifyStatus} from '../status-logs.mjs';
import {logFile,logIO} from '../logs-io.mjs';import {overviewRuns} from '../overview-status.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,message='Tempo de espera excedido'){for(let i=0;i<1000;i++){const result=await fn();if(result)return result;await pause(40)}throw Error(message)}
async function stop(child){if(child?.exitCode===null){child.kill();await once(child,'exit')}}
test('client sem endereço: backup/restauração com master desligado, agendamento persistente e primeiro vínculo por log autenticado',{timeout:180000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'bkd-offline-client-')),central=join(root,'central'),client=join(root,'client');let masterProcess,clientProcess;
 try{
  for(const dir of [central,client]){await mkdir(dir);for(const file of await readdir('.'))if(file.endsWith('.mjs'))await copyFile(file,join(dir,file));await cp('public',join(dir,'public'),{recursive:true})}
  await mkdir(join(central,'dist'));await writeFile(join(central,'dist','BackupDesk-Client-0.31.0-x64.exe'),'MZ-test');
  await copyFile('windows/launch-agent.mjs',join(client,'launch-agent.mjs'));await mkdir(join(client,'bin'));await copyFile('bin/restic',join(client,'bin','restic'));
  const masterURL='http://127.0.0.1:3212',clientURL='http://127.0.0.1:3213';let masterToken,clientToken;
  const api=async(base,path,body,token=base===masterURL?masterToken:clientToken)=>{const response=await fetch(base+'/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Origin:base},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()}};
  async function startMaster(){masterProcess=spawn(process.execPath,[join(central,'server.mjs')],{cwd:central,env:{...process.env,PORT:'3212',DATA_DIR:join(central,'data'),BACKUPDESK_LOCAL_MASTER:'1'},stdio:'ignore'});await wait(async()=>{try{return(await api(masterURL,'health')).status===200}catch{return false}});masterToken=(await api(masterURL,'local-session',{})).body.token}
  async function startClient(){clientProcess=spawn(process.execPath,[join(client,'launch-agent.mjs')],{cwd:client,env:{...process.env,PORT:'3213'},stdio:'ignore'});await wait(async()=>{try{return(await api(clientURL,'health')).body.mode==='client'}catch{return false}},'O client local não iniciou.');clientToken=(await api(clientURL,'local-session',{})).body.token;await wait(async()=>{const s=(await api(clientURL,'state')).body;return s.devices[0]?.version==='0.31.0'&&s})}
  await startMaster();const masterState=(await api(masterURL,'state')).body,masterId=masterState.localDeviceId;
  const shared=join(root,'network-logs'),cloud=join(root,'cloud-logs'),source=join(root,'source'),destination=join(root,'backup'),target=join(root,'restore');for(const p of [shared,cloud,source,destination,target])await mkdir(p);
  await api(masterURL,'devices/'+masterId+'/logs',{local:{path:shared},cloud:{path:cloud}});
  const download=await fetch(masterURL+'/api/download/client',{method:'POST',headers:{Authorization:'Bearer '+masterToken,'Content-Type':'application/json'},body:JSON.stringify({name:'CLIENT-OFFLINE'})});assert.equal(download.status,200);assert.equal(download.headers.get('X-BackupDesk-Connection'),'local');
  const installer=join(root,'named.exe');await writeFile(installer,Buffer.from(await download.arrayBuffer()));const enrollment=await readEnrollment(installer);assert.equal(enrollment.url,null);assert.equal(enrollment.mode,'local');assert.equal(enrollment.log_defaults.local.path,shared);
  assert.equal((await installEnrollment(installer,client)).configured,true);const config=JSON.parse(await readFile(join(client,'agent-config.json'),'utf8'));assert.equal(config.security_key,undefined);
  await stop(masterProcess);masterProcess=null;await startClient();
  const local=(await api(clientURL,'state')).body;assert.equal(local.clientMode,true);assert.equal(local.user.role,'client');assert.deepEqual(local.devices.map(d=>d.id),[config.device_id]);assert.equal(local.devices[0].name,config.name);assert.equal(local.logPreferences[config.device_id].local.path,shared);
  const ownKey=await wait(async()=>{const r=await api(clientURL,'devices/'+config.device_id+'/security-key',{});return r.status===200&&r.body});assert.equal(ownKey.security_key,enrollment.security_key);assert.equal((await api(clientURL,'devices/'+masterId+'/security-key',{})).status,403);
  assert.equal((await api(clientURL,'download/client',{name:'another'})).status,403);assert.equal((await api(clientURL,'users',{name:'x',password:'x'.repeat(12)})).status,403);assert.equal((await api(clientURL,'devices/'+masterId+'/preferences')).status,404);
  const expected=Buffer.from('Dados restauráveis mesmo com o master desligado.');await writeFile(join(source,'documento.txt'),expected);
  assert.equal((await api(clientURL,'devices/'+config.device_id+'/preferences',{engine:'restic',destinations:[{path:destination,type:'local'}],bandwidth:{enabled:false,start:'00:00',end:'00:00',upload_mbps:50,download_mbps:null}})).status,200);
  const routine=(await api(clientURL,'routines',{device:config.device_id,name:'Rotina local',source:JSON.stringify([source]),cadence:'daily',hour:'23:59'})).body;
  async function job(payload){const queued=await api(clientURL,'jobs',payload);assert.equal(queued.status,201,JSON.stringify(queued.body));return wait(async()=>{const result=(await api(clientURL,'jobs/'+queued.body.id)).body;assert.notEqual(result.status,'failed',result.error);return result.status==='success'&&result.result})}
  const backed=await job({kind:'backup',routine_id:routine.id});assert.equal(backed.backup_type,'snapshot');assert.equal(backed.integrity.checked_this_run,true);
  const restored=await job({kind:'restore',run:backed.run,path:'documento.txt',target});assert.deepEqual(await readFile(join(restored.destination,'documento.txt')),expected);
  await wait(async()=>{try{const doc=JSON.parse(await readFile(logFile(shared,config.device_id)));return JSON.parse(doc.payload).runs.some(r=>r.id===backed.run&&r.status==='success')}catch{return false}});
  const document=JSON.parse(await readFile(logFile(shared,config.device_id))),recovery=await masterVault(join(central,'data'));assert.deepEqual(await recovery.getKey(document.registration.header),await deviceVault(join(client,'data'),config.device_id,enrollment.recovery_public_key).then(v=>v.dataKey));
  assert.equal(verifyStatus(document,config.device_id,document.registration.publicKey).installation.id,config.installation_id);
  // The master has never been contacted by this client; only the share enrolls it.
  await startMaster();await api(masterURL,'logs/refresh',{});
  const dashboard=await wait(async()=>{const s=(await api(masterURL,'state')).body;return s.devices.some(d=>d.id===config.device_id)&&s.logReports.some(r=>r.device===config.device_id&&r.runs.some(v=>v.id===backed.run&&v.status==='success'))&&s});
  assert.equal(dashboard.runs.some(r=>r.device===config.device_id),false);assert.equal(overviewRuns(dashboard).find(r=>r.id===backed.run).status,'success');assert.equal(dashboard.devices.find(d=>d.id===config.device_id).installed_at,config.installed_at);assert.equal((await api(masterURL,'jobs',{kind:'catalog',device:config.device_id,source:destination})).status,409);assert.equal((await api(masterURL,'devices/'+config.device_id+'/preferences',{destinations:[],bandwidth:{enabled:false,start:'00:00',end:'00:00',upload_mbps:null,download_mbps:null}})).status,409);
  const healthy=JSON.parse(await readFile(logFile(cloud,config.device_id))),vault=await deviceVault(join(client,'data'),config.device_id,enrollment.recovery_public_key);
  // Copying a signed payload and claiming a second installation cannot change the binding.
  const copied=signedStatus(vault,{name:config.name,version:'0.31.0',runs:[],installation:{id:randomUUID(),installed_at:config.installed_at,platform:process.platform}});for(const folder of [shared,cloud])await logIO({action:'write',root:folder,device:config.device_id,document:copied});await api(masterURL,'logs/refresh',{});
  await wait(async()=>{const s=(await api(masterURL,'devices/'+config.device_id+'/logs')).body;return /outra instalação/.test(s.local.access?.read?.error||'')});assert.ok((await api(masterURL,'state')).body.logReports.find(r=>r.device===config.device_id).runs.some(r=>r.id===backed.run));
  for(const folder of [shared,cloud])await logIO({action:'write',root:folder,device:config.device_id,document:healthy});
  // A newly generated, self-signed key cannot replace the key chosen by the master.
  const fakeDownload=await fetch(masterURL+'/api/download/client',{method:'POST',headers:{Authorization:'Bearer '+masterToken,'Content-Type':'application/json'},body:JSON.stringify({name:'FALSE-CLIENT'})});const fakeFile=join(root,'false.exe');await writeFile(fakeFile,Buffer.from(await fakeDownload.arrayBuffer()));const fakeConfig=await readEnrollment(fakeFile),fakeVault=await deviceVault(join(root,'attacker'),fakeConfig.device_id,enrollment.recovery_public_key);
  const fake=signedStatus(fakeVault,{name:'FALSE-CLIENT',version:'0.31.0',runs:[],installation:{id:randomUUID(),installed_at:new Date().toISOString(),platform:process.platform}});await logIO({action:'write',root:shared,device:fakeConfig.device_id,document:fake});await api(masterURL,'logs/refresh',{});
  await wait(async()=>{const s=(await api(masterURL,'devices/'+fakeConfig.device_id+'/logs')).body;return /difere/.test(s.local.access?.read?.error||'')});assert.equal((await api(masterURL,'state')).body.devices.some(d=>d.id===fakeConfig.device_id),false);
  // Scheduling is local and persists the attempt through a second restart.
  await stop(masterProcess);masterProcess=null;
  const response=await fetch(clientURL+'/api/routines/'+routine.id,{method:'PATCH',headers:{Authorization:'Bearer '+clientToken,'Content-Type':'application/json',Origin:clientURL},body:JSON.stringify({device:config.device_id,name:'Rotina local',source:JSON.stringify([source]),cadence:'daily',hour:'00:00'})});assert.equal(response.status,200);
  await stop(clientProcess);clientProcess=null;await startClient();
  const scheduled=await wait(async()=>{const s=(await api(clientURL,'state')).body;return s.runs.filter(r=>r.status==='success').length===2&&s});assert.equal(scheduled.runs.every(r=>r.status==='success'),true);
  await stop(clientProcess);clientProcess=null;await writeFile(join(client,'data','client-agent-state.json'),'{invalid');await startClient();await pause(2000);assert.equal((await api(clientURL,'state')).body.runs.length,2);assert.ok((await readdir(join(client,'data'))).some(n=>n.startsWith('client-agent-state.json.invalid-')));
 }catch(e){try{e.message+='\n'+(await readFile(join(client,'data','agent.log'),'utf8')).slice(-4000)}catch{}throw e}
 finally{await stop(clientProcess);await stop(masterProcess);await rm(root,{recursive:true,force:true})}
});
