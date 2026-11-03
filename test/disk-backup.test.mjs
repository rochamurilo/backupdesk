import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {backupToDisk,validateDestination,restoreFromDisk,fileHash} from '../disk-backup.mjs';
test('copia arquivo grande, preserva versões e restaura com integridade sem sobrescrever',{timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'backupdesk-disk-'));
 try{const source=join(dir,'source'),destination=join(dir,'external'),target=join(dir,'restore');await mkdir(source);await mkdir(destination);await mkdir(target);await writeFile(join(source,'grande.pst'),Buffer.alloc(20*1024*1024,7));await mkdir(join(source,'sub'));await writeFile(join(source,'sub','nested.txt'),'arquivo da subpasta');
  const first=await backupToDisk({source,destination,device:'desktop',routine:1,run:'first'});assert.equal(first.files[0].size,20*1024*1024);assert.equal(await fileHash(join(first.snapshot,'files','grande.pst')),first.files[0].hash);
  await writeFile(join(source,'grande.pst'),'nova versão');const second=await backupToDisk({source,destination,device:'desktop',routine:1,run:'second'});assert.notEqual(second.files[0].hash,first.files[0].hash);assert.equal((await readFile(join(first.snapshot,'files','grande.pst'))).length,20*1024*1024);
  const restored=await restoreFromDisk({snapshot:first.snapshot,files:first.files,target,job:'recovery'});assert.equal(await fileHash(join(restored.destination,'grande.pst')),first.files[0].hash);assert.equal(await readFile(join(restored.destination,'sub','nested.txt'),'utf8'),'arquivo da subpasta');assert.equal(await readFile(join(source,'grande.pst'),'utf8'),'nova versão');
  await writeFile(join(first.snapshot,'files','grande.pst'),'corrompido');await assert.rejects(restoreFromDisk({snapshot:first.snapshot,files:first.files,target,job:'corrupt'}),/corrompido/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('não aceita destino dentro da origem nem disco ausente',{timeout:10000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'backupdesk-target-'));try{await mkdir(join(dir,'source'));await mkdir(join(dir,'source','nested'));await assert.rejects(validateDestination(join(dir,'source'),join(dir,'source','nested')),/dentro/);await assert.rejects(validateDestination(join(dir,'source'),join(dir,'unplugged')),/ENOENT/);await assert.rejects(validateDestination(join(dir,'source'),join(dir,'source')),/origem/)}finally{await rm(dir,{recursive:true,force:true})}
});
test('origem alterada não gera uma versão concluída',{timeout:10000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'backupdesk-changing-'));try{const source=join(dir,'source'),destination=join(dir,'destination');await mkdir(source);await mkdir(destination);await writeFile(join(source,'dado.txt'),'original');await assert.rejects(backupToDisk({source,destination,device:'desktop',routine:1,run:'changed',onFile:()=>writeFile(join(source,'dado.txt'),'modificado durante a execução')}),/alterada|mudou/);const failed=JSON.parse(await readFile(join(destination,'BackupDesk','desktop','1','.partial-changed','manifest.failed.json'),'utf8'));assert.equal(failed.status,'failed')}finally{await rm(dir,{recursive:true,force:true})}
});
