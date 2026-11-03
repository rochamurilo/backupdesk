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
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$component=Join-Path ([Environment]::GetFolderPath('ProgramFiles')) 'BackupDesk VSS\master'
$env:BACKUPDESK_VSS_PRODUCT='master';$env:BACKUPDESK_VSS_OWNER_SID=$sid;$env:BACKUPDESK_VSS_REMOVE='0'
$clientScript=Join-Path $repo 'windows\vss-client.ps1'
$powerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$fixture=Join-Path $env:TEMP ('backupdesk-vss-'+[guid]::NewGuid().ToString('N')+'.pst')
$handle=$null;$snapshot=$null
function Invoke-Client($Request){
 $Request.protocol=1;if(-not $Request.client){$Request.client=$key}
 $env:BACKUPDESK_VSS_REQUEST=$Request | ConvertTo-Json -Compress
 $out=& $powerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $clientScript 2>&1
 if($LASTEXITCODE -ne 0){throw ($out -join "`n")}
 return (($out -join "`n") | ConvertFrom-Json)
}
try{
 New-Item -ItemType Directory -Path $component -Force | Out-Null
 foreach($file in @('install-vss-component.ps1','vss-broker.ps1','vss-protocol.ps1','vss.ps1')){Copy-Item -LiteralPath (Join-Path $repo ('windows\'+$file)) -Destination $component -Force}
 & $powerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $component 'install-vss-component.ps1')
 if($LASTEXITCODE -ne 0){throw 'Instalação do componente falhou.'}
 $task=Get-ScheduledTask -TaskName ('BackupDeskVSS-master-'+$sid)
 if($task.Principal.UserId -notin @('SYSTEM','S-1-5-18')){throw 'A conta do componente não é SYSTEM.'}
 $probe=Invoke-Client @{action='probe'};if(-not $probe.automatic){throw 'Componente não responde.'}
 $payload=[Text.Encoding]::UTF8.GetBytes('Arquivo de teste bloqueado; não é um PST real do Outlook.')
 [IO.File]::WriteAllBytes($fixture,$payload)
 $handle=[IO.File]::Open($fixture,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 $blocked=$false;try{$null=[IO.File]::ReadAllBytes($fixture)}catch{$blocked=$true};if(-not $blocked){throw 'Arquivo de teste não foi bloqueado.'}
 $volume=[IO.Path]::GetPathRoot($fixture)
 $snapshot=Invoke-Client @{action='create';volume=$volume}
 $env:BACKUPDESK_TEST_SNAPSHOT=$snapshot.device+'\'+$fixture.Substring($volume.Length)
 $env:BACKUPDESK_TEST_CONTENT=[Convert]::ToBase64String($payload)
 node --input-type=module -e "import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';assert.equal((await readFile(process.env.BACKUPDESK_TEST_SNAPSHOT)).toString('base64'),process.env.BACKUPDESK_TEST_CONTENT);console.log('Snapshot real leu arquivo bloqueado: OK')"
 if($LASTEXITCODE -ne 0){throw 'Não foi possível ler o snapshot real.'}
 $refused=$false;try{$null=Invoke-Client @{action='delete';id=$snapshot.id;client=('c'*64)}}catch{$refused=$true}
 if(-not $refused){throw 'Outra instalação conseguiu remover o snapshot.'}
 $removedId=$snapshot.id;$null=Invoke-Client @{action='delete';id=$snapshot.id};$snapshot=$null
 if(Get-CimInstance Win32_ShadowCopy -Filter ("ID = '"+$removedId+"'")){throw 'Snapshot não removido.'}
 $env:BACKUPDESK_TEST_SOURCE=$fixture
 $env:BACKUPDESK_TEST_DEST=Join-Path $env:TEMP ('backupdesk-destination-'+[guid]::NewGuid().ToString('N'))
 New-Item -ItemType Directory -Path $env:BACKUPDESK_TEST_DEST | Out-Null
 node --input-type=module -e "import {backupToDisk} from './disk-backup.mjs';import {readFile} from 'node:fs/promises';import assert from 'node:assert/strict';const result=await backupToDisk({source:process.env.BACKUPDESK_TEST_SOURCE,destination:process.env.BACKUPDESK_TEST_DEST,device:'native',routine:1,run:'native',useVss:true});assert.equal(result.consistency,'vss-crash-consistent-no-writers');assert.equal((await readFile(result.snapshot+'/files/'+result.files[0].path)).toString('base64'),process.env.BACKUPDESK_TEST_CONTENT);console.log('Motor de backup real com VSS automático e arquivo bloqueado: OK');"
 if($LASTEXITCODE -ne 0){throw 'O motor de backup VSS falhou.'}
 $null=Invoke-Client @{action='cleanup'}
 'Windows: tarefa SYSTEM, pipe autenticado, snapshot de arquivo bloqueado, isolamento e limpeza: OK.'
 'A recuperação lógica de um PST real com Outlook aberto não foi testada.'
}finally{
 if($handle){$handle.Dispose()}
 if($snapshot){try{$null=Invoke-Client @{action='delete';id=$snapshot.id}}catch{Write-Warning $_}}
 if($env:BACKUPDESK_TEST_DEST -and (Test-Path -LiteralPath $env:BACKUPDESK_TEST_DEST)){Remove-Item -LiteralPath $env:BACKUPDESK_TEST_DEST -Recurse -Force}
 if(Test-Path -LiteralPath $fixture){Remove-Item -LiteralPath $fixture -Force}
 if(Test-Path -LiteralPath (Join-Path $component 'install-vss-component.ps1')){
  $env:BACKUPDESK_VSS_REMOVE='1'
  & $powerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $component 'install-vss-component.ps1')
  if($LASTEXITCODE -ne 0){throw 'Limpeza do componente de teste falhou.'}
 }
}
