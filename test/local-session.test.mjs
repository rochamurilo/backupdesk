import {test} from 'node:test';import {request as httpRequest} from 'node:http';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
for(const [name,master,host,port,enabled] of [['master local',true,'127.0.0.1',3140,true],['API sem master',false,'127.0.0.1',3141,false],['master exposto na rede',true,'0.0.0.0',3142,false]]){
 test('sessão automática: '+name,{timeout:15000},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'backupdesk-session-'));const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:host,BACKUPDESK_LOCAL_MASTER:master?'1':'0'}});
  try{
   await once(child.stdout,'data');const origin=`http://127.0.0.1:${port}`;
   const raw=(path,headers,method='GET')=>new Promise((resolve,reject)=>{const req=httpRequest(origin+path,{method,headers},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:res.statusCode})))});req.on('error',reject);req.end()});
   const request=headers=>raw('/api/local-session',headers,'POST');
   assert.equal((await request({})).status,403);
   assert.equal((await request({Origin:'https://outro-site.example'})).status,403);
   assert.equal((await request({Host:'outro-site.example',Origin:'http://outro-site.example'})).status,403);
   assert.equal((await fetch(origin+'/api/local-session')).status,405);
   const session=await request({Origin:origin});assert.equal(session.status,enabled?200:403);
   if(enabled){
    const data=await session.json();assert.equal(data.role,'master');assert.equal(data.localOnly,true);assert.ok(data.token);
    const state=await fetch(origin+'/api/state',{headers:{Authorization:'Bearer '+data.token}});assert.equal(state.status,200);assert.equal((await state.json()).devices.length,1);
    const replay=await raw('/api/state',{Authorization:'Bearer '+data.token,Host:'outro-site.example'});assert.equal(replay.status,401);
    const again=await request({Origin:origin});assert.equal((await again.json()).token,data.token);
   }
  }finally{child.kill();await once(child,'exit');await rm(dir,{recursive:true,force:true})}
 });
}
