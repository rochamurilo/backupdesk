import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawn} from 'node:child_process';import {once} from 'node:events';
test('agente real lista pastas, protege consulta e faz backup de seleção múltipla',{timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'backupdesk-browse-'));let agent;const server=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3100',DATA_DIR:join(dir,'data'),ADMIN_PASSWORD:'test-password-long'}});
 try{
  await once(server.stdout,'data');
  const api=async(p,b,t)=>{const r=await fetch('http://127.0.0.1:3100/api/'+p,{method:b?'POST':'GET',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});return {status:r.status,body:await r.json()}};
  const admin=(await api('login',{name:'admin',password:'test-password-long'})).body.token;
  await api('users',{name:'client',password:'client-password-long'},admin);const client=(await api('login',{name:'client',password:'client-password-long'})).body.token;
  const d=(await api('devices',{name:'Agente de teste'},admin)).body;
  assert.equal((await api('devices/'+d.id+'/browse',{path:''},client)).status,404);
  await mkdir(join(dir,'origem'));await writeFile(join(dir,'origem','dado.txt'),'pasta');await writeFile(join(dir,'avulso.txt'),'arquivo');
  const sources=[join(dir,'origem'),join(dir,'avulso.txt')];
  assert.equal((await api('routines',{device:d.id,name:'Seleção',cadence:'daily',hour:'00:00',source:JSON.stringify(sources)},admin)).status,201);
  agent=spawn(process.execPath,['agent.mjs'],{env:{...process.env,BACKUPDESK_URL:'http://127.0.0.1:3100',BACKUPDESK_TOKEN:d.token,BACKUPDESK_AGENT_STATE:join(dir,'agent-state.json')},stdio:'ignore'});
  const browse=await api('devices/'+d.id+'/browse',{path:join(dir,'origem')},admin);assert.equal(browse.status,200);assert.equal(browse.body.entries[0].name,'dado.txt');
  let run;for(let i=0;i<30;i++){run=(await api('state',null,admin)).body.runs.find(r=>r.status==='success');if(run)break;await new Promise(r=>setTimeout(r,100))}assert.ok(run,'Backup da seleção concluiu');
  const files=(await api('runs/'+run.id+'/files',null,admin)).body;assert.deepEqual(files.map(f=>f.path).sort(),['1-origem/dado.txt','2-avulso.txt/avulso.txt']);
  for(const source of ['C:\\Dados','Z:\\Compartilhado','\\\\servidor\\documentos'])assert.equal((await api('routines',{device:d.id,name:'Windows',cadence:'daily',hour:'23:59',source:JSON.stringify([source])},admin)).status,201);
  assert.equal((await api('routines',{device:d.id,name:'Inválida',cadence:'daily',hour:'00:00',source:JSON.stringify(['relativo'])},admin)).status,400);
 }finally{if(agent){agent.kill();await once(agent,'exit')}server.kill();await once(server,'exit');await rm(dir,{recursive:true,force:true})}
});
