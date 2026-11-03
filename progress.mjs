export function createProgressReporter(send,interval=750){
 let latest=null,inflight=null,closed=false;
 async function flush(){if(inflight){await inflight;return}if(!latest)return;const value={...latest};inflight=Promise.resolve().then(()=>send(value)).catch(()=>{});await inflight;inflight=null}
 const timer=setInterval(()=>{if(!closed)flush()},interval);timer.unref();
 return {report(value){latest={...latest,...value};},async close(){closed=true;clearInterval(timer);await flush();if(inflight)await inflight;await flush()}};
}
