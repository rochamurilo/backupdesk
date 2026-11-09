import {recentResults} from '/overview-notifications.mjs';
import {overviewRuns,overviewConnection} from '/overview-status.mjs';
import {calendarDay,calendarEvents,restorationEvents} from '/calendar-events.mjs';
import {buildRestoreTree,selectionState,selectRestoreNode} from '/restore-tree.mjs';
import {megabytes,remainingTime,createProgressMeasurement} from '/progress.mjs';
import {cadenceLabels} from '/schedule.mjs';
let token=sessionStorage.getItem('token'),state;const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));async function api(path,data,method){const r=await fetch('/api/'+path,{method:method||(data?'POST':'GET'),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const b=await r.json();if(!r.ok)throw Error(b.error);return b}function message(e){$('message').textContent=e.message||e}function bind(id,fn){$(id).onsubmit=async e=>{e.preventDefault();try{await fn(Object.fromEntries(new FormData(e.target)));$('message').textContent='';}catch(e){message(e)}}}bind('loginForm',async b=>{const r=await api('login',b);token=r.token;sessionStorage.setItem('token',token);await refresh()});$('logout').onclick=()=>{sessionStorage.removeItem('token');location.reload()};let editingRoutine=null,savingRoutine=false;
$('routineForm').onsubmit=async e=>{
 e.preventDefault();if(savingRoutine)return;
 savingRoutine=true;updateRoutineFormState();
 try{const b=Object.fromEntries(new FormData(e.target));b.source=JSON.stringify(b.source.split(/\r?\n/).map(p=>p.trim()).filter(Boolean));
  const saved=await api(editingRoutine?'routines/'+editingRoutine:'routines',b,editingRoutine?'PATCH':'POST');
  editingRoutine=saved.id;await refresh();message('Rotina salva. Para cadastrar outra, clique em Nova rotina.');
 }catch(error){message(error)}finally{savingRoutine=false;updateRoutineFormState()}
};
function updateRoutineFormState(){
 $('saveRoutine').disabled=savingRoutine||!$('deviceOptions').value;$('saveRoutine').textContent=savingRoutine?'Salvando…':editingRoutine?'Salvar alterações':'Salvar rotina';
 $('routineTitle').textContent=editingRoutine?'Editar rotina':'Nova rotina';$('cancelEdit').hidden=!editingRoutine;$('newRoutine').disabled=savingRoutine;
 document.querySelectorAll('[data-edit]').forEach(b=>b.disabled=savingRoutine);$('cancelEdit').disabled=savingRoutine;
 $('routineForm').setAttribute('aria-busy',String(savingRoutine));
}
function newRoutine(){if(savingRoutine)return;const device=$('deviceOptions').value;$('routineForm').reset();if(state?.devices.some(d=>d.id===device))$('deviceOptions').value=device;editingRoutine=null;updateRoutineFormState();$('routineForm').elements.name.focus()}
$('newRoutine').onclick=newRoutine;
const now=new Date();$('month').value=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');$('month').onchange=calendar;
function calendarDots(counts){return ['success','failed','running'].filter(status=>counts?.[status]).map(status=>`<span class="backup-dot ${status}-dot" data-calendar-status="${status}" title="${({success:'Sucesso',failed:'Falha',running:'Em execução'})[status]}: ${counts[status]}" role="img" aria-label="${({success:'Sucesso',failed:'Falha',running:'Em execução'})[status]}: ${counts[status]}"></span>`).join('')}
function calendar(){const [y,m]=$('month').value.split('-').map(Number);if(!y||!m)return;const days=new Date(y,m,0).getDate(),offset=new Date(y,m-1,1).getDay(),events=calendarEvents(overviewRuns(state));$('calendar').innerHTML=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d=>'<b>'+d+'</b>').join('')+'<div></div>'.repeat(offset)+Array.from({length:days},(_,i)=>{const day=calendarDay(new Date(y,m-1,i+1));return `<div class="day" data-calendar-day="${day}">${i+1}<br>${calendarDots(events.get(day))}</div>`}).join('')}

async function refresh(){state=await api('state');$('login').hidden=true;$('dashboard').hidden=false;$('logout').hidden=!!state.user.localOnly;document.querySelectorAll('.master').forEach(e=>e.hidden=state.user.role!=='master');$('stats').innerHTML='<article>Computadores<strong>'+state.devices.length+'</strong></article>'+[['Backups Concluídos','success'],['Falhas Registradas','failed']].map(([label,status])=>`<article><button class="stat-card" type="button" data-result-status="${status}" title="Resultados não lidos dos últimos 30 dias">${label}<strong>${recentResults(state,status).filter(r=>!r.read).length}</strong></button></article>`).join('');for(const button of $('stats').querySelectorAll('[data-result-status]'))button.onclick=()=>openOverviewResults(button.dataset.resultStatus);renderOverviewResults();const runnableDevices=state.devices.filter(d=>state.clientMode||d.id===state.localDeviceId||d.client_mode!=='local'),selectedDevice=$('deviceOptions').value;$('deviceOptions').innerHTML=(runnableDevices.length?'':'<option value="">Abra o client local para configurar suas rotinas</option>')+runnableDevices.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');if(state.devices.some(d=>d.id===selectedDevice&&!(d.client_mode==='local'&&d.id!==state.localDeviceId&&!state.clientMode)))$('deviceOptions').value=selectedDevice;$('saveRoutine').disabled=savingRoutine||!runnableDevices.length;$('browseFiles').disabled=picking||!runnableDevices.length;renderRoutines();renderHistory();equipment();calendar();renderRestore();renderPreferences();renderOffice();renderLogs();updateRoutineFormState();applyLocalClientControls()}
async function download(path,name){try{const r=await fetch('/api/'+path,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('Falha no download');const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return true}catch(e){message(e);return false}}openPanel();setInterval(()=>{if(token)refresh().catch(message)},5000);

function equipment(){const showOffice=state.devices.some(d=>state.office?.[d.id]?.enabled)||state.runs.some(r=>r.office_status==='confirmed'||r.office_status==='queued');$('officeColumn').hidden=!showOffice;const filter=$('search').value.toLowerCase();const labels={success:'Concluído',failed:'Falha',running:'Em execução'};const localDate=d=>calendarDay(d);$('equipmentRows').innerHTML=state.devices.filter(d=>d.name.toLowerCase().includes(filter)).map(d=>{const report=state.reports?.find(r=>r.device===d.id),runs=overviewRuns(state).filter(r=>r.device===d.id),connection=overviewConnection(state,d.id),last=runs[0],success=runs.find(r=>r.status==='success');const bars=Array.from({length:28},(_,i)=>{const day=new Date();day.setDate(day.getDate()-27+i);const rs=runs.filter(r=>calendarDay(r.finished||r.started)===localDate(day));const status=rs.some(r=>r.status==='failed')?'failed':rs.some(r=>r.status==='running')?'running':rs.length?'success':'none';return `<span class="bar ${status}" title="${day.toLocaleDateString('pt-BR')}: ${labels[status]||'Sem execução'}"></span>`}).join('');return `<tr><td><b>${esc(d.name)}</b><br><small>Agente: ${esc(d.version||'aguardando contato')}</small></td><td class="${last?.status||''}">${labels[last?.status]||'Sem backup'}</td><td><div class="bars">${bars}</div></td><td>${success?new Date(success.finished).toLocaleString('pt-BR'):'—'}</td><td>${last?megabytes(last.bytes):'—'}</td><td>${connection.known?(connection.online?'Online':'Sem contato há mais de 5 min'):'Aguardando relatório'}${connection.log_at?'<br><small title="'+esc('Leitura no master: '+new Date(connection.read_at).toLocaleString('pt-BR'))+'">Log: '+new Date(connection.log_at).toLocaleString('pt-BR')+'</small>':''}</td>${showOffice?`<td>${esc(officeLabel(computerOfficeStatus(d,last,report)))}</td>`:''}</tr>`}).join('')||'<tr><td colspan="7">Nenhum equipamento encontrado.</td></tr>'}
$('search').oninput=()=>{if(state)equipment()};

$('downloadClient').onclick=()=>{$('clientDownloadError').textContent='';$('clientDownload').showModal();$('clientComputerName').focus()};
$('closeClientDownload').onclick=()=>$('clientDownload').close();
let downloadingClient=false;
$('clientDownloadForm').onsubmit=async event=>{
 event.preventDefault();if(downloadingClient)return;downloadingClient=true;const button=$('generateNamedClient');button.disabled=true;button.textContent='Gerando…';$('clientDownloadError').textContent='';
 try{const name=$('clientComputerName').value.trim();const response=await fetch('/api/download/client',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name})});if(!response.ok)throw Error((await response.json()).error||'Falha ao gerar o client.');const disposition=response.headers.get('Content-Disposition')||'',encoded=disposition.match(/filename\*=UTF-8''([^;]+)/i),filename=encoded?decodeURIComponent(encoded[1]):'BackupDesk-Client-'+name+'.exe',url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('clientDownload').close();message('Instalador preparado para '+name+'.'+(response.headers.get('X-BackupDesk-Connection')==='local'?' O client funciona localmente. Configure os logs na rede para acompanhar pelo master.':''));const deviceId=response.headers.get('X-BackupDesk-Device-ID');if(deviceId){try{showSecurityKey(await api('devices/'+deviceId+'/security-key',{}))}catch(error){message('Instalador gerado. A chave ficará disponível em Restauração após o primeiro contato do agente.')}}await refresh()}
 catch(error){$('clientDownloadError').textContent=error.message}finally{downloadingClient=false;button.disabled=false;button.textContent='Gerar instalador'}
};

function displaySources(source){try{return JSON.parse(source).join(' · ')}catch{return source}}
let picking=false;
$('browseFiles').onclick=async()=>{
 if(picking)return;
 if(!state.localDeviceId||$('deviceOptions').value!==state.localDeviceId)return message('A seleção pelo Windows é feita no master local. Para um client remoto, informe no campo acima o caminho da pasta daquele computador.');
 picking=true;$('browseFiles').disabled=true;$('deviceOptions').disabled=true;$('browseFiles').textContent='Aguardando seleção no Windows…';
 try{const result=await api('pick-folder',{purpose:'source'});if(!result.cancelled){const paths=new Set($('sources').value.split(/\r?\n/).map(p=>p.trim()).filter(Boolean));paths.add(result.path);$('sources').value=[...paths].join('\n');$('message').textContent='Pasta selecionada.'}}
 catch(e){message(e)}finally{picking=false;$('browseFiles').disabled=false;$('deviceOptions').disabled=false;$('browseFiles').textContent='Selecionar pasta…'}
};

async function openPanel(){
 try{
  const fragment=new URLSearchParams(location.hash.slice(1));const access=fragment.get('access');if(access)history.replaceState(null,'','#overview');const local=await api('local-session',access?{access}:{});token=local.token;sessionStorage.setItem('token',token);await refresh();
 }catch(error){
  if(token){try{await refresh();return}catch{token=null;sessionStorage.removeItem('token')}}
  if(error.message?.includes('atalho VSS')){message(error);return}
  $('login').hidden=false;
 }
}


function showPage(page){if(state){if(page!=='preferences'){clearGeneralSecurityKey();clearNetworkPassword();clearLogPasswords()}else showPreferencesSection(preferencesSection)}if(!['overview','backup','restore','preferences'].includes(page))page='overview';document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!=='page-'+page);document.querySelectorAll('[data-page]').forEach(a=>a.classList.toggle('active',a.dataset.page===page))}
window.addEventListener('hashchange',()=>showPage(location.hash.slice(1)));showPage(location.hash.slice(1));

function bytes(value){return megabytes(value)}
function backupLabel(run){return run.backup_type==='snapshot'?'Snapshot completo':run.backup_type==='differential'?'Diferencial':'Completo'}
function operationalWarning(warning){return /^PST requer validação de recuperação no Outlook; VSS sem writers não garante consistência da aplicação\.?$/i.test(warning||'')?'':warning||''}
function exclusionDetails(run){let entries;try{entries=typeof run.excluded_links==='string'?JSON.parse(run.excluded_links):run.excluded_links}catch{return ''}if(!Array.isArray(entries)||!entries.length)return '';return '<details><summary>'+entries.length+' atalho(s) ignorado(s)</summary><p>O conteúdo apontado não foi copiado. Para incluí-lo, selecione a pasta real como outra origem.</p><ul>'+entries.map(e=>'<li>'+esc(e.path)+'</li>').join('')+'</ul></details>'}
function renderHistory(){
 $('runs').innerHTML=state.runs.slice(0,10).map(r=>`<div class="item"><span class="${r.status}">${({success:'Concluído',failed:'Falha',running:'Em execução'})[r.status]}</span> · ${esc(state.devices.find(d=>d.id===r.device)?.name)} · ${new Date(r.started).toLocaleString('pt-BR')} · ${backupLabel(r)} · ${r.encryption_id?'Criptografado · ':''}${bytes(r.bytes)} gravados${r.office_status&&r.office_status!=='not-configured'?' · Servidor externo: '+officeLabel(r.office_status):''} ${r.integrity?'<small> · Verificação integral: '+(JSON.parse(r.integrity).status==='failed'?'Falhou':esc(new Date(JSON.parse(r.integrity).last_successful_check_at).toLocaleString('pt-BR')))+'</small>':''} <button data-run="${r.id}" ${r.status==='success'?'':'disabled'}>Ver arquivos</button>${exclusionDetails(r)}</div>`).join('')||'Nenhuma execução registrada.';
 document.querySelectorAll('[data-run]').forEach(b=>b.onclick=()=>{thirdRecoveryContext=null;location.hash='restore';showPage('restore');$('thirdRecoveryStatus').hidden=true;$('exitThirdRecovery').hidden=true;const run=state.runs.find(r=>r.id===b.dataset.run);$('restoreDevice').value=run.device;renderRestore();$('restoreScope').value=restoreScopeKey(run);selectRestorePoint(run);$('restorePoint').scrollIntoView({behavior:'smooth',block:'center'})});
}
let restoreLoaded='';
const dateValue=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
function normalizedLocation(value){const path=String(value||'').replace(/[\\/]+$/,'');return /^(?:[a-z]:|\\)/i.test(path)?path.replaceAll('/',String.fromCharCode(92)).toLowerCase():path}
const restoreScopeKey=r=>normalizedLocation(r.backup_destination||r.scope_destination)||'unknown:'+r.routine_id;
function restoreSourceKey(run){const origin=run.original_device||run.device;try{const sources=JSON.parse(run.scope_sources);if(!sources.length)throw Error();return JSON.stringify([origin,sources.map(normalizedLocation).sort()])}catch{return origin+':'+(run.scope_key||'legacy:'+run.routine_id)}}
let restoreSelection=[];
function restorableRuns(){return [...state.runs,...(state.repositoryRuns||[])]}
let thirdRecoveryContext=null;
function deviceRestoreRuns(){return restorableRuns().filter(r=>r.device===$('restoreDevice').value&&r.status==='success'&&(thirdRecoveryContext?r.recovery_name===thirdRecoveryContext.name&&r.encryption_id===thirdRecoveryContext.key_id:!r.recovery_name)).sort((a,b)=>Date.parse(b.finished)-Date.parse(a.finished))}
function scopeRestoreRuns(){return deviceRestoreRuns().filter(r=>restoreScopeKey(r)===$('restoreScope').value)}
function renderRestore(){
 const previous=$('restoreDevice').value;$('restoreDevice').innerHTML=state.devices.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');if(state.devices.some(d=>d.id===previous))$('restoreDevice').value=previous;
 const selected=$('restoreScope').value,groups=new Map();for(const r of deviceRestoreRuns())if(!groups.has(restoreScopeKey(r)))groups.set(restoreScopeKey(r),r);
 $('restoreScope').innerHTML=[...groups].map(([key,r])=>`<option value="${esc(key)}">${esc(r.backup_destination||r.scope_destination||'Local não registrado')}</option>`).join('');if(groups.has(selected))$('restoreScope').value=selected;
 if(!$('restoreDate').value){const latest=scopeRestoreRuns()[0];const date=latest?new Date(latest.finished):new Date();$('restoreDate').value=dateValue(date);$('restoreMonth').value=dateValue(date).slice(0,7)}
 renderRestoreCalendar();updateRestoreRuns();
}
function renderRestoreCalendar(){
 const [y,m]=$('restoreMonth').value.split('-').map(Number);if(!y||!m)return;const offset=new Date(y,m-1,1).getDay(),days=new Date(y,m,0).getDate(),runs=scopeRestoreRuns(),events=calendarEvents(restorationEvents({runs:state.runs,repositoryRuns:state.repositoryRuns,device:$('restoreDevice').value,location:$('restoreScope').value,recovery:thirdRecoveryContext}));
 $('restoreCalendar').innerHTML=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d=>'<b>'+d+'</b>').join('')+'<div></div>'.repeat(offset)+Array.from({length:days},(_,i)=>{const value=dateValue(new Date(y,m-1,i+1)),count=runs.filter(r=>dateValue(new Date(r.finished))===value).length;return `<button type="button" class="day ${value===$('restoreDate').value?'selected':''}" data-restore-day="${value}" aria-pressed="${value===$('restoreDate').value}" aria-label="${value}, ${count} backup(s) disponível(is), ${events.get(value)?.failed||0} falha(s)">${i+1}${calendarDots(events.get(value))}</button>`}).join('');
 document.querySelectorAll('[data-restore-day]').forEach(b=>b.onclick=()=>{$('restoreDate').value=b.dataset.restoreDay;renderRestoreCalendar();updateRestoreRuns()});
}
function selectRestorePoint(run){const date=new Date(run.finished);$('restoreDate').value=dateValue(date);$('restoreMonth').value=dateValue(date).slice(0,7);$('restoreTime').value=[date.getHours(),date.getMinutes(),date.getSeconds()].map(n=>String(n).padStart(2,'0')).join(':');renderRestoreCalendar();updateRestoreRuns()}
function updateRestoreRuns(){
 const dayEvents=calendarEvents(restorationEvents({runs:state.runs,repositoryRuns:state.repositoryRuns,device:$('restoreDevice').value,location:$('restoreScope').value,recovery:thirdRecoveryContext})).get($('restoreDate').value);$('restoreDayStatus').textContent=dayEvents?.failed?'Nesta data houve '+dayEvents.failed+' falha(s). Somente cópias concluídas até o horário selecionado ficam disponíveis para restauração.':dayEvents?.running?'Há backup em execução nesta data; ele ficará disponível após concluir.':'';
 const asOf=new Date($('restoreDate').value+'T'+(($('restoreTime').value||'23:59:59').length===5?$('restoreTime').value+':00':$('restoreTime').value||'23:59:59')+'.999').getTime(),points=new Map();
 for(const run of scopeRestoreRuns()){const source=restoreSourceKey(run);if(Date.parse(run.finished)<=asOf&&!points.has(source))points.set(source,run)}
 restoreSelection=[...points.values()];const run=restoreSelection[0];
 $('restoreRun').innerHTML=restoreSelection.map(r=>`<option value="${r.id}">${esc(r.finished)}</option>`).join('');
 if(!run){clearRestoreTree();$('restorePoint').textContent='Nenhum backup concluído até a data e o horário selecionados.';$('restoreFiles').textContent='';restoreLoaded='';return}
 $('restorePoint').textContent=(restoreSelection.length>1?restoreSelection.length+' conjuntos · Última versão: ':'Versão disponível: ')+new Date(run.finished).toLocaleString('pt-BR')+' · '+(restoreSelection.length===1?backupLabel(run)+' · ':'')+bytes(restoreSelection.reduce((n,r)=>n+(r.logical_bytes??r.bytes??0),0))+' em arquivos.';
 if(restoreLoaded!==restoreSelection.map(r=>r.id).join(','))loadRestoreFiles();
}
async function loadRestoreFiles(){
 const selection=[...restoreSelection],key=selection.map(r=>r.id).join(',');restoreLoaded=key;clearRestoreTree();$('restoreFiles').textContent='Carregando arquivos…';
 try{const sets=await Promise.all(selection.map(async run=>({run,files:await api((run.repository_id?'repository-runs/':'runs/')+run.id+'/files')})));if(restoreSelection.map(r=>r.id).join(',')!==key)return;
  renderRestoreTree(sets);
 }catch(e){if(restoreSelection.map(r=>r.id).join(',')===key){restoreLoaded='';$('restoreFiles').textContent=e.message}}
}
$('restoreDevice').onchange=()=>{thirdRecoveryContext=null;$('thirdRecoveryStatus').hidden=true;$('exitThirdRecovery').hidden=true;restoreLoaded='';$('restoreDate').value='';renderRestore()};
$('restoreScope').onchange=()=>{restoreLoaded='';const latest=scopeRestoreRuns()[0];if(latest)selectRestorePoint(latest);else updateRestoreRuns()};
$('restoreMonth').onchange=renderRestoreCalendar;
$('restoreDate').onchange=()=>{if($('restoreDate').value)$('restoreMonth').value=$('restoreDate').value.slice(0,7);renderRestoreCalendar();updateRestoreRuns()};$('restoreTime').onchange=updateRestoreRuns;


const destinationLabels={local:'Pasta local',external:'HD externo',network:'Rede',server:'Armazenamento antigo do master'};
function duplicateRoutineCount(){const seen=new Set();let count=0;for(const r of state.routines){const key=JSON.stringify([r.device,r.name,r.cadence,r.hour,r.source,r.destination,r.destination_type,r.use_vss,r.enabled]);if(seen.has(key))count++;else seen.add(key)}return count}
function renderRoutines(){
 const duplicateCount=duplicateRoutineCount();$('removeDuplicates').hidden=!duplicateCount;$('removeDuplicates').textContent='Remover '+duplicateCount+' cópia(s) idêntica(s) de rotinas';
 $('routines').innerHTML=state.routines.map(r=>`<div class="item"><b>${esc(r.name)}</b> · <strong class="${r.enabled?'success':'failed'}">${r.enabled?'Ativa':'Desativada'}</strong> · ${esc(cadenceLabels[r.cadence]||r.cadence)} · ${esc(r.hour)}<br><small>Origem: ${esc(displaySources(r.source))}<br>Destino: ${esc((state.preferences?.[r.device]?.destinations||[]).map(d=>d.path).join(' · ')||'Configure em Preferências')}</small><br><button data-edit="${r.id}">Editar</button><button data-backup="${r.id}" ${r.enabled?'':'disabled'}>Fazer backup agora</button><button data-toggle="${r.id}">${r.enabled?'Desativar':'Ativar'}</button><button data-delete="${r.id}">Excluir rotina</button></div>`).join('');
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{if(savingRoutine)return;const r=state.routines.find(r=>r.id===Number(b.dataset.edit));editingRoutine=r.id;const form=$('routineForm');for(const key of ['name','device','cadence','hour'])form.elements[key].value=r[key];$('sources').value=JSON.parse(r.source.startsWith('[')?r.source:JSON.stringify([r.source])).join('\n');updateRoutineFormState();location.hash='backup';form.scrollIntoView({behavior:'smooth'})});
 document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async()=>{try{const r=state.routines.find(r=>r.id===Number(b.dataset.toggle));await api('routines/'+r.id+'/enabled',{enabled:!r.enabled});await refresh();message(r.enabled?'Rotina desativada. Uma cópia em andamento não é interrompida.':'Rotina ativada.')}catch(e){message(e)}});
 document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Excluir esta rotina? Backups já gravados e uma cópia em andamento serão preservados.'))return;try{await api('routines/'+b.dataset.delete+'/delete',{});await refresh();message('Rotina excluída. Os backups foram preservados.')}catch(e){message(e)}});
 document.querySelectorAll('[data-backup]').forEach(b=>b.onclick=()=>startJob({kind:'backup',routine_id:Number(b.dataset.backup)},'Backup'));
}
$('cancelEdit').onclick=newRoutine;
async function selectTarget(input,device){if(!state.localDeviceId||device!==state.localDeviceId)return message('Para o client remoto, informe o caminho da pasta acessível naquele computador.');try{const picked=await api('pick-folder',{purpose:input==='restoreTarget'?'restore':'destination'});if(!picked.cancelled)$(input).value=picked.path}catch(e){message(e)}}
$('chooseRestoreTarget').onclick=()=>selectTarget('restoreTarget',$('restoreDevice').value);
async function startJob(payload,label,onSuccess){showActivity({kind:payload.kind,status:'queued',progress:{}});$('activityPanel').scrollIntoView({behavior:'smooth',block:'start'});try{const {id}=await api('jobs',payload);delete payload.security_key;message(label+': aguardando o agente…');async function poll(){try{const j=await api('jobs/'+id);if(j.status==='success'){let details='';if(j.result?.destination)details=' Pasta: '+j.result.destination;if(j.result?.backup_type)details=' '+backupLabel(j.result)+' · '+j.result.changed_files+' arquivo(s) gravado(s) · '+bytes(j.result.stored_bytes)+'.';if(operationalWarning(j.result?.warning))details+=' '+operationalWarning(j.result.warning);if(j.result?.total_destinations)details+=' '+j.result.completed_destinations+'/'+j.result.total_destinations+' destinos concluídos.';if(j.result?.runs)details=' '+j.result.runs+' versões · '+j.result.files+' arquivos no catálogo.';if(j.result?.availableBytes)details+=' Espaço disponível: '+bytes(j.result.availableBytes);message(label+(['Restauração','Verificação do destino'].includes(label)?' concluída.':' concluído.')+details);await refresh();if(payload.kind==='catalog'&&j.result?.root){$('restoreScope').value=normalizedLocation(j.result.root);$('restoreScope').dispatchEvent(new Event('change'))}if(onSuccess)await onSuccess(j.result)}else if(j.status==='failed'){message(label+' falhou: '+j.error);await refresh()}else setTimeout(poll,2000)}catch(e){message(e)}}poll()}catch(e){showActivity({kind:payload.kind,status:'failed',error:e.message});message(e)}}
async function restoreFile(runId,file){const run=restorableRuns().find(r=>r.id===runId);if(run&&run.storage_type!=='server'){if(!$('restoreTarget').value){location.hash='restore';return message('Selecione a pasta para receber os arquivos restaurados.')}return startJob({kind:'restore',...(run.repository_id?{repository_run:runId}:{run:runId}),path:file.path,target:$('restoreTarget').value},'Restauração')}return download('runs/'+runId+'/files?path='+encodeURIComponent(file.path),file.path.split('/').pop())}



const stages={cataloging:'Localizando versões no repositório',checking_base:'Verificando backup completo',comparing:'Comparando arquivos com o completo',preparing:'Preparando',scanning:'Localizando arquivos',checking_destination:'Verificando destino e espaço',restic_check:'Verificação integral do repositório (5 dias)',vss_prepare:'Preparando VSS',vss_snapshot:'Criando snapshot VSS',vss_cleanup:'Limpando snapshots VSS',copying:'Copiando arquivos',verifying:'Verificando integridade',finalizing:'Finalizando'};
let activityBusy=false,lastActivity=null;
let renderedActivityKey=null,measurementId=null,activityMeasurement;
function activityKey(item){return [item.id||item.created||'request',item.status,item.finished||''].join('|')}
$('dismissActivity').onclick=()=>{if(!lastActivity||['queued','running'].includes(lastActivity.status))return;sessionStorage.setItem('dismissedActivity',activityKey(lastActivity));$('activityPanel').hidden=true};
function showActivity(item){
 lastActivity=item;const panel=$('activityPanel'),key=activityKey(item),active=['queued','running'].includes(item.status);
 if(!active&&sessionStorage.getItem('dismissedActivity')===key){panel.hidden=true;return}
 const routine=state?.routines.find(r=>r.id===Number(item.routine_id));const cancelled=item.status==='failed'&&/^(Cópia idêntica da rotina removida antes da execução|Rotina desativada ou excluída antes da execução)$/.test(item.error||'');const historical=legacyVssFailure(item)&&!!routine&&/Esta rotina está sem VSS|Feche o Outlook antes de copiar PST/.test(item.error||'');
 panel.hidden=false;panel.dataset.status=cancelled?'cancelled':historical?'historical':item.status;$('dismissActivity').hidden=active;
 if(renderedActivityKey!==key){$('activityDetails').open=active||item.status==='failed'&&!historical&&!cancelled;renderedActivityKey=key}
 const p=item.progress||{};if(measurementId!==item.id||!activityMeasurement){measurementId=item.id;activityMeasurement=createProgressMeasurement()}activityMeasurement.report(p);const measured=activityMeasurement.snapshot(),stale=Date.now()-Date.parse(item.updated||item.created)>15000;const speed=stale?null:p.speedBytesPerSecond??measured.speedBytesPerSecond,eta=stale?null:p.etaSeconds??measured.etaSeconds;const label={backup:'Backup',restore:'Restauração',validate:'Teste do destino',catalog:'Leitura do repositório'}[item.kind]||'Operação';
 $('activityTitle').textContent=label+' · '+(cancelled?'Solicitação cancelada':historical?'Falha anterior — nova execução necessária':({queued:'Aguardando o agente',running:stages[p.stage]||'Em execução',success:item.office_status==='queued'?'Local concluído · envio externo pendente':item.office_status==='confirmed'?'Local e servidor externo concluídos':operationalWarning(item.warning)?'Concluído — verificar observação':'Concluído',failed:'Falhou'})[item.status])+(p.destinationCount>1?' · Destino '+p.destinationIndex+' de '+p.destinationCount:'')+(item.name?' · '+item.name:'');
 $('activitySummary').textContent=active?'Ver detalhes do andamento':cancelled?'Ver detalhes do cancelamento':historical?'Ver detalhes da tentativa anterior':item.status==='failed'?'Ver erro e opções':'Ver resultado';
 $('activityDetail').textContent=historical?'A tentativa registrada falhou sem VSS. A rotina agora está com VSS ativado; somente um novo backup poderá confirmar o funcionamento.':item.error||operationalWarning(item.warning)||[item.device_name,p.currentFile].filter(Boolean).join(' · ');
 const bar=$('activityBar');if(item.status==='success')bar.value=100;else if(p.totalBytes>0)bar.value=Math.min(100,100*(p.processedBytes||0)/p.totalBytes);else bar.removeAttribute('value');
 $('activityCount').textContent=(p.totalBytes>0?bytes(p.processedBytes)+' / '+bytes(p.totalBytes)+' processados (cópia e verificação). ':'')+(p.totalFiles!==null&&p.totalFiles!==undefined?(p.filesDone||0)+' / '+p.totalFiles+' arquivos. ':'')+(item.status==='queued'?'O agente precisa estar conectado.':item.status==='running'&&Date.now()-Date.parse(item.updated||item.created)>15000?'Aguardando atualização do agente…':'');$('activityTransfer').hidden=item.status!=='running';$('activitySpeed').textContent=(p.stage==='verifying'?'Verificação: ':'Transferência: ')+(speed>0?bytes(speed)+'/s':'Calculando…');$('activityEta').textContent='Tempo restante estimado: '+(p.stage==='finalizing'?'Finalizando…':remainingTime(eta));renderPstAction();
}
async function pollActivity(){if(!token||activityBusy)return;activityBusy=true;try{const items=await api('activity');if(items.length)showActivity(items[0])}catch(e){if(!$('activityPanel').hidden)$('activityCount').textContent='Sem atualização: '+e.message}finally{activityBusy=false}}
setInterval(pollActivity,1000);

function legacyVssFailure(item){return item?.status==='failed'&&/Esta rotina está sem VSS|Feche o Outlook antes de copiar PST|VSS exige privilégios|Abra o atalho VSS/.test(item.error||'')}
function renderPstAction(){
 const routine=state?.routines.find(r=>r.id===Number(lastActivity?.routine_id)),button=$('fixPst');
 button.hidden=!legacyVssFailure(lastActivity)||!routine||routine.destination_type==='server';button.textContent='Fazer novo backup';
}
$('fixPst').onclick=async()=>{const id=Number(lastActivity?.routine_id);if(state?.routines.some(r=>r.id===id))await startJob({kind:'backup',routine_id:id},'Backup')};

$('removeDuplicates').onclick=async()=>{
 if(!confirm('Remover as cópias idênticas de rotinas? A rotina mais antiga será mantida. Backups e histórico são preservados; cópias em andamento não serão interrompidas.'))return;
 const button=$('removeDuplicates');button.disabled=true;try{const result=await api('routines/deduplicate',{});if(result.replacements?.[editingRoutine])editingRoutine=result.replacements[editingRoutine];await refresh();message(result.removed+' cópia(s) de rotina removida(s). Backups e histórico foram preservados.')}catch(e){message(e)}finally{button.disabled=false}
};

const preferenceDrafts=new Map();let preferencesLoaded='',savingPreferences=false;
function collectPreferences(){const factor=Number($('bandwidthUnit').value)||1,device=$('preferencesDevice').value,old=state?.preferences?.[device]?.destinations||[];return {engine:$('backupEngine').value,destinations:$('localBackupPath').value.split(/\r?\n/).map(p=>p.trim()).filter(Boolean).map(path=>({path,type:old.find(d=>normalizedLocation(d.path)===normalizedLocation(path))?.type||(/^\\\\/.test(path)?'network':'local')})),bandwidth:{enabled:$('limitBandwidth').checked,start:$('bandwidthStart').value,end:$('bandwidthEnd').value,upload_mbps:$('uploadLimit').value===''?null:Number($('uploadLimit').value)*factor,download_mbps:$('downloadLimit').value===''?null:Number($('downloadLimit').value)*factor}}}

function applyLocalClientControls(){
 const device=state?.devices.find(d=>d.id===$('preferencesDevice').value),readOnly=!!device&&!state.clientMode&&device.id!==state.localDeviceId&&device.client_mode==='local';
 $('localClientNotice').hidden=!readOnly;
 for(const id of ['preferencesForm','officeForm'])for(const control of $(id).querySelectorAll('input,select,textarea,button')){
  if(readOnly){if(!control.hasAttribute('data-client-disabled'))control.dataset.clientDisabled=String(control.disabled);control.disabled=true}
  else if(control.hasAttribute('data-client-disabled')){control.disabled=control.dataset.clientDisabled==='true';delete control.dataset.clientDisabled}
 }
}
function renderPreferences(force=false){
 const previous=$('preferencesDevice').value;$('preferencesDevice').innerHTML=state.devices.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');if(state.devices.some(d=>d.id===previous))$('preferencesDevice').value=previous;else if(state.localDeviceId)$('preferencesDevice').value=state.localDeviceId;const device=$('preferencesDevice').value;renderGeneralInformation();renderNetworkCredentials();if(!device)return;
 const value=preferenceDrafts.get(device)||state.preferences?.[device]||{destinations:[],bandwidth:{enabled:false,start:'00:00',end:'00:00',upload_mbps:50,download_mbps:null}},key=device+JSON.stringify(value);if(!force&&preferencesLoaded===key)return;preferencesLoaded=key;
 $('backupEngine').value=value.engine||'native';
 $('localBackupPath').value=value.destinations.map(d=>d.path).join('\n');
 const b=value.bandwidth;$('limitBandwidth').checked=b.enabled;$('bandwidthStart').value=b.start;$('bandwidthEnd').value=b.end;$('bandwidthUnit').value='1';$('uploadLimit').value=b.upload_mbps??'';$('downloadLimit').value=b.download_mbps??'';

}
$('preferencesDevice').addEventListener('change',()=>setTimeout(applyLocalClientControls,0));
$('preferencesDevice').onchange=()=>{clearNetworkPassword();clearLogPasswords();renderPreferences(true);renderOffice(true);renderLogs(true)};
$('preferencesForm').oninput=event=>{if(['localNetworkUsername','localNetworkPassword'].includes(event.target.id))networkDirty=true;preferenceDrafts.set($('preferencesDevice').value,collectPreferences());preferencesLoaded=$('preferencesDevice').value+JSON.stringify(collectPreferences())};
$('chooseLocalBackupPath').onclick=async()=>{const device=$('preferencesDevice').value;if(device!==state.localDeviceId)return message('Informe o caminho local ou de rede acessível no computador selecionado.');try{const picked=await api('pick-folder',{purpose:'destination'});if(!picked.cancelled){$('localBackupPath').value=picked.path;const draft=collectPreferences();preferenceDrafts.set(device,draft);preferencesLoaded=device+JSON.stringify(draft)}}catch(error){message(error)}};
$('preferencesForm').onsubmit=async event=>{event.preventDefault();if(savingPreferences)return;savingPreferences=true;$('savePreferences').disabled=true;try{const device=$('preferencesDevice').value;const payload=collectPreferences();if(networkDirty)payload.network_credentials={username:$('localNetworkUsername').value.trim(),password:$('localNetworkPassword').value};await api('devices/'+device+'/preferences',payload);clearNetworkPassword();preferenceDrafts.delete(device);await refresh();renderPreferences(true);message('Preferências salvas para todas as rotinas deste computador.')}catch(e){message(e)}finally{savingPreferences=false;$('savePreferences').disabled=false}};
$('openRepository').onclick=()=>$('repositoryPicker').showModal();$('closeRepositoryPicker').onclick=()=>$('repositoryPicker').close();
$('chooseRepository').onclick=async()=>{if($('restoreDevice').value!==state.localDeviceId)return message('Informe o caminho da pasta no computador selecionado.');try{const picked=await api('pick-folder',{purpose:'repository'});if(!picked.cancelled)$('repositoryPath').value=picked.path}catch(e){message(e)}};
$('repositoryForm').onsubmit=async event=>{event.preventDefault();$('repositoryPicker').close();await startJob({kind:'catalog',device:$('restoreDevice').value,source:$('repositoryPath').value.trim()},'Leitura do repositório')};

function computerOfficeStatus(device,last,report){if(!state.office?.[device.id]?.enabled)return 'not-configured';if(!last)return 'waiting';if(last.status==='failed')return 'local-failed';if(last.office_status==='confirmed')return 'confirmed';if(report?.office_status==='failed')return 'failed';return report?.office_status==='uploading'?'uploading':'queued'}
function officeLabel(status){return ({'not-configured':'Não configurado',waiting:'Aguardando backup','local-failed':'Cópia local falhou',queued:'Pendente',uploading:'Enviando',confirmed:'Confirmado',failed:'Falha no envio'})[status]||'Pendente'}
let officeLoaded='',officeDirty=false;
function renderOffice(force=false){const device=$('preferencesDevice').value;if(!device)return;const value=state.office?.[device]||{enabled:false,url:null},key=device+JSON.stringify(value);if(!force&&(officeLoaded===key||officeDirty))return;officeLoaded=key;officeDirty=false;$('officeDeviceId').textContent=device;$('officeEnabled').checked=!!value.enabled;$('officeUrl').value=value.url||'';$('officeToken').value='';$('officeStatus').textContent=value.configured?'Credencial cadastrada para este computador.':'Conexão ainda não configurada.'}
$('officeForm').oninput=()=>{officeDirty=true};
$('officeForm').onsubmit=async event=>{event.preventDefault();$('saveOffice').disabled=true;try{const device=$('preferencesDevice').value;await api('devices/'+device+'/office',{enabled:$('officeEnabled').checked,url:$('officeUrl').value.trim()||null,token:$('officeToken').value.trim()||null});officeDirty=false;await refresh();renderOffice(true);message('Destino externo salvo. O envio será confirmado separadamente do Backup Local.')}catch(e){message(e)}finally{$('saveOffice').disabled=false}};

let displayedSecurityKey=null;
function showSecurityKey(value){displayedSecurityKey=value;$('securityComputerName').textContent=value.name;$('computerSecurityKey').value=value.security_key;$('computerSecurity').showModal()}
function clearSecurityKey(){displayedSecurityKey=null;$('computerSecurityKey').value='';$('securityComputerName').textContent=''}
$('closeComputerSecurity').onclick=()=>{$('computerSecurity').close();clearSecurityKey()};$('computerSecurity').addEventListener('cancel',clearSecurityKey);
$('downloadComputerKey').onclick=()=>{if(!displayedSecurityKey)return;const {name,security_key}=displayedSecurityKey,url=URL.createObjectURL(new Blob(['BackupDesk — '+name+'\nChave de segurança: '+security_key+'\n'],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='BackupDesk-Chave-'+name+'.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};

$('openThirdRecovery').onclick=()=>{$('thirdRepositoryPath').value=$('restoreScope').value||state.preferences?.[$('restoreDevice').value]?.destinations?.[0]?.path||'';$('thirdSecurityKey').value='';$('thirdRecovery').showModal();$('thirdComputerName').focus()};
$('closeThirdRecovery').onclick=()=>{$('thirdSecurityKey').value='';$('thirdRecovery').close()};$('thirdRecovery').addEventListener('cancel',()=>{$('thirdSecurityKey').value=''});
$('chooseThirdRepository').onclick=async()=>{if($('restoreDevice').value!==state.localDeviceId)return message('Informe o caminho de rede acessível ao computador que fará a restauração.');try{const value=await api('pick-folder',{purpose:'repository'});if(!value.cancelled)$('thirdRepositoryPath').value=value.path}catch(error){message(error)}};
$('thirdRecoveryForm').onsubmit=async event=>{event.preventDefault();const device=$('restoreDevice').value,payload={kind:'catalog',device,source:$('thirdRepositoryPath').value.trim(),recovery_name:$('thirdComputerName').value.trim(),security_key:$('thirdSecurityKey').value.trim()};$('thirdSecurityKey').value='';$('thirdRecovery').close();await startJob(payload,'Leitura do repositório',result=>{thirdRecoveryContext={name:result.recovery_name,key_id:result.encryption_id};$('restoreTime').value='23:59:59';$('restoreDate').value='';renderRestore();$('restoreScope').value=normalizedLocation(result.root);renderRestoreCalendar();updateRestoreRuns();$('thirdRecoveryStatus').textContent='Backups de '+result.recovery_name;$('thirdRecoveryStatus').hidden=false;$('exitThirdRecovery').hidden=false;location.hash='restore'})};
$('exitThirdRecovery').onclick=()=>{thirdRecoveryContext=null;$('thirdRecoveryStatus').hidden=true;$('exitThirdRecovery').hidden=true;$('restoreDate').value='';renderRestore()};

let restoreTree=null,restoreFolderElements=new Map(),selectedRestoreFiles=new Set(),restoringSelection=false;
function clearRestoreTree(){restoreTree=null;restoreFolderElements.clear();selectedRestoreFiles.clear();$('restoreSelected').disabled=true}
function renderRestoreTree(sets){
 restoreFolderElements.clear();restoreTree=buildRestoreTree(sets.map(set=>({...set,label:[set.run.source_device_name,displaySources(set.run.scope_sources)||set.run.routine_name||'Backup'].filter(Boolean).join(' · ')})));selectedRestoreFiles.clear();
 if(!restoreTree.rows.length){$('restoreFiles').textContent='Esta versão não contém arquivos.';$('restoreSelected').disabled=true;return}
 $('restoreFiles').innerHTML='<details id="restorePreview"><summary>Visualizar estrutura de pastas</summary><div class="restore-tree-toolbar"><button id="expandRestoreTree" type="button">Expandir todas as pastas</button><button id="collapseRestoreTree" type="button">Recolher pastas</button><span id="restoreSelectionCount"></span></div><p id="restoreFilePreview" class="muted">Selecione arquivos ou pastas para restaurar.</p><div id="restoreTree" aria-label="Estrutura de pastas do backup"></div></details>';
 const container=$('restoreTree');for(const root of restoreTree.roots)container.append(treeElement(root));
 $('expandRestoreTree').onclick=()=>{$('restorePreview').open=true;const queue=[...restoreTree.roots];for(let i=0;i<queue.length;i++){const node=queue[i],details=restoreFolderElements.get(node.id);renderFolderChildren(node,details);details.open=true;queue.push(...node.children.filter(n=>n.type==='folder'))}updateRestoreSelection()};
 $('collapseRestoreTree').onclick=()=>container.querySelectorAll('details').forEach(details=>details.open=false);
 container.onchange=event=>{const node=restoreTree.nodes.get(event.target.dataset.restoreNode);if(!node||restoringSelection)return;selectRestoreNode(node,selectedRestoreFiles,event.target.checked);updateRestoreSelection()};updateRestoreSelection();
}
function treeElement(node){
 const outer=document.createElement(node.type==='folder'?'details':'div');outer.className=node.type==='folder'?'restore-folder':'restore-file';
 const row=document.createElement(node.type==='folder'?'summary':'label'),box=document.createElement('input');box.type='checkbox';box.dataset.restoreNode=node.id;box.setAttribute('aria-label','Selecionar '+(node.type==='folder'?'pasta ':'arquivo ')+node.name);box.addEventListener('click',event=>event.stopPropagation());row.append(box);
 const name=document.createElement('span');name.textContent=(node.type==='folder'?'📁 ':'📄 ')+node.name;row.append(name);
 const info=document.createElement('small');if(node.type==='folder')info.textContent=node.indices.length+' arquivo(s)';else{const file=restoreTree.rows[node.index].file;info.textContent=bytes(file.size)+' · Modificado em: '+(file.modified_at?new Date(file.modified_at).toLocaleString('pt-BR'):'data não registrada')}row.append(info);outer.append(row);
 if(node.type==='folder'){outer.dataset.folder=node.id;restoreFolderElements.set(node.id,outer);const children=document.createElement('div');children.className='restore-children';outer.append(children);outer.addEventListener('toggle',()=>{if(!outer.isConnected||restoreTree?.nodes.get(node.id)!==node)return;if(outer.open&&renderFolderChildren(node,outer))updateRestoreSelection()})}return outer;
}
function renderFolderChildren(node,details){const children=details.querySelector(':scope > .restore-children');if(children.dataset.loaded)return false;children.dataset.loaded='true';for(const child of node.children)children.append(treeElement(child));return true}
function updateRestoreSelection(){
 if(!restoreTree||!$('restoreSelectionCount')){$('restoreSelected').disabled=true;return}for(const input of document.querySelectorAll('[data-restore-node]')){const state=selectionState(restoreTree.nodes.get(input.dataset.restoreNode),selectedRestoreFiles);input.checked=state.checked;input.indeterminate=state.indeterminate;input.disabled=restoringSelection}
 const rows=[...selectedRestoreFiles].map(i=>restoreTree.rows[i]),size=rows.reduce((sum,row)=>sum+row.file.size,0);$('restoreSelectionCount').textContent=rows.length+' arquivo(s) selecionado(s) · '+bytes(size);$('restoreSelected').disabled=restoringSelection||!rows.length;
 $('restoreFilePreview').textContent=rows.length===1?rows[0].file.path+' · '+bytes(rows[0].file.size)+' · Modificado em: '+(rows[0].file.modified_at?new Date(rows[0].file.modified_at).toLocaleString('pt-BR'):'data não registrada'):rows.length?'Pré-visualização: '+rows.length+' arquivo(s) selecionado(s), preservando sua estrutura de pastas.':'Selecione arquivos ou pastas para restaurar.';
}
$('restoreSelected').onclick=async()=>{
 if(restoringSelection||!restoreTree||!selectedRestoreFiles.size)return;const selected=[...selectedRestoreFiles].map(i=>restoreTree.rows[i]),target=$('restoreTarget').value.trim();if(selected.some(row=>row.run.storage_type!=='server')&&!target){message('Selecione o destino para receber os arquivos restaurados.');$('restoreTarget').focus();return}
 const groups=new Map();for(const row of selected){if(!groups.has(row.run.id))groups.set(row.run.id,{run:row.run,files:[]});groups.get(row.run.id).files.push(row.file)}
 restoringSelection=true;$('restoreSelected').textContent='Restaurando…';updateRestoreSelection();let completed=0;const destinations=[];
 try{for(const {run,files} of groups.values()){
  if(run.storage_type==='server'){for(const file of files)if(await restoreFile(run.id,file)===false)throw Error('Falha ao baixar o arquivo antigo.');completed++;continue}
  const queued=await api('jobs',{kind:'restore',...(run.repository_id?{repository_run:run.id}:{run:run.id}),paths:files.map(file=>file.path),target});showActivity({id:queued.id,kind:'restore',status:'queued',progress:{}});$('activityPanel').scrollIntoView({behavior:'smooth',block:'start'});message('Restauração: conjunto '+(completed+1)+' de '+groups.size+'.');
  while(true){const result=await api('jobs/'+queued.id);if(result.status==='failed')throw Error(result.error||'Falha na restauração.');if(result.status==='success'){if(result.result?.destination)destinations.push(result.result.destination);break}await new Promise(resolve=>setTimeout(resolve,1500))}completed++;
 }message('Restauração concluída: '+selected.length+' arquivo(s).'+(destinations.length?'\nDestino: '+destinations.join('\n'):''));await refresh()}
 catch(error){message('Restauração não confirmada ('+completed+'/'+groups.size+' conjuntos concluídos): '+error.message)}finally{restoringSelection=false;$('restoreSelected').textContent='Restaurar';updateRestoreSelection()}
};

let preferencesSection='general',generalSecurityValue=null,generalKeyLoading=null,generalKeyRequest=0;
function clearGeneralSecurityKey(){generalKeyRequest++;generalSecurityValue=null;generalKeyLoading=null;$('generalSecurityKey').value='';$('generalSecurityKey').type='password';$('revealGeneralKey').textContent='Mostrar chave';$('revealGeneralKey').disabled=true;$('downloadGeneralKey').disabled=true;$('generalKeyStatus').textContent=''}
function showPreferencesSection(section){preferencesSection=['general','destinations','performance','office','logs'].includes(section)?section:'general';for(const panel of document.querySelectorAll('[data-preferences-panel]'))panel.hidden=panel.dataset.preferencesPanel!==preferencesSection;for(const button of document.querySelectorAll('[data-preferences-section]'))button.setAttribute('aria-pressed',String(button.dataset.preferencesSection===preferencesSection));$('preferencesForm').hidden=!['destinations','performance'].includes(preferencesSection);if(preferencesSection!=='general')clearGeneralSecurityKey();if(preferencesSection!=='logs')clearLogPasswords();if(state){renderGeneralInformation();if(preferencesSection==='logs'&&!logsDirty)renderLogs()}}
for(const button of document.querySelectorAll('[data-preferences-section]'))button.onclick=()=>showPreferencesSection(button.dataset.preferencesSection);
function renderGeneralInformation(){
 const device=state?.devices.find(d=>d.id===$('preferencesDevice').value);$('generalComputerName').textContent=device?.name||'Nenhum computador selecionado';$('generalInstalledAt').textContent=device?.installed_at?new Date(device.installed_at).toLocaleString('pt-BR'):device?'Não registrada em versões anteriores':'—';$('generalAgentVersion').textContent=device?.version||'Aguardando contato';$('generalLastSeen').textContent=device?.last_seen?new Date(device.last_seen).toLocaleString('pt-BR'):'Aguardando contato';
 if(!device||location.hash!=='#preferences'||preferencesSection!=='general'||state.user.role!=='master'&&!(state.clientMode&&device.id===state.localDeviceId)){clearGeneralSecurityKey();return}if(generalSecurityValue?.device===device.id||generalKeyLoading===device.id)return;
 clearGeneralSecurityKey();generalKeyLoading=device.id;const request=++generalKeyRequest;api('devices/'+device.id+'/security-key',{}).then(value=>{if(request!==generalKeyRequest)return;generalSecurityValue={...value,device:device.id};$('generalSecurityKey').value=value.security_key;$('revealGeneralKey').disabled=false;$('downloadGeneralKey').disabled=false;$('generalKeyStatus').textContent='Guarde esta chave fora dos backups.'}).catch(error=>{if(request===generalKeyRequest)$('generalKeyStatus').textContent=error.message}).finally(()=>{if(request===generalKeyRequest)generalKeyLoading=null});
}
$('revealGeneralKey').onclick=()=>{const hidden=$('generalSecurityKey').type==='password';$('generalSecurityKey').type=hidden?'text':'password';$('revealGeneralKey').textContent=hidden?'Ocultar chave':'Mostrar chave'};
$('downloadGeneralKey').onclick=()=>{if(!generalSecurityValue)return;const {name,security_key}=generalSecurityValue,url=URL.createObjectURL(new Blob(['BackupDesk — '+name+'\nChave de segurança: '+security_key+'\n'],{type:'text/plain;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download='BackupDesk-Chave-'+name+'.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};


let networkLoaded='',networkDirty=false;
function clearNetworkPassword(){networkDirty=false;networkLoaded='';$('localNetworkPassword').value=''}
function renderNetworkCredentials(){const device=$('preferencesDevice').value,value=state?.networkCredentials?.[device]||{username:'',configured:false},key=device+JSON.stringify(value);if(networkDirty||networkLoaded===key)return;networkLoaded=key;$('localNetworkUsername').value=value.username||'';$('localNetworkPassword').value='';$('networkCredentialStatus').textContent=value.configured?'Credenciais cadastradas. Senha em branco mantém a senha salva.':'Opcional: deixe o usuário vazio para usar o acesso disponível no Windows.'}

let logsLoaded='',logsDirty=false,savingLogs=false;const logCredentialDirty=new Set();
function clearLogPasswords(){logsDirty=false;logsLoaded='';logCredentialDirty.clear();for(const kind of ['local','cloud'])$('log-'+kind+'-password').value=''}
function renderLogs(force=false){const device=$('preferencesDevice').value,config=state?.logPreferences?.[device]||{local:{path:'',master_path:'',network:{}},cloud:{path:'',master_path:'',network:{}}},key=device+JSON.stringify(config);for(const kind of ['local','cloud']){const entry=config[kind],write=entry.access?.write,read=entry.access?.read;$('log-'+kind+'-status').textContent=[write?'Gravação: '+(write.status==='success'?'OK':'falhou')+' · '+new Date(write.at).toLocaleString('pt-BR'):entry.path&&!['0.19.0','0.20.0','0.21.0','0.22.0','0.23.0','0.24.0'].includes(state.devices.find(d=>d.id===device)?.version)?'Atualize o client para 0.24.0 para gravar logs.':'Gravação: aguardando o agente.',read?'Leitura no master: '+(read.status==='success'?'OK':read.error||'falhou')+' · '+new Date(read.at).toLocaleString('pt-BR'):'Leitura no master: aguardando.'].join(' | ')}if(!force&&(logsDirty||logsLoaded===key))return;logsLoaded=key;for(const kind of ['local','cloud']){const entry=config[kind];$('log-'+kind+'-path').value=entry.path||'';$('log-'+kind+'-master').value=entry.master_path||'';$('log-'+kind+'-username').value=entry.network?.username||'';$('log-'+kind+'-password').value=''}}
$('logsForm').oninput=event=>{logsDirty=true;for(const kind of ['local','cloud'])if(['log-'+kind+'-username','log-'+kind+'-password'].includes(event.target.id))logCredentialDirty.add(kind)};
for(const button of document.querySelectorAll('[data-log-pick]'))button.onclick=async()=>{if($('preferencesDevice').value!==state.localDeviceId)return message('Informe a pasta acessível no computador selecionado.');try{const result=await api('pick-folder',{purpose:'destination'});if(!result.cancelled){$('log-'+button.dataset.logPick+'-path').value=result.path;logsDirty=true}}catch(e){message(e)}};
$('logsForm').onsubmit=async event=>{event.preventDefault();if(savingLogs)return;savingLogs=true;$('saveLogs').disabled=true;try{const value={};for(const kind of ['local','cloud']){value[kind]={path:$('log-'+kind+'-path').value.trim(),master_path:$('log-'+kind+'-master').value.trim()};if(logCredentialDirty.has(kind))value[kind].network_credentials={username:$('log-'+kind+'-username').value.trim(),password:$('log-'+kind+'-password').value}}await api('devices/'+$('preferencesDevice').value+'/logs',value);clearLogPasswords();await refresh();renderLogs(true);message('Logs salvos. O agente gravará nas duas pastas e o master atualizará a Visão Geral pela leitura dos arquivos.')}catch(e){message(e)}finally{savingLogs=false;$('saveLogs').disabled=false}};
$('refreshLogs').onclick=async()=>{try{await api('logs/refresh',{});message('Leitura dos logs solicitada ao master.')}catch(e){message(e)}};
showPreferencesSection('general');

let overviewResultStatus=null;
function openOverviewResults(status){overviewResultStatus=status;renderOverviewResults();$('overviewResults').showModal()}
function renderOverviewResults(){if(!overviewResultStatus||!state)return;const records=recentResults(state,overviewResultStatus);$('overviewResultsTitle').textContent=overviewResultStatus==='success'?'Backups Concluídos':'Falhas Registradas';$('overviewResultsList').innerHTML=records.map((r,index)=>`<div class="item"><b>${esc(state.devices.find(d=>d.id===r.device)?.name||'Computador')}</b> · ${esc(r.routine_name||'Backup')}<br>${new Date(r.finished||r.started).toLocaleString('pt-BR')} · ${megabytes(r.bytes)} · <span class="${r.status}">${r.status==='success'?'Concluído':'Falha'}</span> ${r.read?'<small>Lido</small>':'<button type="button" data-read-result="'+index+'">Marcar como lido</button>'}${r.status==='failed'?'<p class="failed">'+esc(r.error||'Falha registrada pelo computador.')+'</p>':''}</div>`).join('')||'<p>Nenhum resultado nos últimos 30 dias.</p>';for(const button of $('overviewResultsList').querySelectorAll('[data-read-result]'))button.onclick=async()=>{button.disabled=true;const r=records[Number(button.dataset.readResult)];try{await api('overview/read',{device:r.device,id:r.id,status:r.status,completed:r.finished||r.started});await refresh()}catch(e){message(e);button.disabled=false}}}
$('closeOverviewResults').onclick=()=>{$('overviewResults').close();overviewResultStatus=null};$('overviewResults').addEventListener('cancel',()=>overviewResultStatus=null);
