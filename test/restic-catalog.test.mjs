import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readResticCatalog} from '../restic-backup.mjs';

test('catálogo Restic acima de 64 MiB é consumido sem acumular a saída JSON',async()=>{
 let bytes=0;
 const catalog=await readResticCatalog(async(args,options)=>{
  assert.deepEqual(args,['ls','--json','snapshot']);
  assert.equal(options.captureOutput,false);
  options.onJSON({type:'snapshot',id:'snapshot'});
  options.onJSON({type:'dir',path:'/source'});
  for(let i=0;i<118922;i++){
   const node={type:'file',path:'/source/file-'+i,size:i,mtime:'2026-11-17T00:00:00Z',content:['a'.repeat(64),'b'.repeat(64)],metadata:'x'.repeat(512)};
   const line=JSON.stringify(node);bytes+=Buffer.byteLength(line)+1;
   options.onJSON(JSON.parse(line));
  }
  return '';
 },'snapshot');
 assert.ok(bytes>64*1024*1024);
 assert.equal(catalog.size,118922);
 assert.deepEqual(catalog.get('/source/file-118921'),{path:'/source/file-118921',size:118921});
});

test('falha na listagem Restic não devolve catálogo parcial',async()=>{
 await assert.rejects(readResticCatalog(async(args,{onJSON})=>{
  onJSON({type:'file',path:'/source/a',size:1});
  throw Error('Restic não concluiu a operação');
 },'snapshot'),/não concluiu/);
});
