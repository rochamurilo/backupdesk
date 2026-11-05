export function calendarDay(value){if(value===null||value===undefined||value==='')return null;const date=new Date(value);return Number.isFinite(date.getTime())?[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-'):null}
export function calendarEvents(runs){const days=new Map(),seen=new Set();for(const run of runs){if(!['success','failed','running'].includes(run.status))continue;const date=Number.isFinite(Date.parse(run.finished))?run.finished:run.started,day=calendarDay(date);if(!day)continue;const id=[run.original_device||run.device,run.original_run||run.id,run.status].join(':');if(seen.has(id))continue;seen.add(id);if(!days.has(day))days.set(day,{success:0,failed:0,running:0});days.get(day)[run.status]++}return days}
export function calendarLocation(value){const path=String(value||'').replace(/[\\/]+$/,'');return /^(?:[a-z]:|\\)/i.test(path)?path.replaceAll('/',String.fromCharCode(92)).toLowerCase():path}
function sameStorage(a,b){if(a===b)return true;const suffix=/^(?:[a-z]:|\\)/i.test(a)?'\\backupdesk':'/BackupDesk';return a+suffix===b||b+suffix===a}
export function restorationEvents({runs,repositoryRuns=[],device,location,recovery}){
 const selected=calendarLocation(location),inLocation=run=>{const path=calendarLocation(run.backup_destination||run.scope_destination);return !selected||((!path||!(/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(path)))?(run.status!=='success'||selected.startsWith('unknown:')):sameStorage(path,selected))};
 const imported=repositoryRuns.filter(r=>r.device===device&&inLocation(r)&&(recovery?r.recovery_name===recovery.name&&r.encryption_id===recovery.key_id:!r.recovery_name));
 const originals=recovery?new Set(imported.map(r=>r.original_device)):new Set([device]);
 return [...runs.filter(r=>originals.has(r.device)&&inLocation(r)&&(!recovery||!r.encryption_id||r.encryption_id===recovery.key_id)),...imported];
}
