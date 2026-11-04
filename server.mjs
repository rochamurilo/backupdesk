import {computerName,clientUrl,enrollmentTrailer} from './client-package.mjs';
import {readManifest,modifiedDate,backupDestination} from './backup-repository.mjs';
import http from 'node:http';
import {automaticVssStatus} from './vss.mjs';
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
ensureColumn('devices','platform','TEXT');ensureColumn('devices','installation_id','TEXT');
for(const [name,type] of [['backup_type','TEXT'],['base_run','TEXT'],['scope_key','TEXT'],['scope_sources','TEXT'],['scope_destination','TEXT'],['captured_at','TEXT'],['logical_bytes','INTEGER'],['changed_files','INTEGER'],['pst_validation','TEXT']])ensureColumn('runs',name,type);
ensureColumn('files','source_run','TEXT');ensureColumn('files','modified_at','TEXT');
function absolutePath(p){return typeof p==='string'&&p.length>0&&p.length<=4096&&/^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+|\/)/.test(p)}
function hash(p){return scryptSync(p,'backupdesk-local-v1',32).toString('hex')}
if(!db.prepare('SELECT id FROM users LIMIT 1').get()){const password=process.env.ADMIN_PASSWORD||randomBytes(16).toString('hex');db.prepare('INSERT INTO users(name,password,role) VALUES(?,?,?)').run('admin',hash(password),'master');writeFileSync(join(root,'initial-admin.txt'),`Usuário: admin\nSenha: ${password}\n`,{mode:0o600});}
const localMaster=(process.env.BACKUPDESK_LOCAL_MASTER==='1'||process.argv.includes('--prepare-master'))?prepareLocalMaster(db):null;
if(localMaster)db.prepare('UPDATE devices SET platform=? WHERE id=?').run(process.platform,localMaster.id);
function requiredVss(device,type){return type!=='server'&&!['linux','darwin'].includes(device?.platform)}
// Upgrade existing Windows routines, including ones previously saved with VSS disabled.
db.exec("UPDATE routines SET use_vss=CASE WHEN destination_type='server' OR device IN (SELECT id FROM devices WHERE platform IN ('linux','darwin')) THEN 0 ELSE 1 END WHERE deleted=0");
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
const hydratedRuns=new Map();
async function hydrateLocalRun(run){
 if(!localMaster||run.device!==localMaster.id||run.status!=='success'||run.storage_type==='server'||!run.snapshot)return;
 const cached=hydratedRuns.get(run.id);if(cached===true||typeof cached==='number'&&Date.now()-cached<30000)return;
 if(run.scope_sources&&run.scope_destination&&!db.prepare('SELECT path FROM files WHERE run=? AND modified_at IS NULL LIMIT 1').get(run.id)){hydratedRuns.set(run.id,true);return}
 try{const manifest=await readManifest(run.snapshot);if(manifest.run!==run.id||manifest.device!==run.device)return;
  if(!run.scope_sources&&Array.isArray(manifest.sources))run.scope_sources=JSON.stringify(manifest.sources);
  run.scope_destination ||= manifest.destination||backupDestination(run);
  db.prepare('UPDATE runs SET scope_sources=COALESCE(scope_sources,?),scope_destination=COALESCE(scope_destination,?) WHERE id=?').run(run.scope_sources||null,run.scope_destination||null,run.id);
  const update=db.prepare('UPDATE files SET modified_at=? WHERE run=? AND path=? AND hash=? AND size=? AND modified_at IS NULL');db.exec('BEGIN');try{for(const f of manifest.files){const modified=f.modified_at||modifiedDate(f.mtime_ns);if(modified&&Number.isFinite(Date.parse(modified)))update.run(modified,run.id,f.path,f.hash,f.size)}db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
  hydratedRuns.set(run.id,true);
 }catch{hydratedRuns.set(run.id,Date.now())}
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
if(p.startsWith('/api/agent/')){if(!device)return send(res,401,{error:'Agente não autorizado'});if(device.installation_id&&req.headers['x-backupdesk-installation']&&req.headers['x-backupdesk-installation']!==device.installation_id)return send(res,409,{error:'A identificação deste client pertence a outra instalação.'});db.prepare('UPDATE devices SET last_seen=?,version=COALESCE(?,version) WHERE id=?').run(new Date().toISOString(),req.headers['x-backupdesk-version']||null,device.id);
 const platform=req.headers['x-backupdesk-platform'];if(['win32','linux','darwin'].includes(platform)&&device.platform!==platform){device.platform=platform;db.prepare('UPDATE devices SET platform=? WHERE id=?').run(platform,device.id);db.prepare("UPDATE routines SET use_vss=CASE WHEN destination_type='server' THEN 0 ELSE ? END WHERE device=? AND deleted=0").run(platform==='win32'?1:0,device.id)}
if(p==='/api/agent/hello'&&req.method==='POST'){
 const hello=await body(req);if(hello.installation_id){if(!/^[a-f0-9-]{36}$/i.test(hello.installation_id))throw Error('Identificação da instalação inválida.');if(device.installation_id&&device.installation_id!==hello.installation_id)return send(res,409,{error:'Este instalador já foi vinculado a outro computador. Gere um client com outro nome no master.'});if(!db.prepare('UPDATE devices SET installation_id=? WHERE id=? AND (installation_id IS NULL OR installation_id=?)').run(hello.installation_id,device.id,hello.installation_id).changes)return send(res,409,{error:'Este client já está associado a outro computador.'})}

 db.prepare("UPDATE jobs SET status='failed',error='Agente reiniciado antes da conclusão',finished=? WHERE device=? AND status='running'").run(new Date().toISOString(),device.id);
 db.prepare("UPDATE runs SET status='failed',error='Agente reiniciado antes da conclusão',finished=? WHERE device=? AND status='running'").run(new Date().toISOString(),device.id);return send(res,200,{ok:true});
}
if(p==='/api/agent/commands'){
 const commands=[...browseRequests.values()].filter(j=>j.device===device.id&&!j.delivered).map(j=>{j.delivered=true;return {id:j.id,path:j.path}});
 if(['0.5.0','0.6.0','0.7.0','0.7.1','0.8.0','0.8.1','0.8.2','0.8.3','0.9.0','0.10.0'].includes(req.headers['x-backupdesk-version'])&&url.searchParams.get('busy')!=='1'){const job=db.prepare("SELECT * FROM jobs WHERE device=? AND status='queued' ORDER BY created LIMIT 1").get(device.id);if(job){const payload=JSON.parse(job.payload);if(job.kind==='backup')payload.routine.use_vss=requiredVss(device,payload.routine.destination_type)?1:0;if(job.kind==='validate')payload.useVss=requiredVss(device,'local');
 const needsVss=job.kind==='backup'?payload.routine.use_vss:job.kind==='validate'&&payload.useVss;
 if(needsVss&&!['0.6.0','0.7.0','0.7.1','0.8.0','0.8.1','0.8.2','0.8.3','0.9.0','0.10.0'].includes(req.headers['x-backupdesk-version']))db.prepare("UPDATE jobs SET status='failed',error='Atualize o client para executar backups com VSS obrigatório.',finished=? WHERE id=?").run(new Date().toISOString(),job.id);
 else{db.prepare("UPDATE jobs SET status='running' WHERE id=?").run(job.id);commands.push({id:job.id,kind:job.kind,payload})}
 }}
 return send(res,200,{commands});
}
const progressMatch=p.match(/^\/api\/agent\/(jobs|runs)\/([a-f0-9]+)\/progress$/);
if(progressMatch&&req.method==='POST'){const table=progressMatch[1],item=db.prepare('SELECT * FROM '+table+" WHERE id=? AND device=? AND status='running'").get(progressMatch[2],device.id);if(!item)return send(res,404,{error:'Tarefa ativa não encontrada'});const b=await body(req),value={stage:String(b.stage||'preparing').slice(0,40),currentFile:String(b.currentFile||'').slice(0,4096)};for(const key of ['processedBytes','totalBytes','filesDone','totalFiles'])value[key]=Number.isSafeInteger(b[key])&&b[key]>=0?b[key]:null;const updated=new Date().toISOString();db.prepare('UPDATE '+table+' SET progress=?,updated=? WHERE id=?').run(JSON.stringify(value),updated,item.id);if(table==='runs'&&item.job_id)db.prepare("UPDATE jobs SET progress=?,updated=? WHERE id=? AND device=? AND status='running'").run(JSON.stringify(value),updated,item.job_id,device.id);return send(res,200,{ok:true})}
const jobFinish=p.match(/^\/api\/agent\/jobs\/([a-f0-9]+)$/);
if(jobFinish&&req.method==='POST'){const job=db.prepare("SELECT * FROM jobs WHERE id=? AND device=? AND status='running'").get(jobFinish[1],device.id);if(!job)return send(res,404,{error:'Tarefa não encontrada'});const b=await body(req);if(!['success','failed'].includes(b.status))throw Error('Status inválido');db.prepare('UPDATE jobs SET status=?,error=?,result=?,finished=? WHERE id=?').run(b.status,String(b.error||'').slice(0,2000),JSON.stringify(b.result||{}),new Date().toISOString(),job.id);return send(res,200,{ok:true})}
const commandMatch=p.match(/^\/api\/agent\/commands\/([a-f0-9]+)$/);
if(commandMatch&&req.method==='POST'){const job=browseRequests.get(commandMatch[1]);if(!job||job.device!==device.id)return send(res,404,{error:'Consulta expirada'});const b=await body(req);job.finish(b);return send(res,200,{ok:true})}
if(p==='/api/agent/config')return send(res,200,{device:device.id,routines:db.prepare('SELECT * FROM routines WHERE device=? AND enabled=1 AND deleted=0').all(device.id).map(r=>({...r,use_vss:requiredVss(device,r.destination_type)?1:0})).filter(r=>(['0.5.0','0.6.0','0.7.0','0.7.1','0.8.0','0.8.1','0.8.2','0.8.3','0.9.0','0.10.0'].includes(req.headers['x-backupdesk-version'])||r.destination_type==='server')&&(!r.use_vss||['0.6.0','0.7.0','0.7.1','0.8.0','0.8.1','0.8.2','0.8.3','0.9.0','0.10.0'].includes(req.headers['x-backupdesk-version'])))});
if(p==='/api/agent/runs'&&req.method==='POST'){const b=await body(req);let routine;if(b.routine_id){routine=db.prepare('SELECT * FROM routines WHERE id=? AND device=? AND enabled=1 AND deleted=0').get(Number(b.routine_id),device.id);if(!routine)throw Error('Rotina não encontrada')}
 if(b.job_id&&!db.prepare("SELECT id FROM jobs WHERE id=? AND device=? AND kind='backup' AND status='running'").get(b.job_id,device.id))throw Error('Tarefa inválida');const id=token(),storage=routine&&['local','external','network','server'].includes(b.storage_type)?b.storage_type:(routine?.destination_type||'server');db.prepare('INSERT INTO runs(id,device,started,status,routine_id,storage_type) VALUES(?,?,?,?,?,?)').run(id,device.id,new Date().toISOString(),'running',routine?.id||null,storage);db.prepare('UPDATE runs SET job_id=? WHERE id=?').run(b.job_id||null,id);const bases=db.prepare("SELECT id,snapshot FROM runs WHERE device=? AND status='success' AND storage_type!='server' AND (backup_type IS NULL OR backup_type='full') AND finished>=? ORDER BY finished DESC").all(device.id,new Date(Date.now()-5*86400000).toISOString());return send(res,201,{id,device:device.id,storage_type:storage,bases})}
const runPlan=p.match(/^\/api\/agent\/runs\/([a-f0-9]+)\/plan$/);
if(runPlan&&req.method==='POST'){
 const run=db.prepare("SELECT * FROM runs WHERE id=? AND device=? AND status='running'").get(runPlan[1],device.id);if(!run)return send(res,404,{error:'Execução não encontrada'});
 const b=await body(req);if(!['full','differential'].includes(b.backup_type)||!/^[a-f0-9]{64}$/.test(b.scope_key)||!absolutePath(b.scope_destination)||!Number.isFinite(Date.parse(b.captured_at)))throw Error('Plano de backup inválido.');
 const sources=JSON.parse(b.scope_sources);if(!Array.isArray(sources)||!sources.length||sources.some(s=>!absolutePath(s)))throw Error('Origens do plano inválidas.');
 if(b.backup_type==='differential'){const base=db.prepare("SELECT * FROM runs WHERE id=? AND device=? AND status='success' AND storage_type!='server' AND (backup_type='full' OR backup_type IS NULL)").get(b.base_run,device.id);if(!base||base.scope_key&&base.scope_key!==b.scope_key||Date.parse(base.finished)<Date.parse(run.started)-5*86400000)throw Error('Base completa inválida para o diferencial.');}
 else if(b.base_run)throw Error('Backup completo não deve depender de outra versão.');
 if(db.prepare('SELECT path FROM files WHERE run=? LIMIT 1').get(run.id))throw Error('O plano não pode mudar após cadastrar arquivos.');
 db.prepare('UPDATE runs SET backup_type=?,base_run=?,scope_key=?,scope_sources=?,scope_destination=?,captured_at=? WHERE id=?').run(b.backup_type,b.base_run||null,b.scope_key,JSON.stringify(sources),b.scope_destination,new Date(b.captured_at).toISOString(),run.id);return send(res,200,{ok:true});
}
const m=p.match(/^\/api\/agent\/runs\/([a-f0-9]+)\/(files|finish)$/);if(m&&req.method==='POST'){const run=db.prepare('SELECT * FROM runs WHERE id=? AND device=? AND status=?').get(m[1],device.id,'running');if(!run)return send(res,404,{error:'Execução ativa não encontrada'});const b=await body(req);if(m[2]==='files'){if(typeof b.path!=='string'||!b.path||b.path.startsWith('/')||b.path.split(/[\\/]/).includes('..'))throw Error('Caminho inválido');if(run.storage_type!=='server'){if(!/^[a-f0-9]{64}$/.test(b.hash)||!Number.isSafeInteger(b.size)||b.size<0)throw Error('Metadados inválidos');const sourceRun=b.source_run||run.id;if(sourceRun!==run.id){if(sourceRun!==run.base_run)throw Error('Referência fora da base do diferencial.');const original=db.prepare('SELECT hash,size FROM files WHERE run=? AND path=?').get(sourceRun,b.path);if(!original||original.hash!==b.hash||original.size!==b.size)throw Error('Arquivo não corresponde à base completa.');}const modified=b.modified_at||modifiedDate(b.mtime_ns);if(b.modified_at&&!Number.isFinite(Date.parse(b.modified_at)))throw Error('Data de modificação inválida.');db.prepare('INSERT INTO files(run,path,hash,size,source_run,modified_at) VALUES(?,?,?,?,?,?)').run(run.id,b.path,b.hash,b.size,sourceRun,modified?new Date(modified).toISOString():null);return send(res,201,{ok:true})}const data=Buffer.from(b.content||'','base64'),h=createHash('sha256').update(data).digest('hex');if(!existsSync(join(root,'blobs',h)))writeFileSync(join(root,'blobs',h),data);db.prepare('INSERT INTO files(run,path,hash,size) VALUES(?,?,?,?)').run(run.id,b.path,h,data.length);return send(res,201,{hash:h})}if(!['success','failed'].includes(b.status))throw Error('Status inválido');if(run.storage_type!=='server'&&b.status==='success'){if(!absolutePath(b.snapshot))throw Error('Cópia local sem destino confirmado');db.prepare('UPDATE runs SET snapshot=?,consistency=?,warning=? WHERE id=?').run(b.snapshot,b.consistency||'closed-file-copy',b.warning||null,run.id)}db.prepare('UPDATE runs SET finished=?,status=?,error=?,bytes=(SELECT COALESCE(SUM(size),0) FROM files WHERE run=? AND (source_run IS NULL OR source_run=?)),logical_bytes=(SELECT COALESCE(SUM(size),0) FROM files WHERE run=?),changed_files=?,pst_validation=? WHERE id=?').run(new Date().toISOString(),b.status,String(b.error||'').slice(0,2000),run.id,run.id,run.id,Number.isInteger(b.changed_files)?b.changed_files:null,JSON.stringify(b.pst_validation||null),run.id);return send(res,200,{ok:true})}}
const user=sessions.get(auth);if(!user||(user.localOnly&&!localRequest(req)))return send(res,401,{error:'Faça login'});
if(p==='/api/vss/status'&&req.method==='GET'){
 if(!user.localOnly||!localMaster)return send(res,403,{error:'Diagnóstico disponível no master local.'});
 return send(res,200,await automaticVssStatus());
}
if(p==='/api/vss/launch')return send(res,410,{error:'Não é mais necessário executar como administrador. Instale a versão atual com o componente automático VSS.'});
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
if(p==='/api/activity'){const items=[];for(const table of ['jobs','runs']){const rows=db.prepare(`SELECT t.id,t.device,${table==='jobs'?"json_extract(t.payload,'$.routine.id')":'t.routine_id'} AS routine_id,t.status,t.error,t.finished,t.updated,t.progress,${table==='jobs'?"t.created,t.kind,json_extract(t.payload,'$.routine.name') AS name,json_extract(t.result,'$.warning') AS warning":"t.started,t.warning,'backup' AS kind,(SELECT name FROM routines WHERE id=t.routine_id) AS name"},d.name AS device_name FROM ${table} t JOIN devices d ON d.id=t.device WHERE (?='master' OR d.owner=?) ${table==='runs'?'AND t.job_id IS NULL':''} ORDER BY CASE WHEN t.status IN ('queued','running') THEN 0 ELSE 1 END, ${table==='jobs'?'created':'started'} DESC LIMIT 20`).all(user.role,user.id);for(const r of rows){items.push({id:r.id,device:r.device,routine_id:r.routine_id,kind:r.kind||'backup',status:r.status,error:r.error,warning:r.warning,device_name:r.device_name,created:r.created||r.started,updated:r.updated,progress:r.progress?JSON.parse(r.progress):null,name:r.name||'',finished:r.finished})}}items.sort((a,b)=>Number(!['queued','running'].includes(a.status))-Number(!['queued','running'].includes(b.status))||b.created.localeCompare(a.created));return send(res,200,items.slice(0,20))}
if(p==='/api/state'){const devices=db.prepare(user.role==='master'?'SELECT id,name,owner,last_seen,version,platform FROM devices':'SELECT id,name,owner,last_seen,version,platform FROM devices WHERE owner=?').all(...(user.role==='master'?[]:[user.id]));const ids=new Set(devices.map(d=>d.id)),runs=db.prepare('SELECT runs.*,routines.name AS routine_name FROM runs LEFT JOIN routines ON routines.id=runs.routine_id ORDER BY runs.started DESC').all().filter(r=>ids.has(r.device));for(const run of runs){await hydrateLocalRun(run);run.backup_destination=backupDestination(run)}return send(res,200,{user,devices,vssMode:!!user.localOnly&&process.env.BACKUPDESK_VSS_MODE==='1',localDeviceId:user.localOnly?localMaster?.id:null,users:user.role==='master'?db.prepare('SELECT id,name,role FROM users').all():[],routines:db.prepare('SELECT * FROM routines WHERE deleted=0').all().filter(r=>ids.has(r.device)),runs})}
if(p==='/api/users'&&req.method==='POST'){if(user.role!=='master')return send(res,403,{error:'Acesso restrito'});const b=await body(req);if(!b.name||typeof b.password!=='string'||b.password.length<10)throw Error('Informe nome e senha com pelo menos 10 caracteres');db.prepare('INSERT INTO users(name,password,role) VALUES(?,?,?)').run(b.name,hash(b.password),'client');return send(res,201,{ok:true})}
if(p==='/api/devices'&&req.method==='POST'){if(user.role!=='master')return send(res,403,{error:'Acesso restrito'});const b=await body(req);if(!b.name)throw Error('Nome obrigatório');const id=token(),t=token();db.prepare('INSERT INTO devices(id,name,owner,token) VALUES(?,?,?,?)').run(id,b.name,Number(b.owner)||user.id,t);return send(res,201,{id,token:t})}
if(p==='/api/routines/deduplicate'&&req.method==='POST'){
 const seen=new Map(),duplicates=[],replacements={};
 for(const r of db.prepare('SELECT * FROM routines WHERE deleted=0 ORDER BY id').all()){
  if(!visible(user,r.device))continue;
  const key=JSON.stringify([r.device,r.name,r.cadence,r.hour,r.source,r.destination,r.destination_type,r.use_vss,r.enabled]);
  if(seen.has(key)){duplicates.push(r);replacements[r.id]=seen.get(key)}else seen.set(key,r.id);
 }
 db.exec('BEGIN');try{for(const r of duplicates){
  db.prepare('UPDATE routines SET enabled=0,deleted=1 WHERE id=?').run(r.id);
  db.prepare("UPDATE jobs SET status='failed',error='Cópia idêntica da rotina removida antes da execução',finished=? WHERE device=? AND kind='backup' AND status='queued' AND json_extract(payload,'$.routine.id')=?").run(new Date().toISOString(),r.device,r.id);
 }db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}
 return send(res,200,{removed:duplicates.length,replacements});
}
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
 if(routineEdit){const old=db.prepare('SELECT * FROM routines WHERE id=? AND deleted=0').get(Number(routineEdit[1]));if(!old||!visible(user,old.device))return send(res,404,{error:'Rotina não encontrada'})}
 if(!Object.hasOwn(cadenceLabels,b.cadence)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.hour)||!b.source||!b.name)throw Error('Rotina inválida');
 let sources;try{sources=JSON.parse(b.source)}catch{sources=[b.source]}if(!Array.isArray(sources)||!sources.length||sources.length>100||sources.some(p=>!absolutePath(p)))throw Error('Informe arquivos ou pastas com caminho absoluto');
 const type=b.destination_type;const targetDevice=db.prepare('SELECT platform FROM devices WHERE id=?').get(b.device);const useVss=requiredVss(targetDevice,type);if(!['local','external','network','server'].includes(type))throw Error('Selecione onde salvar o backup.');if(type!=='server'&&!absolutePath(b.destination))throw Error('Selecione a pasta de destino.');
 const name=String(b.name).trim();if(!name)throw Error('Informe o nome da rotina.');
 const values=[b.device,name,b.cadence,b.hour,JSON.stringify([...new Set(sources)]),type==='server'?null:b.destination,type,useVss?1:0];
 let id;if(routineEdit){id=Number(routineEdit[1]);db.prepare('UPDATE routines SET device=?,name=?,cadence=?,hour=?,source=?,destination=?,destination_type=?,use_vss=? WHERE id=?').run(...values,id)}
 else{
  // A replay/double-click must not schedule the same backup twice. Keep existing history intact.
  const existing=db.prepare('SELECT id FROM routines WHERE deleted=0 AND enabled=1 AND device=? AND name=? AND cadence=? AND hour=? AND source=? AND destination IS ? AND destination_type=? AND use_vss=? ORDER BY id LIMIT 1').get(...values);
  if(existing)return send(res,200,{ok:true,id:existing.id,created:false});
  id=Number(db.prepare('INSERT INTO routines(device,name,cadence,hour,source,destination,destination_type,use_vss) VALUES(?,?,?,?,?,?,?,?)').run(...values).lastInsertRowid);
 }
 return send(res,routineEdit?200:201,{ok:true,id,created:!routineEdit});
}
if(p==='/api/jobs'&&req.method==='POST'){
 const b=await body(req);let deviceId,payload;
 if(b.kind==='backup'){const r=db.prepare('SELECT * FROM routines WHERE id=? AND deleted=0').get(Number(b.routine_id));if(!r||!visible(user,r.device))return send(res,404,{error:'Rotina não encontrada'});if(!r.enabled)return send(res,409,{error:'Ative a rotina antes de executar um backup.'});deviceId=r.device;if(r.use_vss&&!['0.6.0','0.7.0','0.7.1','0.8.0','0.8.1','0.8.2','0.8.3','0.9.0','0.10.0'].includes(db.prepare('SELECT version FROM devices WHERE id=?').get(deviceId)?.version))throw Error('Atualize o agente para 0.6.0 para usar VSS.');if(db.prepare("SELECT id FROM jobs WHERE device=? AND status IN ('queued','running') AND kind IN ('backup','restore')").get(deviceId)||db.prepare("SELECT id FROM runs WHERE device=? AND status='running'").get(deviceId))return send(res,409,{error:'Já existe um backup ou restauração em andamento neste computador.'});payload={routine:r}}
 else if(b.kind==='validate'){if(!visible(user,b.device)||!db.prepare('SELECT id FROM devices WHERE id=?').get(b.device))return send(res,404,{error:'Computador não encontrado'});if(!absolutePath(b.destination)||typeof b.source!=='string')throw Error('Informe origem e destino');deviceId=b.device;payload={source:b.source,destination:b.destination,useVss:requiredVss(db.prepare('SELECT platform FROM devices WHERE id=?').get(b.device),'local')}}
 else if(b.kind==='restore'){const r=db.prepare("SELECT * FROM runs WHERE id=? AND status='success'").get(b.run);if(!r||!visible(user,r.device)||r.storage_type==='server')return send(res,404,{error:'Backup em disco concluído não encontrado'});if(!absolutePath(b.target))throw Error('Selecione a pasta para restaurar.');const selected=b.path==='*'?db.prepare('SELECT path,hash,size,source_run FROM files WHERE run=?').all(r.id):[db.prepare('SELECT path,hash,size,source_run FROM files WHERE run=? AND path=?').get(r.id,b.path)].filter(Boolean);if(!selected.length)throw Error('Arquivos não encontrados');deviceId=r.device;if(r.backup_type==='differential'&&!['0.9.0','0.10.0'].includes(db.prepare('SELECT version FROM devices WHERE id=?').get(r.device)?.version))throw Error('Atualize o client para restaurar versões diferenciais.');payload={snapshot:r.snapshot,files:selected,target:b.target,warning:r.warning,pst_validation:r.pst_validation?JSON.parse(r.pst_validation):null}}
 else throw Error('Tarefa inválida');
 const known=db.prepare('SELECT version FROM devices WHERE id=?').get(deviceId);if(!['0.5.0','0.6.0','0.7.0','0.7.1','0.8.0','0.8.1','0.8.2','0.8.3','0.9.0','0.10.0'].includes(known?.version))return send(res,409,{error:'Inicie ou atualize o agente para a versão 0.5.0 antes de executar esta ação.'});
 const id=token();db.prepare('INSERT INTO jobs(id,device,kind,payload,status,created) VALUES(?,?,?,?,?,?)').run(id,deviceId,b.kind,JSON.stringify(payload),'queued',new Date().toISOString());return send(res,201,{id});
}
const jobRead=p.match(/^\/api\/jobs\/([a-f0-9]+)$/);if(jobRead){const job=db.prepare('SELECT * FROM jobs WHERE id=?').get(jobRead[1]);if(!job||!visible(user,job.device))return send(res,404,{error:'Tarefa não encontrada'});return send(res,200,{id:job.id,status:job.status,error:job.error,result:job.result?JSON.parse(job.result):null})}
const match=p.match(/^\/api\/runs\/([a-f0-9]+)\/files$/);if(match){const r=db.prepare('SELECT * FROM runs WHERE id=?').get(match[1]);if(!r||!visible(user,r.device))return send(res,404,{error:'Execução não encontrada'});if(url.searchParams.has('path')){const f=db.prepare('SELECT * FROM files WHERE run=? AND path=?').get(r.id,url.searchParams.get('path'));if(!f)return send(res,404,{error:'Arquivo não encontrado'});if(r.storage_type!=='server')return send(res,409,{error:'Use a restauração para pasta no computador de origem deste backup.'});const data=readFileSync(join(root,'blobs',f.hash));if(createHash('sha256').update(data).digest('hex')!==f.hash)throw Error('Integridade inválida');res.setHeader('Content-Type','application/octet-stream');return res.end(data)}await hydrateLocalRun(r);return send(res,200,db.prepare('SELECT path,size,hash,modified_at FROM files WHERE run=?').all(r.id))}
if(p==='/api/download/client'||p==='/api/download/windows'){
 if(user.role!=='master')return send(res,403,{error:'Somente o master pode baixar instaladores'});
 const client=p.endsWith('/client');if(client&&req.method!=='POST')return send(res,405,{error:'Informe o nome do computador pelo botão Baixar client Windows.'});
 const file=new URL('./dist/'+(client?'BackupDesk-Client-0.10.0-x64.exe':'BackupDesk-Master-0.10.0-x64.exe'),import.meta.url);if(!existsSync(file))return send(res,404,{error:'Instalador não disponível neste servidor'});
 const executable=readFileSync(file);let contents=executable,name='BackupDesk-Master-0.10.0-x64.exe';
 if(client){const b=await body(req),nameValue=computerName(b.name),urlValue=clientUrl(b.url);let registered=db.prepare('SELECT * FROM devices WHERE owner=?').all(user.id).find(d=>d.name.normalize('NFC').toLocaleLowerCase('pt-BR')===nameValue.toLocaleLowerCase('pt-BR'));
  if(registered&&registered.id===localMaster?.id)throw Error('Escolha um nome diferente do computador master.');
  if(!registered){registered={id:token(),name:nameValue,token:token()};db.prepare('INSERT INTO devices(id,name,owner,token) VALUES(?,?,?,?)').run(registered.id,registered.name,user.id,registered.token)}
  contents=Buffer.concat([executable,enrollmentTrailer({format:'backupdesk-client-v1',device_id:registered.id,name:registered.name,url:urlValue,token:registered.token})]);name='BackupDesk-Client-'+registered.name+'-0.10.0-x64.exe';
 }
 res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/vnd.microsoft.portable-executable');res.setHeader('Content-Disposition',"attachment; filename=\""+name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]/g,'_')+"\"; filename*=UTF-8''"+encodeURIComponent(name).replace(/'/g,'%27'));return res.end(contents);
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
   localAgent=supervise(process.execPath,[fileURLToPath(new URL('./agent.mjs',import.meta.url))],{env:{...process.env,BACKUPDESK_URL:'http://127.0.0.1:'+server.address().port,BACKUPDESK_TOKEN:localMaster.token,BACKUPDESK_VSS_PRODUCT:'master',BACKUPDESK_AGENT_STATE:join(root,'master-agent-state.json')},stdio:['ignore','inherit','inherit'],windowsHide:true});

  }
 });
 server.on('close',()=>localAgent?.stop());
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,shutdown);
}else{db.close();console.log('Master preparado: computador local cadastrado e pronto para criar rotinas.')}

function shutdown(){localAgent?.stop();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1000).unref()}
