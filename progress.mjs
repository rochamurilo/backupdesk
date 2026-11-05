export const megabytes=value=>new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(value||0)/1000000)+' MB';
export function remainingTime(seconds){if(!Number.isFinite(seconds)||seconds<0)return 'Calculando…';const n=Math.ceil(seconds);if(n<60)return n+' s';if(n<3600)return Math.floor(n/60)+' min '+n%60+' s';return Math.floor(n/3600)+' h '+Math.floor(n%3600/60)+' min'}
// Measure real copy/read phases separately: verification bytes never inflate copy speed.
export function createProgressMeasurement(now=()=>performance.now()){
 let last=null,at=0,changedAt=0,counters,samples=[];
 const group=p=>['copying','verifying','finalizing'].includes(p.stage)?'transfer':p.stage;
 function report(value){const time=now(),p={...last,...value},processed=Number(p.processedBytes)||0;
  if(!last||processed<(Number(last.processedBytes)||0)||p.totalBytes!==last.totalBytes||group(p)!==group(last)){
   counters={work:processed,copy:0,copyMs:0,verify:0,verifyMs:0};samples=[{at:time,...counters}];at=time;changedAt=time;
  }else{const delta=processed-(Number(last.processedBytes)||0),elapsed=Math.max(0,time-at);counters.work+=delta;if(last.stage==='copying')counters.copyMs+=elapsed;if(last.stage==='verifying')counters.verifyMs+=elapsed;if(p.stage==='copying')counters.copy+=delta;if(p.stage==='verifying')counters.verify+=delta;if(delta>0)changedAt=time;at=time;}
  last=p;if(time-samples.at(-1).at>=500)samples.push({at:time,...counters});while(samples.length>2&&samples[1].at<time-10000)samples.shift();
 }
 return {report,snapshot(){if(!last)return {};report(last);const time=at,base=samples[0],elapsed=time-base.at,work=counters.work-base.work,rate=elapsed>=1000?work*1000/elapsed:0,phase=last.stage==='verifying'?'verify':'copy',phaseMs=counters[phase+'Ms']-base[phase+'Ms'];const speed=elapsed>=1000&&phaseMs>0?(counters[phase]-base[phase])*1000/phaseMs:0,stalled=time-changedAt>15000;
  return {speedBytesPerSecond:!stalled&&speed>0?speed:null,etaSeconds:!stalled&&group(last)==='transfer'&&last.totalBytes>0&&last.processedBytes<last.totalBytes&&rate>0?(last.totalBytes-last.processedBytes)/rate:null};
 }};
}
export function createProgressReporter(send,interval=750){
 let latest=null,inflight=null,closed=false;const measurement=createProgressMeasurement();
 async function flush(){if(inflight){await inflight;return}if(!latest)return;const value={...latest,...measurement.snapshot()};inflight=Promise.resolve().then(()=>send(value)).catch(()=>{});await inflight;inflight=null}
 const timer=setInterval(()=>{if(!closed)flush()},interval);timer.unref();
 return {report(value){latest={...latest,...value};measurement.report(latest)},async close(){closed=true;clearInterval(timer);await flush();if(inflight)await inflight;await flush()}};
}
