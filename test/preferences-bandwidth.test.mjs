import {test} from 'node:test';import assert from 'node:assert/strict';import {bandwidthActive,createBandwidthLimiter} from '../bandwidth.mjs';import {validatePreferences,defaultPreferences} from '../preferences.mjs';
const policy={enabled:true,start:'08:00',end:'18:00',upload_mbps:1,download_mbps:null};
test('limite respeita horário local, virada da meia-noite, dia inteiro e desativação',()=>{
 const at=(h,m=0)=>new Date(2026,10,4,h,m);assert.equal(bandwidthActive(policy,at(7,59)),false);assert.equal(bandwidthActive(policy,at(8)),true);assert.equal(bandwidthActive(policy,at(18)),false);
 const overnight={...policy,start:'22:00',end:'06:00'};assert.equal(bandwidthActive(overnight,at(23)),true);assert.equal(bandwidthActive(overnight,at(5)),true);assert.equal(bandwidthActive(overnight,at(6)),false);assert.equal(bandwidthActive({...policy,start:'00:00',end:'00:00'},at(19)),true);assert.equal(bandwidthActive({...policy,enabled:false},at(12)),false);
});
test('limitador conta bytes reais, compartilha orçamento e reage à alteração de preferência',async()=>{
 let time=0,p={...policy,start:'00:00',end:'00:00'},waited=0;const throttle=createBandwidthLimiter({getPolicy:()=>p,now:()=>time,date:()=>new Date(2026,10,4,12),wait:async ms=>{time+=ms;waited+=ms}});
 await throttle(125000,'upload');assert.ok(time>=1000);await throttle(125000,'upload');assert.ok(time>=2000);const previous=time;await throttle(100000000,'download');assert.equal(time,previous);
 let calls=0;const dynamic=createBandwidthLimiter({getPolicy:()=>p,now:()=>time,date:()=>new Date(),wait:async ms=>{time+=ms;if(++calls===2)p={...p,enabled:false}}});await dynamic(100000000,'upload');assert.equal(calls,2);assert.ok(waited>=2000);
});
test('preferências validam destinos independentes e velocidades, sem duplicar caminhos Windows',()=>{
 const p=defaultPreferences();p.destinations=[{type:'local',path:'E:\\Backups'},{type:'network',path:'\\\\server\\share'}];assert.equal(validatePreferences(p).destinations.length,2);
 for(const destinations of [[{type:'local',path:'relative'}],[{type:'local',path:'E:\\Backups'},{type:'external',path:'e:/backups/'}],[{type:'local',path:'/backups'},{type:'local',path:'/backups/sub'}]])assert.throws(()=>validatePreferences({...p,destinations}));
 assert.throws(()=>validatePreferences({...p,bandwidth:{...p.bandwidth,upload_mbps:-1}}));assert.throws(()=>validatePreferences({...p,bandwidth:{...p.bandwidth,start:'24:00'}}));assert.equal(validatePreferences({...p,bandwidth:{...p.bandwidth,upload_mbps:0}}).bandwidth.upload_mbps,null);
});
test('cópia local e envio ao escritório compartilham o limite sem duplicar orçamento',async()=>{
 let time=0;const throttle=createBandwidthLimiter({getPolicy:()=>({...policy,start:'00:00',end:'00:00'}),now:()=>time,date:()=>new Date(),wait:async ms=>{time+=ms}});await Promise.all([throttle(125000,'upload'),throttle(125000,'upload')]);assert.ok(time>=2000);const start=time;const faster=createBandwidthLimiter({getPolicy:()=>({...policy,start:'00:00',end:'00:00',upload_mbps:50}),now:()=>time,date:()=>new Date(),wait:async ms=>{time+=ms}});await faster(4*1024*1024,'upload');assert.ok(time-start>=4*1024*1024/(50*1000000/8)*1000);assert.ok(time-start<1000);
});
