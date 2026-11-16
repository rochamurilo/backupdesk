param([Parameter(Mandatory=$true)][string]$UserSid,[Parameter(Mandatory=$true)][ValidateSet('master','client')][string]$Product)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if($UserSid -notmatch '^S-1-(?:\d+-)+\d+$'){throw 'SID inválido.'}
if([Security.Principal.WindowsIdentity]::GetCurrent().User.Value -ne 'S-1-5-18'){throw 'O componente VSS deve executar como SYSTEM.'}
. (Join-Path $PSScriptRoot 'vss-protocol.ps1')
$state=Join-Path $PSScriptRoot ('state\'+$UserSid)
New-Item -ItemType Directory -Path $state -Force | Out-Null
$pipeName='BackupDeskVSS-v1-'+$Product+'-'+$UserSid
$security=New-Object System.IO.Pipes.PipeSecurity
$systemSid=New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')
$ownerSid=New-Object System.Security.Principal.SecurityIdentifier($UserSid)
$security.SetOwner($systemSid)
$security.SetAccessRuleProtection($true,$false)
$security.AddAccessRule((New-Object System.IO.Pipes.PipeAccessRule($systemSid,[System.IO.Pipes.PipeAccessRights]::FullControl,[System.Security.AccessControl.AccessControlType]::Allow)))
$security.AddAccessRule((New-Object System.IO.Pipes.PipeAccessRule($ownerSid,[System.IO.Pipes.PipeAccessRights]::ReadWrite,[System.Security.AccessControl.AccessControlType]::Allow)))
function Invoke-OwnedVss($Command,$Key){
 # Do not overlap VSS operations if Windows has not completed cancellation.
 if($script:pendingVssWorker){
  if(-not $script:pendingVssWorker.process.HasExited){throw 'Uma operação VSS anterior ainda está terminando no Windows. Nenhuma nova operação foi iniciada.'}
  $script:pendingVssWorker.process.Dispose()
  Remove-Item -LiteralPath $script:pendingVssWorker.reply -Force -ErrorAction SilentlyContinue
  $script:pendingVssWorker=$null
 }
 $reply=Join-Path $state ('reply-'+[guid]::NewGuid().ToString('N')+'.json')
 $source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot 'vss.ps1'),[Text.Encoding]::UTF8).TrimStart([char]0xFEFF)
 # Both the script and reply location are fixed by this protected broker. The
 # unprivileged protocol never supplies script text, commands or output paths.
 $script='$BackupDeskVssResultFile = '+"'"+$reply.Replace("'","''")+"';"+"`r`n"+$source
 $info=New-Object System.Diagnostics.ProcessStartInfo
 $info.FileName=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
 $info.Arguments='-NoLogo -NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
 # A descendant may inherit redirected pipes and keep EOF pending after its
 # parent exits. Receive the bounded result in a private file instead.
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.EnvironmentVariables['BACKUPDESK_VSS_REQUEST']=($Command | ConvertTo-Json -Compress)
 $info.EnvironmentVariables['BACKUPDESK_VSS_LEDGER']=(Join-Path $state ($Key+'.json'))
 $child=New-Object System.Diagnostics.Process;$child.StartInfo=$info;$started=$false;$phase='start-worker'
 try{
  [void]$child.Start();$started=$true;$phase='wait-worker'
  if(-not $child.WaitForExit(180000)){
   $phase='stop-worker'
   try{$child.Kill()}catch{if(-not $child.HasExited){throw}}
   if(-not $child.WaitForExit(5000)){throw 'O Windows ainda não concluiu o cancelamento da operação VSS.'}
   throw 'Tempo da operação VSS excedido; o processo auxiliar foi encerrado. O registro dos snapshots foi preservado.'
  }
  $phase='read-result'
  if(-not (Test-Path -LiteralPath $reply) -or (Get-Item -LiteralPath $reply).Length -gt 65536){throw 'O processo VSS terminou sem uma confirmação válida.'}
  $document=[IO.File]::ReadAllText($reply,[Text.Encoding]::UTF8) | ConvertFrom-Json
  if($document.format -ne 'backupdesk-vss-result-v1' -or $document.ok -isnot [bool]){throw 'Confirmação do processo VSS inválida.'}
  if(-not $document.ok){throw [string]$document.error}
  if($child.ExitCode -ne 0 -or $null -eq $document.result){throw 'O processo VSS não confirmou a conclusão da operação.'}
  return $document.result
 }catch{throw ('VSS '+$Command.action+' ['+$phase+']: '+$_.Exception.Message)}
 finally{
  if($started -and -not $child.HasExited){$script:pendingVssWorker=@{process=$child;reply=$reply}}
  else{$child.Dispose();Remove-Item -LiteralPath $reply -Force -ErrorAction SilentlyContinue}
 }
}
$readyWritten=$false
function Write-BrokerLog([string]$Message){
 try{
  $log=Join-Path $state 'broker.log';if((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 1048576){Remove-Item -LiteralPath $log}
  Add-Content -LiteralPath $log -Value ((Get-Date -Format o)+' '+$Message)
 }catch{} # Diagnostic writes must not stop the component.
}
while($true){
 $pipe=$null;$reader=$null;$writer=$null
 try{
  $pipe=New-Object System.IO.Pipes.NamedPipeServerStream($pipeName,[System.IO.Pipes.PipeDirection]::InOut,1,[System.IO.Pipes.PipeTransmissionMode]::Byte,[System.IO.Pipes.PipeOptions]::Asynchronous,8192,8192,$security)
  if(-not $readyWritten){@{pid=$PID;protocol=1} | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $state 'ready.json') -Encoding UTF8;$readyWritten=$true}
  $pipe.WaitForConnection()
  $reader=New-Object System.IO.StreamReader($pipe,(New-Object System.Text.UTF8Encoding($false)),$false,1024,$true)
  $writer=New-Object System.IO.StreamWriter($pipe,(New-Object System.Text.UTF8Encoding($false)),1024,$true);$writer.AutoFlush=$true
  try{
   $buffer=New-Object char[] 512;$inputText='';$deadline=[DateTime]::UtcNow.AddSeconds(10)
   do{
    $remaining=[int]($deadline-[DateTime]::UtcNow).TotalMilliseconds;if($remaining -le 0){throw 'Tempo de leitura VSS excedido.'}
    $reading=$reader.ReadAsync($buffer,0,$buffer.Length)
    if(-not $reading.Wait($remaining)){throw 'Tempo de leitura VSS excedido.'}
    $count=$reading.Result;if($count -le 0){throw 'Conexão VSS encerrada.'}
    $inputText+=(-join $buffer[0..($count-1)])
    if($inputText.Length -gt 8192){throw 'Solicitação VSS excede o limite.'}
   }while(-not $inputText.Contains("`n"))
   $request=ConvertTo-VssCommand ($inputText.Substring(0,$inputText.IndexOf("`n")) | ConvertFrom-Json)
   if($request.command.action -eq 'probe'){$result=@{protocol=1;automatic=$true;busy=($null -ne $script:pendingVssWorker -and -not $script:pendingVssWorker.process.HasExited)}}
   else{
    $clock=[Diagnostics.Stopwatch]::StartNew();Write-BrokerLog ('Início '+$request.command.action+'; instalação '+$request.client.Substring(0,12)+'.')
    try{$result=Invoke-OwnedVss $request.command $request.client;Write-BrokerLog ('Concluído '+$request.command.action+'; '+$clock.ElapsedMilliseconds+' ms.')}
    catch{Write-BrokerLog ('Falhou '+$request.command.action+'; '+$clock.ElapsedMilliseconds+' ms; '+$_.Exception.Message);throw}
   }
   $writer.WriteLine((@{ok=$true;result=$result} | ConvertTo-Json -Depth 8 -Compress))
  }catch{$writer.WriteLine((@{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress))}
 }catch{
  Write-BrokerLog $_.Exception.Message
  Start-Sleep -Seconds 1
 }finally{if($reader){$reader.Dispose()};if($writer){$writer.Dispose()};if($pipe){$pipe.Dispose()}}
}
