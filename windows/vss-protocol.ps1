# This protocol never accepts executable names, shell commands, scripts or filesystem paths.
function ConvertTo-VssCommand($Request) {
 if($null -eq $Request -or $Request.protocol -ne 1){throw 'Protocolo VSS inválido.'}
 if([string]$Request.client -notmatch '^[a-f0-9]{64}$'){throw 'Identificação de instalação VSS inválida.'}
 $action=[string]$Request.action
 if($action -notin @('probe','create','delete','cleanup')){throw 'Operação VSS não permitida.'}
 $allowed=@('protocol','client','action')
 $command=@{action=$action}
 if($action -eq 'create'){
  if([string]$Request.volume -notmatch '^[A-Za-z]:\\$'){throw 'VSS requer volume local com letra de unidade.'}
  $allowed+='volume';$command.volume=([string]$Request.volume).ToUpperInvariant()
 }
 if($action -eq 'delete'){
  if([string]$Request.id -notmatch '^\{[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}\}$'){throw 'Identificador VSS inválido.'}
  $allowed+='id';$command.id=[string]$Request.id
 }
 foreach($property in $Request.PSObject.Properties.Name){if($property -notin $allowed){throw 'Campo não permitido no protocolo VSS.'}}
 return @{client=[string]$Request.client;command=$command}
}
