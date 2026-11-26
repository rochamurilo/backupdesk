# Read-only support collection. Does not run app scripts, connect to the pipe,
# restart services/tasks, read credentials, or create/delete VSS snapshots.
[CmdletBinding()]
param(
 [string]$ClientRoot=(Join-Path $env:LOCALAPPDATA 'BackupDeskClient'),
 [string]$ComponentRoot=(Join-Path $env:ProgramFiles 'BackupDesk VSS\client'),
 [string]$OutputFile
)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if(-not $OutputFile){
 $desktop=[Environment]::GetFolderPath('Desktop')
 if(-not $desktop -or -not (Test-Path -LiteralPath $desktop)){$desktop=$env:TEMP}
 $OutputFile=Join-Path $desktop ('BackupDesk-VSS-Diagnostico-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.txt')
}
$report=New-Object Text.StringBuilder
function Add-Section([string]$Name,[scriptblock]$Read){
 [void]$report.AppendLine("`r`n=== $Name ===")
 try{
  $text=(& $Read | Out-String -Width 260).TrimEnd()
  if(-not $text){$text='Nenhum registro encontrado.'}
  [void]$report.AppendLine($text)
 }catch{[void]$report.AppendLine('Consulta indisponível: '+$_.Exception.Message)}
}
Add-Section 'Coleta' {
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 $principal=New-Object Security.Principal.WindowsPrincipal($identity)
 [pscustomobject]@{Hora=(Get-Date -Format o);Computador=$env:COMPUTERNAME;Conta=$identity.Name;SID=$identity.User.Value;PowerShell=$PSVersionTable.PSVersion.ToString();Administrador=$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator);ClientRoot=$ClientRoot;ComponentRoot=$ComponentRoot} | Format-List
 $PSVersionTable | Format-Table -AutoSize
 Get-CimInstance Win32_OperatingSystem -OperationTimeoutSec 10 | Select-Object Caption,Version,BuildNumber,LastBootUpTime | Format-List
 Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full' | Select-Object Release,Version | Format-List
}
Add-Section 'Tarefas BackupDesk VSS' {
 foreach($task in @(Get-ScheduledTask | Where-Object {$_.TaskName -like 'BackupDeskVSS-*'})){
  $info=$task | Get-ScheduledTaskInfo
  [pscustomobject]@{Nome=$task.TaskName;Estado=$task.State;ContaExecutora=$task.Principal.UserId;Executavel=($task.Actions.Execute -join ', ');UltimoInicio=$info.LastRunTime;UltimoResultado=('0x{0:X}' -f $info.LastTaskResult);ProximaExecucao=$info.NextRunTime;Reinicios=$task.Settings.RestartCount;MultiplasInstancias=$task.Settings.MultipleInstances} | Format-List
 }
}
Add-Section 'Processos PowerShell e desta instalação' {
 $all=@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='node.exe' OR Name='restic.exe'" -OperationTimeoutSec 10)
 $brokers=@($all | Where-Object {$_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*vss-broker.ps1*'})
 $brokerIds=@($brokers | ForEach-Object {$_.ProcessId})
 # CommandLine is used only for identification and is never included in output.
 # Include metadata of other PowerShell processes so an orphaned worker whose
 # parent already exited remains visible. No raw arguments or script text.
 foreach($process in @($all | Where-Object {($_.Name -eq 'powershell.exe') -or ($_.ParentProcessId -in $brokerIds) -or ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($ClientRoot.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase))})){
  $ownerSid=$null;$product=$null
  if($process.ProcessId -in $brokerIds){
   if($process.CommandLine -match '-UserSid\s+(S-1-(?:\d+-)+\d+)'){$ownerSid=$Matches[1]}
   if($process.CommandLine -match '-Product\s+(master|client)'){$product=$Matches[1]}
  }
  [pscustomobject]@{ProcessId=$process.ProcessId;ParentProcessId=$process.ParentProcessId;Name=$process.Name;ExecutablePath=$process.ExecutablePath;CreationDate=$process.CreationDate;BrokerSID=$ownerSid;Produto=$product} | Format-List
 }
}
Add-Section 'Pipes BackupDesk presentes (sem conexão)' {
 Get-ChildItem -LiteralPath '\\.\pipe\' | Where-Object {$_.Name -like 'BackupDeskVSS-*'} | Select-Object Name | Format-List
}
Add-Section 'Versões dos arquivos (SHA-256; conteúdo não incluído)' {
 foreach($file in @('vss.mjs','restic-runner.mjs','restic-backup.mjs','windows\vss-client.ps1')){
  $candidate=Join-Path $ClientRoot $file
  if(Test-Path -LiteralPath $candidate -PathType Leaf){Get-FileHash -LiteralPath $candidate -Algorithm SHA256 | Select-Object Path,Hash | Format-List}
 }
 foreach($file in @('vss-broker.ps1','vss-protocol.ps1','vss.ps1','install-vss-component.ps1')){
  $candidate=Join-Path $ComponentRoot $file
  if(Test-Path -LiteralPath $candidate -PathType Leaf){Get-FileHash -LiteralPath $candidate -Algorithm SHA256 | Select-Object Path,Hash | Format-List}
 }
}
Add-Section 'Estado e log protegido do componente' {
 $stateRoot=Join-Path $ComponentRoot 'state'
 foreach($folder in @(Get-ChildItem -LiteralPath $stateRoot -Directory | Where-Object {$_.Name -match '^S-1-(?:\d+-)+\d+$'})){
  'SID do registro: '+$folder.Name
  foreach($name in @('ready.json','startup.json')){
   $file=Join-Path $folder.FullName $name
   if(Test-Path -LiteralPath $file -PathType Leaf){
    $record=Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    $name
    $record | Select-Object format,status,phase,pid,process_started_at,startup_id,protocol,at,error | Format-List
   }
  }
  $log=Join-Path $folder.FullName 'broker.log'
  if(Test-Path -LiteralPath $log -PathType Leaf){'broker.log';Get-Content -LiteralPath $log -Tail 120}
 }
}
Add-Section 'Logs recentes do aplicativo' {
 foreach($name in @('agent.log','launcher.log')){
  $file=Join-Path (Join-Path $ClientRoot 'data') $name
  if(Test-Path -LiteralPath $file -PathType Leaf){Get-Item -LiteralPath $file | Select-Object Name,LastWriteTime,Length | Format-List;Get-Content -LiteralPath $file -Tail 100}
 }
}
Add-Section 'Serviços VSS do Windows (somente consulta)' {
 Get-CimInstance Win32_Service -Filter "Name='VSS' OR Name='swprv'" -OperationTimeoutSec 10 | Select-Object Name,State,StartMode,ProcessId | Format-List
}
Add-Section 'Snapshots presentes (somente consulta)' {
 Get-CimInstance Win32_ShadowCopy -OperationTimeoutSec 10 | Select-Object ID,InstallDate,State,VolumeName,DeviceObject | Format-List
}
Add-Section 'Eventos VSS das últimas 24 horas' {
 Get-WinEvent -FilterHashtable @{LogName='Application';ProviderName='VSS';StartTime=(Get-Date).AddDays(-1)} -MaxEvents 20 | Select-Object TimeCreated,Id,LevelDisplayName,Message | Format-List
}
Add-Section 'Eventos Volsnap das últimas 24 horas' {
 Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='volsnap';StartTime=(Get-Date).AddDays(-1)} -MaxEvents 20 | Select-Object TimeCreated,Id,LevelDisplayName,Message | Format-List
}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($OutputFile),$report.ToString(),(New-Object Text.UTF8Encoding($true)))
Write-Output ('Coleta concluída: '+[IO.Path]::GetFullPath($OutputFile))
