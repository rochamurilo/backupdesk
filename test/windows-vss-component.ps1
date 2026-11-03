# Runs on an administrator Windows test runner, not on the installed user's desktop.
$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
foreach($file in Get-ChildItem (Join-Path $repo 'windows') -Filter '*.ps1'){
 $tokens=$null;$errors=$null
 $null=[System.Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
 if($errors.Count){throw ($file.Name+': '+($errors.Message -join '; '))}
}
. (Join-Path $repo 'windows\vss-protocol.ps1')
$key='b'*64
foreach($bad in @(
 @{protocol=1;client=$key;action='execute';command='cmd.exe'},
 @{protocol=1;client=$key;action='cleanup';ledger='C:\Windows'},
 @{protocol=1;client='..\..';action='cleanup'},
 @{protocol=1;client=$key;action='create';volume='\\server\share'},
 @{protocol=1;client=$key;action='delete';id='invalid'},
 @{protocol=2;client=$key;action='probe'}
)){
 $rejected=$false;try{$null=ConvertTo-VssCommand ([pscustomobject]$bad)}catch{$rejected=$true}
 if(-not $rejected){throw 'Pedido privilegiado indevido foi aceito.'}
}
$userName='bkd'+[guid]::NewGuid().ToString('N').Substring(0,12)
$passwordText='A7!'+[guid]::NewGuid().ToString('N')
$password=ConvertTo-SecureString $passwordText -AsPlainText -Force
$env:BACKUPDESK_TEST_STAGE='create-user'
$user=New-LocalUser -Name $userName -Password $password -PasswordNeverExpires -AccountNeverExpires
$sid=$user.SID.Value
$component=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'BackupDesk VSS\master'
$testRoot=Join-Path $env:PUBLIC ('BackupDesk-Test-'+[guid]::NewGuid().ToString('N'))
$testTask='BackupDesk-StandardUser-Test-'+$userName
$env:BACKUPDESK_VSS_PRODUCT='master';$env:BACKUPDESK_VSS_OWNER_SID=$sid;$env:BACKUPDESK_VSS_REMOVE='0'
$powerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
try{
 if(-not (Get-LocalGroupMember -SID 'S-1-5-32-545' | Where-Object {$_.SID.Value -eq $sid})){Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $userName}
 New-Item -ItemType Directory -Path $component -Force | Out-Null
 foreach($file in @('install-vss-component.ps1','vss-broker.ps1','vss-protocol.ps1','vss.ps1')){Copy-Item -LiteralPath (Join-Path $repo ('windows\'+$file)) -Destination $component -Force}
 $env:BACKUPDESK_TEST_STAGE='install-component'
 & $powerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $component 'install-vss-component.ps1')
 if($LASTEXITCODE -ne 0){throw 'Instalação do componente falhou.'}
 $task=Get-ScheduledTask -TaskName ('BackupDeskVSS-master-'+$sid)
 if($task.Principal.UserId -notin @('SYSTEM','S-1-5-18')){throw 'A conta do componente não é SYSTEM.'}
 New-Item -ItemType Directory -Path (Join-Path $testRoot 'agent\windows') -Force | Out-Null
 foreach($file in @('disk-backup.mjs','filesystem.mjs','vss.mjs')){Copy-Item -LiteralPath (Join-Path $repo $file) -Destination (Join-Path $testRoot 'agent')}
 Copy-Item -LiteralPath (Join-Path $repo 'windows\vss-client.ps1') -Destination (Join-Path $testRoot 'agent\windows')
 Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'windows-vss-user.ps1') -Destination (Join-Path $testRoot 'run.ps1')
 Copy-Item -LiteralPath (Get-Command node.exe).Source -Destination (Join-Path $testRoot 'node.exe')
 $acl=Get-Acl -LiteralPath $testRoot
 $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($user.SID,'Modify','ContainerInherit,ObjectInherit','None','Allow')))
 Set-Acl -LiteralPath $testRoot -AclObject $acl
 $action=New-ScheduledTaskAction -Execute $powerShell -Argument ('-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+(Join-Path $testRoot 'run.ps1')+'"')
 $env:BACKUPDESK_TEST_STAGE='register-user-test'
 Register-ScheduledTask -TaskName $testTask -Action $action -User ($env:COMPUTERNAME+'\'+$userName) -Password $passwordText -RunLevel Limited -Force | Out-Null
 $passwordText=$null
 $env:BACKUPDESK_TEST_STAGE='start-user-test'
 Start-ScheduledTask -TaskName $testTask
 $env:BACKUPDESK_TEST_STAGE='wait-user-result'
 $resultFile=Join-Path $testRoot 'result.json'
 for($i=0;$i -lt 900;$i++){
  if(Test-Path -LiteralPath $resultFile){break}
  if($i -gt 10 -and (Get-ScheduledTask -TaskName $testTask).State -ne 'Running'){
   $info=Get-ScheduledTaskInfo -TaskName $testTask
   if($info.LastTaskResult -ne 0 -and ($info.LastTaskResult -lt 267008 -or $info.LastTaskResult -gt 267263)){throw ('O teste do usuário comum encerrou com código Windows: '+$info.LastTaskResult)}
  };Start-Sleep -Milliseconds 500
 }
 if(-not (Test-Path -LiteralPath $resultFile)){throw 'O cliente de teste não concluiu dentro do prazo.'}
 $result=Get-Content -Raw -LiteralPath $resultFile | ConvertFrom-Json
 if(-not $result.success){throw ($result.error+' '+$result.stack)}
 if(-not $result.nonAdministrator){throw 'O cliente de teste não comprovou execução sem administrador.'}
 'Windows: usuário comum, tarefa SYSTEM, pipe autenticado, arquivo bloqueado, motor VSS e limpeza: OK.'
 'PST real com Outlook aberto não foi validado.'
}catch{$env:BACKUPDESK_TEST_FAILURE_STAGE=$env:BACKUPDESK_TEST_STAGE;throw}
finally{
 if(Get-ScheduledTask -TaskName $testTask -ErrorAction SilentlyContinue){Stop-ScheduledTask -TaskName $testTask;Unregister-ScheduledTask -TaskName $testTask -Confirm:$false}
 if(Test-Path -LiteralPath (Join-Path $component 'install-vss-component.ps1')){
  $env:BACKUPDESK_VSS_REMOVE='1'
  & $powerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $component 'install-vss-component.ps1')
  if($LASTEXITCODE -ne 0){Write-Error 'Limpeza do componente de teste falhou.'}
 }
 Remove-LocalUser -Name $userName -ErrorAction SilentlyContinue
 if(Test-Path -LiteralPath $testRoot){Remove-Item -LiteralPath $testRoot -Recurse -Force}
}
