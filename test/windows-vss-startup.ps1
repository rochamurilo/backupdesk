# Real Task Scheduler startup, isolated from application data and VSS snapshots.
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$repo=Split-Path $PSScriptRoot -Parent
$userName='bkstart'+[guid]::NewGuid().ToString('N').Substring(0,10)
$user=New-LocalUser -Name $userName -Password (ConvertTo-SecureString ('A7!'+[guid]::NewGuid().ToString('N')) -AsPlainText -Force) -PasswordNeverExpires
$sid=$user.SID.Value;$product='client';$taskName='BackupDeskVSS-'+$product+'-'+$sid
$component=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'BackupDesk VSS\client'
$state=Join-Path $component ('state\'+$sid)
$powerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$broker=[IO.File]::ReadAllText((Join-Path $repo 'windows\vss-broker.ps1'),[Text.Encoding]::UTF8)
$env:BACKUPDESK_VSS_OWNER_SID=$sid;$env:BACKUPDESK_VSS_PRODUCT=$product;$env:BACKUPDESK_VSS_REMOVE='0'
Remove-Item Env:BACKUPDESK_UPDATE_DIR -ErrorAction SilentlyContinue
function Assert-TestReady {
 $ready=Get-Content -Raw -LiteralPath (Join-Path $state 'ready.json') | ConvertFrom-Json
 $arguments=(Get-ScheduledTask -TaskName $taskName).Actions[0].Arguments
 $generation=[regex]::Match($arguments,'-StartupId ([a-f0-9]{32})')
 if(-not $generation.Success -or $ready.startup_id -ne $generation.Groups[1].Value -or $ready.status -ne 'ready'){throw 'An earlier generation confirmed VSS startup.'}
 $process=Get-Process -Id ([int]$ready.pid) -ErrorAction Stop
 if([string]$process.StartTime.ToUniversalTime().Ticks -ne [string]$ready.process_started_at){throw 'A dead or different process confirmed VSS startup.'}
}
function Invoke-TestInstall {
 $preference=$ErrorActionPreference
 try{
  $ErrorActionPreference='Continue'
  $output=& $powerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $component 'install-vss-component.ps1') 2>&1
  $status=$LASTEXITCODE
 }finally{$ErrorActionPreference=$preference}
 return @{status=$status;text=($output -join "`n")}
}
try{
 # PowerShell 5.1 coerces $null string arguments to an empty path. Exercise
 # actual replacement as well as initial creation before testing the task.
 $publisherRoot=Join-Path $env:TEMP ('bkd-startup-publisher-'+[guid]::NewGuid().ToString('N'))
 New-Item -ItemType Directory -Path $publisherRoot | Out-Null
 try{
  $tokens=$null;$errors=$null
  $ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'windows\vss-broker.ps1'),[ref]$tokens,[ref]$errors)
  $publisher=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Write-VssStartupRecord'},$true)
  if(-not $publisher){throw 'Startup publisher was not found.'}
  . ([scriptblock]::Create($publisher.Extent.Text))
  $savedState=$state;$state=$publisherRoot;$StartupId=[guid]::NewGuid().ToString('N')
  foreach($status in @('starting','starting','ready','ready','failed')){Write-VssStartupRecord $status 'publisher-test'}
  if((Get-Content -Raw -LiteralPath (Join-Path $state 'ready.json') | ConvertFrom-Json).status -ne 'ready'){throw 'Readiness replacement failed.'}
 }finally{$state=$savedState;Remove-Item -LiteralPath $publisherRoot -Recurse -Force}
 'VSS installer: atomic startup state replacement under Windows PowerShell: OK.'
 New-Item -ItemType Directory -Path $component -Force | Out-Null
 foreach($file in @('install-vss-component.ps1','vss-broker.ps1','vss-protocol.ps1','vss.ps1','update-application.ps1')){Copy-Item -LiteralPath (Join-Path $repo ('windows\'+$file)) -Destination $component -Force}
 # A cold/loaded computer can take more than the previous 15-second deadline.
 $delayed=$broker.Replace('$ErrorActionPreference=''Stop''',('Start-Sleep -Seconds 20'+"`r`n"+'$ErrorActionPreference=''Stop'''))
 [IO.File]::WriteAllText((Join-Path $component 'vss-broker.ps1'),$delayed,(New-Object Text.UTF8Encoding($true)))
 $clock=[Diagnostics.Stopwatch]::StartNew();$result=Invoke-TestInstall;$clock.Stop()
 if($result.status -ne 0 -or $clock.ElapsedMilliseconds -lt 19000){throw ('Delayed VSS startup failed: '+$clock.ElapsedMilliseconds+' ms; '+$result.text)}
 Assert-TestReady
 'VSS installer: startup slower than 15 seconds succeeds: OK.'
 # A stale marker must not approve installation before the new broker starts.
 $stale=@'
$testState=Join-Path $PSScriptRoot ('state\'+$UserSid)
$fake=@{format='backupdesk-vss-startup-v1';startup_id=('a'*32);status='ready';protocol=1;pid=1;process_started_at='1'}
$fake | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $testState 'ready.json') -Encoding UTF8
Start-Sleep -Seconds 5
$fake.startup_id=$StartupId
$fake | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $testState 'ready.json') -Encoding UTF8
Start-Sleep -Seconds 15
'@
 $modified=$broker.Replace('$ErrorActionPreference=''Stop''',($stale+"`r`n"+'$ErrorActionPreference=''Stop'''))
 [IO.File]::WriteAllText((Join-Path $component 'vss-broker.ps1'),$modified,(New-Object Text.UTF8Encoding($true)))
 $clock.Restart();$result=Invoke-TestInstall;$clock.Stop()
 if($result.status -ne 0 -or $clock.ElapsedMilliseconds -lt 19000){throw ('Stale marker approved VSS startup: '+$clock.ElapsedMilliseconds+' ms; '+$result.text)}
 Assert-TestReady
 'VSS installer: a previous startup cannot confirm the new component: OK.'
 # Report initialization failures from this attempt, rather than old backup logs.
 [IO.File]::WriteAllText((Join-Path $component 'vss-broker.ps1'),$broker,(New-Object Text.UTF8Encoding($true)))
 Remove-Item -LiteralPath (Join-Path $component 'vss-protocol.ps1') -Force
 Set-Content -LiteralPath (Join-Path $state 'broker.log') -Value 'OLD UNRELATED BACKUP ERROR'
 $clock.Restart();$result=Invoke-TestInstall;$clock.Stop()
 if($result.status -eq 0 -or $result.text -notlike '*load-protocol*' -or $result.text -like '*OLD UNRELATED*' -or $clock.ElapsedMilliseconds -gt 30000){throw ('Current startup failure was not reported: '+$clock.ElapsedMilliseconds+' ms; '+$result.text)}
 Copy-Item -LiteralPath (Join-Path $repo 'windows\vss-protocol.ps1') -Destination $component -Force
 $result=Invoke-TestInstall;if($result.status -ne 0){throw ('VSS repair did not recover after initialization failure: '+$result.text)}
 $ready=Get-Content -Raw -LiteralPath (Join-Path $state 'ready.json') | ConvertFrom-Json
 if($ready.status -ne 'ready' -or $ready.startup_id -notmatch '^[a-f0-9]{32}$' -or (Get-ScheduledTask -TaskName $taskName).State -ne 'Running'){throw 'A live component did not confirm the repaired installation.'}
 'VSS installer: current initialization error, bounded failure and repair: OK.'
}finally{
 $env:BACKUPDESK_VSS_REMOVE='1'
 if(Test-Path -LiteralPath (Join-Path $component 'vss-protocol.ps1')){$null=Invoke-TestInstall}
 if(Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue){Stop-ScheduledTask -TaskName $taskName;Unregister-ScheduledTask -TaskName $taskName -Confirm:$false}
 Remove-LocalUser -Name $userName -ErrorAction SilentlyContinue
 if(Test-Path -LiteralPath $state){Remove-Item -LiteralPath $state -Recurse -Force}
}
