import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {browseFiles,collectFiles} from './filesystem.mjs';
const base=process.env.BACKUPDESK_URL||'http://127.0.0.1:3000',token=process.env.BACKUPDESK_TOKEN;
if(!token)throw Error('Defina BACKUPDESK_TOKEN');
async function api(path,data){const r=await fetch(base+'/api/agent/'+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(30000)});const b=await r.json();if(!r.ok)throw Error(b.error);return b}
async function backup(source){const run=await api('runs',{});try{await collectFiles(source,async(path,content)=>api('runs/'+run.id+'/files',{path,content:content.toString('base64')}));await api('runs/'+run.id+'/finish',{status:'success'});console.log('Backup concluído:',run.id)}catch(e){await api('runs/'+run.id+'/finish',{status:'failed',error:e.message});throw e}}
if(process.argv[2]==='--once'){
 if(!process.argv[3])throw Error('Uso: node agent.mjs --once CAMINHO');await backup(process.argv[3]);
}else{
 const statePath=resolve(process.env.BACKUPDESK_AGENT_STATE||'.backupdesk-agent-state.json');let state={};
 try{state=JSON.parse(await readFile(statePath,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
 async function tick(){const {routines}=await api('config');const now=new Date(),date=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');for(const r of routines){const eligible=r.cadence==='daily'||r.cadence==='weekly'&&now.getDay()===1||r.cadence==='monthly'&&now.getDate()===1;const time=String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');if(eligible&&time>=r.hour&&state[r.id]!==date){await backup(r.source);state[r.id]=date;await writeFile(statePath,JSON.stringify(state))}}}
 let busy=false,lastTick=0;
 // A consulta de arquivos continua respondendo enquanto um backup está em execução.
 while(true){try{
  const {commands}=await api('commands');
  for(const command of commands){let result;try{result={result:await browseFiles(command.path)}}catch(e){result={error:e.message}}await api('commands/'+command.id,result)}
  if(!busy&&Date.now()-lastTick>=60000){busy=true;lastTick=Date.now();tick().catch(e=>console.error(e.message)).finally(()=>{busy=false})}
 }catch(e){console.error(e.message)}await new Promise(r=>setTimeout(r,2000))}
}
