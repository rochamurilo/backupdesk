import http from 'node:http';
import {spawn} from 'node:child_process';
import {prepareLocalMaster} from './local-master.mjs';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, scryptSync, timingSafeEqual, createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(process.env.DATA_DIR||'data'); mkdirSync(join(root,'blobs'),{recursive:true});
const db=new DatabaseSync(join(root,'backupdesk.sqlite')); db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT UNIQUE,password TEXT,role TEXT); CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,name TEXT,owner INTEGER REFERENCES users(id),token TEXT UNIQUE,last_seen TEXT); CREATE TABLE IF NOT EXISTS routines(id INTEGER PRIMARY KEY,device TEXT REFERENCES devices(id),name TEXT,cadence TEXT,hour TEXT,source TEXT); CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,device TEXT REFERENCES devices(id),started TEXT,finished TEXT,status TEXT,bytes INTEGER DEFAULT 0,error TEXT); CREATE TABLE IF NOT EXISTS files(run TEXT REFERENCES runs(id),path TEXT,hash TEXT,size INTEGER,PRIMARY KEY(run,path));`);
function hash(p){return scryptSync(p,'backupdesk-local-v1',32).toString('hex')}
if(!db.prepare('SELECT id FROM users LIMIT 1').get()){const password=process.env.ADMIN_PASSWORD||randomBytes(16).toString('hex');db.prepare('INSERT INTO users(name,password,role) VALUES(?,?,?)').run('admin',hash(password),'master');writeFileSync(join(root,'initial-admin.txt'),`Usuário: admin\nSenha: ${password}\n`,{mode:0o600});}
const localMaster=(process.env.BACKUPDESK_LOCAL_MASTER==='1'||process.argv.includes('--prepare-master'))?prepareLocalMaster(db):null;
const browseRequests=new Map();
const sessions=new Map(); const token=()=>randomBytes(32).toString('hex');
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
async function body(req){let chunks=[],n=0;for await(const c of req){n+=c.length;if(n>24*1024*1024)throw Error('Corpo excede 24 MB');chunks.push(c)}return JSON.parse(Buffer.concat(chunks).toString()||'{}')}
let localSessionToken;
function localRequest(req){
 const host=req.headers.host||'';
 const bound=server.address()?.address;
 return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(bound)&&/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host);
}
const visible=(user,id)=>user.role==='master'||!!db.prepare('SELECT id FROM devices WHERE id=? AND owner=?').get(id,user.id);
export const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),p=url.pathname; if(!p.startsWith('/api/')){const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css'}[p];if(!file)return send(res,404,{error:'Não encontrado'});res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');return res.end(readFileSync(new URL('./public/'+file,import.meta.url)))}
if(p==='/api/health')return send(res,200,{ok:true});
if(p==='/api/local-session'){
 if(req.method!=='POST')return send(res,405,{error:'Método não permitido'});
 if(!localMaster||!localRequest(req)||req.headers.origin!=='http://'+req.headers.host)return send(res,403,{error:'Acesso automático disponível apenas no master local'});
 const user=db.prepare("SELECT id,name,role FROM users WHERE id=? AND role='master'").get(localMaster.owner);
 if(!user)return send(res,403,{error:'Master local não disponível'});
 if(!localSessionToken){localSessionToken=token();sessions.set(localSessionToken,{...user,localOnly:true})}
 return send(res,200,{token:localSessionToken,...user,localOnly:true});
}
if(p==='/api/login'&&req.method==='POST'){const b=await body(req),u=db.prepare('SELECT * FROM users WHERE name=?').get(b.name);if(!u||!timingSafeEqual(Buffer.from(u.password,'hex'),Buffer.from(hash(b.password||''),'hex')))return send(res,401,{error:'Credenciais inválidas'});const t=token();sessions.set(t,{id:u.id,name:u.name,role:u.role});return send(res,200,{token:t,role:u.role,name:u.name})}
const auth=req.headers.authorization?.replace(/^Bearer /,'');const device=db.prepare('SELECT * FROM devices WHERE token=?').get(auth||'');
if(p.startsWith('/api/agent/')){if(!device)return send(res,401,{error:'Agente não autorizado'});db.prepare('UPDATE devices SET last_seen=? WHERE id=?').run(new Date().toISOString(),device.id);
if(p==='/api/agent/commands')return send(res,200,{commands:[...browseRequests.values()].filter(j=>j.device===device.id&&!j.delivered).map(j=>{j.delivered=true;return {id:j.id,path:j.path}})});
const commandMatch=p.match(/^\/api\/agent\/commands\/([a-f0-9]+)$/);
if(commandMatch&&req.method==='POST'){const job=browseRequests.get(commandMatch[1]);if(!job||job.device!==device.id)return send(res,404,{error:'Consulta expirada'});const b=await body(req);job.finish(b);return send(res,200,{ok:true})}
if(p==='/api/agent/config')return send(res,200,{device:device.id,routines:db.prepare('SELECT * FROM routines WHERE device=?').all(device.id)});
if(p==='/api/agent/runs'&&req.method==='POST'){const id=token();db.prepare('INSERT INTO runs(id,device,started,status) VALUES(?,?,?,?)').run(id,device.id,new Date().toISOString(),'running');return send(res,201,{id})}
const m=p.match(/^\/api\/agent\/runs\/([a-f0-9]+)\/(files|finish)$/);if(m&&req.method==='POST'){const run=db.prepare('SELECT * FROM runs WHERE id=? AND device=? AND status=?').get(m[1],device.id,'running');if(!run)return send(res,404,{error:'Execução ativa não encontrada'});const b=await body(req);if(m[2]==='files'){if(typeof b.path!=='string'||!b.path||b.path.startsWith('/')||b.path.split(/[\\/]/).includes('..'))throw Error('Caminho inválido');const data=Buffer.from(b.content||'','base64'),h=createHash('sha256').update(data).digest('hex');if(!existsSync(join(root,'blobs',h)))writeFileSync(join(root,'blobs',h),data);db.prepare('INSERT INTO files(run,path,hash,size) VALUES(?,?,?,?)').run(run.id,b.path,h,data.length);return send(res,201,{hash:h})}if(!['success','failed'].includes(b.status))throw Error('Status inválido');db.prepare('UPDATE runs SET finished=?,status=?,error=?,bytes=(SELECT COALESCE(SUM(size),0) FROM files WHERE run=?) WHERE id=?').run(new Date().toISOString(),b.status,String(b.error||'').slice(0,2000),run.id,run.id);return send(res,200,{ok:true})}}
const user=sessions.get(auth);if(!user||(user.localOnly&&!localRequest(req)))return send(res,401,{error:'Faça login'});
const browseMatch=p.match(/^\/api\/devices\/([a-f0-9]+)\/browse$/);
if(browseMatch&&req.method==='POST'){
 const id=browseMatch[1];if(!visible(user,id)||!db.prepare('SELECT id FROM devices WHERE id=?').get(id))return send(res,404,{error:'Computador não encontrado'});
 const b=await body(req);if(typeof b.path!=='string'||b.path.length>4096)throw Error('Caminho inválido');
 if([...browseRequests.values()].some(j=>j.device===id))return send(res,409,{error:'Já existe uma consulta em andamento neste computador'});
 const result=await new Promise(resolve=>{const jobId=token();const timer=setTimeout(()=>finish({error:'O agente não respondeu. Abra Iniciar agente e confirme a configuração e a versão 0.2.0.'}),15000);function finish(value){if(!browseRequests.has(jobId))return;clearTimeout(timer);browseRequests.delete(jobId);resolve(value)}browseRequests.set(jobId,{id:jobId,device:id,path:b.path,finish,delivered:false})});
 return send(res,result.error?400:200,result.error?{error:result.error}:result.result);
}
if(p==='/api/state'){const devices=db.prepare(user.role==='master'?'SELECT id,name,owner,last_seen FROM devices':'SELECT id,name,owner,last_seen FROM devices WHERE owner=?').all(...(user.role==='master'?[]:[user.id]));const ids=new Set(devices.map(d=>d.id));return send(res,200,{user,devices,users:user.role==='master'?db.prepare('SELECT id,name,role FROM users').all():[],routines:db.prepare('SELECT * FROM routines').all().filter(r=>ids.has(r.device)),runs:db.prepare('SELECT * FROM runs ORDER BY started DESC').all().filter(r=>ids.has(r.device))})}
if(p==='/api/users'&&req.method==='POST'){if(user.role!=='master')return send(res,403,{error:'Acesso restrito'});const b=await body(req);if(!b.name||typeof b.password!=='string'||b.password.length<10)throw Error('Informe nome e senha com pelo menos 10 caracteres');db.prepare('INSERT INTO users(name,password,role) VALUES(?,?,?)').run(b.name,hash(b.password),'client');return send(res,201,{ok:true})}
if(p==='/api/devices'&&req.method==='POST'){if(user.role!=='master')return send(res,403,{error:'Acesso restrito'});const b=await body(req);if(!b.name)throw Error('Nome obrigatório');const id=token(),t=token();db.prepare('INSERT INTO devices(id,name,owner,token) VALUES(?,?,?,?)').run(id,b.name,Number(b.owner)||user.id,t);return send(res,201,{id,token:t})}
if(p==='/api/routines'&&req.method==='POST'){const b=await body(req);if(!visible(user,b.device))return send(res,403,{error:'Acesso restrito'});if(!['daily','weekly','monthly'].includes(b.cadence)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.hour)||!b.source||!b.name)throw Error('Rotina inválida');let sources;try{sources=JSON.parse(b.source)}catch{sources=[b.source]}if(!Array.isArray(sources)||!sources.length||sources.length>100||sources.some(p=>typeof p!=='string'||!p.trim()||p.length>4096||!(/^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+|\/)/.test(p))))throw Error('Informe arquivos ou pastas com caminho absoluto');db.prepare('INSERT INTO routines(device,name,cadence,hour,source) VALUES(?,?,?,?,?)').run(b.device,b.name,b.cadence,b.hour,JSON.stringify([...new Set(sources)]));return send(res,201,{ok:true})}
const match=p.match(/^\/api\/runs\/([a-f0-9]+)\/files$/);if(match){const r=db.prepare('SELECT * FROM runs WHERE id=?').get(match[1]);if(!r||!visible(user,r.device))return send(res,404,{error:'Execução não encontrada'});if(url.searchParams.has('path')){const f=db.prepare('SELECT * FROM files WHERE run=? AND path=?').get(r.id,url.searchParams.get('path'));if(!f)return send(res,404,{error:'Arquivo não encontrado'});const data=readFileSync(join(root,'blobs',f.hash));if(createHash('sha256').update(data).digest('hex')!==f.hash)throw Error('Integridade inválida');res.setHeader('Content-Type','application/octet-stream');return res.end(data)}return send(res,200,db.prepare('SELECT path,size,hash FROM files WHERE run=?').all(r.id))}
if(p==='/api/download/client'||p==='/api/download/windows'){
 if(user.role!=='master')return send(res,403,{error:'Somente o master pode baixar instaladores'});
 const name=p.endsWith('/client')?'BackupDesk-Client-0.3.1-x64.exe':'BackupDesk-Master-0.3.2-x64.exe';
 const file=new URL('./dist/'+name,import.meta.url);if(!existsSync(file))return send(res,404,{error:'Instalador não disponível neste servidor'});
 res.setHeader('Content-Type','application/vnd.microsoft.portable-executable');res.setHeader('Content-Disposition','attachment; filename="'+name+'"');return res.end(readFileSync(file));
}
if(p==='/api/download/agent')return send(res,410,{error:'Use Baixar client no painel master'});
return send(res,404,{error:'Não encontrado'});
}catch(e){send(res,400,{error:e.message})}});
let localAgent;
if(!process.argv.includes('--prepare-master')){
 server.listen(Number(process.env.PORT||3000),process.env.HOST||'127.0.0.1',()=>{
  console.log('BackupDesk iniciado. Credenciais iniciais em '+join(root,'initial-admin.txt'));
  if(localMaster){
   db.prepare("UPDATE runs SET status='failed',finished=?,error='Execução interrompida: o master foi encerrado ou atualizado antes da conclusão',bytes=(SELECT COALESCE(SUM(size),0) FROM files WHERE run=runs.id) WHERE device=? AND status='running'").run(new Date().toISOString(),localMaster.id)
   localAgent=spawn(process.execPath,[fileURLToPath(new URL('./agent.mjs',import.meta.url))],{env:{...process.env,BACKUPDESK_URL:'http://127.0.0.1:'+server.address().port,BACKUPDESK_TOKEN:localMaster.token,BACKUPDESK_AGENT_STATE:join(root,'master-agent-state.json')},stdio:['ignore','inherit','inherit']});
   localAgent.on('error',e=>console.error('Agente local:',e.message));
   localAgent.on('exit',code=>{if(code)console.error('Agente local encerrou com código',code)});
  }
 });
 server.on('close',()=>localAgent?.kill());
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{localAgent?.kill();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref()});
}else{db.close();console.log('Master preparado: computador local cadastrado e pronto para criar rotinas.')}
