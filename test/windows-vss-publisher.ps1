# Concurrent publication of real startup records in isolated temporary folders.
$ErrorActionPreference='Stop'
$root=Join-Path $env:TEMP ('bkd-publish-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $root | Out-Null
$children=New-Object Collections.ArrayList
$fixture=Join-Path $root 'publisher.ps1'
@'
param([string]$Broker,[string]$Root,[long]$StartAt)
$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($Broker,[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors.Message -join '; ')}
$function=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Write-VssStartupRecord'},$true)
. ([scriptblock]::Create($function.Extent.Text))
$StartupId=[guid]::NewGuid().ToString('N')
while([DateTime]::UtcNow.Ticks -lt $StartAt){Start-Sleep -Milliseconds 5}
for($index=0;$index -lt 20;$index++){
 $state=Join-Path $Root ([string]$index)
 [void][IO.Directory]::CreateDirectory($state)
 Write-VssStartupRecord 'starting' 'concurrency-test'
 Write-VssStartupRecord 'ready' 'concurrency-test'
}
'@ | Set-Content -LiteralPath $fixture -Encoding UTF8
try{
 $broker=Join-Path (Split-Path $PSScriptRoot -Parent) 'windows\vss-broker.ps1'
 $start=[DateTime]::UtcNow.AddSeconds(8).Ticks
 for($index=0;$index -lt 4;$index++){
  $arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$fixture+'" -Broker "'+$broker+'" -Root "'+$root+'" -StartAt '+$start
  [void]$children.Add((Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru))
 }
 foreach($child in $children){if(-not $child.WaitForExit(30000) -or $child.ExitCode -ne 0){throw 'Concurrent startup publication failed.'}}
 for($index=0;$index -lt 20;$index++){
  foreach($name in @('startup.json','ready.json')){
   $record=Get-Content -Raw -LiteralPath (Join-Path (Join-Path $root ([string]$index)) $name) | ConvertFrom-Json
   if($record.format -ne 'backupdesk-vss-startup-v1' -or $record.phase -ne 'concurrency-test' -or $record.startup_id -notmatch '^[a-f0-9]{32}$'){throw 'Concurrent publication produced an invalid record.'}
  }
 }
 if(@(Get-ChildItem -LiteralPath $root -Filter '*.tmp' -Recurse).Count){throw 'Publication left temporary files.'}
 'VSS startup: four concurrent publishers, 160 atomic writes, no check-then-move failure or partial JSON: OK.'
}finally{
 foreach($child in $children){try{if(-not $child.HasExited){$child.Kill();[void]$child.WaitForExit(2000)}}finally{$child.Dispose()}}
 Remove-Item -LiteralPath $root -Recurse -Force
}
