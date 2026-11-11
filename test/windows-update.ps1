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
  New-Item -ItemType Directory -Path (Join-Path $root 'windows') -Force | Out-Null
  Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $root 'windows\restic.exe')
  Set-Content -LiteralPath (Join-Path $root 'agent.mjs') -Value 'setInterval(()=>{},1000);'
  Set-Content -LiteralPath (Join-Path $root 'server.mjs') -Value 'setInterval(()=>{},1000);'
 }
 Set-Content -LiteralPath (Join-Path $target 'master.mjs') -Value "import {spawn} from 'node:child_process';spawn(process.execPath,['server.mjs'],{stdio:'ignore'});setInterval(()=>{},1000);"
 $process=Start-Process -FilePath (Join-Path $target 'node.exe') -ArgumentList 'master.mjs' -WorkingDirectory $target -PassThru -WindowStyle Hidden
 $unrelated=Start-Process -FilePath (Join-Path $other 'node.exe') -ArgumentList 'server.mjs' -WorkingDirectory $other -PassThru -WindowStyle Hidden
 $resticProcess=Start-Process -FilePath (Join-Path $target 'windows\restic.exe') -ArgumentList (Join-Path $target 'agent.mjs') -PassThru -WindowStyle Hidden
 $otherRestic=Start-Process -FilePath (Join-Path $other 'windows\restic.exe') -ArgumentList (Join-Path $other 'agent.mjs') -PassThru -WindowStyle Hidden
 Start-Sleep -Seconds 2
 Stop-BackupDeskInstallation $target
 if(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object {$_.ExecutablePath -eq (Join-Path $target 'node.exe')}){throw 'Os processos da instalação continuaram ativos.'}
 $resticProcess.Refresh();if(-not $resticProcess.HasExited){throw 'O Restic da instalação permaneceu ativo.'}
 $otherRestic.Refresh();if($otherRestic.HasExited){throw 'Um Restic de outra instalação foi encerrado.'}
 $unrelated.Refresh();if($unrelated.HasExited){throw 'Um processo Node.js de outra pasta foi encerrado.'}
 if(-not (Test-Path -LiteralPath (Join-Path $target 'data\update-lock.json'))){throw 'Proteção contra reinício não foi criada.'}
 # Windows retains a terminated process object while its handle is open. A second
 # TerminateProcess can return ERROR_ACCESS_DENIED even though shutdown succeeded.
 $exited=Start-Process -FilePath (Join-Path $target 'node.exe') -ArgumentList 'agent.mjs' -WorkingDirectory $target -PassThru -WindowStyle Hidden
 try{
  $retainedHandle=$exited.Handle
  $exited.Kill();$exited.WaitForExit()
  if(-not [BackupDesk.UpdateProcesses]::Stop($exited.Id,(Join-Path $target 'node.exe'))){throw 'O processo encerrado não foi reconhecido.'}
 }finally{$exited.Dispose()}
 'Windows: processo já encerrado, com handle retido, não bloqueia a atualização: OK.'
 # Exercise the narrow exit race deterministically, using real Win32 calls:
 # terminate after image verification, then repeat termination on that handle.
 $source=Get-Content -Raw -LiteralPath (Join-Path $repo 'windows\update-application.ps1')
 $native=[regex]::Match($source,"(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@").Groups[1].Value
 if(-not $native){throw 'Código de encerramento não encontrado para o teste de concorrência.'}
 $declaration='[DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr h,uint exitCode);'
 $race='[DllImport("kernel32.dll", EntryPoint="TerminateProcess", SetLastError=true)] static extern bool NativeTerminateProcess(IntPtr h,uint exitCode); static bool TerminateProcess(IntPtr h,uint exitCode) { if(!NativeTerminateProcess(h,exitCode))return false; WaitForSingleObject(h,5000); return NativeTerminateProcess(h,exitCode); }'
 if(-not $native.Contains($declaration)){throw 'Declaração Win32 mudou; revise o teste de concorrência.'}
 Add-Type -TypeDefinition ($native.Replace('UpdateProcesses','ExitRaceProcesses').Replace($declaration,$race))
 $racing=Start-Process -FilePath (Join-Path $target 'node.exe') -ArgumentList 'agent.mjs' -WorkingDirectory $target -PassThru -WindowStyle Hidden
 try{
  $retainedHandle=$racing.Handle
  if(-not [BackupDesk.ExitRaceProcesses]::Stop($racing.Id,(Join-Path $target 'node.exe'))){throw 'Encerramento concorrente não foi confirmado.'}
  if(-not $racing.WaitForExit(5000)){throw 'Processo concorrente permaneceu ativo.'}
 }finally{if(-not $racing.HasExited){$racing.Kill()};$racing.Dispose()}
 # A real access denial while the process is alive must still abort the update.
 $denied='[DllImport("kernel32.dll", EntryPoint="SetLastError", SetLastError=true)] static extern void SetError(uint code); static bool TerminateProcess(IntPtr h,uint exitCode) { SetError(5); return false; }'
 Add-Type -TypeDefinition ($native.Replace('UpdateProcesses','DeniedProcesses').Replace($declaration,$denied))
 $alive=Start-Process -FilePath (Join-Path $target 'node.exe') -ArgumentList 'agent.mjs' -WorkingDirectory $target -PassThru -WindowStyle Hidden
 try{
  $blocked=$false;try{$null=[BackupDesk.DeniedProcesses]::Stop($alive.Id,(Join-Path $target 'node.exe'))}catch{$blocked=$true}
  $alive.Refresh();if(-not $blocked -or $alive.HasExited){throw 'Acesso negado real não bloqueou a atualização com processo ativo.'}
 }finally{if(-not $alive.HasExited){$alive.Kill();$alive.WaitForExit()};$alive.Dispose()}
 'Windows: corrida de encerramento reproduzida com Win32 real; acesso negado em processo ativo continua bloqueado: OK.'
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
 foreach($root in @($target,$other)){Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='restic.exe'" | Where-Object {$_.ExecutablePath -eq (Join-Path $root 'node.exe') -or $_.ExecutablePath -eq (Join-Path $root 'windows\restic.exe')} | ForEach-Object {Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue}}
 Start-Sleep -Milliseconds 500
 if(Test-Path -LiteralPath $dir){Remove-Item -LiteralPath $dir -Recurse -Force}
}
