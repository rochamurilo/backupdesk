import {cadenceLabels} from '/schedule.mjs';
let token=sessionStorage.getItem('token'),state;const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));async function api(path,data,method){const r=await fetch('/api/'+path,{method:method||(data?'POST':'GET'),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const b=await r.json();if(!r.ok)throw Error(b.error);return b}function message(e){$('message').textContent=e.message||e}function bind(id,fn){$(id).onsubmit=async e=>{e.preventDefault();try{await fn(Object.fromEntries(new FormData(e.target)));$('message').textContent='';}catch(e){message(e)}}}bind('loginForm',async b=>{const r=await api('login',b);token=r.token;sessionStorage.setItem('token',token);await refresh()});$('logout').onclick=()=>{sessionStorage.removeItem('token');location.reload()};bind('userForm',async b=>{await api('users',b);$('userForm').reset();await refresh()});let editingRoutine=null,savingRoutine=false;
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
async function refresh(){state=await api('state');$('login').hidden=true;$('dashboard').hidden=false;$('logout').hidden=!!state.user.localOnly;document.querySelectorAll('.master').forEach(e=>e.hidden=state.user.role!=='master');$('stats').innerHTML=[['Computadores',state.devices.length],['Backups concluídos',state.runs.filter(r=>r.status==='success').length],['Falhas registradas',state.runs.filter(r=>r.status==='failed').length]].map(([k,v])=>`<article>${k}<strong>${v}</strong></article>`).join('');const selectedDevice=$('deviceOptions').value;$('deviceOptions').innerHTML=(state.devices.length?'':'<option value="">Cadastre um computador primeiro</option>')+state.devices.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');if(state.devices.some(d=>d.id===selectedDevice))$('deviceOptions').value=selectedDevice;$('saveRoutine').disabled=savingRoutine||!state.devices.length;$('browseFiles').disabled=picking||!state.devices.length;renderRoutines();$('runs').innerHTML=state.runs.map(r=>`<div class="item"><span class="${r.status}">${({success:'Concluído',failed:'Falha',running:'Em execução'})[r.status]}</span> · ${esc(state.devices.find(d=>d.id===r.device)?.name)} · ${new Date(r.started).toLocaleString('pt-BR')} · ${r.bytes} bytes <button data-run="${r.id}">Ver arquivos</button><br><small>${esc(r.error)} ${esc(r.warning||'')}</small></div>`).join('')||'Nenhuma execução registrada.';document.querySelectorAll('[data-run]').forEach(b=>b.onclick=async()=>{try{const files=await api('runs/'+b.dataset.run+'/files');$('files').innerHTML=files.map((f,i)=>`<div class="item">${esc(f.path)} · ${f.size} bytes <button data-file="${i}">Restaurar arquivo</button></div>`).join('')||'Sem arquivos';document.querySelectorAll('[data-file]').forEach(btn=>btn.onclick=()=>restoreFile(b.dataset.run,files[btn.dataset.file]))}catch(e){message(e)}});equipment();calendar();renderRestore();updateRoutineFormState()}
async function download(path,name){try{const r=await fetch('/api/'+path,{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('Falha no download');const url=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}catch(e){message(e)}}openPanel();setInterval(()=>{if(token)refresh().catch(message)},30000);

function equipment(){const filter=$('search').value.toLowerCase();const labels={success:'Concluído',failed:'Falha',running:'Em execução'};const localDate=d=>[d.getFullYear(),d.getMonth(),d.getDate()].join('-');$('equipmentRows').innerHTML=state.devices.filter(d=>d.name.toLowerCase().includes(filter)).map(d=>{const runs=state.runs.filter(r=>r.device===d.id),last=runs[0],success=runs.find(r=>r.status==='success');const bars=Array.from({length:28},(_,i)=>{const day=new Date();day.setDate(day.getDate()-27+i);const rs=runs.filter(r=>localDate(new Date(r.started))===localDate(day));const status=rs.some(r=>r.status==='failed')?'failed':rs.some(r=>r.status==='running')?'running':rs.length?'success':'none';return `<span class="bar ${status}" title="${day.toLocaleDateString('pt-BR')}: ${labels[status]||'Sem execução'}"></span>`}).join('');return `<tr><td><b>${esc(d.name)}</b><br><small>Agente: ${esc(d.version||'aguardando contato')}</small></td><td class="${last?.status||''}">${last?.warning?'Cópia VSS — validar PST':labels[last?.status]||'Sem backup'}</td><td><div class="bars">${bars}</div></td><td>${success?new Date(success.finished).toLocaleString('pt-BR'):'—'}</td><td>${last?new Intl.NumberFormat('pt-BR',{maximumFractionDigits:2}).format(last.bytes/1048576)+' MiB':'—'}</td></tr>`}).join('')||'<tr><td colspan="5">Nenhum equipamento encontrado.</td></tr>'}
$('search').oninput=()=>{if(state)equipment()};

$('downloadClient').onclick=()=>download('download/client','BackupDesk-Client-0.8.3-x64.exe');

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


function showPage(page){if(!['overview','backup','restore'].includes(page))page='overview';document.querySelectorAll('.page').forEach(p=>p.hidden=p.id!=='page-'+page);document.querySelectorAll('[data-page]').forEach(a=>a.classList.toggle('active',a.dataset.page===page))}
window.addEventListener('hashchange',()=>showPage(location.hash.slice(1)));showPage(location.hash.slice(1));
$('openClients').onclick=()=>$('clientManager').showModal();$('closeClients').onclick=()=>$('clientManager').close();
let restoreLoaded='';
function renderRestore(){
 const previous=$('restoreDevice').value;$('restoreDevice').innerHTML=state.devices.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');if(state.devices.some(d=>d.id===previous))$('restoreDevice').value=previous;updateRestoreRuns();
}
function updateRestoreRuns(){
 const previous=$('restoreRun').value;const runs=state.runs.filter(r=>r.device===$('restoreDevice').value&&r.status==='success');
 $('restoreRun').innerHTML=runs.map(r=>`<option value="${r.id}">${new Date(r.finished).toLocaleString('pt-BR')} · ${r.bytes} bytes</option>`).join('');if(runs.some(r=>r.id===previous))$('restoreRun').value=previous;
 if(!$('restoreRun').value){$('restoreFiles').textContent='Nenhum backup concluído neste computador. Crie uma rotina na aba Backup e aguarde sua execução.';restoreLoaded='';return}
 if(restoreLoaded!==$('restoreRun').value)loadRestoreFiles();
}
async function loadRestoreFiles(){const run=$('restoreRun').value;restoreLoaded=run;$('restoreFiles').textContent='Carregando arquivos…';try{const files=await api('runs/'+run+'/files');if($('restoreRun').value!==run)return;$('restoreFiles').innerHTML=files.map((f,i)=>`<div class="item">${esc(f.path)} · ${f.size} bytes <button data-restore="${i}">Restaurar arquivo</button></div>`).join('')||'Este backup não contém arquivos.';document.querySelectorAll('[data-restore]').forEach(b=>b.onclick=()=>restoreFile(run,files[b.dataset.restore]))}catch(e){restoreLoaded='';$('restoreFiles').textContent=e.message}}
$('restoreDevice').onchange=()=>{restoreLoaded='';updateRestoreRuns()};$('restoreRun').onchange=loadRestoreFiles;

$('generateClientToken').onclick=async()=>{try{const r=await api('devices',{name:'Client '+new Date().toLocaleString('pt-BR')});$('enrollment').textContent='Token para configurar o novo client (guarde com segurança):\n'+r.token;await refresh()}catch(e){message(e)}};

const destinationLabels={local:'Pasta local',external:'HD externo',network:'Rede',server:'Armazenamento antigo do master'};
function duplicateRoutineCount(){const seen=new Set();let count=0;for(const r of state.routines){const key=JSON.stringify([r.device,r.name,r.cadence,r.hour,r.source,r.destination,r.destination_type,r.use_vss,r.enabled]);if(seen.has(key))count++;else seen.add(key)}return count}
function renderRoutines(){
 const duplicateCount=duplicateRoutineCount();$('removeDuplicates').hidden=!duplicateCount;$('removeDuplicates').textContent='Remover '+duplicateCount+' cópia(s) idêntica(s) de rotinas';
 $('routines').innerHTML=state.routines.map(r=>`<div class="item"><b>${esc(r.name)}</b> · <strong class="${r.enabled?'success':'failed'}">${r.enabled?'Ativa':'Desativada'}</strong> · ${esc(cadenceLabels[r.cadence]||r.cadence)} · ${esc(r.hour)}<br><small>Origem: ${esc(displaySources(r.source))}<br>Destino: ${esc(destinationLabels[r.destination_type]||'Antigo')} ${esc(r.destination||'— edite para escolher uma pasta')}</small><br><button data-edit="${r.id}">Editar</button><button data-backup="${r.id}" ${r.enabled?'':'disabled'}>Fazer backup agora</button><button data-toggle="${r.id}">${r.enabled?'Desativar':'Ativar'}</button><button data-delete="${r.id}">Excluir rotina</button></div>`).join('');
 document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{if(savingRoutine)return;const r=state.routines.find(r=>r.id===Number(b.dataset.edit));editingRoutine=r.id;const form=$('routineForm');for(const key of ['name','device','cadence','hour'])form.elements[key].value=r[key];$('sources').value=JSON.parse(r.source.startsWith('[')?r.source:JSON.stringify([r.source])).join('\n');$('destinationType').value=r.destination_type==='server'?'local':r.destination_type;$('destination').value=r.destination||'';updateRoutineFormState();location.hash='backup';form.scrollIntoView({behavior:'smooth'})});
 document.querySelectorAll('[data-toggle]').forEach(b=>b.onclick=async()=>{try{const r=state.routines.find(r=>r.id===Number(b.dataset.toggle));await api('routines/'+r.id+'/enabled',{enabled:!r.enabled});await refresh();message(r.enabled?'Rotina desativada. Uma cópia em andamento não é interrompida.':'Rotina ativada.')}catch(e){message(e)}});
 document.querySelectorAll('[data-delete]').forEach(b=>b.onclick=async()=>{if(!confirm('Excluir esta rotina? Backups já gravados e uma cópia em andamento serão preservados.'))return;try{await api('routines/'+b.dataset.delete+'/delete',{});await refresh();message('Rotina excluída. Os backups foram preservados.')}catch(e){message(e)}});
 document.querySelectorAll('[data-backup]').forEach(b=>b.onclick=()=>startJob({kind:'backup',routine_id:Number(b.dataset.backup)},'Backup'));
}
$('cancelEdit').onclick=newRoutine;
async function selectTarget(input,device){if(!state.localDeviceId||device!==state.localDeviceId)return message('Para o client remoto, informe o caminho da pasta acessível naquele computador.');try{const picked=await api('pick-folder',{purpose:input==='restoreTarget'?'restore':'destination'});if(!picked.cancelled)$(input).value=picked.path}catch(e){message(e)}}
$('chooseDestination').onclick=()=>selectTarget('destination',$('deviceOptions').value);$('chooseRestoreTarget').onclick=()=>selectTarget('restoreTarget',$('restoreDevice').value);
$('testDestination').onclick=()=>startJob({kind:'validate',device:$('deviceOptions').value,source:JSON.stringify($('sources').value.split(/\r?\n/).map(p=>p.trim()).filter(Boolean)),destination:$('destination').value},'Verificação do destino');
async function startJob(payload,label){showActivity({kind:payload.kind,status:'queued',progress:{}});$('activityPanel').scrollIntoView({behavior:'smooth',block:'start'});try{const {id}=await api('jobs',payload);message(label+': aguardando o agente…');async function poll(){try{const j=await api('jobs/'+id);if(j.status==='success'){let details='';if(j.result?.destination)details=' Pasta: '+j.result.destination;if(j.result?.snapshot)details=' Cópia: '+j.result.snapshot;if(j.result?.warning)details+=' Atenção: '+j.result.warning;if(j.result?.availableBytes)details+=' Espaço disponível: '+(Number(j.result.availableBytes)/1073741824).toFixed(1)+' GB';message(label+(['Restauração','Verificação do destino'].includes(label)?' concluída.':' concluído.')+details);await refresh()}else if(j.status==='failed'){message(label+' falhou: '+j.error);await refresh()}else setTimeout(poll,2000)}catch(e){message(e)}}poll()}catch(e){showActivity({kind:payload.kind,status:'failed',error:e.message});message(e)}}
async function restoreFile(runId,file){const run=state.runs.find(r=>r.id===runId);if(run&&run.storage_type!=='server'){if(!$('restoreTarget').value){location.hash='restore';return message('Selecione a pasta para receber os arquivos restaurados.')}return startJob({kind:'restore',run:runId,path:file.path,target:$('restoreTarget').value},'Restauração')}return download('runs/'+runId+'/files?path='+encodeURIComponent(file.path),file.path.split('/').pop())}

$('restoreAll').onclick=()=>{const run=state.runs.find(r=>r.id===$('restoreRun').value);if(!run)return message('Selecione uma versão concluída.');if(run.storage_type==='server')return message('Para o armazenamento antigo, baixe os arquivos individualmente abaixo.');if(!$('restoreTarget').value)return message('Escolha a pasta para receber a restauração.');startJob({kind:'restore',run:run.id,path:'*',target:$('restoreTarget').value},'Restauração')};

const stages={preparing:'Preparando',scanning:'Localizando arquivos',checking_destination:'Verificando destino e espaço',vss_prepare:'Preparando VSS',vss_snapshot:'Criando snapshot VSS',vss_cleanup:'Limpando snapshots VSS',copying:'Copiando arquivos',verifying:'Verificando integridade',finalizing:'Finalizando'};
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
 const p=item.progress||{},label={backup:'Backup',restore:'Restauração',validate:'Teste do destino'}[item.kind]||'Operação';
 $('activityTitle').textContent=label+' · '+(cancelled?'Solicitação cancelada':historical?'Falha anterior — nova execução necessária':({queued:'Aguardando o agente',running:stages[p.stage]||'Em execução',success:item.warning?'Concluído — verificar observação':'Concluído',failed:'Falhou'})[item.status])+(item.name?' · '+item.name:'');
 $('activitySummary').textContent=active?'Ver detalhes do andamento':cancelled?'Ver detalhes do cancelamento':historical?'Ver detalhes da tentativa anterior':item.status==='failed'?'Ver erro e opções':'Ver resultado';
 $('activityDetail').textContent=historical?'A tentativa registrada falhou sem VSS. A rotina agora está com VSS ativado; somente um novo backup poderá confirmar o funcionamento.':item.error||item.warning||[item.device_name,p.currentFile].filter(Boolean).join(' · ');
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
