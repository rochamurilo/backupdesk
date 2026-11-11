$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$master=Join-Path $repo 'dist\BackupDesk-Master-0.25.0-x64.exe'
$newMaster=Join-Path $repo 'dist\BackupDesk-Master-0.30.0-x64.exe'
$updater=Join-Path $repo 'dist\BackupDesk-Atualizacao-Client-0.30.0-x64.exe'
if(-not (Test-Path -LiteralPath $master)){'Instalador ainda não publicado; teste de pacote será executado na publicação.';return}
$root=Join-Path $env:TEMP ('BackupDesk Client Test '+[guid]::NewGuid().ToString('N'))
$extract=Join-Path $root 'extracted'
$target=Join-Path $root 'client instalado'
$renamed=Join-Path $root 'arquivo renomeado.exe'
$sevenZip=(Get-Command 7z.exe -ErrorAction SilentlyContinue).Source
if(-not $sevenZip){$sevenZip=Join-Path $env:ProgramFiles '7-Zip\7z.exe'}
New-Item -ItemType Directory -Path $root | Out-Null
$testStage='preparar instalação antiga';$testPassed=$false
try{
 $null=& $sevenZip x $master ('-o'+$extract) -y
 if($LASTEXITCODE -ne 0){throw 'Falha ao extrair o pacote publicado.'}
 $generic=Get-ChildItem -LiteralPath $extract -Filter 'BackupDesk-Client-0.25.0-x64.exe' -Recurse | Select-Object -First 1
 if(-not $generic){throw 'Master não contém o client esperado.'}
 $env:BACKUPDESK_TEST_LOG_LOCAL=Join-Path $root 'logs local';$env:BACKUPDESK_TEST_LOG_CLOUD=Join-Path $root 'logs cloud'
 New-Item -ItemType Directory -Path $env:BACKUPDESK_TEST_LOG_LOCAL,$env:BACKUPDESK_TEST_LOG_CLOUD | Out-Null
 $env:BACKUPDESK_TEST_CLIENT_BASE=$generic.FullName
 $env:BACKUPDESK_TEST_CLIENT_NAMED=$renamed
 Set-Location $repo
 & node --input-type=module -e "import {readFile,writeFile} from 'node:fs/promises';import {enrollmentTrailer} from './client-package.mjs';const {generateKeyPairSync}=await import('node:crypto');const publicKey=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}).publicKey;const config={security_key:'07'.repeat(32),recovery_public_key:publicKey,format:'backupdesk-client-v1',device_id:'d'.repeat(64),name:'Financeiro São Paulo',mode:'local',url:null,log_defaults:{local:{path:process.env.BACKUPDESK_TEST_LOG_LOCAL},cloud:{path:process.env.BACKUPDESK_TEST_LOG_CLOUD}},token:'a'.repeat(64)};await writeFile(process.env.BACKUPDESK_TEST_CLIENT_NAMED,Buffer.concat([await readFile(process.env.BACKUPDESK_TEST_CLIENT_BASE),enrollmentTrailer(config)]));"
 if($LASTEXITCODE -ne 0){throw 'Falha ao incorporar identificação no instalador.'}
 $testStage='instalar Client 0.25'
 $process=Start-Process -FilePath $renamed -ArgumentList @('/S',('/D='+$target)) -PassThru
 if(-not $process.WaitForExit(180000)){$process.Kill();throw 'Instalação identificada excedeu o prazo.'}
 if($process.ExitCode -ne 0){throw ('Instalador retornou '+$process.ExitCode)}
 $config=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $target 'agent-config.json') | ConvertFrom-Json
 if($config.name -ne 'Financeiro São Paulo' -or $config.device_id -ne ('d'*64) -or -not $config.installation_id){throw 'Identidade não foi instalada automaticamente.'}
 if($config.url -or $config.mode -ne 'local'){throw 'O client local não pode exigir endereço do master.'}
 $panel='http://127.0.0.1:3001'
 $script:clientSession=$null
 function Invoke-LocalClient($Path,$Body=$null){
  $headers=@{Origin=$panel};if($script:clientSession){$headers.Authorization='Bearer '+$script:clientSession}
  # Windows PowerShell 5.1 otherwise encodes JSON strings and decodes responses as a legacy code page.
  $request=@{Uri=($panel+'/api/'+$Path);Headers=$headers;TimeoutSec=10;UseBasicParsing=$true}
  if($null -ne $Body){$request.Method='Post';$request.ContentType='application/json; charset=utf-8';$request.Body=[Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 12 -Compress))}
  $response=Invoke-WebRequest @request
  return ([Text.Encoding]::UTF8.GetString($response.RawContentStream.ToArray()) | ConvertFrom-Json)
 }
 function Wait-LocalClient($ExpectedVersion='0.30.0') {
  $ready=$false
  for($attempt=0;$attempt -lt 100;$attempt++){try{$health=Invoke-LocalClient 'health';if($health.mode -eq 'client' -and $health.device -eq $config.device_id){$ready=$true;break}}catch{};Start-Sleep -Milliseconds 300}
  if(-not $ready){throw 'O painel local do client não iniciou sem endereço do master.'}
  $script:clientSession=(Invoke-LocalClient 'local-session' @{}).token
  for($attempt=0;$attempt -lt 100;$attempt++){$state=Invoke-LocalClient 'state';if($state.devices[0].version -eq $ExpectedVersion){return $state};Start-Sleep -Milliseconds 200}
  throw 'O agente local do client não iniciou.'
 }
 $testStage='iniciar Client antigo'
 $localState=Wait-LocalClient '0.25.0'
 if($localState.user.role -ne 'client' -or $localState.devices.Count -ne 1 -or $localState.localDeviceId -ne $config.device_id){throw 'O client expôs controles master ou outra máquina.'}
 $source=Join-Path $root 'source';$destination=Join-Path $root 'BackupDesk';$restore=Join-Path $root 'restored'
 New-Item -ItemType Directory -Path $source,$destination,$restore | Out-Null
 [IO.File]::WriteAllText((Join-Path $source 'sample.txt'),'backup independente do master')
 $null=Invoke-LocalClient ('devices/'+$config.device_id+'/preferences') @{engine='restic';destinations=@(@{path=$destination;type='local'});bandwidth=@{enabled=$false;start='00:00';end='00:00';upload_mbps=50;download_mbps=$null}}
 $routine=Invoke-LocalClient 'routines' @{device=$config.device_id;name='Rotina do client';source=(ConvertTo-Json -InputObject @($source) -Compress);cadence='daily';hour='23:59'}
 function Wait-ClientJob($Job){
  for($attempt=0;$attempt -lt 200;$attempt++){$result=Invoke-LocalClient ('jobs/'+$Job.id);if($result.status -eq 'failed'){throw ('Tarefa local falhou: '+$result.error)};if($result.status -eq 'success'){return $result.result};Start-Sleep -Milliseconds 300}
  throw 'A tarefa local não concluiu.'
 }
 $testStage='backup Restic antigo'
 $backup=Wait-ClientJob (Invoke-LocalClient 'jobs' @{kind='backup';routine_id=$routine.id})
 if($backup.backup_type -ne 'snapshot' -or -not $backup.integrity.checked_this_run){throw 'O Restic local não confirmou snapshot e check integral.'}
 $testStage='restaurar no Client antigo'
 $recovered=Wait-ClientJob (Invoke-LocalClient 'jobs' @{kind='restore';run=$backup.run;path='sample.txt';target=$restore})
 if([IO.File]::ReadAllText((Join-Path $recovered.destination 'sample.txt')) -ne 'backup independente do master'){throw 'A restauração pelo client local divergiu da origem.'}
 $testStage='publicar logs da rotina'
 foreach($folder in @($env:BACKUPDESK_TEST_LOG_LOCAL,$env:BACKUPDESK_TEST_LOG_CLOUD)){
  $file=Join-Path (Join-Path $folder 'BackupDesk-Logs') ($config.device_id+'.json');$found=$false
  for($attempt=0;$attempt -lt 100;$attempt++){if(Test-Path -LiteralPath $file){$document=Get-Content -Raw -Encoding UTF8 -LiteralPath $file | ConvertFrom-Json;$payload=$document.payload | ConvertFrom-Json;if($payload.runs | Where-Object {$_.id -eq $backup.run -and $_.status -eq 'success'}){$found=$true;break}};Start-Sleep -Milliseconds 200}
  if(-not $found -or -not $document.registration.publicKey){throw 'O client não publicou o resultado com prova de identificação nas duas pastas.'}
 }
 $instance=$config.installation_id
 $installedAt=$config.installed_at
 if(-not $installedAt){throw 'A data de instalação não foi registrada.'}
 $crypto=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $target 'data\keys\computer.json') | ConvertFrom-Json
 if($crypto.protected.scheme -ne 'windows-dpapi-current-user'){throw 'Chave do computador não está protegida por DPAPI.'}
 $dataKey=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $target 'data\keys\device.json') | ConvertFrom-Json
 $keyId=$dataKey.header.key_id
 if($keyId -ne '4bb06f8e4e3a7715d201d573d0aa423762e55dabd61a2c02278fa56cc6d294e0'){throw 'A chave de segurança não originou a chave de dados do computador.'}
 if($config.PSObject.Properties.Name -contains 'security_key'){throw 'A chave de segurança ficou em texto aberto na configuração.'}
 $filesToPreserve=@('agent-config.json','data\keys\master.json','data\keys\computer.json','data\keys\device.json','data\device-identity.json')
 $keyHashes=@{};foreach($relative in $filesToPreserve){$keyHashes[$relative]=(Get-FileHash -LiteralPath (Join-Path $target $relative) -Algorithm SHA256).Hash}
 # A harmless marker proves rejection happens before any application replacement.
 Add-Content -LiteralPath (Join-Path $target 'agent.mjs') -Value '// marker: rejected installer must not replace this file' -Encoding UTF8
 $agentHash=(Get-FileHash -LiteralPath (Join-Path $target 'agent.mjs') -Algorithm SHA256).Hash
 $runningServer=Get-CimInstance Win32_Process | Where-Object {$_.ExecutablePath -eq (Join-Path $target 'node.exe') -and $_.CommandLine -match 'server\.mjs'} | Select-Object -First 1
 if(-not $runningServer){throw 'Servidor local não está em execução para o teste de proteção.'}
 # The original installation is the real published 0.25.0; use the current package for rejection/update tests.
 $newExtract=Join-Path $root 'new extracted'
 $null=& $sevenZip x $newMaster ('-o'+$newExtract) -y
 if($LASTEXITCODE -ne 0){throw 'Falha ao extrair a versão atual.'}
 $newGeneric=Get-ChildItem -LiteralPath $newExtract -Filter 'BackupDesk-Client-0.30.0-x64.exe' -Recurse | Select-Object -First 1
 if(-not $newGeneric){throw 'Client atual não encontrado.'}
 $env:BACKUPDESK_TEST_CLIENT_BASE=$newGeneric.FullName
 $env:BACKUPDESK_TEST_CLIENT_WRONG=Join-Path $root 'pacote com outra chave.exe'
 & node --input-type=module -e "import {readFile,writeFile} from 'node:fs/promises';import {readEnrollment,enrollmentTrailer} from './client-package.mjs';const original=await readEnrollment(process.env.BACKUPDESK_TEST_CLIENT_NAMED);await writeFile(process.env.BACKUPDESK_TEST_CLIENT_WRONG,Buffer.concat([await readFile(process.env.BACKUPDESK_TEST_CLIENT_BASE),enrollmentTrailer({...original,security_key:'08'.repeat(32)})]));"
 if($LASTEXITCODE -ne 0){throw 'Falha ao preparar teste com chave divergente.'}
 $testStage='rejeitar pacote com outra chave'
 $rejected=Start-Process -FilePath $env:BACKUPDESK_TEST_CLIENT_WRONG -ArgumentList @('/S',('/D='+$target)) -PassThru
 if(-not $rejected.WaitForExit(90000)){$rejected.Kill();throw 'O instalador divergente não encerrou em modo silencioso.'}
 if($rejected.ExitCode -eq 0){throw 'O instalador aceitou uma chave diferente.'}
 foreach($relative in $filesToPreserve){if((Get-FileHash -LiteralPath (Join-Path $target $relative) -Algorithm SHA256).Hash -ne $keyHashes[$relative]){throw ('Instalador divergente modificou '+$relative)}}
 if((Get-FileHash -LiteralPath (Join-Path $target 'agent.mjs') -Algorithm SHA256).Hash -ne $agentHash){throw 'A validação ocorreu depois de substituir o programa.'}
 if(-not (Get-Process -Id $runningServer.ProcessId -ErrorAction SilentlyContinue)){throw 'O instalador divergente interrompeu o servidor antes da validação.'}
 $null=Invoke-LocalClient 'state'
 # Even a package carrying the original key may not recreate a missing vault record.
 $testStage='rejeitar cofre incompleto'
 $deviceFile=Join-Path $target 'data\keys\device.json'
 Move-Item -LiteralPath $deviceFile -Destination ($deviceFile+'.retained')
 try{
  $incomplete=Start-Process -FilePath $renamed -ArgumentList @('/S',('/D='+$target)) -PassThru
  if(-not $incomplete.WaitForExit(90000)){$incomplete.Kill();throw 'O teste de cofre incompleto não encerrou.'}
  if($incomplete.ExitCode -eq 0 -or (Test-Path -LiteralPath $deviceFile)){throw 'O instalador recriou a chave de um cofre incompleto.'}
  if((Get-FileHash -LiteralPath (Join-Path $target 'agent.mjs') -Algorithm SHA256).Hash -ne $agentHash){throw 'O instalador modificou o programa apesar do cofre incompleto.'}
 }finally{Move-Item -LiteralPath ($deviceFile+'.retained') -Destination $deviceFile}
 $testStage='atualizar Client preservando chaves'
 $process=Start-Process -FilePath $updater -ArgumentList @('/S',('/D='+$target)) -PassThru
 if(-not $process.WaitForExit(180000)){$process.Kill();throw 'Atualização do client excedeu o prazo.'}
 if($process.ExitCode -ne 0){throw 'Atualização identificada falhou.'}
 $testStage='iniciar Client atualizado'
 $afterUpdate=Wait-LocalClient
 if($afterUpdate.routines.Count -ne 1){throw 'A atualização perdeu a rotina local.'}
 $updated=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $target 'agent-config.json') | ConvertFrom-Json
 if((Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $target 'data\keys\device.json') | ConvertFrom-Json).header.key_id -ne $keyId){throw 'A atualização trocou a chave de dados.'}
 foreach($relative in @('data\keys\master.json','data\keys\computer.json','data\keys\device.json','data\device-identity.json')){if((Get-FileHash -LiteralPath (Join-Path $target $relative) -Algorithm SHA256).Hash -ne $keyHashes[$relative]){throw ('Atualização legítima regravou '+$relative)}}
 $testStage='restaurar backup anterior após atualização'
 $oldRestored=Wait-ClientJob (Invoke-LocalClient 'jobs' @{kind='restore';run=$backup.run;path='sample.txt';target=$restore})
 if([IO.File]::ReadAllText((Join-Path $oldRestored.destination 'sample.txt')) -ne 'backup independente do master'){throw 'O backup anterior não abriu com a chave preservada.'}
 if($updated.installed_at -ne $installedAt){throw 'A atualização alterou a data original de instalação.'}
 if($updated.installation_id -ne $instance){throw 'A atualização mudou a identificação da instalação.'}
 if(-not (Test-Path -LiteralPath (Join-Path $target 'client-package.mjs'))){throw 'Módulo de identificação não foi incluído no pacote.'}
 # Dedicated update has no enrollment and must keep the configuration byte for byte.
 $updater=Join-Path $repo 'dist\BackupDesk-Atualizacao-Client-0.30.0-x64.exe'
 if(-not (Test-Path -LiteralPath $updater)){throw 'Atualizador do client não foi publicado.'}
 $updateHashes=@{};foreach($relative in $filesToPreserve){$updateHashes[$relative]=(Get-FileHash -LiteralPath (Join-Path $target $relative) -Algorithm SHA256).Hash}
 $configBytes=[IO.File]::ReadAllBytes((Join-Path $target 'agent-config.json'))
 Add-Content -LiteralPath (Join-Path $target 'agent.mjs') -Value '// dedicated updater must replace program without touching identity' -Encoding UTF8
 $oldProgram=(Get-FileHash -LiteralPath (Join-Path $target 'agent.mjs') -Algorithm SHA256).Hash
 $testStage='bloquear atualizador sem instalação'
 $fresh=Join-Path $root 'sem instalacao'
 $blocked=Start-Process -FilePath $updater -ArgumentList @('/S',('/D='+$fresh)) -PassThru
 if(-not $blocked.WaitForExit(90000)){$blocked.Kill();throw 'Atualizador sem instalação não encerrou.'}
 if($blocked.ExitCode -eq 0 -or (Test-Path -LiteralPath $fresh)){throw 'Atualizador permitiu primeira instalação ou criou dados novos.'}
 $testStage='rejeitar cofre incompleto'
 $deviceFile=Join-Path $target 'data\keys\device.json'
 Move-Item -LiteralPath $deviceFile -Destination ($deviceFile+'.retained')
 try{
  $blocked=Start-Process -FilePath $updater -ArgumentList @('/S',('/D='+$target)) -PassThru
  if(-not $blocked.WaitForExit(90000)){$blocked.Kill();throw 'Atualizador com cofre incompleto não encerrou.'}
  if($blocked.ExitCode -eq 0 -or (Test-Path -LiteralPath $deviceFile)){throw 'Atualizador recriou chave ausente.'}
  if((Get-FileHash -LiteralPath (Join-Path $target 'agent.mjs') -Algorithm SHA256).Hash -ne $oldProgram){throw 'Atualizador modificou programa antes de validar as chaves.'}
 }finally{Move-Item -LiteralPath ($deviceFile+'.retained') -Destination $deviceFile}
 $testStage='atualizar Client preservando chaves'
 $process=Start-Process -FilePath $updater -ArgumentList @('/S',('/D='+$target)) -PassThru
 if(-not $process.WaitForExit(180000)){$process.Kill();throw 'Atualizador dedicado excedeu o prazo.'}
 if($process.ExitCode -ne 0){throw ('Atualizador dedicado falhou: '+$process.ExitCode)}
 $testStage='iniciar Client após atualização dedicada'
 $afterDedicated=Wait-LocalClient
 foreach($relative in $filesToPreserve){if((Get-FileHash -LiteralPath (Join-Path $target $relative) -Algorithm SHA256).Hash -ne $updateHashes[$relative]){throw ('Atualizador dedicado regravou '+$relative)}}
 if((Get-FileHash -LiteralPath (Join-Path $target 'agent.mjs') -Algorithm SHA256).Hash -eq $oldProgram){throw 'O programa não foi atualizado.'}
 if($afterDedicated.routines.Count -ne 1){throw 'O atualizador perdeu a rotina.'}
 $testStage='restaurar após atualização dedicada'
 $restoredDedicated=Wait-ClientJob (Invoke-LocalClient 'jobs' @{kind='restore';run=$backup.run;path='sample.txt';target=$restore})
 if([IO.File]::ReadAllText((Join-Path $restoredDedicated.destination 'sample.txt')) -ne 'backup independente do master'){throw 'O backup anterior não restaurou após atualização dedicada.'}
 $testStage='Menu Iniciar, sem Área de Trabalho, prioridade reduzida'
 $desktop=[Environment]::GetFolderPath('Desktop');$programs=[Environment]::GetFolderPath('Programs')
 if(Test-Path -LiteralPath (Join-Path $desktop 'BackupDesk Client.lnk')){throw 'Atalho Client permaneceu na Área de Trabalho.'}
 $link=Join-Path $programs 'BackupDesk Client.lnk'
 if(-not (Test-Path -LiteralPath $link)){throw 'Atalho Client não foi criado no Menu Iniciar.'}
 $shell=New-Object -ComObject WScript.Shell;$linked=$shell.CreateShortcut($link).TargetPath
 if(-not (Test-Path -LiteralPath $linked) -or (Split-Path -Leaf $linked) -ne 'BackupDeskClient.exe'){throw 'Atalho Client não abre o aplicativo.'}
 $nodes=@(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.ExecutablePath -eq (Join-Path $target 'node.exe')})
 if($nodes.Count -lt 2){throw 'Servidor e agente não encontrados para verificar prioridade.'}
 foreach($node in $nodes){if((Get-Process -Id $node.ProcessId).PriorityClass -notin @('BelowNormal','Idle')){throw 'Client não aplicou prioridade reduzida.'}}
 $testStage='simular restauração do catálogo anterior sem novo backup'
 $historicalVolume=(Invoke-LocalClient 'state').devices[0].selected_volume
 if($historicalVolume.basis -ne 'restore' -or $historicalVolume.bytes -ne [Text.Encoding]::UTF8.GetByteCount('backup independente do master')){throw 'O volume do catálogo anterior não ficou disponível após atualizar.'}
 $testStage='medir volume selecionado no Client atualizado'
 $measuredBackup=Wait-ClientJob (Invoke-LocalClient 'jobs' @{kind='backup';routine_id=$routine.id})
 $volumeState=Invoke-LocalClient 'state'
 $expectedVolume=[Text.Encoding]::UTF8.GetByteCount('backup independente do master')
 if($volumeState.devices[0].selected_volume.basis -ne 'restore' -or $volumeState.devices[0].selected_volume.status -ne 'ready' -or $volumeState.devices[0].selected_volume.bytes -ne $expectedVolume){throw 'Volume selecionado divergiu do tamanho lógico do catálogo restaurável.'}
 foreach($folder in @($env:BACKUPDESK_TEST_LOG_LOCAL,$env:BACKUPDESK_TEST_LOG_CLOUD)){
  $file=Join-Path (Join-Path $folder 'BackupDesk-Logs') ($config.device_id+'.json');$found=$false
  for($attempt=0;$attempt -lt 100;$attempt++){if(Test-Path -LiteralPath $file){$document=Get-Content -Raw -Encoding UTF8 -LiteralPath $file | ConvertFrom-Json;$payload=$document.payload | ConvertFrom-Json;if($payload.selected_volume.basis -eq 'restore' -and $payload.selected_volume.bytes -eq $expectedVolume -and ($payload.runs | Where-Object {$_.id -eq $measuredBackup.run -and $_.status -eq 'success'})){$found=$true;break}};Start-Sleep -Milliseconds 200}
  if(-not $found){throw 'Volume selecionado não chegou às duas pastas de logs.'}
 }
 'Client Windows: simulação do catálogo de restauração e volume publicado nas duas pastas de logs: OK.'
 # The destination itself is named BackupDesk: catalog the outer folder using the original key.
 $testStage='consultar própria chave'
 $ownSecurity=Invoke-LocalClient ('devices/'+$config.device_id+'/security-key') @{}
 $testStage='catalogar subpastas da raiz'
 $catalog=Wait-ClientJob (Invoke-LocalClient 'jobs' @{kind='catalog';device=$config.device_id;source=$root;recovery_name=$config.name;security_key=$ownSecurity.security_key})
 if($catalog.runs -lt 1){throw 'O calendário não encontrou backup nas subpastas da raiz selecionada.'}
 $catalogState=Invoke-LocalClient 'state'
 $imported=$catalogState.repositoryRuns | Where-Object {$_.original_run -eq $backup.run -and $_.recovery_name -eq $config.name} | Select-Object -First 1
 if(-not $imported){throw 'Backup anterior não foi importado com nome e chave originais.'}
 $testStage='restaurar pelo calendário importado'
 $recoveredCatalog=Wait-ClientJob (Invoke-LocalClient 'jobs' @{kind='restore';repository_run=$imported.id;path='sample.txt';target=$restore})
 if([IO.File]::ReadAllText((Join-Path $recoveredCatalog.destination 'sample.txt')) -ne 'backup independente do master'){throw 'Restauração pelo calendário importado divergiu.'}
 $testStage='medir repouso do Client instalado'
 Start-Sleep -Seconds 3
 $items=@(Get-CimInstance Win32_Process | Where-Object {($_.ExecutablePath -eq (Join-Path $target 'node.exe')) -or ($_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*BackupDesk VSS*client*vss-broker.ps1*')})
 $before=@{};$memory=0
 foreach($item in $items){$p=Get-Process -Id $item.ProcessId;$before[$item.ProcessId]=$p.TotalProcessorTime.TotalMilliseconds;$memory+=$p.WorkingSet64}
 $clock=[Diagnostics.Stopwatch]::StartNew();Start-Sleep -Seconds 10;$clock.Stop();$cpu=0;$memoryAfter=0
 foreach($item in $items){$p=Get-Process -Id $item.ProcessId;$cpu+=$p.TotalProcessorTime.TotalMilliseconds-$before[$item.ProcessId];$memoryAfter+=$p.WorkingSet64}
 $percent=[Math]::Round($cpu/$clock.Elapsed.TotalMilliseconds*100,2);$mb=[Math]::Round([Math]::Max($memory,$memoryAfter)/1000000,1)
 Write-Output "::notice title=BackupDesk Windows idle resources::Processes=$($items.Count); CPUs=$([Environment]::ProcessorCount); CPU one core=$percent percent; working set=$mb MB; sample=$([Math]::Round($clock.Elapsed.TotalSeconds,1)) seconds"
 $testPassed=$true
 'Busca recursiva pela pasta raiz, nome Unicode e chave original: calendário carregado e arquivo Restic anterior restaurado: OK.'
 'Atualizador Client 0.25.0 para 0.30.0: sem cadastro/chave no pacote, sem primeira instalação, cofre incompleto bloqueado, configuração/chaves idênticas, rotina e restauração anterior preservadas: OK.'
 'Chaves Windows: instalador divergente bloqueado antes de substituir arquivos ou parar o app; cofre incompleto preservado; chaves idênticas após atualização legítima e backup anterior restaurado: OK.'
 'Client local Windows: sem endereço, painel isolado, Restic/VSS, backup, restauração, duas pastas de logs e atualização preservando rotina: OK.'
 'Instalador NSIS real: CRC preservado com identificação incorporada, nome independente do arquivo e vínculo mantido na atualização: OK.'
}catch{
 $detail=$_.Exception.Message
 $log=Join-Path $target 'data\agent.log'
 if(Test-Path -LiteralPath $log){$detail+=' '+((Get-Content -Encoding UTF8 -LiteralPath $log -Tail 25) -join [Environment]::NewLine)}
 $diagnostic=($testStage+': '+$detail+' '+$_.ScriptStackTrace).Replace('%','%25').Replace("`r",'%0D').Replace("`n",'%0A')
 Write-Output "::error title=Windows client original failure::$diagnostic"
 throw $detail
}finally{
 try{
 $uninstall=Join-Path $target 'Uninstall.exe'
 if(Test-Path -LiteralPath $uninstall){$process=Start-Process -FilePath $uninstall -ArgumentList @('/S',('_?='+$target)) -PassThru;if(-not $process.WaitForExit(60000)){$process.Kill();throw 'Desinstalação do teste excedeu o prazo.'}}
 if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}
 }catch{
  if($testPassed){throw}
  Write-Warning ('Limpeza falhou após erro principal: '+$_.Exception.Message)
 }
}
