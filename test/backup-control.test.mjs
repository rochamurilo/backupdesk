import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomBytes} from 'node:crypto';
import {masterVault,deviceVault} from '../crypto-vault.mjs';
import {backupToDisk,restoreFromDisk} from '../disk-backup.mjs';
import {stoppedError} from '../backup-control.mjs';
import {runRestic} from '../restic-runner.mjs';
import {localResticTransport} from '../restic-local-transport.mjs';
import {createBandwidthLimiter} from '../bandwidth.mjs';
const allDay={enabled:true,start:'00:00',end:'00:00',upload_mbps:4,download_mbps:8};
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'bkd-control-'));try{const source=join(root,'source'),destination=join(root,'backup'),target=join(root,'restore');for(const p of [source,destination,target])await mkdir(p);const master=await masterVault(join(root,'master')),vault=await deviceVault(join(root,'vault'),'pc',master.publicKey);await fn({root,source,destination,target,master,vault})}finally{await rm(root,{recursive:true,force:true})}}
for(const engine of ['native','restic'])test(engine+': cancelar cópia preserva backup anterior e permite próxima execução',{timeout:60000},()=>fixture(async({source,destination,target,master,vault})=>{
 const original=randomBytes(512*1024);await writeFile(join(source,'data.bin'),original);const opts={engine,source,destination,device:'pc',routine:1,encryption:vault},first=await backupToDisk({...opts,run:'first'});await writeFile(join(source,'data.bin'),randomBytes(2*1024*1024));const controller=new AbortController();let copied=0;
 const limiter=createBandwidthLimiter({getPolicy:()=>allDay});const throttle=async(n,direction,signal)=>{if(direction==='upload'&&(copied+=n)>200000)controller.abort(stoppedError());await limiter(n,direction,signal)};
 await assert.rejects(backupToDisk({...opts,run:'stopped',policy:allDay,signal:controller.signal,throttle}),e=>e.code==='BACKUP_STOPPED');
 await assert.rejects(readFile(join(destination,'BackupDesk','pc','1','stopped','manifest.bde')),/ENOENT/);
 const restored=await restoreFromDisk({snapshot:first.snapshot,files:first.files,target,job:'old',getKey:h=>master.getKey(h)});assert.deepEqual(await readFile(join(restored.destination,'data.bin')),original);
 const next=await backupToDisk({...opts,run:'next'});assert.equal(next.files.length,1);
}));
test('Restic local: limita bytes reais de upload e download, sem alterar formato do repositório',{timeout:60000},()=>fixture(async({source,destination,vault})=>{
 const repository=join(destination,'repo');await mkdir(repository);await writeFile(join(source,'random.bin'),randomBytes(2*1024*1024));const opts={repository,key:vault.dataKey,device:'pc'};await runRestic({...opts,args:['init']});
 let uploaded=0,downloaded=0;const limiter=createBandwidthLimiter({getPolicy:()=>allDay}),throttle=async(n,dir,signal)=>{await limiter(n,dir,signal);if(dir==='upload')uploaded+=n;else downloaded+=n};let start=performance.now();await runRestic({...opts,args:['backup',source],policy:allDay,throttle});const uploadMs=performance.now()-start;assert.ok(uploaded>2*1024*1024);assert.ok(uploadMs>=uploaded/(allDay.upload_mbps*1000000/8)*1000-200,JSON.stringify({uploadMs,uploaded}));
 downloaded=0;start=performance.now();await runRestic({...opts,args:['check','--read-data'],policy:allDay,throttle});const downloadMs=performance.now()-start;assert.ok(downloaded>2*1024*1024);assert.ok(downloadMs>=downloaded/(allDay.download_mbps*1000000/8)*1000-200,JSON.stringify({downloadMs,downloaded}));
 const snapshots=JSON.parse(await runRestic({...opts,args:['snapshots','--json']}));assert.equal(snapshots.length,1);assert.ok((await readdir(join(repository,'data'))).length);console.log(JSON.stringify({uploaded,uploadMs,downloaded,downloadMs}));
}));
test('transporte privado rejeita falta de autenticação, traversal, links e remoção de dados',{timeout:15000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'bkd-transport-'));let transport;try{await mkdir(join(root,'repo'));await mkdir(join(root,'outside'));await writeFile(join(root,'outside','secret'),'preserve');await symlink(join(root,'outside'),join(root,'repo','keys'),'dir');transport=await localResticTransport(join(root,'repo'));const url=new URL(transport.url.slice(5)),auth='Basic '+Buffer.from(decodeURIComponent(url.username)+':'+decodeURIComponent(url.password)).toString('base64');url.username='';url.password='';const base=url.href;
 assert.equal((await fetch(base+'config')).status,401);for(const name of ['data/%2e%2e%2fsecret','keys/'+ 'a'.repeat(64)])assert.ok((await fetch(base+name,{headers:{Authorization:auth}})).status>=400);assert.equal((await fetch(base+'data/'+'a'.repeat(64),{method:'DELETE',headers:{Authorization:auth}})).status,405);assert.equal(await readFile(join(root,'outside','secret'),'utf8'),'preserve');
 }finally{await transport?.close();await rm(root,{recursive:true,force:true})}
});
