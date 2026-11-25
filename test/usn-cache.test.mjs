import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createUsnCache,continuousJournal,validJournal} from '../usn-cache.mjs';

const digest=s=>createHash('sha256').update(s).digest('hex');
const journal={volume_id:'\\\\?\\Volume{12345678-1234-1234-1234-123456789abc}\\',serial:'123',journal_id:'456',first_usn:'0',lowest_valid_usn:'0',next_usn:'1000'};
const file={absolute:'\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy1\\source\\a.txt',path:'a.txt',size:3n,mtime:1700000000000000000n};
const stamp=['123','789','100','3','133444736000000000','132000000000000000'];
const snapshot={device:'\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy1',volume:'C:\\',usn:journal};
async function fixture(operation){const dir=await mkdtemp(path.join(tmpdir(),'bkd-usn-'));try{await operation({files:[file],snapshots:[snapshot],scopeKey:'scope',device:'pc',encryption:{dataKey:Buffer.alloc(32,7)},cacheFile:path.join(dir,'cache.bde'),platform:'win32',readStamps:async requests=>{assert.equal(requests[0].live,'C:\\source\\a.txt');return new Map([[0,stamp]])}},dir)}finally{await rm(dir,{recursive:true,force:true})}}
async function seed(opts){const cache=await createUsnCache(opts);assert.equal(cache.get(file),null);cache.remember(file,digest('old'));await cache.save()}

test('USN reutiliza SHA-256 sem reler conteúdo, com cache cifrado e snapshot diferente',()=>fixture(async opts=>{
 await seed(opts);assert.ok(!(await readFile(opts.cacheFile,'utf8')).includes('a.txt'));
 const next={...snapshot,device:snapshot.device.replace('Copy1','Copy2'),usn:{...journal,next_usn:'2000'}};
 const renamedSnapshotPath={...file,absolute:file.absolute.replace('Copy1','Copy2')};
 const cache=await createUsnCache({...opts,snapshots:[next],files:[renamedSnapshotPath]});
 assert.equal(cache.get(renamedSnapshotPath),digest('old'));assert.equal(cache.stats.reused_files,1);assert.equal(cache.stats.reused_bytes,3);
}));

test('USN mudança com MESMO tamanho e data exige novo hash',()=>fixture(async opts=>{
 await seed(opts);
 const changed=[...stamp];changed[2]='101';
 const cache=await createUsnCache({...opts,readStamps:async()=>new Map([[0,changed]])});
 assert.equal(cache.get(file),null);
}));

test('USN recriação, hardlink alterado, arquivo aberto e metadados divergentes não reutilizam hash',()=>fixture(async opts=>{
 await seed(opts);
 for(const parts of [null,[stamp[0],'790',...stamp.slice(2)],[stamp[0],stamp[1],stamp[2],'4',...stamp.slice(4)],[...stamp.slice(0,4),'133444736000000001',stamp[5]],[...stamp.slice(0,5),'132000000000000001'],['999',...stamp.slice(1)]]){
  const cache=await createUsnCache({...opts,readStamps:async()=>new Map([[0,parts]])});assert.equal(cache.get(file),null);
 }
}));

test('diário recriado, truncado, rebobinado e volume trocado invalidam o cache',()=>fixture(async opts=>{
 await seed(opts);
 for(const patch of [{journal_id:'457'},{first_usn:'1001',next_usn:'2000'},{lowest_valid_usn:'1001',next_usn:'2000'},{next_usn:'999'},{volume_id:journal.volume_id.replace('abc','abd')}]){
  const cache=await createUsnCache({...opts,snapshots:[{...snapshot,usn:{...journal,...patch}}]});assert.equal(cache.get(file),null);
 }
 assert.equal(continuousJournal(journal,{...journal,next_usn:'2000'}),true);
 assert.equal(validJournal({...journal,next_usn:'bad'}),false);
}));

test('falha de consulta, cache corrompido, outra chave, outro escopo e ausência VSS voltam ao SHA',()=>fixture(async opts=>{
 await seed(opts);
 for(const patch of [{readStamps:async()=>{throw Error('acesso negado')}},{scopeKey:'outro'},{device:'other'},{encryption:{dataKey:Buffer.alloc(32,8)}},{snapshots:[]},{snapshots:[{...snapshot,usn:null}]},{platform:'linux'}]){
  const cache=await createUsnCache({...opts,...patch});assert.equal(cache.get(file),null);
 }
 await writeFile(opts.cacheFile,'corrompido');const cache=await createUsnCache(opts);assert.equal(cache.get(file),null);
}));

test('execução incompleta não promove cache, exclusão remove entrada e cancelamento é propagado',()=>fixture(async(opts,dir)=>{
 await seed(opts);const before=await readFile(opts.cacheFile);
 const failed=await createUsnCache(opts);failed.remember(file,digest('new'));assert.deepEqual(await readFile(opts.cacheFile),before);
 const empty=await createUsnCache({...opts,files:[{...file,path:'new.txt'}]});await empty.save();assert.equal((await createUsnCache(opts)).get(file),null);
 const controller=new AbortController();controller.abort(Error('cancelado'));
 await assert.rejects(createUsnCache({...opts,signal:controller.signal}),/cancelado/);
 assert.ok((await readdir(dir)).every(n=>!n.endsWith('.tmp')));
}));

test('cache opcional não reprova backup já publicado se a gravação falha ou se o usuário cancela depois',()=>fixture(async(opts,dir)=>{
 const blocked=path.join(dir,'directory');await mkdir(blocked);
 const cache=await createUsnCache({...opts,cacheFile:blocked});cache.remember(file,digest('old'));await cache.save();assert.equal(cache.stats.reason,'cache-write-failed');
 const controller=new AbortController(),cancelled=await createUsnCache({...opts,signal:controller.signal});cancelled.remember(file,digest('old'));controller.abort();await cancelled.save();
 assert.ok((await readdir(dir)).every(n=>!n.endsWith('.tmp')));
}));
