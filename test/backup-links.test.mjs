import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {backupToDisk,restoreFromDisk,validateDestination} from '../disk-backup.mjs';import {readManifest} from '../backup-repository.mjs';import {masterVault,deviceVault} from '../crypto-vault.mjs';
import {runRestic} from '../restic-runner.mjs';
for(const engine of ['native','restic'])test(engine+': links internos, externos, quebrados e ciclos não impedem copiar arquivos reais nem são percorridos',{timeout:90000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'bkd-links-'));
 try{
  const source=join(root,'Documentos'),destination=join(root,'destino'),outside=join(root,'fora'),target=join(root,'restaurar');for(const p of [source,destination,outside,target])await mkdir(p);
  await mkdir(join(source,'sub'));await writeFile(join(source,'sub','importante.txt'),'arquivo real');await writeFile(join(outside,'nao-copiar.txt'),'fora da seleção');
  for(const [name,where,type] of [['Meus Documentos',source,'dir'],['Ciclo',join(source,'Ciclo'),'dir'],['Externo',outside,'dir'],['Quebrado',join(root,'ausente'),'dir'],['arquivo-link',join(source,'sub','importante.txt'),'file']])await symlink(where,join(source,name),type);
  const planned=await validateDestination(source,destination);assert.equal(planned.excluded_links.length,5);assert.equal(planned.files.length,1);
  const master=await masterVault(join(root,'master')),vault=await deviceVault(join(root,'vault'),'pc',master.publicKey);
  const result=await backupToDisk({engine,source,destination,device:'pc',routine:1,run:'primeiro',encryption:vault});assert.equal(result.files.length,1);assert.equal(result.excluded_links.length,5);assert.match(result.warning,/ignorado/);
  const manifest=await readManifest(result.snapshot,{getKey:h=>master.getKey(h)});assert.deepEqual(manifest.excluded_links,result.excluded_links);assert.equal(manifest.files[0].path,'sub/importante.txt');
  const restored=await restoreFromDisk({snapshot:result.snapshot,files:result.files,target,job:'restore',getKey:h=>master.getKey(h)});assert.equal(await readFile(join(restored.destination,'sub','importante.txt'),'utf8'),'arquivo real');await assert.rejects(readFile(join(restored.destination,'Externo','nao-copiar.txt')),/ENOENT/);
  if(engine==='restic'){const repo=join(destination,'BackupDesk','pc','.restic',vault.header.key_id),listing=await runRestic({repository:repo,key:vault.dataKey,device:'pc',args:['ls','--json',manifest.restic.snapshot]});const nodes=listing.trim().split('\n').map(line=>JSON.parse(line)).filter(n=>n.type==='file');assert.equal(nodes.length,1);assert.equal(nodes.some(n=>n.path.includes('nao-copiar')),false)}
  const overlap=await backupToDisk({engine,source:JSON.stringify([source,join(source,'sub')]),destination,device:'pc',routine:1,run:'overlap',encryption:vault});assert.equal(overlap.files.length,2);assert.equal(overlap.files[0].hash,overlap.files[1].hash);assert.equal(overlap.excluded_links.length,5);
  await symlink(source,join(root,'root-link'),'dir');await assert.rejects(backupToDisk({engine,source:join(root,'root-link'),destination,device:'pc',routine:1,run:'rootlink',encryption:vault}),/pasta real|link/);
  await rm(join(source,'sub','importante.txt'));const empty=await backupToDisk({engine,source,destination,device:'pc',routine:1,run:'sem_arquivos',encryption:vault});assert.equal(empty.files.length,0);assert.equal(empty.excluded_links.length,5);
 }finally{await rm(root,{recursive:true,force:true})}
});
