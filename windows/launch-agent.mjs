import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {openSync,mkdirSync} from 'node:fs';
import {instanceLock,supervise,isUpdating} from './background.mjs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url));
process.chdir(dir);
if(isUpdating(dir))process.exit(0);
const config=JSON.parse((await readFile(join(dir,'agent-config.json'),'utf8')).replace(/^\uFEFF/,''));
if(!config.url){mkdirSync(join(dir,'data'),{recursive:true});if(process.argv.includes('--interactive'))await new Promise((resolve,reject)=>execFile('powershell.exe',['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',join(dir,'Configure.ps1')],{windowsHide:true},error=>error?reject(error):resolve()));else{const {appendFile}=await import('node:fs/promises');await appendFile(join(dir,'data','agent.log'),'Client '+(config.name||'')+': informe o endereço do master em Configurar agente.\n')}process.exit(0)}
const lock=await instanceLock(dir+'-client');if(!lock)process.exit(0);
if(!config.installation_id){config.installation_id=randomUUID();await writeFile(join(dir,'agent-config.json'),JSON.stringify(config,null,2),{mode:0o600,flush:true})}
const url=new URL(config.url);
if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('URL inválida');
if(!config.token)throw Error('Configure o token antes de iniciar');
process.env.BACKUPDESK_URL=url.href.replace(/\/$/,'');
process.env.BACKUPDESK_TOKEN=config.token;
process.env.BACKUPDESK_VSS_PRODUCT='client';process.env.BACKUPDESK_COMPUTER_NAME=config.name||'';process.env.BACKUPDESK_INSTALLATION_ID=config.installation_id;
if(config.recovery_public_key)process.env.BACKUPDESK_RECOVERY_PUBLIC_KEY=config.recovery_public_key;process.env.BACKUPDESK_KEY_DIR=join(dir,'data');
process.env.BACKUPDESK_AGENT_STATE=join(dir,'agent-state.json');
if(lock){mkdirSync(join(dir,'data'),{recursive:true});const fd=openSync(join(dir,'data','agent.log'),'a');const worker=supervise(process.execPath,[join(dir,'agent.mjs')],{cwd:dir,env:process.env,stdio:['ignore',fd,fd],windowsHide:true});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{worker.stop();lock.close(()=>process.exit(0))})}
