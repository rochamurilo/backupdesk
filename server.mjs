import http from 'node:http';
import {pickFolder} from './native-picker.mjs';
import {cadenceLabels} from './schedule.mjs';
import {supervise} from './background.mjs';
import {prepareLocalMaster} from './local-master.mjs';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes, scryptSync, timingSafeEqual, createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(process.env.DATA_DIR||'data'); mkdirSync(join(root,'blobs'),{recursive:true});
const db=new DatabaseSync(join(root,'backupdesk.sqlite')); db.exec(`PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT UNIQUE,password TEXT,role TEXT); CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY,name TEXT,owner INTEGER REFERENCES users(id),token TEXT UNIQUE,last_seen TEXT); CREATE TABLE IF NOT EXISTS routines(id INTEGER PRIMARY KEY,device TEXT REFERENCES devices(id),name TEXT,cadence TEXT,hour TEXT,source TEXT); CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,device TEXT REFERENCES devices(id),started TEXT,finished TEXT,status TEXT,bytes INTEGER DEFAULT 0,error TEXT); CREATE TABLE IF NOT EXISTS files(run TEXT REFERENCES runs(id),path TEXT,hash TEXT,size INTEGER,PRIMARY KEY(run,path));`);
function ensureColumn(table,name,type){if(!db.prepare('PRAGMA table_info('+table+')').all().some(c=>c.name===name))db.exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+type)}
ensureColumn('routines','enabled','INTEGER DEFAULT 1');ensureColumn('routines','deleted','INTEGER DEFAULT 0');ensureColumn('routines','use_vss','INTEGER DEFAULT 0');
ensureColumn('routines','destination',"TEXT");ensureColumn('routines','destination_type',"TEXT DEFAULT 'server'");
ensureColumn('runs','routine_id','INTEGER');ensureColumn('runs','storage_type',"TEXT DEFAULT 'server'");ensureColumn('runs','snapshot','TEXT');ensureColumn('runs','consistency','TEXT');ensureColumn('runs','warning','TEXT');ensureColumn('devices','version','TEXT');
db.exec("CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,device TEXT REFERENCES devices(id),kind TEXT,payload TEXT,status TEXT,error TEXT,result TEXT,created TEXT,finished TEXT)");
for(const table of ['jobs','runs']){ensureColumn(table,'progress','TEXT');ensureColumn(table,'updated','TEXT')}
ensureColumn('runs','job_id','TEXT');
function absolutePath(p){return typeof p==='string'&&p.length>0&&p.length<=4096&&/^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+|\/)/.test(p)}
function hash(p){return scryptSync(p,'backupdesk-local-v1',32).toString('hex')}
if(!db.prepare('SELECT id FROM users LIMIT 1').get()){const password=process.env.ADMIN_PASSWORD||randomBytes(16).toString('hex');db.prepare('INSERT INTO users(name,password,role) VALUES(?,?,?)').run('admin',hash(password),'master');writeFileSync(join(root,'initial-admin.txt'),`Usuário: admin\nSenha: ${password}\n`,{mode:0o600});}
const localMaster=(process.env.BACKUPDESK_LOCAL_MASTER==='1'||process.argv.includes('--prepare-master'))?prepareLocalMaster(db):null;
const browseRequests=new Map();
const sessions=new Map(); const token=()=>randomBytes(32).toString('hex');
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
async function body(req){let chunks=[],n=0;for await(const c of req){n+=c.length;if(n>24*1024*1024)throw Error('Corpo excede 24 MB');chunks.push(c)}return JSON.parse(Buffer.concat(chunks).toString()||'{}')}
let localSessionToken;
let choosingFolder=false;
function localRequest(req){
 const host=req.headers.host||'';
 const bound=server.address()?.address;
 return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)&&['127.0.0.1','::1','::ffff:127.0.0.1'].includes(bound)&&/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host);
}
const visible=(user,id)=>user.role==='master'||!!db.prepare('SELECT id FROM devices WHERE id=? AND owner=?').get(id,user.id);
export const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),p=url.pathname; if(!p.startsWith('/api/')){if(p==='/schedule.mjs'){res.setHeader('Content-Type','text/javascript');return res.end(readFileSync(new URL('./schedule.mjs',import.meta.url)))}const file={'/':'index.html','/app.js':'app.js','/style.css':'style.css'}[p];if(!file)return send(res,404,{error:'Não encontrado'});res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');return res.end(readFileSync(new URL('./public/'+file,import.meta.url)))}
if(p==='/api/health')return send(res,200,{ok:true,app:'backupdesk',mode:localMaster?'master':'api'});
if(p==='/api/local-session'){
 if(req.method!=='POST')return send(res,405,{error:'Método não permitido'});
 if(!localMaster||!localRequest(req)||req.headers.origin!=='http://'+req.headers.host)return send(res,403,{error:'Acesso automático disponível apenas no master local'});
 if(process.env.BACKUPDESK_VSS_MODE==='1'){const b=await body(req);if(!process.env.BACKUPDESK_LOCAL_ACCESS||b.access!==process.env.BACKUPDESK_LOCAL_ACCESS)return send(res,403,{error:'Abra pelo atalho VSS (administrador) para autorizar esta sessão.'})}
 const user=db.prepare("SELECT id,name,role FROM users WHERE id=? AND role='master'").get(localMaster.owner);
 if(!user)return send(res,403,{error:'Master local não disponível'});
 if(!localSessionToken){localSessionToken=token();sessions.set(localSessionToken,{...user,localOnly:true})}
 return send(res,200,{token:localSessionToken,...user,localOnly:true});
}
if(p==='/api/login'&&req.method==='POST'){if(process.env.BACKUPDESK_VSS_MODE==='1')return send(res,403,{error:'Abra pelo atalho VSS (administrador) para autorizar esta sessão.'});const b=await body(req),u=db.prepare('SELECT * FROM users WHERE name=?').get(b.name);if(!u||!timingSafeEqual(Buffer.from(u.password,'hex'),Buffer.from(hash(b.password||''),'hex')))return send(res,401,{error:'Credenciais inválidas'});const t=token();sessions.set(t,{id:u.id,name:u.name,role:u.role});return send(res,200,{token:t,role:u.role,name:u.name})}
const auth=req.headers.authorization?.replace(/^Bearer /,'');const device=db.prepare('SELECT * FROM devices WHERE token=?').get(auth||'');
if(p.startsWith('/api/agent/')){if(!device)return send(res,401,{error:'Agente não autorizado'});db.prepare('UPDATE devices SET last_seen=?,version=COALESCE(?,version) WHERE id=?').run(new Date().toISOString(),req.headers['x-backupdesk-version']||null,device.id);
if(p==='/api/agent/hello'&&req.method==='POST'){
 db.prepare("UPDATE jobs SET status='failed',error='Agente reiniciado antes da conclusão',finished=? WHERE device=? AND status='running'").run(new Date().toISOString(),device.id);
 db.prepare("UPDATE runs SET status='failed',error='Agente reiniciado antes da conclusão',finished=? WHERE device=? AND status='running'").run(new Date().toISOString(),device.id);return send(res,200,{ok:true});
}
if(p==='/api/agent/commands'){
 const commands=[...browseRequests.values()].filter(j=>j.device===device.id&&!j.delivered).map(j=>{j.delivered=true;return {id:j.id,path:j.path}});
 if(['0.5.0','0.6.0','0.7.0'].includes(req.headers['x-backupdesk-version'])&&url.searchParams.get('busy')!=='1'){const job=db.prepare("SELECT * FROM jobs WHERE device=? AND status='queued' ORDER BY created LIMIT 1").get(device.id);if(job){db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(job.id);commands.push({id:job.id,kind:job.kind,payload:JSON.parse(job.payload)})}}
 return send(res,200,{commands});
}
const progressMatch=p.match(/^\/api\/agent\/(jobs|runs)\/([a-f0-9]+)\/progress$/);
if(progressMatch&&req.method==='POST'){const table=progressMatch[1],item=db.prepare('SELECT * FROM '+table+" WHERE id=? AND device=? AND status='running'").get(progressMatch[2],device.id);if(!item)return send(res,404,{error:'Tarefa ativa não encontrada'});const b=await body(req),value={stage:String(b.stage||'preparing').slice(0,40),currentFile:String(b.currentFile||'').slice(0,4096)};for(const key of ['processedBytes','totalBytes','filesDone','totalFiles'])value[key]=Number.isSafeInteger(b[key])&&b[key]>=0?b[key]:null;const updated=new Date().toISOString();db.prepare('UPDATE '+table+' SET progress=?,updated=? WHERE id=?').run(JSON.stringify(value),updated,item.id);if(table==='runs'&&item.job_id)db.prepare("UPDATE jobs SET progress=?,updated=? WHERE id=? AND device=? AND status='running'").run(JSON.stringify(value),updated,item.job_id,device.id);return send(res,200,{ok:true})}
const jobFinish=p.match(/^\/api\/agent\/jobs\/([a-f0-9]+)$/);
if(jobFinish&&req.method==='POST'){const job=db.prepare("SELECT * FROM jobs WHERE id=? AND device=? AND status='running'").get(jobFinish[1],device.id);if(!job)return send(res,404,{error:'Tarefa não encontrada'});const b=await body(req);if(!['success','failed'].includes(b.status))throw Error('Status inválido');db.prepare('UPDATE jobs SET status=?,error=?,result=?,finished=? WHERE id=?').run(b.status,String(b.error||'').slice(0,2000),JSON.stringify(b.result||{}),new Date().toISOString(),job.id);return send(res,200,{ok:true})}
const commandMatch=p.match(/^\/api\/agent\/commands\/([a-f0-9]+)$/);
if(commandMatch&&req.method==='POST'){const job=browseRequests.get(commandMatch[1]);if(!job||job.device!==device.id)return send(res,404,{error:'Consulta expirada'});const b=await body(req);job.finish(b);return send(res,200,{ok:true})}
if(p==='/api/agent/config')return send(res,200,{device:device.id,routines:db.prepare('SELECT * FROM routines WHERE device=? AND enabled=1 AND deleted=0').all(device.id).filter(r=>(['0.5.0','0.6.0','0.7.0'].includes(req.headers['x-backupdesk-version'])||r.destination_type==='server')&&(!r.use_vss||['0.6.0','0.7.0'].includes(req.headers['x-backupdesk-version'])))});
if(p==='/api/agent/runs'&&req.method==='POST'){const b=await body(req);let routine;if(b.routine_id){routine=db.prepare('SELECT * FROM routines WHERE id=? AND device=? AND enabled=1 AND deleted=0').get(Number(b.routine_id),device.id);if(!routine)throw Error('Rotina não encontrada')}
 if(b.job_id&&!db.prepare("SELECT id FROM jobs WHERE id=? AND device=? AND kind='backup' AND status='running'").get(b.job_id,device.id))throw Error('Tarefa inválida');const id=token(),storage=routine&&['local','external','network','server'].includes(b.storage_type)?b.storage_type:(routine?.destination_type||'server');db.prepare('INSERT INTO runs(id,device,started,status,routine_id,storage_type) VALUES(?,?,?,?,?,?)').run(id,device.id,new Date().toISOString(),'running',routine?.id||null,storage);db.prepare('UPDATE runs SET job_id=? WHERE id=?').run(b.job_id||null,id);return send(res,201,{id,device:device.id,storage_type:storage})}
const m=p.match(/^\/api\/agent\/runs\/([a-f0-9]+)\/(files|finish)$/);if(m&&req.method==='POST'){const run=db.prepare('SELECT * FROM runs WHERE id=? AND device=? AND status=?').get(m[1],device.id,'running');if(!run)return send(res,404,{error:'Execução ativa não encontrada'});const b=await body(req);if(m[2]==='files'){if(typeof b.path!=='string'||!b.path||b.path.startsWith('/')||b.path.split(/[\\/]/).includes('..'))throw Error('Caminho inválido');if(run.storage_type!=='server'){if(!/^[a-f0-9]{64}$/.test(b.hash)||!Number.isSafeInteger(b.size)||b.size<0)throw Error('Metadados inválidos');db.prepare('INSERT INTO files(run,path,hash,size) VALUES(?,?,?,?)').run(run.id,b.path,b.hash,b.size);return send(res,201,{ok:true})}const data=Buffer.from(b.content||'','base64'),h=createHash('sha256').update(data).digest('hex');if(!existsSync(join(root,'blobs',h)))writeFileSync(join(root,'blobs',h),data);db.prepare('INSERT INTO files(run,path,hash,size) VALUES(?,?,?,?)').run(run.id,b.path,h,data.length);return send(res,201,{hash:h})}if(!['success','failed'].includes(b.status))throw Error('Status inválido');if(run.storage_type!=='server'&&b.status==='success'){if(!absolutePath(b.snapshot))throw Error('Cópia local sem destino confirmado');db.prepare('UPDATE runs SET snapshot=?,consistency=?,warning=? WHERE id=?').run(b.snapshot,b.consistency||'closed-file-copy',b.warning||null,run.id)}db.prepare('UPDATE runs SET finished=?,status=?,error=?,bytes=(SELECT COALESCE(SUM(size),0) FROM files WHERE run=?) WHERE id=?').run(new Date().toISOString(),b.status,String(b.error||'').slice(0,2000),run.id,run.id);return send(res,200,{ok:true})}}
const user=sessions.get(auth);if(!user||(user.localOnly&&!localRequest(req)))return send(res,401,{error:'Faça login'});
if(p==='/api/pick-folder'&&req.method==='POST'){
 if(!user.localOnly||!localMaster||!localRequest(req)||req.headers.origin!=='http://'+req.headers.host)return send(res,403,{error:'Abra o painel no computador master para selecionar a pasta no Windows.'});
 if(choosingFolder)return send(res,409,{error:'A janela de seleção já está aberta.'});
 const b=await body(req);choosingFolder=true;try{return send(res,200,await pickFolder(b.purpose||'source'))}finally{choosingFolder=false}
}
const browseMatch=p.match(/^\/api\/devices\/([a-f0-9]+)\/browse$/);
if(browseMatch&&req.method==='POST'){
 const id=browseMatch[1];if(!visible(user,id)||!db.prepare('SELECT id FROM devices WHERE id=?').get(id))return send(res,404,{error:'Computador não encontrado'});
 const b=await body(req);if(typeof b.path!=='string'||b.path.length>4096)throw Error('Caminho inválido');
 if([...browseRequests.values()].some(j=>j.device===id))return send(res,409,{error:'Já existe uma consulta em andamento neste computador'});
 const result=await new Promise(resolve=>{const jobId=token();const timer=setTimeout(()=>finish({error:'O agente não respondeu. Abra Iniciar agente e confirme a configuração e a versão 0.2.0.'}),15000);function finish(value){if(!browseRequests.has(jobId))return;clearTimeout(timer);browseRequests.delete(jobId);resolve(value)}browseRequests.set(jobId,{id:jobId,device:id,path:b.path,finish,delivered:false})});
 return send(res,result.error?400:200,result.error?{error:result.error}:result.result);
}
if(p==='/api/activity'){const items=[];for(const table of ['jobs','runs']){const rows=db.prepare(`SELECT t.id,t.status,t.error,t.finished,t.updated,t.progress,${table==='jobs'?"t.created,t.kind,json_extract(t.payload,'$.routine.name') AS name,json_extract(t.result,'$.warning') AS warning":"t.started,t.warning,'backup' AS kind,(SELECT name FROM routines WHERE id=t.routine_id) AS name"},d.name AS device_name FROM ${table} t JOIN devices d ON d.id=t.device WHERE (?='master' OR d.owner=?) ${table==='runs'?'AND t.job_id IS NULL':''} ORDER BY CASE WHEN t.status IN ('queued','running') THEN 0 ELSE 1 END, ${table==='jobs'?'created':'started'} DESC LIMIT 20`).all(user.role,user.id);for(const r of rows){items.push({id:r.id,kind:r.kind||'backup',status:r.status,error:r.error,warning:r.warning,device_name:r.device_name,created:r.created||r.started,updated:r.updated,progress:r.progress?JSON.parse(r.progress):null,name:r.name||'',finished:r.finished})}}items.sort((a,b)=>Number(!['queued','running'].includes(a.status))-Number(!['queued','running'].includes(b.status))||b.created.localeCompare(a.created));return send(res,200,items.slice(0,20))}
if(p==='/api/state'){const devices=db.prepare(user.role==='master'?'SELECT id,name,owner,last_seen,version FROM devices':'SELECT id,name,owner,last_seen,version FROM devices WHERE owner=?').all(...(user.role==='master'?[]:[user.id]));const ids=new Set(devices.map(d=>d.id));return send(res,200,{user,devices,localDeviceId:user.localOnly?localMaster?.id:null,users:user.role==='master'?db.prepare('SELECT id,name,role FROM users').all():[],routines:db.prepare('SELECT * FROM routines WHERE deleted=0').all().filter(r=>ids.has(r.device)),runs:db.prepare('SELECT * FROM runs ORDER BY started DESC').all().filter(r=>ids.has(r.device))})}
if(p==='/api/users'&&req.method==='POST'){if(user.role!=='master')return send(res,403,{error:'Acesso restrito'});const b=await body(req);if(!b.name||typeof b.password!=='string'||b.password.length<10)throw Error('Informe nome e senha com pelo menos 10 caracteres');db.prepare('INSERT INTO users(name,password,role) VALUES(?,?,?)').run(b.name,hash(b.password),'client');return send(res,201,{ok:true})}
if(p==='/api/devices'&&req.method==='POST'){if(user.role!=='master')return send(res,403,{error:'Acesso restrito'});const b=await body(req);if(!b.name)throw Error('Nome obrigatório');const id=token(),t=token();db.prepare('INSERT INTO devices(id,name,owner,token) VALUES(?,?,?,?)').run(id,b.name,Number(b.owner)||user.id,t);return send(res,201,{id,token:t})}
const routineControl=p.match(/^\/api\/routines\/(\d+)\/(enabled|delete)$/);
if(routineControl&&req.method==='POST'){
 const id=Number(routineControl[1]);const routine=db.prepare('SELECT * FROM routines WHERE id=? AND deleted=0').get(id);if(!routine||!visible(user,routine.device))return send(res,404,{error:'Rotina não encontrada'});
 if(routineControl[2]==='enabled'){const b=await body(req);if(typeof b.enabled!=='boolean')throw Error('Estado inválido');db.prepare('UPDATE routines SET enabled=? WHERE id=?').run(b.enabled?1:0,id)}else db.prepare('UPDATE routines SET enabled=0,deleted=1 WHERE id=?').run(id);
 db.prepare("UPDATE jobs SET status='failed',error='Rotina desativada ou excluída antes da execução',finished=? WHERE device=? AND kind='backup' AND status='queued' AND json_extract(payload,'$.routine.id')=?").run(new Date().toISOString(),routine.device,id);
 return send(res,200,{ok:true});
}
const routineEdit=p.match(/^\/api\/routines\/(\d+)$/);
if((p==='/api/routines'&&req.method==='POST')||(routineEdit&&req.method==='PATCH')){
 const b=await body(req);if(!visible(user,b.device))return send(res,403,{error:'Acesso restrito'});
 if(routineEdit){const old=db.prepare('SELECT * FROM routines WHERE id=?').get(Number(routineEdit[1]));if(!old||!visible(user,old.device))return send(res,404,{error:'Rotina não encontrada'})}
 if(!Object.hasOwn(cadenceLabels,b.cadence)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.hour)||!b.source||!b.name)throw Error('Rotina inválida');
 let sources;try{sources=JSON.parse(b.source)}catch{sources=[b.source]}if(!Array.isArray(sources)||!sources.length||sources.length>100||sources.some(p=>!absolutePath(p)))throw Error('Informe arquivos ou pastas com caminho absoluto');
 const useVss=b.use_vss===true||b.use_vss==='on';const type=b.destination_type;if(useVss&&type==='server')throw Error('VSS requer destino em disco local, externo ou rede.');if(!['local','external','network','server'].includes(type))throw Error('Selecione onde salvar o backup.');if(type!=='server'&&!absolutePath(b.destination))throw Error('Selecione a pasta de destino.');
 const values=[b.device,b.name,b.cadence,b.hour,JSON.stringify([...new Set(sources)]),type==='server'?null:b.destination,type,useVss?1:0];
 if(routineEdit)db.prepare('UPDATE routines SET device=?,name=?,cadence=?,hour=?,source=?,destination=?,destination_type=?,use_vss=? WHERE id=?').run(...values,Number(routineEdit[1]));else db.prepare('INSERT INTO routines(device,name,cadence,hour,source,destination,destination_type,use_vss) VALUES(?,?,?,?,?,?,?,?)').run(...values);
 return send(res,routineEdit?200:201,{ok:true});
}
if(p==='/api/jobs'&&req.method==='POST'){
 const b=await body(req);let deviceId,payload;
 if(b.kind==='backup'){const r=db.prepare('SELECT * FROM routines WHERE id=? AND deleted=0').get(Number(b.routine_id));if(!r||!visible(user,r.device))return send(res,404,{error:'Rotina não encontrada'});if(!r.enabled)return send(res,409,{error:'Ative a rotina antes de executar um backup.'});deviceId=r.device;if(r.use_vss&&!['0.6.0','0.7.0'].includes(db.prepare('SELECT version FROM devices WHERE id=?').get(deviceId)?.version))throw Error('Atualize o agente para 0.6.0 para usar VSS.');if(db.prepare("SELECT id FROM jobs WHERE device=? AND status IN ('queued','running') AND kind IN ('backup','restore')").get(deviceId)||db.prepare("SELECT id FROM runs WHERE device=? AND status='running'").get(deviceId))return send(res,409,{error:'Já existe um backup ou restauração em andamento neste computador.'});payload={routine:r}}
 else if(b.kind==='validate'){if(!visible(user,b.device)||!db.prepare('SELECT id FROM devices WHERE id=?').get(b.device))return send(res,404,{error:'Computador não encontrado'});if(!absolutePath(b.destination)||typeof b.source!=='string')throw Error('Informe origem e destino');deviceId=b.device;payload={source:b.source,destination:b.destination,useVss:b.use_vss===true}}
 else if(b.kind==='restore'){const r=db.prepare("SELECT * FROM runs WHERE id=? AND status='success'").get(b.run);if(!r||!visible(user,r.device)||r.storage_type==='server')return send(res,404,{error:'Backup em disco concluído não encontrado'});if(!absolutePath(b.target))throw Error('Selecione a pasta para restaurar.');const selected=b.path==='*'?db.prepare('SELECT path,hash,size FROM files WHERE run=?').all(r.id):[db.prepare('SELECT path,hash,size FROM files WHERE run=? AND path=?').get(r.id,b.path)].filter(Boolean);if(!selected.length)throw Error('Arquivos não encontrados');deviceId=r.device;payload={snapshot:r.snapshot,files:selected,target:b.target,warning:r.warning}}
 else throw Error('Tarefa inválida');
 const known=db.prepare('SELECT version FROM devices WHERE id=?').get(deviceId);if(!['0.5.0','0.6.0','0.7.0'].includes(known?.version))return send(res,409,{error:'Inicie ou atualize o agente para a versão 0.5.0 antes de executar esta ação.'});
 const id=token();db.prepare('INSERT INTO jobs(id,device,kind,payload,status,created) VALUES(?,?,?,?,?,?)').run(id,deviceId,b.kind,JSON.stringify(payload),'queued',new Date().toISOString());return send(res,201,{id});
}
const jobRead=p.match(/^\/api\/jobs\/([a-f0-9]+)$/);if(jobRead){const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(jobRead[1]);if(!job||!visible(user,job.device))return send(res,404,{error:'Tarefa não encontrada'});return send(res,200,{id:job.id,status:job.status,error:job.error,result:job.result?JSON.parse(job.result):null})}
const match=p.match(/^\/api\/runs\/([a-f0-9]+)\/files$/);if(match){const r=db.prepare('SELECT * FROM runs WHERE id=?').get(match[1]);if(!r||!visible(user,r.device))return send(res,404,{error:'Execução não encontrada'});if(url.searchParams.has('path')){const f=db.prepare('SELECT * FROM files WHERE run=? AND path=?').get(r.id,url.searchParams.get('path'));if(!f)return send(res,404,{error:'Arquivo não encontrado'});if(r.storage_type!=='server')return send(res,409,{error:'Use a restauração para pasta no computador de origem deste backup.'});const data=readFileSync(join(root,'blobs',f.hash));if(createHash('sha256').update(data).digest('hex')!==f.hash)throw Error('Integridade inválida');res.setHeader('Content-Type','application/octet-stream');return res.end(data)}return send(res,200,db.prepare('SELECT path,size,hash FROM files WHERE run=?').all(r.id))}
if(p==='/api/download/client'||p==='/api/download/windows'){
 if(user.role!=='master')return send(res,403,{error:'Somente o master pode baixar instaladores'});
 const name=p.endsWith('/client')?'BackupDesk-Client-0.7.0-x64.exe':'BackupDesk-Master-0.7.0-x64.exe';
 const file=new URL('./dist/'+name,import.meta.url);if(!existsSync(file))return send(res,404,{error:'Instalador não disponível neste servidor'});
 res.setHeader('Content-Type','application/vnd.microsoft.portable-executable');res.setHeader('Content-Disposition','attachment; filename="'+name+'"');return res.end(readFileSync(file));
}
if(p==='/api/download/agent')return send(res,410,{error:'Use Baixar client no painel master'});
return send(res,404,{error:'Não encontrado'});
}catch(e){send(res,400,{error:e.message})}});
let localAgent;
if(!process.argv.includes('--prepare-master')){
 server.listen(Number(process.env.PORT||3000),process.env.BACKUPDESK_VSS_MODE==='1'?'127.0.0.1':(process.env.HOST||'127.0.0.1'),()=>{
  console.log('BackupDesk iniciado. Credenciais iniciais em '+join(root,'initial-admin.txt'));
  if(localMaster){
   db.prepare("UPDATE runs SET status='failed',finished=?,error='Execução interrompida: o master foi encerrado ou atualizado antes da conclusão',bytes=(SELECT COALESCE(SUM(size),0) FROM files WHERE run=runs.id) WHERE device=? AND status='running'").run(new Date().toISOString(),localMaster.id)
   localAgent=supervise(process.execPath,[fileURLToPath(new URL('./agent.mjs',import.meta.url))],{env:{...process.env,BACKUPDESK_URL:'http://127.0.0.1:'+server.address().port,BACKUPDESK_TOKEN:localMaster.token,BACKUPDESK_AGENT_STATE:join(root,'master-agent-state.json')},stdio:['ignore','inherit','inherit'],windowsHide:true});

  }
 });
 server.on('close',()=>localAgent?.stop());
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,shutdown);
}else{db.close();console.log('Master preparado: computador local cadastrado e pronto para criar rotinas.')}

function shutdown(){localAgent?.stop();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref()}
