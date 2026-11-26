# Real Windows named pipes; no services, snapshots, credentials or application data.
$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$module=Join-Path (Split-Path $PSScriptRoot -Parent) 'windows\vss-io.ps1'
. $module
$root=Join-Path $env:TEMP ('bkd-pipe-'+[guid]::NewGuid().ToString('N'))
$pipeName='BackupDesk-Pipe-Test-'+[guid]::NewGuid().ToString('N')
$children=New-Object Collections.ArrayList
$connections=New-Object Collections.ArrayList
New-Item -ItemType Directory -Path $root | Out-Null
$fixture=Join-Path $root 'client.ps1'
@'
param([string]$Name,[string]$Mode,[string]$Module,[string]$Result)
$ErrorActionPreference='Stop'
. $Module
$pipe=New-Object IO.Pipes.NamedPipeClientStream('.',$Name,[IO.Pipes.PipeDirection]::InOut,[IO.Pipes.PipeOptions]::Asynchronous)
try{
 $pipe.Connect(10000)
 switch($Mode){
  fragmented {
   foreach($value in [Text.Encoding]::UTF8.GetBytes('{"text":"ação"}'+"`r`n")){$pipe.WriteByte($value);Start-Sleep -Milliseconds 5}
   $answer=Read-BackupDeskPipeLine $pipe 5000 65536
   [IO.File]::WriteAllText($Result,$answer)
  }
  normal {Write-BackupDeskPipeLine $pipe '{}';$answer=Read-BackupDeskPipeLine $pipe 5000 65536;[IO.File]::WriteAllText($Result,$answer)}
  partial {$pipe.Write([Text.Encoding]::UTF8.GetBytes('{"action":'),0,10);Start-Sleep -Seconds 5}
  nonreader {Write-BackupDeskPipeLine $pipe '{}';Start-Sleep -Seconds 5}
  disconnect {Write-BackupDeskPipeLine $pipe '{}'}
  invalid {$pipe.WriteByte(255);$pipe.WriteByte(10);Start-Sleep -Seconds 5}
  oversized {$bytes=[Text.Encoding]::UTF8.GetBytes(('a'*2048));$pipe.Write($bytes,0,$bytes.Length);Start-Sleep -Seconds 5}
  default {throw 'Invalid test mode.'}
 }
}finally{Close-BackupDeskPipe $pipe}
'@ | Set-Content -LiteralPath $fixture -Encoding UTF8
function New-TestConnection([string]$Mode){
 $pipe=$null
 for($attempt=0;$attempt -lt 40;$attempt++){
  try{$pipe=New-Object IO.Pipes.NamedPipeServerStream($pipeName,[IO.Pipes.PipeDirection]::InOut,1,[IO.Pipes.PipeTransmissionMode]::Byte,[IO.Pipes.PipeOptions]::Asynchronous,512,512);break}
  catch{if($attempt -eq 39){throw};Start-Sleep -Milliseconds 25}
 }
 [void]$connections.Add($pipe)
 $waiting=$pipe.WaitForConnectionAsync()
 $result=Join-Path $root ([guid]::NewGuid().ToString('N')+'.json')
 $arguments='-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "'+$fixture+'" -Name '+$pipeName+' -Mode '+$Mode+' -Module "'+$module+'" -Result "'+$result+'"'
 $child=Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru
 [void]$children.Add($child)
 if(-not $waiting.Wait(15000)){throw 'Fixture did not connect.'}
 $waiting.GetAwaiter().GetResult()
 return @{pipe=$pipe;process=$child;result=$result}
}
function Assert-NextConnection {
 $next=New-TestConnection 'normal'
 try{
  $request=Read-BackupDeskPipeLine $next.pipe 2000
  if($request -ne '{}'){throw 'Next request was corrupted.'}
  Write-BackupDeskPipeLine $next.pipe '{"ok":true}'
  if(-not $next.process.WaitForExit(10000) -or $next.process.ExitCode -ne 0 -or -not (Get-Content -Raw -LiteralPath $next.result | ConvertFrom-Json).ok){throw 'Pipe did not recover.'}
 }finally{Close-BackupDeskPipe $next.pipe}
}
try{
 $fragmented=New-TestConnection 'fragmented'
 try{
  $decoded=(Read-BackupDeskPipeLine $fragmented.pipe 5000) | ConvertFrom-Json
  if($decoded.text -ne 'ação'){throw 'Fragmented UTF-8/CRLF was not preserved.'}
  Write-BackupDeskPipeLine $fragmented.pipe '{"ok":true}'
  if(-not $fragmented.process.WaitForExit(10000) -or $fragmented.process.ExitCode -ne 0){throw 'Fragmented client failed.'}
 }finally{Close-BackupDeskPipe $fragmented.pipe}
 foreach($mode in @('partial','invalid','oversized')){
  $connection=New-TestConnection $mode;$failed=$false;$clock=[Diagnostics.Stopwatch]::StartNew()
  try{$null=Read-BackupDeskPipeLine $connection.pipe 400 512}catch{$failed=$true}
  if(-not $failed -or $clock.ElapsedMilliseconds -gt 2500){throw ('Invalid/stalled request did not fail within deadline: '+$mode)}
  if($mode -ne 'oversized' -and $connection.process.HasExited){throw ('Fixture closed before server recovery could be tested: '+$mode)}
  # Same pipe name, while the abandoned client still has its endpoint open.
  Assert-NextConnection
 }
 $connection=New-TestConnection 'nonreader';$null=Read-BackupDeskPipeLine $connection.pipe 2000
 $failed=$false;$clock.Restart()
 try{for($i=0;$i -lt 20;$i++){Write-BackupDeskPipeLine $connection.pipe ('{"data":"'+('x'*60000)+'"}') 400}}catch{$failed=$true}
 if(-not $failed -or $clock.ElapsedMilliseconds -gt 2500){throw 'Non-reading client blocked response indefinitely.'}
 Assert-NextConnection
 $connection=New-TestConnection 'disconnect';$null=Read-BackupDeskPipeLine $connection.pipe 2000
 if(-not $connection.process.WaitForExit(10000)){throw 'Disconnected fixture did not exit.'}
 $failed=$false;try{Write-BackupDeskPipeLine $connection.pipe '{"ok":true}'}catch{$failed=$true}
 if(-not $failed){throw 'Disconnected client unexpectedly accepted response.'}
 Close-BackupDeskPipe $connection.pipe;Assert-NextConnection
 'VSS pipe: fragmented UTF-8, CRLF, abandoned reads, invalid/oversized frames, blocked writes, broken connections and reconnection: OK.'
}finally{
 foreach($pipe in $connections){Close-BackupDeskPipe $pipe}
 foreach($child in $children){try{if(-not $child.HasExited){$child.Kill();[void]$child.WaitForExit(2000)}}finally{$child.Dispose()}}
 Remove-Item -LiteralPath $root -Recurse -Force
}
