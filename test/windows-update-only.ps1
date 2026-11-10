$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$installer=Join-Path $repo 'dist\BackupDesk-Master-0.25.0-x64.exe'
$updater=Join-Path $repo 'dist\BackupDesk-Atualizacao-Master-0.29.0-x64.exe'
$root=Join-Path $env:TEMP ('BackupDesk Master Update '+[guid]::NewGuid().ToString('N'))
$target=Join-Path $root 'master existente'
New-Item -ItemType Directory -Path $root | Out-Null
function Run-Package($File,$Directory){$p=Start-Process -FilePath $File -ArgumentList @('/S',('/D='+$Directory)) -PassThru;if(-not $p.WaitForExit(180000)){$p.Kill();throw 'Pacote excedeu o prazo.'};return $p.ExitCode}
$panel='http://127.0.0.1:3000';$script:session=$null
function Api($Path,$Body=$null){$headers=@{Origin=$panel};if($script:session){$headers.Authorization='Bearer '+$script:session};if($null -eq $Body){return Invoke-RestMethod -Uri ($panel+'/api/'+$Path) -Headers $headers -TimeoutSec 5};return Invoke-RestMethod -Uri ($panel+'/api/'+$Path) -Method Post -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Depth 12 -Compress) -Headers $headers -TimeoutSec 10}
function Ready($ExpectedVersion='0.29.0') {for($i=0;$i -lt 150;$i++){try{$script:session=(Api 'local-session' @{}).token;$s=Api 'state';if($s.localDeviceId -and $s.devices[0].version -eq $ExpectedVersion){return $s}}catch{};Start-Sleep -Milliseconds 300};throw 'Master não iniciou.'}
function Wait-Job($Job){for($i=0;$i -lt 200;$i++){$j=Api ('jobs/'+$Job.id);if($j.status -eq 'failed'){throw $j.error};if($j.status -eq 'success'){return $j.result};Start-Sleep -Milliseconds 300};throw 'Tarefa não concluiu.'}
try{
 $fresh=Join-Path $root 'nao instalado'
 if((Run-Package $updater $fresh) -eq 0 -or (Test-Path -LiteralPath $fresh)){throw 'Atualizador master permitiu primeira instalação.'}
 if((Run-Package $installer $target) -ne 0){throw 'Instalação inicial do master falhou.'}
 $state=Ready '0.25.0';$device=$state.localDeviceId
 $source=Join-Path $root 'source';$backupPath=Join-Path $root 'backups';$restorePath=Join-Path $root 'restore';New-Item -ItemType Directory -Path $source,$backupPath,$restorePath | Out-Null
 [IO.File]::WriteAllText((Join-Path $source 'before.txt'),'master key remains valid')
 $null=Api ('devices/'+$device+'/preferences') @{engine='restic';destinations=@(@{path=$backupPath;type='local'});bandwidth=@{enabled=$false;start='00:00';end='00:00';upload_mbps=50;download_mbps=$null}}
 $routine=Api 'routines' @{device=$device;name='Original';source=(ConvertTo-Json -InputObject @($source) -Compress);cadence='daily';hour='23:59'}
 $backup=Wait-Job (Api 'jobs' @{kind='backup';routine_id=$routine.id})
 $files=@('data\keys\master.json','data\keys\computer.json','data\keys\device.json','data\device-identity.json');$hashes=@{};foreach($relative in $files){$hashes[$relative]=(Get-FileHash -LiteralPath (Join-Path $target $relative) -Algorithm SHA256).Hash}
 Add-Content -LiteralPath (Join-Path $target 'agent.mjs') -Value '// update-only must replace this marker' -Encoding UTF8
 $oldProgram=(Get-FileHash -LiteralPath (Join-Path $target 'agent.mjs') -Algorithm SHA256).Hash
 $masterFile=Join-Path $target 'data\keys\master.json'
 Move-Item -LiteralPath $masterFile -Destination ($masterFile+'.retained')
 try{if((Run-Package $updater $target) -eq 0 -or (Test-Path -LiteralPath $masterFile)){throw 'Atualizador gerou uma chave master nova.'};if((Get-FileHash -LiteralPath (Join-Path $target 'agent.mjs') -Algorithm SHA256).Hash -ne $oldProgram){throw 'Programa foi substituído antes da validação.'}}
 finally{Move-Item -LiteralPath ($masterFile+'.retained') -Destination $masterFile}
 if((Run-Package $updater $target) -ne 0){throw 'Atualização dedicada do master falhou.'}
 $after=Ready
 foreach($relative in $files){if((Get-FileHash -LiteralPath (Join-Path $target $relative) -Algorithm SHA256).Hash -ne $hashes[$relative]){throw ('Chave alterada: '+$relative)}}
 if($after.localDeviceId -ne $device -or $after.routines.Count -ne 1 -or $after.preferences.$device.destinations[0].path -ne $backupPath){throw 'Identidade, rotina ou preferências foram alteradas.'}
 if((Get-FileHash -LiteralPath (Join-Path $target 'agent.mjs') -Algorithm SHA256).Hash -eq $oldProgram){throw 'Programa não foi atualizado.'}
 $restored=Wait-Job (Api 'jobs' @{kind='restore';run=$backup.run;path='before.txt';target=$restorePath})
 if([IO.File]::ReadAllText((Join-Path $restored.destination 'before.txt')) -ne 'master key remains valid'){throw 'Backup antigo não foi restaurado.'}
 'Atualizador Master 0.25.0 para 0.29.0: primeira instalação bloqueada, chave ausente sem regeneração, chaves idênticas, cadastro/rotinas/preferências preservados e backup Restic anterior restaurado: OK.'
}finally{
 $uninstall=Join-Path $target 'Uninstall.exe';if(Test-Path -LiteralPath $uninstall){$p=Start-Process -FilePath $uninstall -ArgumentList @('/S',('_?='+$target)) -PassThru;if(-not $p.WaitForExit(60000)){$p.Kill();throw 'Limpeza do teste excedeu o prazo.'}}
 if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}
}
