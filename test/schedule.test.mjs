import {test} from 'node:test';import assert from 'node:assert/strict';import {isScheduledDay} from '../schedule.mjs';
test('dias de execução cobrem a semana inteira e respeitam finais de semana',()=>{
 const dates=Array.from({length:7},(_,i)=>new Date(2026,10,2+i,20,0));
 const expected={weekdays:[true,true,true,true,true,false,false],saturday:[false,false,false,false,false,true,false],sunday:[false,false,false,false,false,false,true],daily:[true,true,true,true,true,true,true],weekly:[true,false,false,false,false,false,false]};
 for(const [cadence,days] of Object.entries(expected))assert.deepEqual(dates.map(d=>isScheduledDay(cadence,d)),days,cadence);
});
test('rotinas mensais e cadências antigas continuam válidas',()=>{
 assert.equal(isScheduledDay('monthly',new Date(2026,9,31)),false);assert.equal(isScheduledDay('monthly',new Date(2026,10,1)),true);assert.equal(isScheduledDay('monthly',new Date(2026,10,2)),false);assert.equal(isScheduledDay('invalid',new Date()),false);assert.equal(isScheduledDay('daily',new Date('invalid')),false);
});

test('falha agendada não repete por minuto nem após reinício, mas tenta no próximo dia',async()=>{
 const {runScheduledRoutine}=await import('../schedule.mjs');const routine={id:9,cadence:'daily',hour:'10:00'},state={};let calls=0,persisted;
 const persist=async s=>{persisted=JSON.stringify(s)},backup=async()=>{calls++;throw Error('Outlook aberto')};
 await assert.rejects(runScheduledRoutine(routine,new Date(2026,10,3,10,0),state,persist,backup),/Outlook/);
 assert.equal(await runScheduledRoutine(routine,new Date(2026,10,3,10,1),state,persist,backup),false);
 assert.equal(await runScheduledRoutine(routine,new Date(2026,10,3,15,0),JSON.parse(persisted),persist,backup),false);assert.equal(calls,1);
 await assert.rejects(runScheduledRoutine(routine,new Date(2026,10,4,10,0),state,persist,backup),/Outlook/);assert.equal(calls,2);
});
test('sem persistir tentativa não inicia backup e preserva estado anterior',async()=>{
 const {runScheduledRoutine}=await import('../schedule.mjs');const state={};let copied=false;
 await assert.rejects(runScheduledRoutine({id:1,cadence:'daily',hour:'10:00'},new Date(2026,10,3,10,0),state,async()=>{throw Error('Disco indisponível')},async()=>{copied=true}),/Disco/);assert.equal(copied,false);assert.deepEqual(state,{});
});

test('alterar de 09h para 23h no mesmo dia permite o novo horário, sem repetir os já tentados',async()=>{
 const {runScheduledRoutine}=await import('../schedule.mjs');const state={},routine={id:42,cadence:'weekdays',hour:'09:00'};let calls=0,persisted;
 const persist=async value=>{persisted=JSON.stringify(value)};
 await assert.rejects(runScheduledRoutine(routine,new Date(2026,10,11,9),state,persist,async()=>{calls++;throw Error('VSS falhou')}),/VSS/);
 routine.hour='23:00';
 assert.equal(await runScheduledRoutine(routine,new Date(2026,10,11,22,59),state,persist,async()=>calls++),false);
 assert.equal(await runScheduledRoutine(routine,new Date(2026,10,11,23),state,persist,async()=>calls++),true);
 assert.equal(await runScheduledRoutine(routine,new Date(2026,10,11,23,1),JSON.parse(persisted),persist,async()=>calls++),false);
 routine.hour='09:00';assert.equal(await runScheduledRoutine(routine,new Date(2026,10,11,23,2),state,persist,async()=>calls++),false);
 assert.equal(calls,2);
 assert.equal(await runScheduledRoutine(routine,new Date(2026,10,12,9),state,persist,async()=>calls++),true);
 assert.equal(calls,3);
});

test('falha ao persistir novo horário preserva as tentativas anteriores e permite tentar salvar novamente',async()=>{
 const {runScheduledRoutine}=await import('../schedule.mjs'),old={date:'2026-11-11',hours:['09:00']},state={1:old},routine={id:1,cadence:'weekdays',hour:'23:00'};let copied=false;
 await assert.rejects(runScheduledRoutine(routine,new Date(2026,10,11,23),state,async()=>{throw Error('Disco indisponível')},async()=>{copied=true}),/Disco/);
 assert.equal(copied,false);assert.equal(state[1],old);assert.deepEqual(old.hours,['09:00']);
 assert.equal(await runScheduledRoutine(routine,new Date(2026,10,11,23,1),state,async()=>{},async()=>{copied=true}),true);assert.equal(copied,true);
});
