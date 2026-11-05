import path from 'node:path';
export const defaultBandwidth=()=>({enabled:false,start:'00:00',end:'00:00',upload_mbps:50,download_mbps:null});
export const defaultPreferences=()=>({destinations:[],bandwidth:defaultBandwidth()});
export function pathFlavor(value){return /^(?:[a-z]:|\\)/i.test(value)?path.win32:path.posix}
export function absoluteDevicePath(value){return typeof value==='string'&&value.length>0&&value.length<=4096&&pathFlavor(value).isAbsolute(value)&&!value.includes('\0')}
export function pathKey(value){const p=pathFlavor(value),normalized=p.normalize(value);return p===path.win32?normalized.toLowerCase():normalized}
export function withinPath(root,child){const p=pathFlavor(root);if(p!==pathFlavor(child))return false;const r=p.relative(root,child);return r===''||!r.startsWith('..'+p.sep)&&r!=='..'&&!p.isAbsolute(r)}
export function validatePreferences(value){
 if(!value||!Array.isArray(value.destinations)||value.destinations.length>10)throw Error('Configure até dez destinos de backup.');
 const seen=new Set(),destinations=value.destinations.map(d=>{if(!['local','external','network'].includes(d.type)||!absoluteDevicePath(d.path))throw Error('Informe uma pasta absoluta para cada destino.');const key=pathKey(d.path);if(seen.has(key))throw Error('Um destino foi informado mais de uma vez.');seen.add(key);return {path:pathFlavor(d.path).normalize(d.path),type:d.type}});
 for(const a of destinations)for(const b of destinations)if(a!==b&&(withinPath(a.path,b.path)||withinPath(b.path,a.path)))throw Error('Destinos de backup não podem ficar uns dentro dos outros.');
 const b=value.bandwidth;if(!b||typeof b.enabled!=='boolean'||![b.start,b.end].every(v=>typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v)))throw Error('Informe horários válidos para a limitação de velocidade.');
 const rate=v=>{if(v===null||v===''||v===0)return null;if(typeof v!=='number'||!Number.isFinite(v)||v<0.001||v>1000000)throw Error('Velocidade deve estar entre 0,001 e 1.000.000 Mbit/s, ou ilimitada.');return v};
 return {destinations,bandwidth:{enabled:b.enabled,start:b.start,end:b.end,upload_mbps:rate(b.upload_mbps),download_mbps:rate(b.download_mbps)}};
}
export function preferencesStore(db){
 db.exec('CREATE TABLE IF NOT EXISTS device_preferences(device TEXT PRIMARY KEY REFERENCES devices(id),config TEXT NOT NULL,updated TEXT NOT NULL)');
 function get(device){const saved=db.prepare('SELECT config FROM device_preferences WHERE device=?').get(device);if(saved)return JSON.parse(saved.config);const result=defaultPreferences(),seen=new Set();for(const r of db.prepare("SELECT destination,destination_type FROM routines WHERE device=? AND deleted=0 AND destination_type!='server' ORDER BY id").all(device)){if(!absoluteDevicePath(r.destination))continue;const key=pathKey(r.destination);if(!seen.has(key)){seen.add(key);result.destinations.push({path:r.destination,type:r.destination_type})}}return result}
 function saved(device){return !!db.prepare('SELECT device FROM device_preferences WHERE device=?').get(device)}
 function set(device,value,onPersist=()=>{}){const result=validatePreferences(value);db.exec('BEGIN');try{db.prepare('INSERT INTO device_preferences(device,config,updated) VALUES(?,?,?) ON CONFLICT(device) DO UPDATE SET config=excluded.config,updated=excluded.updated').run(device,JSON.stringify(result),new Date().toISOString());if(result.destinations.length){const first=result.destinations[0];db.prepare("UPDATE routines SET destination=?,destination_type=?,use_vss=CASE WHEN (SELECT platform FROM devices WHERE id=?) IN ('linux','darwin') THEN 0 ELSE 1 END WHERE device=? AND deleted=0").run(first.path,first.type,device,device)}onPersist();db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}return result}
 function apply(routine,device){const preferences=get(device.id),first=preferences.destinations[0];return {...routine,...(first?{destination:first.path,destination_type:first.type}:{}),destinations:preferences.destinations,bandwidth:preferences.bandwidth,preferences_required:saved(device.id),device_name:device.name,use_vss:(first?.type||routine.destination_type)!=='server'&&!['linux','darwin'].includes(device.platform)?1:0}}
 return {get,set,saved,apply};
}
