import {readFile,writeFile,rename,mkdir,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';import {randomUUID} from 'node:crypto';
function validate(value){if(!value||typeof value!=='object'||Array.isArray(value)||Object.entries(value).some(([key,date])=>!/^\d+$/.test(key)||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00'))))throw Error('Registro de agendamento inválido.');return value}
export function attemptsToState(attempts){if(!Array.isArray(attempts))throw Error('Histórico de agendamento inválido.');const state={};for(const attempt of attempts){if(!Number.isSafeInteger(attempt.routine_id)||attempt.routine_id<1||typeof attempt.started!=='string'||!Number.isFinite(Date.parse(attempt.started)))throw Error('Tentativa de agendamento inválida.');const date=new Date(attempt.started),day=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');const key=String(attempt.routine_id);if(!state[key]||day>state[key])state[key]=day}return state}
export async function openScheduleState(file,{recover,log=()=>{}}={}){
 await mkdir(dirname(file),{recursive:true});let state,invalid=false;
 try{state=validate(JSON.parse(await readFile(file,'utf8')))}catch(e){if(e.code&&e.code!=='ENOENT')throw e;if(e.code!=='ENOENT')invalid=true;state=attemptsToState(await recover());}
 let serial=Promise.resolve();
 function save(value){const payload=JSON.stringify(validate(value)),temporary=file+'.'+randomUUID()+'.tmp';const task=serial.then(async()=>{try{await writeFile(temporary,payload,{flag:'wx',mode:0o600,flush:true});await rename(temporary,file)}finally{await unlink(temporary).catch(()=>{})}});serial=task.catch(()=>{});return task}
 if(invalid){await rename(file,file+'.invalid-'+randomUUID());log('O registro de agendamento estava inválido; foi preservado para diagnóstico e recuperado do histórico de tentativas.');}
 await save(state);return {state,save};
}
