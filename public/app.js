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
 $('saveRoutine').disabled=savingRoutine||!state?.devices.length;$('saveRoutine').textContent=savingRoutine?'Salvando…':editingRoutine?'Salvar alterações':'Salvar rotina';
 $('routineTitle').textContent=editingRoutine?'Editar rotina':'Nova rotina';$('cancelEdit').hidden=!editingRoutine;$('newRoutine').disabled=savingRoutine;
 document.querySelectorAll('[data-edit]').forEach(b=>b.disabled=savingRoutine);$('cancelEdit').disabled=savingRoutine;
 $('routineForm').setAttribute('aria-busy',String(savingRoutine));
}
function newRoutine(){if(savingRoutine)return;const device=$('deviceOptions').value;$('routineForm').reset();if(state?.devices.some(d=>d.id===device))$('deviceOptions').value=device;editingRoutine=null;updateRoutineFormState();$('routineForm').elements.name.focus()}
$('newRoutine').onclick=newRoutine;
const now=new Date();$('month').value=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0');$('month').onchange=calendar;
function calendar(){const [y,m]=$('month').value.split('-').map(Number);if(!y||!m)return;const days=new Date(y,m,0).getDate(),offset=new Date(y,m-1,1).getDay();$('calendar').innerHTML=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d=>'<b>'+d+'</b>').join('')+'<div></div>'.repeat(offset)+Array.from({length:days},(_,i)=>{const runs=state.runs.filter(r=>{const d=new Date(r.started);return d.getFullYear()===y&&d.getMonth()===m-1&&d.getDate()===i+1});return `<div class="day">${i+1}<br>${['success','failed','running'].map(s=>runs.some(r=>r.status===s)?`<span class="${s}" title="${s}">● </span>`:'').join('')}</div>`}).join('')}
async function refresh(){state=await api('state');$('login').hidden=true;$('dashboard').hidden=false;$('logout').hidden=!!state.user.localOnly;document.querySelectorAll('.master').forEach(e=>e.hidden=state.user.role!=='master');$('stats').innerHTML=[['Computadores',state.devices.length],['Backups concluídos',state.runs.filter(r=>r.status==='success').length],['Falhas registradas',state.runs.filter(r=>r.status==='failed').length]].map(([k,v])=>`<article>${k}<strong>${v}</strong></article>`).join('');const selectedDevice=$('deviceOptions').value;$('deviceOptions').innerHTML=(state.devices.length?'':'<option value="">Instale um client para começar</option>')+state.devices.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');if(state.devices.some(d=>d.id===selectedDevice))$('deviceOptions').value=selectedDevice;$('saveRoutine').disabled=savingRoutine||!state.devices.length;$('browseFiles').disabled=picking||!state.devices.length;renderRoutines();renderHistory();equipment();calendar();renderRestore();renderPreferences();renderOffice();updateRoutineFormState()}
async function download(path,name){try{const r=await fetch('/api/'+path,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('Falha no download');const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){message(e)}}openPanel();setInterval(()=>{if(token)refresh().catch(message)},5000);

function equipment(){const showOffice=state.devices.some(d=>state.office?.[d.id]?.enabled)||state.runs.some(r=>r.office_status==='confirmed'||r.office_status==='queued');$('officeColumn').hidden=!showOffice;const filter=$('search').value.toLowerCase();const labels={success:'Concluído',failed:'Falha',running:'Em execução'};const localDate=d=>[d.getFullYear(),d.getMonth(),d.getDate()].join('-');$('equipmentRows').innerHTML=state.devices.filter(d=>d.name.toLowerCase().includes(filter)).map(d=>{const report=state.reports?.find(r=>r.device===d.id),runs=state.runs.filter(r=>r.device===d.id),last=runs[0],success=runs.find(r=>r.status==='success');const bars=Array.from({length:28},(_,i)=>{const day=new Date();day.setDate(day.getDate()-27+i);const rs=runs.filter(r=>localDate(new Date(r.started))===localDate(day));const status=rs.some(r=>r.status==='failed')?'failed':rs.some(r=>r.status==='running')?'running':rs.length?'success':'none';return `<span class="bar ${status}" title="${day.toLocaleDateString('pt-BR')}: ${labels[status]||'Sem execução'}"></span>`}).join('');return `<tr><td><b>${esc(d.name)}</b><br><small>Agente: ${esc(d.version||'aguardando contato')}</small></td><td class="${last?.status||''}">${labels[last?.status]||'Sem backup'}</td><td><div class="bars">${bars}</div></td><td>${success?new Date(success.finished).toLocaleString('pt-BR'):'—'}</td><td>${last?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(last.bytes/1048576)+' MiB':'—'}</td><td>${report?(report.online?'Online':'Sem contato há mais de 5 min'):'Aguardando relatório'}</td>${showOffice?`<td>${esc(officeLabel(computerOfficeStatus(d,last,report)))}</td>`:''}</tr>`}).join('')||'<tr><td colspan="7">Nenhum equipamento encontrado.</td></tr>'}
$('search').oninput=()=>{if(state)equipment()};

$('downloadClient').onclick=()=>{$('clientDownloadError').textContent='';const origin=new URL(location.origin),address=state.publicUrl||(origin.protocol==='https:'?origin.origin:'');if(address)$('clientMasterUrl').value=address;$('clientConnection').hidden=!!address;$('clientDownload').showModal();$('clientComputerName').focus()};
$('closeClientDownload').onclick=()=>$('clientDownload').close();
let downloadingClient=false;
$('clientDownloadForm').onsubmit=async event=>{
 event.preventDefault();if(downloadingClient)return;downloadingClient=true;const button=$('generateNamedClient');button.disabled=true;button.textContent='Gerando…';$('clientDownloadError').textContent='';
 try{const name=$('clientComputerName').value.trim();const response=await fetch('/api/download/client',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({name,url:$('clientMasterUrl').value.trim()||null})});if(!response.ok)throw Error((await response.json()).error||'Falha ao gerar o client.');const disposition=response.headers.get('Content-Disposition')||'',encoded=disposition.match(/filename\*=UTF-8''([^;]+)/i),filename=encoded?decodeURIComponent(encoded[1]):'BackupDesk-Client-'+name+'.exe',url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('clientDownload').close();message('Instalador preparado para '+name+'.');await refresh()}
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


function showPage(page){if(!['overview','backup','restore','preferences'].includes(page))page='overview';document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!=='page-'+page);document.querySelectorAll('[data-page]').forEach(a=>a.classList.toggle('active',a.dataset.page===page))}
window.addEventListener('hashchange',()=>showPage(location.hash.slice(1)));showPage(location.hash.slice(1));

function bytes(value){return new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(Number(value||0)/1048576)+' MiB'}
function backupLabel(run){return run.backup_type==='differential'?'Diferencial':'Completo'}
function operationalWarning(warning){return /^PST requer validação de recuperação no Outlook; VSS sem writers não garante consistência da aplicação\.?$/i.test(warning||'')?'':warning||''}
function validationDetails(run){
 let pst=null;try{pst=typeof run.pst_validation==='string'?JSON.parse(run.pst_validation):run.pst_validation}catch{}
 const legacy=!!run.warning&&!operationalWarning(run.warning);
 if(!pst&&!legacy)return '';
 return '<details class="validation"><summary>Verificação do PST</summary><small>Integridade da cópia verificada por SHA-256. A abertura do PST no Outlook não foi testada. VSS permite copiar arquivos abertos, mas não verifica a estrutura interna do PST.</small></details>';
}
function renderHistory(){
 $('runs').innerHTML=state.runs.slice(0,10).map(r=>`<div class="item"><span class="${r.status}">${({success:'Concluído',failed:'Falha',running:'Em execução'})[r.status]}</span> · ${esc(state.devices.find(d=>d.id===r.device)?.name)} · ${new Date(r.started).toLocaleString('pt-BR')} · ${backupLabel(r)} · ${r.encryption_id?'Criptografado · ':''}${bytes(r.bytes)} gravados${r.office_status&&r.office_status!=='not-configured'?' · Escritório: '+officeLabel(r.office_status):''} <button data-run="${r.id}" ${r.status==='success'?'':'disabled'}>Ver arquivos</button>${r.error||operationalWarning(r.warning)?'<p class="failed">'+esc(r.error||operationalWarning(r.warning))+'</p>':''}${r.status==='success'?validationDetails(r):''}</div>`).join('')||'Nenhuma execução registrada.';
 document.querySelectorAll('[data-run]').forEach(b=>b.onclick=()=>{const run=state.runs.find(r=>r.id===b.dataset.run);$('restoreDevice').value=run.device;renderRestore();$('restoreScope').value=restoreScopeKey(run);selectRestorePoint(run);$('restorePoint').scrollIntoView({behavior:'smooth',block:'center'})});
}
let restoreLoaded='';
const dateValue=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
function normalizedLocation(value){const path=String(value||'').replace(/[\\/]+$/,'');return /^(?:[a-z]:|\\)/i.test(path)?path.replaceAll('/',String.fromCharCode(92)).toLowerCase():path}
const restoreScopeKey=r=>normalizedLocation(r.backup_destination||r.scope_destination)||'unknown:'+r.routine_id;
function restoreSourceKey(run){const origin=run.original_device||run.device;try{const sources=JSON.parse(run.scope_sources);if(!sources.length)throw Error();return JSON.stringify([origin,sources.map(normalizedLocation).sort()])}catch{return origin+':'+(run.scope_key||'legacy:'+run.routine_id)}}
let restoreSelection=[];
function restorableRuns(){return [...state.runs,...(state.repositoryRuns||[])]}
function deviceRestoreRuns(){return restorableRuns().filter(r=>r.device===$('restoreDevice').value&&r.status==='success').sort((a,b)=>Date.parse(b.finished)-Date.parse(a.finished))}
function scopeRestoreRuns(){return deviceRestoreRuns().filter(r=>restoreScopeKey(r)===$('restoreScope').value)}
function renderRestore(){
 const previous=$('restoreDevice').value;$('restoreDevice').innerHTML=state.devices.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');if(state.devices.some(d=>d.id===previous))$('restoreDevice').value=previous;
 const selected=$('restoreScope').value,groups=new Map();for(const r of deviceRestoreRuns())if(!groups.has(restoreScopeKey(r)))groups.set(restoreScopeKey(r),r);
 $('restoreScope').innerHTML=[...groups].map(([key,r])=>`<option value="${esc(key)}">${esc(r.backup_destination||r.scope_destination||'Local não registrado')}</option>`).join('');if(groups.has(selected))$('restoreScope').value=selected;
 if(!$('restoreDate').value){const latest=scopeRestoreRuns()[0];const date=latest?new Date(latest.finished):new Date();$('restoreDate').value=dateValue(date);$('restoreMonth').value=dateValue(date).slice(0,7)}
 renderRestoreCalendar();updateRestoreRuns();
}
function renderRestoreCalendar(){
 const [y,m]=$('restoreMonth').value.split('-').map(Number);if(!y||!m)return;const offset=new Date(y,m-1,1).getDay(),days=new Date(y,m,0).getDate(),runs=scopeRestoreRuns();
 $('restoreCalendar').innerHTML=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d=>'<b>'+d+'</b>').join('')+'<div></div>'.repeat(offset)+Array.from({length:days},(_,i)=>{const value=dateValue(new Date(y,m-1,i+1)),count=runs.filter(r=>dateValue(new Date(r.finished))===value).length;return `<button type="button" class="day ${value===$('restoreDate').value?'selected':''}" data-restore-day="${value}" aria-pressed="${value===$('restoreDate').value}" aria-label="${value}, ${count} backup(s)">${i+1}${count?'<span class="success"> ●</span>':''}</button>`}).join('');
 document.querySelectorAll('[data-restore-day]').forEach(b=>b.onclick=()=>{$('restoreDate').value=b.dataset.restoreDay;renderRestoreCalendar();updateRestoreRuns()});
}
function selectRestorePoint(run){const date=new Date(run.finished);$('restoreDate').value=dateValue(date);$('restoreMonth').value=dateValue(date).slice(0,7);$('restoreTime').value=[date.getHours(),date.getMinutes(),date.getSeconds()].map(n=>String(n).padStart(2,'0')).join(':');renderRestoreCalendar();updateRestoreRuns()}
function updateRestoreRuns(){
 const asOf=new Date($('restoreDate').value+'T'+(($('restoreTime').value||'23:59:59').length===5?$('restoreTime').value+':00':$('restoreTime').value||'23:59:59')+'.999').getTime(),points=new Map();
 for(const run of scopeRestoreRuns()){const source=restoreSourceKey(run);if(Date.parse(run.finished)<=asOf&&!points.has(source))points.set(source,run)}
 restoreSelection=[...points.values()];const run=restoreSelection[0];
 $('restoreRun').innerHTML=restoreSelection.map(r=>`<option value="${r.id}">${esc(r.finished)}</option>`).join('');
 $('restoreValidation').innerHTML=restoreSelection.map(validationDetails).find(Boolean)||'';
 if(!run){$('restorePoint').textContent='Nenhum backup concluído até a data e o horário selecionados.';$('restoreFiles').textContent='';restoreLoaded='';return}
 $('restorePoint').textContent=(restoreSelection.length>1?restoreSelection.length+' conjuntos · Última versão: ':'Versão disponível: ')+new Date(run.finished).toLocaleString('pt-BR')+' · '+(restoreSelection.length===1?backupLabel(run)+' · ':'')+bytes(restoreSelection.reduce((n,r)=>n+(r.logical_bytes??r.bytes??0),0))+' em arquivos.';
 if(restoreLoaded!==restoreSelection.map(r=>r.id).join(','))loadRestoreFiles();
}
async function loadRestoreFiles(){
 const selection=[...restoreSelection],key=selection.map(r=>r.id).join(',');restoreLoaded=key;$('restoreFiles').textContent='Carregando arquivos…';
 try{const sets=await Promise.all(selection.map(async run=>({run,files:await api((run.repository_id?'repository-runs/':'runs/')+run.id+'/files')})));if(restoreSelection.map(r=>r.id).join(',')!==key)return;
  const rows=sets.flatMap(({run,files})=>files.map(file=>({run,file})));$('restoreFiles').innerHTML=rows.map(({run,file},i)=>`<div class="item">${esc(file.path)} · ${bytes(file.size)} · Modificado em: ${file.modified_at?esc(new Date(file.modified_at).toLocaleString('pt-BR')):'data não registrada'} <button data-restore="${i}">Restaurar arquivo</button>${sets.length>1?'<br><small>'+esc([run.source_device_name,displaySources(run.scope_sources)||run.routine_name||'Backup anterior'].filter(Boolean).join(' · '))+'</small>':''}</div>`).join('')||'Esta versão não contém arquivos.';
  document.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>{const {run,file}=rows[b.dataset.restore];return restoreFile(run.id,file)});
 }catch(e){if(restoreSelection.map(r=>r.id).join(',')===key){restoreLoaded='';$('restoreFiles').textContent=e.message}}
}
$('restoreDevice').onchange=()=>{restoreLoaded='';$('restoreDate').value='';renderRestore()};
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
async function startJob(payload,label){showActivity({kind:payload.kind,status:'queued',progress:{}});$('activityPanel').scrollIntoView({behavior:'smooth',block:'start'});try{const {id}=await api('jobs',payload);message(label+': aguardando o agente…');async function poll(){try{const j=await api('jobs/'+id);if(j.status==='success'){let details='';if(j.result?.destination)details=' Pasta: '+j.result.destination;if(j.result?.backup_type)details=' '+backupLabel(j.result)+' · '+j.result.changed_files+' arquivo(s) gravado(s) · '+bytes(j.result.stored_bytes)+'.';if(operationalWarning(j.result?.warning))details+=' '+operationalWarning(j.result.warning);if(j.result?.total_destinations)details+=' '+j.result.completed_destinations+'/'+j.result.total_destinations+' destinos concluídos.';if(j.result?.runs)details=' '+j.result.runs+' versões · '+j.result.files+' arquivos no catálogo.';if(j.result?.availableBytes)details+=' Espaço disponível: '+(Number(j.result.availableBytes)/1073741824).toFixed(1)+' GB';message(label+(['Restauração','Verificação do destino'].includes(label)?' concluída.':' concluído.')+details);await refresh();if(payload.kind==='catalog'&&j.result?.root){$('restoreScope').value=normalizedLocation(j.result.root);$('restoreScope').dispatchEvent(new Event('change'))}}else if(j.status==='failed'){message(label+' falhou: '+j.error);await refresh()}else setTimeout(poll,2000)}catch(e){message(e)}}poll()}catch(e){showActivity({kind:payload.kind,status:'failed',error:e.message});message(e)}}
async function restoreFile(runId,file){const run=restorableRuns().find(r=>r.id===runId);if(run&&run.storage_type!=='server'){if(!$('restoreTarget').value){location.hash='restore';return message('Selecione a pasta para receber os arquivos restaurados.')}return startJob({kind:'restore',...(run.repository_id?{repository_run:runId}:{run:runId}),path:file.path,target:$('restoreTarget').value},'Restauração')}return download('runs/'+runId+'/files?path='+encodeURIComponent(file.path),file.path.split('/').pop())}



const stages={cataloging:'Localizando versões no repositório',checking_base:'Verificando backup completo',comparing:'Comparando arquivos com o completo',preparing:'Preparando',scanning:'Localizando arquivos',checking_destination:'Verificando destino e espaço',vss_prepare:'Preparando VSS',vss_snapshot:'Criando snapshot VSS',vss_cleanup:'Limpando snapshots VSS',copying:'Copiando arquivos',verifying:'Verificando integridade',finalizing:'Finalizando'};
let activityBusy=false,lastActivity=null;
let renderedActivityKey=null;
function activityKey(item){return [item.id||item.created||'request',item.status,item.finished||''].join('|')}
$('dismissActivity').onclick=()=>{if(!lastActivity||['queued','running'].includes(lastActivity.status))return;sessionStorage.setItem('dismissedActivity',activityKey(lastActivity));$('activityPanel').hidden=true};
function showActivity(item){
 lastActivity=item;const panel=$('activityPanel'),key=activityKey(item),active=['queued','running'].includes(item.status);
 if(!active&&sessionStorage.getItem('dismissedActivity')===key){panel.hidden=true;return}
 const routine=state?.routines.find(r=>r.id===Number(item.routine_id));const cancelled=item.status==='failed'&&/^(Cópia idêntica da rotina removida antes da execução|Rotina desativada ou excluída antes da execução)$/.test(item.error||'');const historical=legacyVssFailure(item)&&!!routine&&/Esta rotina está sem VSS|Feche o Outlook antes de copiar PST/.test(item.error||'');
 panel.hidden=false;panel.dataset.status=cancelled?'cancelled':historical?'historical':item.status;$('dismissActivity').hidden=active;
 if(renderedActivityKey!==key){$('activityDetails').open=active||item.status==='failed'&&!historical&&!cancelled;renderedActivityKey=key}
 const p=item.progress||{},label={backup:'Backup',restore:'Restauração',validate:'Teste do destino',catalog:'Leitura do repositório'}[item.kind]||'Operação';
 $('activityTitle').textContent=label+' · '+(cancelled?'Solicitação cancelada':historical?'Falha anterior — nova execução necessária':({queued:'Aguardando o agente',running:stages[p.stage]||'Em execução',success:item.office_status==='queued'?'Local concluído · escritório pendente':item.office_status==='confirmed'?'Local e escritório concluídos':operationalWarning(item.warning)?'Concluído — verificar observação':'Concluído',failed:'Falhou'})[item.status])+(p.destinationCount>1?' · Destino '+p.destinationIndex+' de '+p.destinationCount:'')+(item.name?' · '+item.name:'');
 $('activitySummary').textContent=active?'Ver detalhes do andamento':cancelled?'Ver detalhes do cancelamento':historical?'Ver detalhes da tentativa anterior':item.status==='failed'?'Ver erro e opções':'Ver resultado';
 $('activityDetail').textContent=historical?'A tentativa registrada falhou sem VSS. A rotina agora está com VSS ativado; somente um novo backup poderá confirmar o funcionamento.':item.error||operationalWarning(item.warning)||[item.device_name,p.currentFile].filter(Boolean).join(' · ');
 const bar=$('activityBar');if(item.status==='success')bar.value=100;else if(p.totalBytes>0)bar.value=Math.min(100,100*(p.processedBytes||0)/p.totalBytes);else bar.removeAttribute('value');
 $('activityCount').textContent=(p.totalBytes>0?((p.processedBytes||0)/1048576).toFixed(1)+' / '+(p.totalBytes/1048576).toFixed(1)+' MiB processados (cópia e verificação). ':'')+(p.totalFiles!==null&&p.totalFiles!==undefined?(p.filesDone||0)+' / '+p.totalFiles+' arquivos. ':'')+(item.status==='queued'?'O agente precisa estar conectado.':item.status==='running'&&Date.now()-Date.parse(item.updated||item.created)>15000?'Aguardando atualização do agente…':'');renderPstAction();
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
function collectPreferences(){const factor=Number($('bandwidthUnit').value)||1;return {destinations:[...document.querySelectorAll('[data-preference-destination]')].map(row=>({path:row.querySelector('input').value.trim(),type:row.querySelector('select').value})),bandwidth:{enabled:$('limitBandwidth').checked,start:$('bandwidthStart').value,end:$('bandwidthEnd').value,upload_mbps:$('uploadLimit').value===''?null:Number($('uploadLimit').value)*factor,download_mbps:$('downloadLimit').value===''?null:Number($('downloadLimit').value)*factor}}}
function renderPreferences(force=false){
 const previous=$('preferencesDevice').value;$('preferencesDevice').innerHTML=state.devices.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');if(state.devices.some(d=>d.id===previous))$('preferencesDevice').value=previous;const device=$('preferencesDevice').value;if(!device)return;
 const value=preferenceDrafts.get(device)||state.preferences?.[device]||{destinations:[],bandwidth:{enabled:false,start:'00:00',end:'00:00',upload_mbps:50,download_mbps:null}},key=device+JSON.stringify(value);if(!force&&preferencesLoaded===key)return;preferencesLoaded=key;
 $('preferenceDestinations').innerHTML=value.destinations.map((d,i)=>`<div class="preference-destination" data-preference-destination="${i}"><select aria-label="Tipo do destino"><option value="local">Pasta local</option><option value="external">HD externo / USB</option><option value="network">Unidade de rede / NAS</option></select><input aria-label="Pasta de destino" value="${esc(d.path)}" placeholder="Pasta onde salvar as cópias"><button type="button" data-browse-preference="${i}">Selecionar pasta…</button><button type="button" data-remove-preference="${i}">Remover</button></div>`).join('')||'<p class="muted">Nenhum destino configurado.</p>';
 document.querySelectorAll('[data-preference-destination]').forEach((row,i)=>row.querySelector('select').value=value.destinations[i].type);
 const b=value.bandwidth;$('limitBandwidth').checked=b.enabled;$('bandwidthStart').value=b.start;$('bandwidthEnd').value=b.end;$('bandwidthUnit').value='1';$('uploadLimit').value=b.upload_mbps??'';$('downloadLimit').value=b.download_mbps??'';
 document.querySelectorAll('[data-remove-preference]').forEach(button=>button.onclick=()=>{const draft=collectPreferences();draft.destinations.splice(Number(button.dataset.removePreference),1);preferenceDrafts.set(device,draft);renderPreferences(true)});
 document.querySelectorAll('[data-browse-preference]').forEach(button=>button.onclick=async()=>{if(device!==state.localDeviceId)return message('Informe o caminho acessível no computador selecionado.');try{const picked=await api('pick-folder',{purpose:'destination'});if(!picked.cancelled){const draft=collectPreferences();draft.destinations[button.dataset.browsePreference].path=picked.path;preferenceDrafts.set(device,draft);renderPreferences(true)}}catch(e){message(e)}});
}
$('preferencesDevice').onchange=()=>{renderPreferences(true);renderOffice(true)};
$('preferencesForm').oninput=()=>{preferenceDrafts.set($('preferencesDevice').value,collectPreferences());preferencesLoaded=$('preferencesDevice').value+JSON.stringify(collectPreferences())};
$('addPreferenceDestination').onclick=()=>{const device=$('preferencesDevice').value;if(!device)return;const draft=collectPreferences();draft.destinations.push({path:'',type:'local'});preferenceDrafts.set(device,draft);renderPreferences(true)};
$('preferencesForm').onsubmit=async event=>{event.preventDefault();if(savingPreferences)return;savingPreferences=true;$('savePreferences').disabled=true;try{const device=$('preferencesDevice').value;await api('devices/'+device+'/preferences',collectPreferences());preferenceDrafts.delete(device);await refresh();renderPreferences(true);message('Preferências salvas para todas as rotinas deste computador.')}catch(e){message(e)}finally{savingPreferences=false;$('savePreferences').disabled=false}};
$('openRepository').onclick=()=>$('repositoryPicker').showModal();$('closeRepositoryPicker').onclick=()=>$('repositoryPicker').close();
$('chooseRepository').onclick=async()=>{if($('restoreDevice').value!==state.localDeviceId)return message('Informe o caminho da pasta no computador selecionado.');try{const picked=await api('pick-folder',{purpose:'repository'});if(!picked.cancelled)$('repositoryPath').value=picked.path}catch(e){message(e)}};
$('repositoryForm').onsubmit=async event=>{event.preventDefault();$('repositoryPicker').close();await startJob({kind:'catalog',device:$('restoreDevice').value,source:$('repositoryPath').value.trim()},'Leitura do repositório')};

function computerOfficeStatus(device,last,report){if(!state.office?.[device.id]?.enabled)return 'not-configured';if(!last)return 'waiting';if(last.status==='failed')return 'local-failed';if(last.office_status==='confirmed')return 'confirmed';if(report?.office_status==='failed')return 'failed';return report?.office_status==='uploading'?'uploading':'queued'}
function officeLabel(status){return ({'not-configured':'Não configurado',waiting:'Aguardando backup','local-failed':'Cópia local falhou',queued:'Pendente',uploading:'Enviando',confirmed:'Confirmado',failed:'Falha no envio'})[status]||'Pendente'}
let officeLoaded='',officeDirty=false;
function renderOffice(force=false){const device=$('preferencesDevice').value;if(!device)return;const value=state.office?.[device]||{enabled:false,url:null},key=device+JSON.stringify(value);if(!force&&(officeLoaded===key||officeDirty))return;officeLoaded=key;officeDirty=false;$('officeDeviceId').textContent=device;$('officeEnabled').checked=!!value.enabled;$('officeUrl').value=value.url||'';$('officeToken').value='';$('officeStatus').textContent=value.configured?'Credencial cadastrada para este computador.':'Conexão ainda não configurada.'}
$('officeForm').oninput=()=>{officeDirty=true};
$('officeForm').onsubmit=async event=>{event.preventDefault();$('saveOffice').disabled=true;try{const device=$('preferencesDevice').value;await api('devices/'+device+'/office',{enabled:$('officeEnabled').checked,url:$('officeUrl').value.trim()||null,token:$('officeToken').value.trim()||null});officeDirty=false;await refresh();renderOffice(true);message('Conexão do escritório salva. Os envios serão confirmados separadamente das cópias locais.')}catch(e){message(e)}finally{$('saveOffice').disabled=false}};
$('recoveryExportForm').onsubmit=async event=>{event.preventDefault();try{const document=await api('security/recovery/export',{admin_password:$('masterRecoveryAuthPassword').value,password:$('recoveryPassword').value});const url=URL.createObjectURL(new Blob([JSON.stringify(document,null,2)],{type:'application/json'})),link=window.document.createElement('a');link.href=url;link.download='BackupDesk-Master-Recovery.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('recoveryPassword').value='';$('masterRecoveryAuthPassword').value='';message('Arquivo de recuperação gerado. Guarde uma cópia separada e a senha em local seguro.')}catch(e){message(e)}};
$('recoveryImportForm').onsubmit=async event=>{event.preventDefault();try{const file=$('recoveryFile').files[0];if(!file||file.size>1024*1024)throw Error('Selecione um arquivo de recuperação válido.');await api('security/recovery/import',{admin_password:$('masterRecoveryAuthPassword').value,document:JSON.parse(await file.text()),password:$('recoveryImportPassword').value});$('recoveryImportPassword').value='';$('masterRecoveryAuthPassword').value='';message('Chave de recuperação importada. Você pode carregar o repositório na aba Restauração.')}catch(e){message(e)}};

$('authorizeMasterRecovery').onclick=async()=>{try{await api('security/key-access',{password:$('masterRecoveryAuthPassword').value});$('masterRecoveryAuthPassword').value='';message('Recuperação master autorizada por 15 minutos. Você pode carregar o repositório de outro computador.')}catch(e){message(e)}};
