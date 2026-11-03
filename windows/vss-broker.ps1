param([Parameter(Mandatory=$true)][string]$UserSid,[Parameter(Mandatory=$true)][ValidateSet('master','client')][string]$Product)
$ErrorActionPreference='Stop'
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
 $script=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'vss.ps1')
 $info=New-Object System.Diagnostics.ProcessStartInfo
 $info.FileName=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
 $info.Arguments='-NoLogo -NoProfile -NonInteractive -EncodedCommand '+[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
 $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 $info.StandardOutputEncoding=New-Object System.Text.UTF8Encoding($false)
 $info.StandardErrorEncoding=New-Object System.Text.UTF8Encoding($false)
 $info.EnvironmentVariables['BACKUPDESK_VSS_REQUEST']=($Command | ConvertTo-Json -Compress)
 $info.EnvironmentVariables['BACKUPDESK_VSS_LEDGER']=(Join-Path $state ($Key+'.json'))
 $child=New-Object System.Diagnostics.Process;$child.StartInfo=$info
 try{
  [void]$child.Start();$output=$child.StandardOutput.ReadToEndAsync();$errors=$child.StandardError.ReadToEndAsync()
  if(-not $child.WaitForExit(180000)){$child.Kill();throw 'Tempo de execução do VSS excedido.'}
  $text=$output.GetAwaiter().GetResult();$err=$errors.GetAwaiter().GetResult()
  if($child.ExitCode -ne 0){throw $err.Trim()}
  return ($text.Trim([char]0xFEFF).Trim() | ConvertFrom-Json)
 }finally{$child.Dispose()}
}
while($true){
 $pipe=$null;$reader=$null;$writer=$null
 try{
  $pipe=New-Object System.IO.Pipes.NamedPipeServerStream($pipeName,[System.IO.Pipes.PipeDirection]::InOut,1,[System.IO.Pipes.PipeTransmissionMode]::Byte,[System.IO.Pipes.PipeOptions]::Asynchronous,8192,8192,$security)
  @{pid=$PID;protocol=1} | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $state 'ready.json') -Encoding UTF8
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
   if($request.command.action -eq 'probe'){$result=@{protocol=1;automatic=$true}}
   else{$result=Invoke-OwnedVss $request.command $request.client}
   $writer.WriteLine((@{ok=$true;result=$result} | ConvertTo-Json -Depth 8 -Compress))
  }catch{$writer.WriteLine((@{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress))}
 }catch{
  $log=Join-Path $state 'broker.log';if((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 1048576){Remove-Item -LiteralPath $log}
  Add-Content -LiteralPath $log -Value ((Get-Date -Format o)+' '+$_.Exception.Message)
  Start-Sleep -Seconds 1
 }finally{if($reader){$reader.Dispose()};if($writer){$writer.Dispose()};if($pipe){$pipe.Dispose()}}
}
