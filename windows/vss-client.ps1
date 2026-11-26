$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$pipe=$null
try{
 $phase='load-transport'
 $clientRoot=$PSScriptRoot;if($BackupDeskVssClientRoot){$clientRoot=$BackupDeskVssClientRoot}
 . (Join-Path $clientRoot 'vss-io.ps1')
 $phase='identity'
 $product=$env:BACKUPDESK_VSS_PRODUCT
 if($product -notin @('master','client')){throw 'Produto VSS inválido.'}
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $pipeName='BackupDeskVSS-v1-'+$product+'-'+$sid
 $pipe=New-Object System.IO.Pipes.NamedPipeClientStream('.',$pipeName,[System.IO.Pipes.PipeDirection]::InOut,[System.IO.Pipes.PipeOptions]::Asynchronous)
 $request=$env:BACKUPDESK_VSS_REQUEST | ConvertFrom-Json
 $phase='connect';$recovered=$false
 try{$pipe.Connect(1500)}catch{
  Close-BackupDeskPipe $pipe;$pipe=$null;$phase='start-component'
  $taskName='BackupDeskVSS-'+$product+'-'+$sid
  try{
   $scheduler=New-Object -ComObject 'Schedule.Service';$scheduler.Connect()
   $task=$scheduler.GetFolder('\').GetTask($taskName)
   if($task.State -eq 1){throw 'disabled'}
   if($task.State -notin @(2,4)){$null=$task.Run($null);$recovered=$true}
  }catch{throw 'O componente VSS não está disponível para este usuário. Execute o atualizador do BackupDesk nesta mesma conta e autorize o reparo do componente. As chaves existentes são preservadas.'}
  $phase='connect-retry'
  $pipe=New-Object System.IO.Pipes.NamedPipeClientStream('.',$pipeName,[System.IO.Pipes.PipeDirection]::InOut,[System.IO.Pipes.PipeOptions]::Asynchronous)
  $timeout=90000;if($request.action -eq 'probe'){$timeout=15000}
  try{$pipe.Connect($timeout)}catch{throw ('O componente VSS está em inicialização ou ocupado e o canal não ficou disponível em '+($timeout/1000)+' segundos. Detalhe: '+$_.Exception.GetBaseException().Message)}
 }
 # Prevent another user from impersonating the privileged component with a pipe of the same name.
 $phase='verify-owner'
 if($pipe.GetAccessControl().GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-18'){throw 'A identidade do componente VSS não é confiável.'}
 $phase='request'
 Write-BackupDeskPipeLine $pipe $env:BACKUPDESK_VSS_REQUEST 5000 8192
 $phase='response'
 $responseTimeout=195000;if($request.action -eq 'probe'){$responseTimeout=5000}
 $response=(Read-BackupDeskPipeLine $pipe $responseTimeout 65536) | ConvertFrom-Json
 if(-not $response.ok){throw [string]$response.error}
 if($recovered){$response.result | Add-Member -NotePropertyName component_restarted -NotePropertyValue $true}
 $response.result | ConvertTo-Json -Depth 8 -Compress
}catch{
 $details='';if($request -and $request.action){$details=' Operação: '+$request.action+'.'}
 if($phase -in @('connect-retry','response') -and $task){try{
  $current=$scheduler.GetFolder('\').GetTask($taskName)
  $states=@('desconhecido','desativado','na fila','parado','em execução')
  $details+=' Estado do componente: '+$states[[int]$current.State]+'.'
 }catch{}}
 [Console]::Error.WriteLine(('VSS client ['+$phase+']: '+$_.Exception.Message+$details));exit 1
}
finally{if($pipe){Close-BackupDeskPipe $pipe}}
