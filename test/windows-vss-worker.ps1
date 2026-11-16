# Run the worker function on an isolated Windows test machine, without a SYSTEM
# broker or real snapshots. The fixture is controlled by this test only.
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$repo=Split-Path $PSScriptRoot -Parent
$script:workerRoot=Join-Path $env:TEMP ('BackupDesk VSS Worker '+[guid]::NewGuid().ToString('N'))
$state=Join-Path $script:workerRoot 'state'
New-Item -ItemType Directory -Path $state -Force | Out-Null
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'windows\vss-broker.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors.Message -join '; ')}
$function=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-OwnedVss'},$true)
if(-not $function){throw 'Worker VSS não encontrado.'}
# Reduce only the operation deadline in this isolated copy of the real function.
$body=$function.Extent.Text.Replace('$PSScriptRoot','$script:workerRoot').Replace('180000','2000')
. ([scriptblock]::Create($body))
$success=@'
$result=@{cleaned=$true}
if($BackupDeskVssResultFile){[IO.File]::WriteAllText($BackupDeskVssResultFile,(@{format='backupdesk-vss-result-v1';ok=$true;result=$result} | ConvertTo-Json -Compress),(New-Object Text.UTF8Encoding($false)))}else{$result | ConvertTo-Json -Compress}
'@
try{
 Set-Content -LiteralPath (Join-Path $script:workerRoot 'vss.ps1') -Value ($success+"`nexit 0") -Encoding UTF8
 $result=Invoke-OwnedVss @{action='cleanup'} ('b'*64)
 if(-not $result.cleaned){throw 'Worker normal não confirmou o resultado.'}
 # A descendant retains the redirected stdout/stderr handles after its parent
 # exits. The broker must not wait for that descendant's output EOF.
 $leak=@'
$grandchild=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList @('-NoLogo','-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 9') -NoNewWindow -PassThru
[IO.File]::WriteAllText((Join-Path (Split-Path $env:BACKUPDESK_VSS_LEDGER) 'descendant.pid'),[string]$grandchild.Id)
'@
 Set-Content -LiteralPath (Join-Path $script:workerRoot 'vss.ps1') -Value ($leak+"`n"+$success+"`nexit 0") -Encoding UTF8
 $clock=[Diagnostics.Stopwatch]::StartNew();$result=Invoke-OwnedVss @{action='cleanup'} ('b'*64);$clock.Stop()
 if(-not $result.cleaned -or $clock.ElapsedMilliseconds -gt 5000){throw ('Worker ficou esperando saída de um descendente após terminar: '+$clock.ElapsedMilliseconds+' ms.')}
 'VSS: worker encerrado com descendente vivo não bloqueia o componente: OK.'
 Set-Content -LiteralPath (Join-Path $script:workerRoot 'vss.ps1') -Value 'Start-Sleep -Seconds 20' -Encoding UTF8
 $failed=$false;$clock.Restart();try{$null=Invoke-OwnedVss @{action='cleanup'} ('b'*64)}catch{$failed=$true};$clock.Stop()
 if(-not $failed -or $clock.ElapsedMilliseconds -gt 8000){throw 'Worker bloqueado não terminou com erro dentro do limite.'}
 Set-Content -LiteralPath (Join-Path $script:workerRoot 'vss.ps1') -Value 'exit 0' -Encoding UTF8
 $failed=$false;try{$null=Invoke-OwnedVss @{action='cleanup'} ('b'*64)}catch{$failed=$true}
 if(-not $failed){throw 'Worker sem confirmação foi aprovado.'}
 Set-Content -LiteralPath (Join-Path $script:workerRoot 'vss.ps1') -Value ($success+"`nexit 0") -Encoding UTF8
 if(-not (Invoke-OwnedVss @{action='cleanup'} ('b'*64)).cleaned){throw 'Worker não se recuperou após as falhas.'}
 $workerAst=[Management.Automation.Language.Parser]::ParseFile((Join-Path $repo 'windows\vss.ps1'),[ref]$tokens,[ref]$errors)
 $publisher=$workerAst.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Write-VssReply'},$true)
 if(-not $publisher){throw 'Confirmação privada VSS não encontrada.'};. ([scriptblock]::Create($publisher.Extent.Text))
 $env:BACKUPDESK_VSS_LEDGER=Join-Path $state (('b'*64)+'.json')
 $BackupDeskVssResultFile=Join-Path $state ('reply-'+[guid]::NewGuid().ToString('N')+'.json')
 Write-VssReply @{cleaned=$true};$document=[IO.File]::ReadAllText($BackupDeskVssResultFile) | ConvertFrom-Json
 if(-not $document.ok -or -not $document.result.cleaned){throw 'Confirmação privada não foi persistida.'}
 $failed=$false;try{Write-VssReply @{cleaned=$false}}catch{$failed=$true};if(-not $failed){throw 'Confirmação existente foi sobrescrita.'}
 $BackupDeskVssResultFile=Join-Path $script:workerRoot ('reply-'+[guid]::NewGuid().ToString('N')+'.json')
 $failed=$false;try{Write-VssReply @{cleaned=$true}}catch{$failed=$true};if(-not $failed -or (Test-Path -LiteralPath $BackupDeskVssResultFile)){throw 'Resultado foi escrito fora da pasta privada do ledger.'}
 $BackupDeskVssResultFile=$null
 'VSS: confirmação privada não sobrescreve arquivos nem aceita outro diretório: OK.'
 'VSS: prazo do worker, confirmação obrigatória e operação seguinte após falha: OK.'
}finally{
 $pidFile=Join-Path $state 'descendant.pid'
 if(Test-Path -LiteralPath $pidFile){$descendant=Get-Process -Id ([int][IO.File]::ReadAllText($pidFile)) -ErrorAction SilentlyContinue;if($descendant -and $descendant.ProcessName -eq 'powershell'){$descendant.Kill();$descendant.WaitForExit(5000) | Out-Null}}
 if(Test-Path -LiteralPath $script:workerRoot){Remove-Item -LiteralPath $script:workerRoot -Recurse -Force}
}
