$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
. (Join-Path $repo 'windows\update-application.ps1')
$dir=Join-Path $env:TEMP ('BackupDesk-Update-Test-'+[guid]::NewGuid().ToString('N'))
$target=Join-Path $dir 'app';$other=Join-Path $dir 'other'
$process=$null;$unrelated=$null;$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
try{
 foreach($root in @($target,$other)){
  New-Item -ItemType Directory -Path $root -Force | Out-Null
  Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $root 'node.exe')
  Set-Content -LiteralPath (Join-Path $root 'agent.mjs') -Value 'setInterval(()=>{},1000);'
  Set-Content -LiteralPath (Join-Path $root 'server.mjs') -Value 'setInterval(()=>{},1000);'
 }
 Set-Content -LiteralPath (Join-Path $target 'master.mjs') -Value "import {spawn} from 'node:child_process';spawn(process.execPath,['server.mjs'],{stdio:'ignore'});setInterval(()=>{},1000);"
 $process=Start-Process -FilePath (Join-Path $target 'node.exe') -ArgumentList 'master.mjs' -WorkingDirectory $target -PassThru -WindowStyle Hidden
 $unrelated=Start-Process -FilePath (Join-Path $other 'node.exe') -ArgumentList 'server.mjs' -WorkingDirectory $other -PassThru -WindowStyle Hidden
 Start-Sleep -Seconds 2
 Stop-BackupDeskInstallation $target
 if(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.ExecutablePath -eq (Join-Path $target 'node.exe')}){throw 'Os processos da instalação continuaram ativos.'}
 $unrelated.Refresh();if($unrelated.HasExited){throw 'Um processo Node.js de outra pasta foi encerrado.'}
 if(-not (Test-Path -LiteralPath (Join-Path $target 'data\update-lock.json'))){throw 'Proteção contra reinício não foi criada.'}
 Register-BackupDeskStartup $target $sid 'master'
 $task=Get-ScheduledTask -TaskName ('BackupDesk-master-'+$sid)
 if($task.Principal.RunLevel -ne 'Limited' -or $task.Principal.LogonType -ne 'Interactive'){throw 'A inicialização não está no usuário normal.'}
 $expected=Join-Path (Get-BackupDeskDirectory $target) 'BackupDesk.exe'
 $actual=[IO.Path]::GetFullPath($task.Actions[0].Execute.Trim('"'))
 if($actual -ne $expected -or $task.Actions[0].Arguments.Trim() -ne '/background'){throw ('Inicialização incorreta: '+$actual+' '+$task.Actions[0].Arguments+'; esperado: '+$expected)}
 if(-not $task.Triggers){throw 'O gatilho de entrada no Windows não foi criado.'}
 Remove-BackupDeskStartup $sid 'master'
 if(Get-ScheduledTask -TaskName ('BackupDesk-master-'+$sid) -ErrorAction SilentlyContinue){throw 'A inicialização não foi removida.'}
 'Windows: atualização encerra supervisor e agentes elevados da própria pasta, preserva outros Node.js e registra início automático sem elevação: OK.'
}finally{
 Remove-BackupDeskStartup $sid 'master'
 foreach($root in @($target,$other)){Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.ExecutablePath -eq (Join-Path $root 'node.exe')} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}}
 Start-Sleep -Milliseconds 500
 if(Test-Path -LiteralPath $dir){Remove-Item -LiteralPath $dir -Recurse -Force}
}
