import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {selectRestorePoints,restoreVolumeAt} from '../restore-tree.mjs';import {gigabytes} from '../progress.mjs';
import {overviewSelectedVolume} from '../overview-status.mjs';import {masterVault,deviceVault} from '../crypto-vault.mjs';
import {signedStatus,verifyStatus,statusJournal,cleanSelectedVolume} from '../status-logs.mjs';import {backupToDisk,restoreFromDisk} from '../disk-backup.mjs';
const at='2026-11-10T12:00:00.000Z',now=()=>new Date(at),ready=bytes=>({basis:'restore',status:'ready',bytes,measured_at:at,latest_backup_at:'2026-11-09T12:00:00.000Z'});
const point=(id,finished,logical_bytes,extra={})=>({id,device:'pc',routine_id:1,status:'success',finished,logical_bytes,scope_sources:'["C:\\\\Data"]',...extra});
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'bkd-restore-volume-'));try{await fn(root)}finally{await rm(root,{recursive:true,force:true})}}
test('simula o catálogo completo até a data selecionada, incluindo base, sem somar versões antigas ou execuções incompletas',()=>{
 const runs=[point('full','2026-11-08T10:00:00Z',1000),point('diff','2026-11-09T10:00:00Z',750,{backup_type:'differential',bytes:20}),point('failed','2026-11-10T10:00:00Z',9999,{status:'failed'}),point('running','2026-11-10T11:00:00Z',9999,{status:'running'}),point('future','2026-11-11T10:00:00Z',9000)];
 assert.equal(restoreVolumeAt(runs,now()).bytes,750);assert.deepEqual(selectRestorePoints(runs,now()).map(r=>r.id),['diff']);assert.equal(restoreVolumeAt(runs,new Date('2026-11-08T23:59:59Z')).bytes,1000);
 assert.equal(restoreVolumeAt(runs,new Date('2026-11-07')),null);assert.equal(restoreVolumeAt(runs,now()).latest_backup_at,'2026-11-09T10:00:00Z');
});
test('um ponto por conjunto de origem soma conjuntos distintos e não multiplica destinos ou rotinas equivalentes',()=>{
 const runs=[point('a','2026-11-09T10:00:00Z',100,{scope_destination:'X:'}),point('copy','2026-11-09T11:00:00Z',100,{routine_id:2,scope_sources:'["c:/Data/"]',scope_destination:'Y:'}),point('other','2026-11-09T10:00:00Z',250,{scope_sources:'["C:\\\\Other"]'})];
 assert.equal(selectRestorePoints(runs,now()).length,2);assert.equal(restoreVolumeAt(runs,now()).bytes,350);
 const empty=point('empty','2026-11-10T10:00:00Z',0);assert.equal(restoreVolumeAt([...runs,empty],now()).bytes,250);assert.equal(restoreVolumeAt([runs[0],empty],now()).bytes,0);
 assert.equal(restoreVolumeAt([point('unknown',at,null)],now()).status,'unavailable');assert.equal(restoreVolumeAt([point('oversize',at,Number.MAX_SAFE_INTEGER),point('other',at,1,{scope_sources:'["/other"]'})],now()).status,'unavailable');
});
for(const engine of ['native','restic'])test(engine+': total simulado corresponde à restauração real e só muda após backup concluído',{timeout:60000,skip:process.platform==='win32'},()=>fixture(async root=>{
 const source=join(root,'source'),destination=join(root,'backup'),target=join(root,'restored');for(const p of [source,destination,target])await mkdir(p);await writeFile(join(source,'kept.txt'),'keep');await writeFile(join(source,'removed.txt'),'old data');const master=await masterVault(join(root,'master')),vault=await deviceVault(join(root,'vault'),'pc',master.publicKey),opts={source,destination,device:'pc',deviceName:'Test',routine:1,encryption:vault,engine};
 const runs=[];const backup=async id=>{const result=await backupToDisk({...opts,run:id});const run={...result,id,device:'pc',scope_sources:JSON.stringify([source]),logical_bytes:result.files.reduce((n,f)=>n+f.size,0),status:'success',finished:result.finished||new Date().toISOString()};runs.push(run);return result};
 const first=await backup('first');assert.equal(restoreVolumeAt(runs).bytes,12);await rm(join(source,'removed.txt'));await writeFile(join(source,'new.txt'),'new content not backed up');assert.equal(restoreVolumeAt(runs).bytes,12);
 const restored=await restoreFromDisk({snapshot:first.snapshot,files:first.files,target,job:'first',getKey:h=>vault.getKey(h)});let restoredBytes=0;for(const file of first.files)restoredBytes+=(await readFile(join(restored.destination,...file.path.split('/')))).length;assert.equal(restoredBytes,restoreVolumeAt(runs).bytes);
 const second=await backup('second');assert.equal(restoreVolumeAt(runs).bytes,29);const secondRestore=await restoreFromDisk({snapshot:second.snapshot,files:second.files,target,job:'second',getKey:h=>vault.getKey(h)});restoredBytes=0;for(const file of second.files)restoredBytes+=(await readFile(join(secondRestore.destination,...file.path.split('/')))).length;assert.equal(restoredBytes,restoreVolumeAt(runs).bytes);
 await backup('unchanged');assert.equal(restoreVolumeAt(runs).bytes,29);await rm(source,{recursive:true});assert.equal(restoreVolumeAt(runs).bytes,29);
}));
test('GB decimal, proveniência de restauração e log mais recente que o catálogo local',()=>{
 assert.equal(gigabytes(1000000000),'1 GB');assert.equal(gigabytes(1500000000),'1,5 GB');assert.equal(gigabytes(0),'0 GB');assert.equal(gigabytes(1000000),'< 0,01 GB');
 const state={devices:[{id:'a',selected_volume:ready(1000000000)},{id:'old',selected_volume:{status:'ready',bytes:999999999,measured_at:at}}],logReports:[{device:'b',selected_volume:ready(93049620000)}]};assert.equal(overviewSelectedVolume(state,'a').bytes,1000000000);assert.equal(overviewSelectedVolume(state,'b').bytes,93049620000);assert.equal(overviewSelectedVolume(state,'old'),null);
 state.logReports.push({device:'a',selected_volume:{...ready(2000000000),latest_backup_at:'2026-11-10T10:00:00Z'}});assert.equal(overviewSelectedVolume(state,'a').bytes,2000000000);
});
test('novo critério é assinado e persistido; logs antigos são aceitos sem apresentar a medição de origens como restaurável',()=>fixture(async root=>{
 const master=await masterVault(join(root,'master')),vault=await deviceVault(join(root,'device'),'a'.repeat(64),master.publicKey),value=ready(93049620000);
 const document=signedStatus(vault,{runs:[],selected_volume:value},now());assert.deepEqual(verifyStatus(document,vault.header.origin_device,vault.publicKey,+now()).selected_volume,value);assert.throws(()=>verifyStatus({...document,payload:document.payload.replace('93049620000','1')},vault.header.origin_device,vault.publicKey,+now()),/Assinatura/);
 const legacy={status:'ready',bytes:123,measured_at:at};assert.deepEqual(verifyStatus(signedStatus(vault,{runs:[],selected_volume:legacy},now()),vault.header.origin_device,vault.publicKey,+now()).selected_volume,legacy);
 for(const bytes of [-1,1.5,Number.MAX_SAFE_INTEGER+1,null])assert.throws(()=>cleanSelectedVolume({...value,bytes},+now()),/Volume/);assert.throws(()=>cleanSelectedVolume({...value,latest_backup_at:'2099-01-01'},+now()),/catálogo/);
 let written;const dir=join(root,'journal'),journal=await statusJournal(dir,{now,io:async()=>{}});await journal.setSelectedVolume(value);const reopened=await statusJournal(dir,{now,io:async args=>written=args.document});await reopened.publish({local:{path:'/test'}},vault,{});assert.deepEqual(verifyStatus(written,vault.header.origin_device,vault.publicKey).selected_volume,value);assert.equal(await reopened.publish({local:{path:'/test'}},vault,{}),null);await reopened.setSelectedVolume(null);await reopened.publish({local:{path:'/test'}},vault,{});assert.equal(verifyStatus(written,vault.header.origin_device,vault.publicKey).selected_volume,undefined);
}));
