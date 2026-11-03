import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {readFile,mkdir} from 'node:fs/promises';import path from 'node:path';
const execute=promisify(execFile);
export function mapSnapshotPaths(sources,snapshots){return sources.map(source=>{
 const absolute=path.win32.resolve(source),volume=path.win32.parse(absolute).root;
 if(!/^[A-Za-z]:\\$/.test(volume))throw Error('VSS suporta origens locais com letra de unidade; caminhos de rede precisam de snapshot no servidor.');
 const snapshot=snapshots.find(s=>s.volume.toLowerCase()===volume.toLowerCase());if(!snapshot||!/^\\\\\?\\GLOBALROOT\\Device\\HarddiskVolumeShadowCopy\d+$/i.test(snapshot.device))throw Error('Caminho do snapshot VSS inválido.');
 return path.win32.join(snapshot.device+'\\',path.win32.relative(volume,absolute));
})}
async function requestVss(request){
 if(process.platform!=='win32')throw Error('VSS está disponível apenas no Windows.');
 const ledger=path.join(path.dirname(path.resolve(process.env.BACKUPDESK_AGENT_STATE||'data/agent-state.json')),'vss-owned.json');await mkdir(path.dirname(ledger),{recursive:true});
 const script=await readFile(new URL('./windows/vss.ps1',import.meta.url),'utf8');
 try{const {stdout}=await execute('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,env:{...process.env,BACKUPDESK_VSS_REQUEST:JSON.stringify(request),BACKUPDESK_VSS_LEDGER:ledger},encoding:'utf8',timeout:180000,maxBuffer:1048576});return JSON.parse(stdout.replace(/^\uFEFF/,'').trim())}catch(e){throw Error((e.stderr||e.message).trim())}
}
export async function withVssSources(sources,operation,backend=requestVss){
 const volumes=[...new Set(sources.map(p=>{if(!/^[A-Za-z]:[\\/]/.test(p))throw Error('VSS requer origem em disco local NTFS.');return path.win32.parse(path.win32.resolve(p)).root.toUpperCase()}))];const snapshots=[];
 if(backend===requestVss)await backend({action:'cleanup'});
 try{for(const volume of volumes)snapshots.push(await backend({action:'create',volume}));const mapped=mapSnapshotPaths(sources,snapshots);return await operation(mapped,snapshots)}
 finally{const failures=[];for(const snapshot of snapshots.reverse()){try{await backend({action:'delete',id:snapshot.id})}catch(e){failures.push(snapshot.id+': '+e.message)}}if(backend===requestVss){try{await backend({action:'cleanup'})}catch(e){failures.push(e.message)}}if(failures.length)throw Error('Não foi possível remover os snapshots VSS desta execução: '+failures.join('; '))}
}
