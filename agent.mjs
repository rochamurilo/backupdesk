import {createBandwidthLimiter} from './bandwidth.mjs';
import {scanRepository} from './repository-catalog.mjs';
import {realpath} from 'node:fs/promises';
import {createProgressReporter} from './progress.mjs';
import {readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {runScheduledRoutine} from './schedule.mjs';import {browseFiles,collectFiles} from './filesystem.mjs';
import {backupToDisk,validateDestination,validateVssDestination,restoreFromDisk} from './disk-backup.mjs';
const base=process.env.BACKUPDESK_URL||'http://127.0.0.1:3000',token=process.env.BACKUPDESK_TOKEN;
if(!token)throw Error('Defina BACKUPDESK_TOKEN');
async function api(path,data){const r=await fetch(base+'/api/agent/'+path,{method:data?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-BackupDesk-Version':'0.11.0','X-BackupDesk-Platform':process.platform,...(process.env.BACKUPDESK_INSTALLATION_ID?{'X-BackupDesk-Installation':process.env.BACKUPDESK_INSTALLATION_ID}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(path.endsWith('/progress')?5000:30000)});const b=await r.json();if(!r.ok)throw Error(b.error);return b}
let currentPreferences=null;
async function backupOne(routine,jobId,throttle=async()=>{},destinationIndex=1,destinationCount=1){const run=await api('runs',routine.id?{routine_id:routine.id,storage_type:routine.destination_type,job_id:jobId,destination:routine.destination}:{});const reporter=createProgressReporter(p=>api('runs/'+run.id+'/progress',{...p,destinationIndex,destinationCount}));try{
 let result={};let snapshot,consistency,warning;
 if(routine.destination_type&&routine.destination_type!=='server'){
  const copied=await backupToDisk({source:routine.source,destination:routine.destination,device:run.device,routine:routine.id,run:run.id,useVss:process.platform==='win32',throttle,deviceName:routine.device_name,knownRuns:run.bases,onPlan:plan=>api('runs/'+run.id+'/plan',plan),onProgress:reporter.report,onFile:file=>api('runs/'+run.id+'/files',file)});result=copied;snapshot=copied.snapshot;consistency=copied.consistency;warning=copied.warning;
 }else{if(process.platform==='win32')throw Error('Configure uma pasta de destino em Preferências para executar este backup.');await collectFiles(routine.source,async(path,content)=>{await throttle(content.length,'upload');return api('runs/'+run.id+'/files',{path,content:content.toString('base64')})});}
 await reporter.close();await api('runs/'+run.id+'/finish',{status:'success',snapshot,consistency,warning,pst_validation:result.pst_validation,changed_files:result.changed_files});console.log('Backup concluído:',run.id);const {files,...summary}=result;return {run:run.id,...summary,snapshot,consistency,warning};
 }catch(e){await reporter.close();await api('runs/'+run.id+'/finish',{status:'failed',error:e.message}).catch(()=>{});throw e}}
async function backup(routine,jobId){
 const destinations=routine.destinations?.length?routine.destinations:!routine.preferences_required?[{path:routine.destination,type:routine.destination_type}]:[];
 if(!destinations.length)throw Error('Configure pelo menos um destino em Preferências.');
 const throttle=createBandwidthLimiter({getPolicy:()=>currentPreferences?.bandwidth||routine.bandwidth}),results=[];let firstError;
 for(let i=0;i<destinations.length;i++){const d=destinations[i];try{results.push({...await backupOne({...routine,destination:d.path,destination_type:d.type},jobId,throttle,i+1,destinations.length),status:'success',destination:d.path})}catch(e){firstError ||= e;results.push({status:'failed',destination:d.path,error:e.message})}}
 if(results.length===1&&results[0].status==='success')return results[0];
 const succeeded=results.filter(r=>r.status==='success'),summary={destinations:results,completed_destinations:succeeded.length,total_destinations:results.length,stored_bytes:succeeded.reduce((n,r)=>n+(r.stored_bytes||0),0),changed_files:succeeded.reduce((n,r)=>n+(r.changed_files||0),0),backup_type:succeeded.every(r=>r.backup_type==='differential')?'differential':'full'};
 if(firstError){const error=Error(succeeded.length+'/'+results.length+' destinos concluídos. '+results.filter(r=>r.status==='failed').map(r=>r.destination+': '+r.error).join(' · '));error.result=summary;throw error}return summary;
}
if(process.argv[2]==='--once'){if(!process.argv[3])throw Error('Uso: node agent.mjs --once CAMINHO');await backup({source:process.argv[3],destination_type:'server'})}
else{
 const statePath=resolve(process.env.BACKUPDESK_AGENT_STATE||'.backupdesk-agent-state.json');let state={};try{state=JSON.parse(await readFile(statePath,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
 await api('hello',{installation_id:process.env.BACKUPDESK_INSTALLATION_ID});if(process.env.BACKUPDESK_COMPUTER_NAME)console.log('Computador:',process.env.BACKUPDESK_COMPUTER_NAME);
 async function tick(){const config=await api('config');currentPreferences=config.preferences;const {routines}=config;for(const r of routines){try{await runScheduledRoutine(r,new Date(),state,value=>writeFile(statePath,JSON.stringify(value)),backup)}catch(e){console.error('Rotina '+r.name+': '+e.message)}}}

 let busy=false,lastTick=0;
 async function job(command){const reporter=createProgressReporter(p=>api('jobs/'+command.id+'/progress',p));const throttle=createBandwidthLimiter({getPolicy:()=>currentPreferences?.bandwidth});if(command.kind!=='backup')reporter.report({stage:'preparing'});try{let result;if(command.kind==='backup')result=await backup(command.payload.routine,command.id);else if(command.kind==='validate'){const v=process.platform==='win32'?await validateVssDestination(command.payload.source,command.payload.destination,{onProgress:reporter.report}):await validateDestination(command.payload.source,command.payload.destination,{onProgress:reporter.report});result={destination:v.target,requiredBytes:v.requiredBytes,availableBytes:v.availableBytes}}else if(command.kind==='restore')result={...await restoreFromDisk({...command.payload,job:command.id,onProgress:reporter.report,throttle}),warning:command.payload.warning,pst_validation:command.payload.pst_validation};else if(command.kind==='catalog'){const root=await realpath(command.payload.source),repository=await api('repositories/start',{job_id:command.id,root});try{result=await scanRepository(root,{onProgress:reporter.report,onSnapshot:async({metadata,snapshot,files})=>{const entry=await api('repositories/'+repository.id+'/runs',{metadata,snapshot});for(let offset=0;offset<files.length;offset+=500)await api('repositories/'+repository.id+'/runs/'+entry.id+'/files',{files:files.slice(offset,offset+500)})}});await api('repositories/'+repository.id+'/finish',{status:'success'})}catch(e){await api('repositories/'+repository.id+'/finish',{status:'failed'}).catch(()=>{});throw e}}else throw Error('Tarefa desconhecida');await reporter.close();await api('jobs/'+command.id,{status:'success',result})}catch(e){await reporter.close();await api('jobs/'+command.id,{status:'failed',error:e.message,result:e.result}).catch(()=>{});console.error(e.message)}finally{busy=false}}
 while(true){try{
  const response=await api('commands?busy='+(busy?'1':'0'));currentPreferences=response.preferences||currentPreferences;const {commands}=response;
  for(const command of commands){if(command.kind){busy=true;job(command)}else{let result;try{result={result:await browseFiles(command.path)}}catch(e){result={error:e.message}}await api('commands/'+command.id,result)}}
  if(!busy&&Date.now()-lastTick>=60000){busy=true;lastTick=Date.now();tick().catch(e=>console.error(e.message)).finally(()=>{busy=false})}
 }catch(e){console.error(e.message)}await new Promise(r=>setTimeout(r,2000))}
}
