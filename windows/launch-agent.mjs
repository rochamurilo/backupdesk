import {readFile} from 'node:fs/promises';
import {openSync,mkdirSync} from 'node:fs';
import {instanceLock,supervise} from './background.mjs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=dirname(fileURLToPath(import.meta.url));
process.chdir(dir);
const config=JSON.parse((await readFile(join(dir,'agent-config.json'),'utf8')).replace(/^\uFEFF/,''));
const url=new URL(config.url);
if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('URL inválida');
if(!config.token)throw Error('Configure o token antes de iniciar');
process.env.BACKUPDESK_URL=url.href.replace(/\/$/,'');
process.env.BACKUPDESK_TOKEN=config.token;
process.env.BACKUPDESK_AGENT_STATE=join(dir,'agent-state.json');
const lock=await instanceLock(dir+'-client');
if(lock){mkdirSync(join(dir,'data'),{recursive:true});const fd=openSync(join(dir,'data','agent.log'),'a');const worker=supervise(process.execPath,[join(dir,'agent.mjs')],{cwd:dir,env:process.env,stdio:['ignore',fd,fd],windowsHide:true});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{worker.stop();lock.close(()=>process.exit(0))})}
