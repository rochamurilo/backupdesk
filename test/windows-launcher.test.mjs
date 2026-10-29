import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
test('launcher aceita JSON do PowerShell com BOM e configura ambiente sem expor token',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'backupdesk windows '));
 try{
  await copyFile('windows/launch-agent.mjs',join(dir,'launch-agent.mjs'));
  await writeFile(join(dir,'agent-config.json'),'\uFEFF'+JSON.stringify({url:'https://backup.example.test/',token:'a'.repeat(64)}));
  await writeFile(join(dir,'agent.mjs'),`import assert from 'node:assert/strict';import {join} from 'node:path';assert.equal(process.env.BACKUPDESK_URL,'https://backup.example.test');assert.equal(process.env.BACKUPDESK_TOKEN,'a'.repeat(64));assert.equal(process.env.BACKUPDESK_AGENT_STATE,join(process.cwd(),'agent-state.json'));`);
  const result=spawnSync(process.execPath,[join(dir,'launch-agent.mjs')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.ok(!result.stdout.includes('a'.repeat(64)));
 }finally{await rm(dir,{recursive:true,force:true})}
});
