import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {browseFiles,collectFiles,parseSources} from '../filesystem.mjs';
test('navegação, arquivos individuais e várias pastas sem colisão de nomes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'backupdesk-files-'));
 try{
  await mkdir(join(root,'pasta A'));await mkdir(join(root,'pasta B'));
  await writeFile(join(root,'pasta A','igual.txt'),'A');await writeFile(join(root,'pasta B','igual.txt'),'B');await writeFile(join(root,'individual.txt'),'C');
  const listing=await browseFiles(root);assert.equal(listing.entries.length,3);assert.equal(listing.entries[0].directory,true);
  await assert.rejects(browseFiles('caminho relativo'));
  const found=[];await collectFiles(JSON.stringify([join(root,'pasta A'),join(root,'pasta B'),join(root,'individual.txt')]),async(p,c)=>found.push([p,c.toString()]));
  assert.deepEqual(found,[['1-pasta A/igual.txt','A'],['2-pasta B/igual.txt','B'],['3-individual.txt/individual.txt','C']]);
  const legacy=[];await collectFiles(join(root,'pasta A'),async(p)=>legacy.push(p));assert.deepEqual(legacy,['igual.txt']);
  assert.deepEqual(parseSources([root,root]),[root]);
 }finally{await rm(root,{recursive:true,force:true})}
});
