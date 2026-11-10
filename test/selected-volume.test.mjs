import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {measureSelectedVolume} from '../filesystem.mjs';
import {gigabytes} from '../progress.mjs';
import {overviewSelectedVolume} from '../overview-status.mjs';
import {masterVault,deviceVault} from '../crypto-vault.mjs';
import {signedStatus,verifyStatus,statusJournal,cleanSelectedVolume} from '../status-logs.mjs';
const at='2026-11-10T12:00:00.000Z',ready=bytes=>({status:'ready',bytes,measured_at:at});
async function fixture(fn){const root=await mkdtemp(join(tmpdir(),'bkd-selected-volume-'));try{await fn(root)}finally{await rm(root,{recursive:true,force:true})}}
test('mede todas as rotinas ativas sem duplicar origens sobrepostas nem multiplicar por destinos',()=>fixture(async root=>{
 const source=join(root,'source'),nested=join(source,'nested'),sibling=join(root,'source-other');for(const d of [source,nested,sibling])await mkdir(d);await writeFile(join(source,'a'),Buffer.alloc(123));await writeFile(join(nested,'b'),Buffer.alloc(234));await writeFile(join(sibling,'c'),Buffer.alloc(345));
 const measured=await measureSelectedVolume([{source,enabled:1,destinations:[{},{}]},{source:JSON.stringify([nested,join(source,'a'),sibling])},{source:join(root,'missing-disabled'),enabled:0},{source:join(root,'missing-deleted'),deleted:1}],{now:()=>new Date(at)});
 assert.deepEqual(measured,ready(702));await writeFile(join(nested,'b'),Buffer.alloc(567));assert.equal((await measureSelectedVolume([{source},{source:nested}])).bytes,690);
 assert.deepEqual(await measureSelectedVolume([],{now:()=>new Date(at)}),ready(0));
}));
test('ignora atalhos dentro da origem, rejeita origem inacessível e permite cancelar a medição',()=>fixture(async root=>{
 const source=join(root,'source'),outside=join(root,'outside');await mkdir(source);await mkdir(outside);await writeFile(join(source,'a'),'abc');await writeFile(join(outside,'b'),'never counted');await symlink(outside,join(source,'redirect'),process.platform==='win32'?'junction':'dir');assert.equal((await measureSelectedVolume([{source}])).bytes,3);
 await assert.rejects(measureSelectedVolume([{source},{source:join(root,'missing')}]));await assert.rejects(measureSelectedVolume([{source:join(source,'redirect')}]));
 const controller=new AbortController();await assert.rejects(measureSelectedVolume([{source}],{signal:controller.signal,onProgress:()=>controller.abort(Error('cancelled'))}),/cancelled/);
}));
test('GB usa base decimal e distingue arquivo pequeno, pasta vazia e volume desconhecido',()=>{
 assert.equal(gigabytes(1000000000),'1 GB');assert.equal(gigabytes(1500000000),'1,5 GB');assert.equal(gigabytes(10000000000),'10 GB');assert.equal(gigabytes(0),'0 GB');assert.equal(gigabytes(1000000),'< 0,01 GB');
 const state={devices:[{id:'a',selected_volume:ready(1000000000)},{id:'old'}],logReports:[{device:'b',selected_volume:ready(93049620000)}]};assert.equal(overviewSelectedVolume(state,'a').bytes,1000000000);assert.equal(overviewSelectedVolume(state,'b').bytes,93049620000);assert.equal(overviewSelectedVolume(state,'old'),null);
 state.logReports.push({device:'a',selected_volume:{status:'unavailable',bytes:null,measured_at:'2026-11-10T13:00:00Z'}});assert.equal(overviewSelectedVolume(state,'a').status,'unavailable');assert.equal(overviewSelectedVolume(state,'a').bytes,null);
});
test('Windows mede arquivo aberto com bloqueio exclusivo, sem precisar ler seu conteúdo',{skip:process.platform!=='win32',timeout:20000},()=>fixture(async root=>{
 const file=join(root,'opened.pst');await writeFile(file,Buffer.alloc(123456));
 const lock=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"$file=[IO.File]::Open($env:BACKUPDESK_TEST_VOLUME_LOCK,'Open','ReadWrite','None');try{[Console]::WriteLine('READY');[Console]::ReadLine() | Out-Null}finally{$file.Dispose()}"],{env:{...process.env,BACKUPDESK_TEST_VOLUME_LOCK:file}});
 try{await once(lock.stdout,'data');assert.equal((await measureSelectedVolume([{source:root}])).bytes,123456)}finally{lock.stdin.end('\n');if(lock.exitCode===null)await once(lock,'exit')}
}));
test('volume via log é assinado, validado, persistente e compatível com logs antigos',()=>fixture(async root=>{
 const master=await masterVault(join(root,'master')),vault=await deviceVault(join(root,'device'),'a'.repeat(64),master.publicKey),value=ready(93049620000),now=()=>new Date(at);
 const document=signedStatus(vault,{runs:[],selected_volume:value},now());assert.deepEqual(verifyStatus(document,vault.header.origin_device,vault.publicKey,+now()).selected_volume,value);
 assert.throws(()=>verifyStatus({...document,payload:document.payload.replace('93049620000','1')},vault.header.origin_device,vault.publicKey,+now()),/Assinatura/);
 assert.equal(verifyStatus(signedStatus(vault,{runs:[]},now()),vault.header.origin_device,vault.publicKey,+now()).selected_volume,undefined);
 for(const bytes of [-1,1.5,Number.MAX_SAFE_INTEGER+1,null])assert.throws(()=>cleanSelectedVolume({...value,bytes},+now()),/Volume/);
 assert.throws(()=>cleanSelectedVolume({...value,measured_at:'2099-01-01'},+now()),/Volume/);
 const journal=await statusJournal(join(root,'journal'),{now,io:async()=>{}});await journal.setSelectedVolume(value);let written;const reopened=await statusJournal(join(root,'journal'),{now,io:async args=>written=args.document});await reopened.publish({local:{path:'/test'}},vault,{});assert.deepEqual(verifyStatus(written,vault.header.origin_device,vault.publicKey).selected_volume,value);assert.equal(await reopened.publish({local:{path:'/test'}},vault,{}),null);
}));
