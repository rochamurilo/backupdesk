// Native Windows integration, run by windows-vss-user.ps1 as a standard user.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,stat,utimes,rename,link,unlink,open} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {backupToDisk,restoreFromDisk} from './disk-backup.mjs';
import {masterVault,deviceVault} from './crypto-vault.mjs';
const root=await mkdtemp(path.join(process.env.BACKUPDESK_TEST_ROOT,'usn-'));
process.env.BACKUPDESK_USN_TEST_DIAGNOSTICS='1';
try {
 const source=path.join(root,'source'),destination=path.join(root,'destination'),target=path.join(root,'restore');
 for(const folder of [source,destination,target])await mkdir(folder);
 const master=await masterVault(path.join(root,'master')),encryption=await deviceVault(path.join(root,'agent'),'usn-test',master.publicKey);
 for(const engine of ['native','restic']){
  const a=path.join(source,'a.txt'),b=path.join(source,'b.txt');
  await writeFile(a,'old');const exactTime=new Date('2026-01-01T12:00:00Z');await utimes(a,exactTime,exactTime);await writeFile(b,randomBytes(1024*1024));
  const opts={source,destination,device:'usn-test',routine:engine==='native'?101:102,engine:engine==='native'?undefined:engine,encryption,useVss:true};
  const first=await backupToDisk({...opts,run:engine+'-1'});
  assert.equal(first.comparison.reused_files,0);
  const second=await backupToDisk({...opts,run:engine+'-2'});
  assert.equal(second.comparison.method,'ntfs-usn',JSON.stringify(second.comparison));
  assert.equal(second.comparison.reused_files,2,JSON.stringify(second.comparison));
  assert.equal(second.comparison.reused_bytes,1024*1024+3);
  const before=await stat(a,{bigint:true});await writeFile(a,'new');await utimes(a,before.atime,before.mtime);
  const after=await stat(a,{bigint:true});assert.equal(after.size,before.size);assert.equal(after.mtimeNs,before.mtimeNs);
  const third=await backupToDisk({...opts,run:engine+'-3'});
  assert.equal(third.comparison.reused_files,1);
  assert.notEqual(third.files.find(f=>f.path==='a.txt').hash,second.files.find(f=>f.path==='a.txt').hash);
  const restored=await restoreFromDisk({snapshot:third.snapshot,files:third.files.filter(f=>f.path==='a.txt'),target,job:engine,getKey:h=>master.getKey(h)});
  assert.equal(await readFile(path.join(restored.destination,'a.txt'),'utf8'),'new');
  // An open write handle with permissive sharing must still force full hashing.
  const writer=await open(a,'r+');
  try{
   const busy=await backupToDisk({...opts,run:engine+'-busy'});
   assert.equal(busy.comparison.reused_files,1,JSON.stringify(busy.comparison));
   assert.equal(busy.files.find(f=>f.path==='a.txt').hash,third.files.find(f=>f.path==='a.txt').hash);
  }finally{await writer.close()}
  // Rename, new file, hardlink and deletion must follow the current enumeration.
  await rename(b,path.join(source,'renamed.txt'));await link(a,path.join(source,'hardlink.txt'));
  const fourth=await backupToDisk({...opts,run:engine+'-4'});
  assert.deepEqual(fourth.files.map(f=>f.path).sort(),['a.txt','hardlink.txt','renamed.txt']);
  assert.equal(fourth.files.find(f=>f.path==='hardlink.txt').hash,third.files.find(f=>f.path==='a.txt').hash);
  await unlink(path.join(source,'hardlink.txt'));await unlink(path.join(source,'renamed.txt'));
  console.log(JSON.stringify({engine,first:first.comparison,second:second.comparison,third:third.comparison,restored:true}));
 }
} finally {await rm(root,{recursive:true,force:true})}
