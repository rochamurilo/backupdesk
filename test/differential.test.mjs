import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,utimes,stat} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';
import {backupToDisk,restoreFromDisk} from '../disk-backup.mjs';import {FULL_WINDOW_MS} from '../backup-repository.mjs';
async function fixture(fn){const root=await mkdtemp(path.join(tmpdir(),'backupdesk-differential-'));const source=path.join(root,'source'),destination=path.join(root,'destination'),target=path.join(root,'restore');for(const p of [source,destination,target])await mkdir(p);let time=Date.parse('2026-11-04T10:00:00Z'),sequence=0;const copy=extra=>backupToDisk({source,destination,device:'desktop',routine:1,run:'run'+(++sequence),clock:()=>new Date(time),...extra});try{await fn({root,source,destination,target,copy,advance:ms=>time+=ms})}finally{await rm(root,{recursive:true,force:true})}}
const content=(snapshot,file)=>readFile(path.join(snapshot,'files',file),'utf8');
test('diferencial é cumulativo desde o completo e restaura catálogo inteiro, incluindo exclusões',()=>fixture(async({source,target,copy,advance})=>{
 await writeFile(path.join(source,'stable.txt'),'estável');await writeFile(path.join(source,'change.txt'),'versão1');await writeFile(path.join(source,'deleted.txt'),'remover');
 const full=await copy();assert.equal(full.backup_type,'full');assert.equal(full.changed_files,3);assert.equal(full.pst_validation,null);
 advance(86400000);await writeFile(path.join(source,'change.txt'),'versão2');await writeFile(path.join(source,'new.txt'),'novo');await rm(path.join(source,'deleted.txt'));
 const second=await copy();assert.equal(second.backup_type,'differential');assert.equal(second.base_run,'run1');assert.equal(second.changed_files,2);assert.equal(second.files.length,3);assert.equal(second.files.find(f=>f.path==='stable.txt').source_run,'run1');await assert.rejects(content(second.snapshot,'stable.txt'),/ENOENT/);
 const manifest=JSON.parse(await readFile(path.join(second.snapshot,'manifest.json'),'utf8'));assert.deepEqual(manifest.deleted,['deleted.txt']);
 advance(86400000);const third=await copy();assert.equal(third.base_run,'run1');assert.equal(third.changed_files,2);assert.equal(await content(third.snapshot,'change.txt'),'versão2');assert.equal(await content(third.snapshot,'new.txt'),'novo');
 const restored=await restoreFromDisk({snapshot:third.snapshot,files:third.files,target,job:'restore3'});for(const f of ['stable.txt','change.txt','new.txt'])assert.equal(await readFile(path.join(restored.destination,f),'utf8'),await readFile(path.join(source,f),'utf8'));await assert.rejects(readFile(path.join(restored.destination,'deleted.txt')),/ENOENT/);
 // Reverting to the full version removes this file from the physical differential.
 await writeFile(path.join(source,'change.txt'),'versão1');const reverted=await copy();assert.equal(reverted.files.find(f=>f.path==='change.txt').source_run,'run1');assert.equal(reverted.changed_files,1);
}));
test('completo expira após cinco dias; diferencial não renova o prazo; mesma origem/destino pode usar outra rotina',()=>fixture(async({source,copy,advance})=>{
 await writeFile(path.join(source,'a'),'abc');const full=await copy();advance(FULL_WINDOW_MS);const boundary=await copy({routine:2});assert.equal(boundary.backup_type,'differential');assert.equal(boundary.base_run,'run1');assert.equal(boundary.changed_files,0);advance(1);const expired=await copy();assert.equal(expired.backup_type,'full');assert.equal(expired.base_run,null);assert.equal(expired.changed_files,1);assert.ok(full.snapshot);
}));
test('outra origem, destino, computador ou base não confirmada não reutiliza completo',()=>fixture(async({root,source,destination,copy})=>{
 await writeFile(path.join(source,'a'),'abc');const full=await copy();const elsewhere=path.join(root,'elsewhere');await mkdir(elsewhere);await writeFile(path.join(elsewhere,'a'),'abc');
 for(const options of [{source:elsewhere},{destination:elsewhere},{device:'other'},{knownRuns:[]}])assert.equal((await copy(options)).backup_type,'full');
 const reused=await copy({knownRuns:[{id:'run1',snapshot:full.snapshot}]});assert.equal(reused.base_run,'run1');
}));
test('base corrompida força completo e não permite restaurar referência diferencial corrompida',()=>fixture(async({source,target,copy})=>{
 await writeFile(path.join(source,'a'),'abc');const full=await copy(),diff=await copy();assert.equal(diff.changed_files,0);await writeFile(path.join(full.snapshot,'files','a'),'xyz');await assert.rejects(restoreFromDisk({snapshot:diff.snapshot,files:diff.files,target,job:'broken'}),/corrompido/);const next=await copy();assert.equal(next.backup_type,'full');assert.match(next.warning,/novo backup completo/);assert.equal(await content(next.snapshot,'a'),'abc');
}));
test('conteúdo alterado com tamanho e mtime iguais é detectado; PST tem validação separada de falhas',()=>fixture(async({source,copy})=>{
 const file=path.join(source,'mail.pst');await writeFile(file,'abcd');const before=await stat(file);const full=await copy();assert.equal(full.warning,null);assert.equal(full.pst_validation.copy_integrity,'sha256');assert.equal(full.pst_validation.outlook,'not-tested');await writeFile(file,'efgh');await utimes(file,before.atime,before.mtime);const next=await copy();assert.equal(next.changed_files,1);assert.notEqual(next.files[0].hash,full.files[0].hash);
}));
test('catálogo vazio registra exclusões; origem ausente nunca vira backup vazio bem sucedido',()=>fixture(async({source,copy})=>{
 await writeFile(path.join(source,'a'),'abc');await copy();await rm(path.join(source,'a'));const empty=await copy();assert.equal(empty.backup_type,'differential');assert.equal(empty.files.length,0);assert.equal(empty.changed_files,0);assert.deepEqual(JSON.parse(await readFile(path.join(empty.snapshot,'manifest.json'),'utf8')).deleted,['a']);await rm(source,{recursive:true});await assert.rejects(copy(),/ENOENT/);
}));
test('completo v1 continua reutilizável e restaurável',()=>fixture(async({source,target,copy})=>{
 await writeFile(path.join(source,'a'),'antigo');const full=await copy();const file=path.join(full.snapshot,'manifest.json'),m=JSON.parse(await readFile(file,'utf8'));m.format='backupdesk-files-v1';delete m.backup_type;delete m.scope_key;for(const f of m.files)delete f.source_run;await writeFile(file,JSON.stringify(m));const diff=await copy();assert.equal(diff.base_run,'run1');assert.equal(diff.changed_files,0);const restored=await restoreFromDisk({snapshot:diff.snapshot,files:diff.files,target,job:'legacy'});assert.equal(await readFile(path.join(restored.destination,'a'),'utf8'),'antigo');
}));
