import {readFile,writeFile,unlink} from 'node:fs/promises';import {join} from 'node:path';import assert from 'node:assert/strict';import {ensureNetworkAccess} from '../network-share.mjs';
const credentials=JSON.parse((await readFile(process.env.BACKUPDESK_NETWORK_TEST_CONFIG,'utf8')).replace(/^\uFEFF/,''));const result=await ensureNetworkAccess(credentials.destination,async()=>credentials);assert.equal(result.authenticated,true);const file=join(credentials.destination,'native-proof.txt');await writeFile(file,'BackupDesk authenticated SMB');assert.equal(await readFile(file,'utf8'),'BackupDesk authenticated SMB');await unlink(file);console.log('Native SMB authentication, Unicode password and write/read: OK.');
// Exercise signed log publication and master reading through separate worker processes over SMB.
const {mkdir,mkdtemp,rm,realpath}=await import('node:fs/promises'),{tmpdir}=await import('node:os');const {masterVault,deviceVault}=await import('../crypto-vault.mjs'),{signedStatus,verifyStatus}=await import('../status-logs.mjs'),{runLogIO}=await import('../logs-io.mjs');const temporary=await mkdtemp(join(tmpdir(),'bkd-smb-logs-'));
try{const master=await masterVault(join(temporary,'master')),device='a'.repeat(64),vault=await deviceVault(join(temporary,'device'),device,master.publicKey);const at=new Date().toISOString(),document=signedStatus(vault,{name:'Native SMB PC',version:'0.37.0',runs:[{id:'c'.repeat(64),started:at,finished:at,status:'success',bytes:12}]});for(const name of ['LocalLogs','CloudLogs']){const root=join(credentials.destination,name);await mkdir(root);await runLogIO({action:'write',root,device,document,credentials});const copy=await runLogIO({action:'read',root,device,credentials});assert.equal(verifyStatus(copy,device,vault.publicKey).runs[0].status,'success')}console.log('Native signed logs: two folders, atomic publication and master read: OK.')}finally{await rm(temporary,{recursive:true,force:true})}

const {runRestic}=await import('../restic-runner.mjs'),{randomBytes}=await import('node:crypto');const testRoot=await mkdtemp(join(tmpdir(),'bkd-smb-restic-'));
try{const repo=join(credentials.destination,'ResticLimited');await mkdir(repo);await writeFile(join(testRoot,'random.bin'),randomBytes(1024*1024));const key=randomBytes(32),opts={repository:repo,key,device:'smb',policy:{enabled:true,start:'00:00',end:'00:00',upload_mbps:2,download_mbps:4}};await runRestic({...opts,args:['init']});const started=performance.now();await runRestic({...opts,args:['backup',testRoot]});assert.ok(performance.now()-started>=4000);await runRestic({...opts,args:['check','--read-data']});assert.equal(JSON.parse(await runRestic({...opts,args:['snapshots','--json']})).length,1);console.log('Native SMB Restic: atomic writes, real upload limit and full repository verification: OK.')}finally{await rm(testRoot,{recursive:true,force:true})}

// The source is a real authenticated SMB share. No VSS component is installed
// in this job; local source paths must still be rejected in network mode.
const {backupToDisk,restoreFromDisk,validateVssDestination}=await import('../disk-backup.mjs');
const {resolveNetworkSources}=await import('../filesystem.mjs');
const copyRoot=await realpath(await mkdtemp(join(tmpdir(),'bkd-network-source-'))),source=join(credentials.destination,'EngineeringSource');
await mkdir(source);await writeFile(join(source,'engineering.txt'),'engenharia em rede');
process.env.BACKUPDESK_RESTIC_TEST_DIAGNOSTICS='1';
try{
 const master=await masterVault(join(copyRoot,'master')),vault=await deviceVault(join(copyRoot,'keys'),'network-pc',master.publicKey);
 assert.deepEqual(await resolveNetworkSources(source),[source]);
 if(process.env.BACKUPDESK_NETWORK_TEST_DRIVE){
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  await promisify(execFile)('net.exe',['use',process.env.BACKUPDESK_NETWORK_TEST_DRIVE,credentials.destination,'/persistent:no'],{windowsHide:true});
  const mapped=join(process.env.BACKUPDESK_NETWORK_TEST_DRIVE+'\\','EngineeringSource');assert.deepEqual(await resolveNetworkSources(mapped),[source]);
 }
 for(const engine of ['native','restic']){
  const destination=join(copyRoot,engine);await mkdir(destination);
  assert.equal((await validateVssDestination(source,destination,{sourceMode:'network'})).target,destination);
  const options={engine,sourceMode:'network',source,destination,device:'network-pc',routine:1,encryption:vault};
  await assert.rejects(backupToDisk({...options,sourceMode:'local',run:'wrong_mode'}),/origem.*rede|Compartilhamento de Rede/i);
  await assert.rejects(backupToDisk({...options,source:copyRoot,run:'local_bypass'}),/apenas origens de rede/);
  await assert.rejects(backupToDisk({...options,destination:source,run:'inside_source'}),/dentro da origem/);
  const updates=[],point=await backupToDisk({...options,run:'network_'+engine,onProgress:p=>updates.push(p)});
  assert.equal(point.consistency,'network-verified-file-copy');assert.match(point.warning,/sem snapshot/);
  assert.equal(updates.some(p=>p.stage.startsWith('vss_')),false);
  const restored=await restoreFromDisk({snapshot:point.snapshot,files:point.files,target:copyRoot,job:'network_restore_'+engine,getKey:h=>master.getKey(h)});
  assert.equal(await readFile(join(restored.destination,point.files[0].path),'utf8'),'engenharia em rede');
  let changed=false;
  await assert.rejects(backupToDisk({...options,run:'changed_'+engine,throttle:async(n,direction)=>{if(direction==='upload'&&!changed){changed=true;await writeFile(join(source,'engineering.txt'),'alterado durante a leitura '+engine)}}}),/alterad|mudou|catálogo/i);
  await writeFile(join(source,'engineering.txt'),'engenharia em rede');
 }
 console.log('SMB source: explicit mode, mapped drive, local/VSS protection, encrypted native/Restic restore and changed-source rejection: OK.');
}finally{await rm(copyRoot,{recursive:true,force:true})}
