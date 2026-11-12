import {readFile,writeFile,rename,mkdir,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';import {randomUUID} from 'node:crypto';
import {isScheduleHour,isScheduleDate as validDate,scheduleDate,scheduleTime} from './schedule.mjs';
function validEntry(entry){if(typeof entry==='string')return validDate(entry);return entry&&typeof entry==='object'&&!Array.isArray(entry)&&validDate(entry.date)&&Array.isArray(entry.hours)&&entry.hours.length<=1440&&entry.hours.every(isScheduleHour)&&new Set(entry.hours).size===entry.hours.length&&(entry.legacyUntil===undefined||isScheduleHour(entry.legacyUntil))&&Object.keys(entry).every(key=>['date','hours','legacyUntil'].includes(key))}
function validate(value){if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([key,entry])=>!/^\d+$/.test(key)||!validEntry(entry)))throw Error('Registro de agendamento inválido.');return value}
export function attemptsToState(attempts){
 if(!Array.isArray(attempts))throw Error('Histórico de agendamento inválido.');const state={};
 for(const attempt of attempts){
  if(!Number.isSafeInteger(attempt.routine_id)||attempt.routine_id<1||typeof attempt.started!=='string'||!Number.isFinite(Date.parse(attempt.started))||attempt.schedule_hour!=null&&!isScheduleHour(attempt.schedule_hour)||attempt.schedule_date!=null&&(!validDate(attempt.schedule_date)||!isScheduleHour(attempt.schedule_hour)))throw Error('Tentativa de agendamento inválida.');
  const started=new Date(attempt.started),date=attempt.schedule_date||scheduleDate(started),key=String(attempt.routine_id);
  if(!state[key]||date>state[key].date)state[key]={date,hours:[]};if(date!==state[key].date)continue;
  const entry=state[key];
  if(attempt.schedule_hour!=null){if(!entry.hours.includes(attempt.schedule_hour))entry.hours.push(attempt.schedule_hour)}
  else{const until=scheduleTime(started);if(!entry.legacyUntil||until>entry.legacyUntil)entry.legacyUntil=until}
 }
 return state;
}
export async function openScheduleState(file,{recover,log=()=>{}}={}){
 await mkdir(dirname(file),{recursive:true});let state,invalid=false;
 try{state=validate(JSON.parse(await readFile(file,'utf8')))}catch(e){if(e.code&&e.code!=='ENOENT')throw e;if(e.code!=='ENOENT')invalid=true;state=attemptsToState(await recover());}
 // Older files recorded only a day. Recover the actual attempt time once, so
 // an earlier failure does not consume a newly selected evening schedule.
 if(Object.values(state).some(entry=>typeof entry==='string')){
  const recovered=attemptsToState(await recover());
  for(const [key,entry] of Object.entries(state))if(typeof entry==='string'&&recovered[key]?.date===entry)state[key]=recovered[key];
 }
 let serial=Promise.resolve();
 function save(value){const payload=JSON.stringify(validate(value)),temporary=file+'.'+randomUUID()+'.tmp';const task=serial.then(async()=>{try{await writeFile(temporary,payload,{flag:'wx',mode:0o600,flush:true});await rename(temporary,file)}finally{await unlink(temporary).catch(()=>{})}});serial=task.catch(()=>{});return task}
 if(invalid){await rename(file,file+'.invalid-'+randomUUID());log('O registro de agendamento estava inválido; foi preservado para diagnóstico e recuperado do histórico de tentativas.');}
 await save(state);return {state,save};
}
