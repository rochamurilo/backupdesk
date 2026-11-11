import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {openSync,mkdirSync,appendFileSync} from 'node:fs';
import {instanceLock,supervise,isUpdating,lowerPriority} from './background.mjs';
import {validateEnrollment,clientUrl} from './client-package.mjs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
lowerPriority();
const dir=dirname(fileURLToPath(import.meta.url));process.chdir(dir);
if(isUpdating(dir))process.exit(0);
const config=JSON.parse((await readFile(join(dir,'agent-config.json'),'utf8')).replace(/^\uFEFF/,''));if(config.format||!config.url)validateEnrollment(config);else{clientUrl(config.url);if(!/^[a-f0-9]{64}$/.test(config.token||''))throw Error('Token do client inválido.');}
mkdirSync(join(dir,'data'),{recursive:true});
const logfile=join(dir,'data','agent.log'),log=text=>appendFileSync(logfile,new Date().toISOString()+' '+text+'\n');
const interactive=process.argv.includes('--interactive'),local=config.mode==='local'||!config.url;
if(local&&!config.recovery_public_key)throw Error('Atualize pelo instalador identificado gerado no master para usar o client local.');
if(!config.installation_id){config.installation_id=randomUUID();await writeFile(join(dir,'agent-config.json'),JSON.stringify(config,null,2),{mode:0o600,flush:true})}
const lock=await instanceLock(dir+'-client');
const port=process.env.PORT||'3001',panel='http://127.0.0.1:'+port;
async function openLocalPanel(){
 if(!interactive)return;
 const deadline=Date.now()+30000;
 while(Date.now()<deadline){try{const response=await fetch(panel+'/api/health',{signal:AbortSignal.timeout(500)}),health=await response.json();if(response.ok&&health.app==='backupdesk'&&health.mode==='client'&&health.device===config.device_id&&health.installation_id===config.installation_id){if(process.platform==='win32')spawn('explorer.exe',[panel],{stdio:'ignore',windowsHide:true}).on('error',e=>log(e.message));return}}catch{}await new Promise(r=>setTimeout(r,150))}
 log('O painel local do client não respondeu. Confira a disponibilidade da porta '+port+' e os erros deste arquivo.');
}
if(!lock){await openLocalPanel();process.exit(0)}
const shared={...process.env,BACKUPDESK_VSS_PRODUCT:'client',BACKUPDESK_REQUIRE_EXISTING_KEYS:'1',BACKUPDESK_COMPUTER_NAME:config.name,BACKUPDESK_INSTALLATION_ID:config.installation_id,BACKUPDESK_INSTALLED_AT:config.installed_at||'',BACKUPDESK_KEY_DIR:join(dir,'data'),BACKUPDESK_AGENT_STATE:join(dir,'agent-state.json'),...(config.recovery_public_key?{BACKUPDESK_RECOVERY_PUBLIC_KEY:config.recovery_public_key}:{})};
let entry,env;
if(local){entry='server.mjs';env={...shared,HOST:'127.0.0.1',PORT:port,DATA_DIR:join(dir,'data'),BACKUPDESK_AGENT_STATE:join(dir,'data','client-agent-state.json'),BACKUPDESK_LOCAL_MASTER:'0',BACKUPDESK_LOCAL_CLIENT:'1',BACKUPDESK_CLOUD_MODE:'0',BACKUPDESK_PUBLIC_URL:'',BACKUPDESK_CLIENT_CONFIG:join(dir,'agent-config.json')};log('Client local iniciado; rotinas e logs são executados neste computador.');}
else{const url=new URL(config.url);entry='agent.mjs';env={...shared,BACKUPDESK_URL:url.origin,BACKUPDESK_TOKEN:config.token};log('Client online iniciado com conexão incorporada no instalador.');}
const fd=openSync(logfile,'a'),worker=supervise(process.execPath,[join(dir,entry)],{cwd:dir,env,stdio:['ignore',fd,fd],windowsHide:true});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{worker.stop();lock.close(()=>process.exit(0))});
await openLocalPanel();
