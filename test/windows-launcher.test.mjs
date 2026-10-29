import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,copyFile,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawn} from 'node:child_process';import {once} from 'node:events';
test('client lê configuração PowerShell e inicia agente em segundo plano sem expor token',{timeout:15000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'backupdesk windows '));let child;
 try{
  await copyFile('windows/launch-agent.mjs',join(dir,'launch-agent.mjs'));await copyFile('background.mjs',join(dir,'background.mjs'));
  await writeFile(join(dir,'agent-config.json'),'\uFEFF'+JSON.stringify({url:'https://backup.example.test/',token:'a'.repeat(64)}));
  await writeFile(join(dir,'agent.mjs'),`import assert from 'node:assert/strict';import {writeFileSync} from 'node:fs';assert.equal(process.env.BACKUPDESK_URL,'https://backup.example.test');assert.equal(process.env.BACKUPDESK_TOKEN,'a'.repeat(64));writeFileSync('ready.txt','OK');setInterval(()=>{},1000);`);
  child=spawn(process.execPath,[join(dir,'launch-agent.mjs')],{stdio:'ignore'});let ready=false;for(let i=0;i<100;i++){try{ready=(await readFile(join(dir,'ready.txt'),'utf8'))==='OK';if(ready)break}catch{}await new Promise(r=>setTimeout(r,50))}assert.ok(ready);assert.ok(!(await readFile(join(dir,'data','agent.log'),'utf8')).includes('a'.repeat(64)));
 }finally{if(child){child.kill();await once(child,'exit')}await rm(dir,{recursive:true,force:true})}
});
