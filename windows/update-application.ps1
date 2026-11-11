# Installer-only operations. This file is never loaded by the SYSTEM VSS broker.
function Get-BackupDeskDirectory([string]$Directory){
 $Directory=$Directory.Trim().Trim('"')
 if(-not [IO.Path]::IsPathRooted($Directory) -or $Directory.Contains('"')){throw 'Pasta de instalação inválida.'}
 $root=[IO.Path]::GetFullPath($Directory).TrimEnd('\')
 if($root -eq [IO.Path]::GetPathRoot($root).TrimEnd('\')){throw 'A raiz de uma unidade não é uma pasta de instalação válida.'}
 return $root
}
function Stop-BackupDeskInstallation([string]$Directory){
 $root=Get-BackupDeskDirectory $Directory
 $node=Join-Path $root 'node.exe'
 $restic=Join-Path $root 'windows\restic.exe'
 $executables=@($node,$restic)
 if(-not (Test-Path -LiteralPath $node)){return}
 if(-not (Test-Path -LiteralPath (Join-Path $root 'agent.mjs')) -or (-not (Test-Path -LiteralPath (Join-Path $root 'server.mjs')) -and -not (Test-Path -LiteralPath (Join-Path $root 'launch-agent.mjs')))){throw 'A pasta não foi reconhecida como uma instalação do BackupDesk. Nenhum processo foi encerrado.'}
 New-Item -ItemType Directory -Path (Join-Path $root 'data') -Force | Out-Null
 @{version=1;created=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $root 'data\update-lock.json') -Encoding UTF8
 if(-not ('BackupDesk.UpdateProcesses' -as [type])){
 Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
namespace BackupDesk {
 public static class UpdateProcesses {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr h,uint flags,StringBuilder name,ref uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr h,uint exitCode);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static bool Stop(int pid,string expected) {
   IntPtr handle=OpenProcess(0x1000|0x0001|0x00100000,false,pid);
   if(handle==IntPtr.Zero)return false;
   try {
    // A supervisor may have already reaped a child from our process snapshot.
    // Its object can still exist while another process retains an open handle.
    if(WaitForSingleObject(handle,0)==0)return true;
    uint size=32768;StringBuilder image=new StringBuilder((int)size);
    if(!QueryFullProcessImageName(handle,0,image,ref size))return false;
    // Verify the executable on the opened handle, avoiding a PID-reuse race.
    if(!String.Equals(Path.GetFullPath(image.ToString()),Path.GetFullPath(expected),StringComparison.OrdinalIgnoreCase))return false;
    if(!TerminateProcess(handle,0)) {
     int error=Marshal.GetLastWin32Error();
     // ERROR_ACCESS_DENIED is also returned if the child exited between the
     // image check and TerminateProcess. Ignore it only after confirmed exit.
     if(WaitForSingleObject(handle,0)!=0)throw new Win32Exception(error);
    }
    if(WaitForSingleObject(handle,5000)!=0)throw new Win32Exception(1460,"O processo desta instalação não terminou no prazo.");
    return true;
   } finally { CloseHandle(handle); }
  }
 }
}
'@
 }
 for($attempt=0;$attempt -lt 30;$attempt++){
  $targets=@(Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='restic.exe'" | Where-Object {$_.ExecutablePath -and ($executables -icontains [IO.Path]::GetFullPath($_.ExecutablePath))} | Sort-Object @{Expression={if($_.CommandLine -match 'master\.mjs|launch-agent\.mjs'){0}elseif($_.CommandLine -match 'server\.mjs'){1}else{2}}})
  foreach($process in $targets){$null=[BackupDesk.UpdateProcesses]::Stop([int]$process.ProcessId,[IO.Path]::GetFullPath($process.ExecutablePath))}
  if(-not $targets.Count){
   $file=$null
   try{foreach($executable in $executables){if(Test-Path -LiteralPath $executable){$file=[IO.File]::Open($executable,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read);$file.Dispose();$file=$null}};return}catch{if($attempt -eq 29){throw 'O executável ainda está bloqueado. Nenhum arquivo do aplicativo foi substituído.'}}finally{if($file){$file.Dispose()}}
  }
  Start-Sleep -Milliseconds 500
 }
 throw 'Não foi possível encerrar os processos desta instalação. Nenhum arquivo do aplicativo foi substituído.'
}
function Register-BackupDeskStartup([string]$Directory,[string]$UserSid,[string]$Product){
 $root=Get-BackupDeskDirectory $Directory
 if($UserSid -notmatch '^S-1-(?:\d+-)+\d+$' -or $Product -notin @('master','client')){throw 'Inicialização automática inválida.'}
 $launcher='BackupDesk.exe';if($Product -eq 'client'){$launcher='BackupDeskClient.exe'}
 $name='BackupDesk-'+$Product+'-'+$UserSid
 $action=New-ScheduledTaskAction -Execute (Join-Path $root $launcher) -Argument '/background' -WorkingDirectory $root
 $trigger=New-ScheduledTaskTrigger -AtLogOn -User $UserSid
 $principal=New-ScheduledTaskPrincipal -UserId $UserSid -LogonType Interactive -RunLevel Limited
 $settings=New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable
 Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Inicia o BackupDesk ao entrar no Windows, no usuário normal e em segundo plano.' -Force | Out-Null
 Enable-ScheduledTask -TaskName $name | Out-Null
}
function Remove-BackupDeskStartup([string]$UserSid,[string]$Product){
 if($UserSid -notmatch '^S-1-(?:\d+-)+\d+$' -or $Product -notin @('master','client')){throw 'Inicialização automática inválida.'}
 $name='BackupDesk-'+$Product+'-'+$UserSid
 if(Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue){Unregister-ScheduledTask -TaskName $name -Confirm:$false}
}
