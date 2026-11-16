import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,writeFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,hostname} from 'node:os';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {runRestic,resticBinary,repositoryPassword} from '../restic-runner.mjs';
import {localResticTransport} from '../restic-local-transport.mjs';

// Match the real transport listing: temporary uploads are not published locks.
const lockNames=async repository=>(await readdir(join(repository,'locks'))).filter(name=>/^[a-f0-9]{64}$/.test(name));

async function fixture(operation){
 const root=await mkdtemp(join(tmpdir(),'backupdesk-restic-lock-'));
 let child,transport;
 try{
  const repository=join(root,'repository'),source=join(root,'source');
  await mkdir(repository);await mkdir(source);
  await writeFile(join(source,'original.txt'),'original preservado');
  await writeFile(join(source,'data.bin'),randomBytes(1024*1024));
  const key=Buffer.alloc(32,7),device='lock-test',options={repository,key,device,throttle:async()=>{}};
  await runRestic({...options,args:['init','--repository-version','2']});
  const initial=JSON.parse(await runRestic({...options,args:['backup','--json',source]}).then(s=>s.trim().split('\n').at(-1)));
  assert.ok(initial.snapshot_id);
  transport=await localResticTransport(repository);
  const env=Object.fromEntries(Object.entries(process.env).filter(([name])=>!name.startsWith('RESTIC_')));
  Object.assign(env,{RESTIC_REPOSITORY:transport.url,RESTIC_PASSWORD:repositoryPassword(key,device),GOMAXPROCS:'2'});
  // A real exclusive check kept alive by a slow HTTP read, without altering the
  // encrypted lock or fabricating a PID/timestamp. Killing it leaves a fresh lock.
  child=spawn(await resticBinary(),['--no-cache','--limit-download','1','check','--read-data'],{env,stdio:'ignore',windowsHide:true});
  for(let i=0;i<300;i++){
   if((await lockNames(repository)).length)break;
   assert.equal(child.exitCode,null);await delay(50);
  }
  const locks=await lockNames(repository);assert.equal(locks.length,1);
  await operation({options,source,initial,locks,child,stop:async()=>{const ended=once(child,'exit');child.kill('SIGKILL');await ended;await transport.close();transport=null}});
 }finally{
  if(child?.exitCode===null&&child?.signalCode===null){const ended=once(child,'exit');child.kill('SIGKILL');await ended}
  await transport?.close();await rm(root,{recursive:true,force:true});
 }
}

test('Restic recupera bloqueio exclusivo abandonado após interrupção e preserva snapshot e chave',{timeout:60000},async()=>{
 await fixture(async({options,source,initial,locks,stop})=>{
  await stop();assert.deepEqual(await lockNames(options.repository),locks);
  const before=Buffer.from(options.key);
  const input=Buffer.from([join(source,'original.txt'),join(source,'data.bin'),''].join('\0'));
  const result=await runRestic({...options,input,args:['backup','--json','--host',options.device,'--files-from-raw','-']});
  assert.ok(JSON.parse(result.trim().split('\n').at(-1)).snapshot_id);
  assert.deepEqual(options.key,before);
  assert.deepEqual(await lockNames(options.repository),[]);
  const snapshots=JSON.parse(await runRestic({...options,args:['snapshots','--json']}));
  assert.equal(snapshots.length,2);assert.ok(snapshots.some(s=>s.id.startsWith(initial.snapshot_id)));
  await runRestic({...options,args:['check','--read-data']});
  const listing=await runRestic({...options,args:['ls','--json',initial.snapshot_id]});
  const original=listing.trim().split('\n').map(s=>JSON.parse(s)).find(n=>n.path?.endsWith('/original.txt'));
  assert.equal(await runRestic({...options,args:['--no-lock','dump',initial.snapshot_id,original.path]}),'original preservado');
 });
});

test('Restic preserva bloqueio ativo, informa processo e não trata chave errada como bloqueio',{timeout:60000},async()=>{
 await fixture(async({options,source,locks,child})=>{
  for(const args of [['backup','--json',source],['check','--read-data']])await assert.rejects(runRestic({...options,args}),error=>{
   assert.equal(error.code,'RESTIC_FAILED');assert.equal(error.exitCode,11);
   assert.equal(error.operation,args[0]);assert.equal(error.lockRecoveryAttempted,true);
   assert.match(error.message,/bloqueado/);assert.ok(error.message.includes(hostname()));
   assert.ok(error.message.includes(String(child.pid)));assert.doesNotMatch(error.message,/Confira acesso, chave/);
   return true;
  });
  assert.equal(child.exitCode,null);assert.deepEqual(await lockNames(options.repository),locks);
  await assert.rejects(runRestic({...options,key:Buffer.alloc(32,9),args:['cat','config']}),error=>{
   assert.equal(error.exitCode,12);assert.equal(error.lockRecoveryAttempted,undefined);assert.match(error.message,/chave/);return true;
  });
  const controller=new AbortController(),reason=Error('cancelamento de teste');controller.abort(reason);
  await assert.rejects(runRestic({...options,args:['check','--read-data'],signal:controller.signal}),error=>error===reason);
  assert.deepEqual(await lockNames(options.repository),locks);
 });
});

test('conferência integral Restic recupera bloqueio abandonado e mantém leitura e progresso',{timeout:60000},async()=>{
 await fixture(async({options,locks,stop})=>{
  await stop();assert.deepEqual(await lockNames(options.repository),locks);
  let readBytes=0;const updates=[];
  await runRestic({...options,args:['check','--read-data'],captureOutput:false,onCheckProgress:p=>updates.push(p),onTransfer:(direction,n)=>{if(direction==='download')readBytes+=n}});
  assert.ok(readBytes>1024*1024);assert.ok(updates.at(-1).totalPacks>0);
  assert.equal(updates.at(-1).packsDone,updates.at(-1).totalPacks);
  assert.deepEqual(await lockNames(options.repository),[]);
 });
});
