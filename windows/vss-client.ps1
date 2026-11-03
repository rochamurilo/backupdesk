$ErrorActionPreference='Stop'
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
 $connectTimeout=20000;if($request.action -eq 'probe'){$connectTimeout=2000}
 $phase='connect'
 try{$pipe.Connect($connectTimeout)}catch{throw 'Componente automático VSS indisponível. Reinstale a versão atual e autorize o componente durante a instalação. Não é necessário abrir o painel como administrador.'}
 # Prevent another user from impersonating the privileged component with a pipe of the same name.
 $phase='verify-owner'
 if($pipe.GetAccessControl().GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-18'){throw 'A identidade do componente VSS não é confiável.'}
 $phase='request'
 $writer=New-Object System.IO.StreamWriter($pipe,(New-Object System.Text.UTF8Encoding($false)),1024,$true);$writer.AutoFlush=$true
 $reader=New-Object System.IO.StreamReader($pipe,(New-Object System.Text.UTF8Encoding($false)),$false,1024,$true)
 $writer.WriteLine($env:BACKUPDESK_VSS_REQUEST)
 $phase='response'
 $reading=$reader.ReadLineAsync()
 if(-not $reading.Wait(185000)){throw 'O componente VSS não respondeu dentro do prazo.'}
 $response=$reading.Result | ConvertFrom-Json
 if(-not $response.ok){throw [string]$response.error}
 $response.result | ConvertTo-Json -Depth 8 -Compress
}catch{[Console]::Error.WriteLine(('VSS client ['+$phase+']: '+$_.Exception.Message));exit 1}
finally{if($reader){$reader.Dispose()};if($writer){$writer.Dispose()};if($pipe){$pipe.Dispose()}}
