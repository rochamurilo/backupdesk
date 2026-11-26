# Bounded local pipe I/O, shared by the unprivileged client and protected broker.
# Cancellation applies only to this process's pipe handle, never to a VSS worker.
if(-not ('BackupDesk.PipeCancellation' -as [type])){
 Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
namespace BackupDesk {
 public static class PipeCancellation {
  [DllImport("kernel32.dll",SetLastError=true)]
  public static extern bool CancelIoEx(SafePipeHandle handle,IntPtr overlapped);
 }
}
'@
}
function Close-BackupDeskPipe($Pipe){
 if($null -eq $Pipe){return}
 try{[void][BackupDesk.PipeCancellation]::CancelIoEx($Pipe.SafePipeHandle,[IntPtr]::Zero)}catch{}
 try{$Pipe.Dispose()}catch{}
}
function Read-BackupDeskPipeLine($Pipe,[int]$TimeoutMs=10000,[int]$MaxBytes=8192){
 $clock=[Diagnostics.Stopwatch]::StartNew();$bytes=New-Object IO.MemoryStream
 try{
  $buffer=New-Object byte[] 1024
  while($true){
   $remaining=$TimeoutMs-[int]$clock.ElapsedMilliseconds
   if($remaining -le 0){throw [TimeoutException]::new('Tempo de leitura do canal VSS excedido.')}
   $reading=$Pipe.ReadAsync($buffer,0,$buffer.Length)
   if(-not $reading.Wait($remaining)){throw [TimeoutException]::new('Tempo de leitura do canal VSS excedido.')}
   $count=$reading.GetAwaiter().GetResult()
   if($count -le 0){throw [IO.EndOfStreamException]::new('Conexão VSS encerrada antes da confirmação.')}
   for($i=0;$i -lt $count;$i++){
    if($buffer[$i] -eq 10){return (New-Object Text.UTF8Encoding($false,$true)).GetString($bytes.ToArray()).TrimEnd([char]13)}
    if($bytes.Length -ge $MaxBytes){throw [IO.InvalidDataException]::new('Mensagem do canal VSS excede o limite.')}
    $bytes.WriteByte($buffer[$i])
   }
  }
 }catch{Close-BackupDeskPipe $Pipe;throw}
 finally{$bytes.Dispose()}
}
function Write-BackupDeskPipeLine($Pipe,[string]$Text,[int]$TimeoutMs=5000,[int]$MaxBytes=65536){
 try{
  $bytes=(New-Object Text.UTF8Encoding($false,$true)).GetBytes($Text+"`n")
  if($bytes.Length -gt $MaxBytes){throw [IO.InvalidDataException]::new('Resposta do canal VSS excede o limite.')}
  $writing=$Pipe.WriteAsync($bytes,0,$bytes.Length)
  if(-not $writing.Wait($TimeoutMs)){throw [TimeoutException]::new('Tempo de escrita do canal VSS excedido.')}
  [void]$writing.GetAwaiter().GetResult()
 }catch{Close-BackupDeskPipe $Pipe;throw}
}
