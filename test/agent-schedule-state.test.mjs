import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {openScheduleState,attemptsToState} from '../agent-schedule-state.mjs';import {runScheduledRoutine} from '../schedule.mjs';
test('cópias em vários destinos após meia-noite conservam o dia do disparo original',async()=>{
 const state=attemptsToState([{routine_id:1,started:new Date(2026,10,11,23).toISOString(),schedule_hour:'23:00',schedule_date:'2026-11-11'},{routine_id:1,started:new Date(2026,10,12,2).toISOString(),schedule_hour:'23:00',schedule_date:'2026-11-11'}]);
 assert.deepEqual(state[1],{date:'2026-11-11',hours:['23:00']});
 let slot;assert.equal(await runScheduledRoutine({id:1,cadence:'daily',hour:'23:00'},new Date(2026,10,12,23),state,async()=>{},async(_,value)=>{slot=value}),true);
 assert.deepEqual(slot,{date:'2026-11-12',hour:'23:00'});
});
test('migração do estado antigo permite 23h após falha anterior e conserva o bloqueio do horário já tentado',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bkd-schedule-migration-'));try{
  const file=join(root,'state.json');await writeFile(file,JSON.stringify({'7':'2026-11-11'}));
  const store=await openScheduleState(file,{recover:async()=>[{routine_id:7,started:new Date(2026,10,11,9,1).toISOString()}]});
  let calls=0;const routine={id:7,cadence:'weekdays',hour:'09:00'};
  assert.equal(await runScheduledRoutine(routine,new Date(2026,10,11,14),store.state,store.save,async()=>calls++),false);
  routine.hour='23:00';assert.equal(await runScheduledRoutine(routine,new Date(2026,10,11,23),store.state,store.save,async()=>calls++),true);
  const reopened=await openScheduleState(file,{recover:()=>{throw Error('Estado novo não deve consultar histórico')}});
  assert.equal(await runScheduledRoutine(routine,new Date(2026,10,11,23,30),reopened.state,reopened.save,async()=>calls++),false);assert.equal(calls,1);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('recuperação mantém horários exatos mesmo com execução atrasada e preserva arquivo antigo se histórico falhar',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bkd-schedule-exact-'));try{
  const file=join(root,'state.json');await writeFile(file,'invalid');
  const store=await openScheduleState(file,{recover:async()=>[{routine_id:1,started:new Date(2026,10,11,23,40).toISOString(),schedule_hour:'09:00'},{routine_id:1,started:new Date(2026,10,11,23,50).toISOString(),schedule_hour:'23:00'}]});
  for(const hour of ['09:00','23:00'])assert.equal(await runScheduledRoutine({id:1,cadence:'daily',hour},new Date(2026,10,11,23,59),store.state,store.save,async()=>{throw Error('Não pode repetir')}),false);
  const old=JSON.stringify({'1':'2026-11-11'});await writeFile(file,old);
  await assert.rejects(openScheduleState(file,{recover:async()=>{throw Error('Sem histórico')}}),/Sem histórico/);assert.equal(await readFile(file,'utf8'),old);
 }finally{await rm(root,{recursive:true,force:true})}
});
test('agendamento recupera arquivo interrompido sem repetir tentativa já registrada e persiste o dia seguinte',{timeout:10000},async()=>{const root=await mkdtemp(join(tmpdir(),'bkd-schedule-state-'));try{const file=join(root,'state.json');await writeFile(file,'{"1":');const store=await openScheduleState(file,{recover:async()=>[{routine_id:1,started:new Date(2026,10,9,9,0).toISOString()}]});let calls=0;const routine={id:1,cadence:'daily',hour:'09:00'};assert.equal(await runScheduledRoutine(routine,new Date(2026,10,9,13,0),store.state,store.save,async()=>calls++),false);assert.equal(calls,0);assert.equal((await readdir(root)).filter(f=>f.startsWith('state.json.invalid-')).length,1);assert.equal(await runScheduledRoutine(routine,new Date(2026,10,10,9,0),store.state,store.save,async()=>calls++),true);assert.equal(calls,1);assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{'1':{date:'2026-11-10',hours:['09:00']}});const reopened=await openScheduleState(file,{recover:()=>{throw Error('Não deveria consultar histórico com arquivo válido.')}});assert.equal(await runScheduledRoutine(routine,new Date(2026,10,10,14,0),reopened.state,reopened.save,async()=>calls++),false)}finally{await rm(root,{recursive:true,force:true})}});
test('início após horário executa uma vez; falha de recuperação preserva o arquivo original',{timeout:10000},async()=>{const root=await mkdtemp(join(tmpdir(),'bkd-schedule-late-'));try{const file=join(root,'state.json'),store=await openScheduleState(file,{recover:async()=>[]});let calls=0;await runScheduledRoutine({id:2,cadence:'daily',hour:'09:00'},new Date(2026,10,9,13,0),store.state,store.save,async()=>calls++);assert.equal(calls,1);await writeFile(file,'invalid');await assert.rejects(openScheduleState(file,{recover:async()=>{throw Error('Histórico indisponível')}}),/Histórico/);assert.equal(await readFile(file,'utf8'),'invalid')}finally{await rm(root,{recursive:true,force:true})}});
