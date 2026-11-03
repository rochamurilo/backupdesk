import {test} from 'node:test';import assert from 'node:assert/strict';import {isScheduledDay} from '../schedule.mjs';
test('dias de execução cobrem a semana inteira e respeitam finais de semana',()=>{
 const dates=Array.from({length:7},(_,i)=>new Date(2026,10,2+i,20,0));
 const expected={weekdays:[true,true,true,true,true,false,false],saturday:[false,false,false,false,false,true,false],sunday:[false,false,false,false,false,false,true],daily:[true,true,true,true,true,true,true],weekly:[true,false,false,false,false,false,false]};
 for(const [cadence,days] of Object.entries(expected))assert.deepEqual(dates.map(d=>isScheduledDay(cadence,d)),days,cadence);
});
test('rotinas mensais e cadências antigas continuam válidas',()=>{
 assert.equal(isScheduledDay('monthly',new Date(2026,9,31)),false);assert.equal(isScheduledDay('monthly',new Date(2026,10,1)),true);assert.equal(isScheduledDay('monthly',new Date(2026,10,2)),false);assert.equal(isScheduledDay('invalid',new Date()),false);assert.equal(isScheduledDay('daily',new Date('invalid')),false);
});
