$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$pipe=$null;$reader=$null;$writer=$null
try{
 $phase='identity'
 $product=$env:BACKUPDESK_VSS_PRODUCT
 if($product -notin @('master','client')){throw 'Produto VSS inválido.'}
 $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
 $pipeName='BackupDeskVSS-v1-'+$product+'-'+$sid
 $pipe=New-Object System.IO.Pipes.NamedPipeClientStream('.',$pipeName,[System.IO.Pipes.PipeDirection]::InOut,[System.IO.Pipes.PipeOptions]::Asynchronous)
 $request=$env:BACKUPDESK_VSS_REQUEST | ConvertFrom-Json
 $phase='connect';$recovered=$false
 try{$pipe.Connect(1500)}catch{
  $pipe.Dispose();$pipe=$null;$phase='start-component'
  $taskName='BackupDeskVSS-'+$product+'-'+$sid
  try{
   $scheduler=New-Object -ComObject 'Schedule.Service';$scheduler.Connect()
   $task=$scheduler.GetFolder('\').GetTask($taskName)
   if($task.State -eq 1){throw 'disabled'}
   if($task.State -ne 4){$null=$task.Run($null);$recovered=$true}
  }catch{throw 'O componente VSS não está disponível para este usuário. Execute o atualizador do BackupDesk nesta mesma conta e autorize o reparo do componente. As chaves existentes são preservadas.'}
  $phase='connect-retry'
  $pipe=New-Object System.IO.Pipes.NamedPipeClientStream('.',$pipeName,[System.IO.Pipes.PipeDirection]::InOut,[System.IO.Pipes.PipeOptions]::Asynchronous)
  $timeout=20000;if($request.action -eq 'probe'){$timeout=15000}
  try{$pipe.Connect($timeout)}catch{throw 'O componente VSS foi localizado, mas não respondeu. Aguarde outra rotina em execução ou repare o componente pelo atualizador do BackupDesk.'}
 }
 # Prevent another user from impersonating the privileged component with a pipe of the same name.
 $phase='verify-owner'
 if($pipe.GetAccessControl().GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-18'){throw 'A identidade do componente VSS não é confiável.'}
 $phase='request'
 $writer=New-Object System.IO.StreamWriter($pipe,(New-Object System.Text.UTF8Encoding($false)),1024,$true);$writer.AutoFlush=$true
 $reader=New-Object System.IO.StreamReader($pipe,(New-Object System.Text.UTF8Encoding($false)),$false,1024,$true)
 $writer.WriteLine($env:BACKUPDESK_VSS_REQUEST)
 $phase='response'
 $reading=$reader.ReadLineAsync()
 $responseTimeout=195000;if($request.action -eq 'probe'){$responseTimeout=5000}
 if(-not $reading.Wait($responseTimeout)){throw ('O componente VSS não respondeu dentro do prazo durante '+$request.action+'. A operação não foi confirmada.')}
 $response=$reading.Result | ConvertFrom-Json
 if(-not $response.ok){throw [string]$response.error}
 if($request.action -eq 'probe' -and $recovered){$response.result | Add-Member -NotePropertyName component_restarted -NotePropertyValue $true}
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
finally{if($reader){$reader.Dispose()};if($writer){$writer.Dispose()};if($pipe){$pipe.Dispose()}}
