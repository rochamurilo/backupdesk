import {performance} from 'node:perf_hooks';import {setTimeout as delay} from 'node:timers/promises';
export function bandwidthActive(policy,date=new Date()){
 if(!policy?.enabled)return false;const minutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3,5)),start=minutes(policy.start),end=minutes(policy.end),now=date.getHours()*60+date.getMinutes();return start===end||start<end&&now>=start&&now<end||start>end&&(now>=start||now<end);
}
// Shared across files/destinations. No initial free burst; policy is checked during long waits.
export function createBandwidthLimiter({getPolicy=()=>null,now=()=>performance.now(),date=()=>new Date(),wait=delay}={}){
 const states=new Map();
 const consume=async(bytes,direction='upload',signal)=>{signal?.throwIfAborted();let remaining=bytes;const state=states.get(direction)||{last:now()};states.set(direction,state);
  while(remaining>0){signal?.throwIfAborted();const policy=getPolicy(),current=now(),mbps=policy?.[direction+'_mbps'];if(!bandwidthActive(policy,date())||!mbps){state.last=current;return}const rate=mbps*1000000/8,elapsed=Math.max(0,current-state.last);remaining-=Math.min(remaining,rate*elapsed/1000,65536);state.last=current;if(remaining>0)await wait(Math.min(250,Math.max(1,Math.min(remaining,65536)/rate*1000)),undefined,{signal})}
 };
 const queues=new Map();return(bytes,direction='upload',signal)=>{const work=(queues.get(direction)||Promise.resolve()).then(()=>consume(bytes,direction,signal));queues.set(direction,work.catch(()=>{}));return work};
}
