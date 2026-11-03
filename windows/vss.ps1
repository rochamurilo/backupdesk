$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
try {
 $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
 if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'VSS exige privilégios administrativos. Abra o atalho VSS (administrador) desta instalação e confirme o UAC.'}
 $request=$env:BACKUPDESK_VSS_REQUEST | ConvertFrom-Json
 $ledger=$env:BACKUPDESK_VSS_LEDGER
 function Read-Owned {if(Test-Path -LiteralPath $ledger){$data=Get-Content -Raw -LiteralPath $ledger | ConvertFrom-Json;if($data.format -ne 'backupdesk-vss-owned-v1'){throw 'Registro VSS do aplicativo inválido.'};return @($data.ids | Where-Object {$_})};return @()}
 function Write-Owned($ids){@{format='backupdesk-vss-owned-v1';ids=@($ids | Where-Object {$_})} | ConvertTo-Json -Compress | Set-Content -LiteralPath $ledger -Encoding UTF8}
 function Delete-Owned($id){
  if($id -notmatch '^\{[a-fA-F0-9-]{36}\}$'){throw 'Identificador VSS inválido.'}
  $owned=@(Read-Owned);if($owned -notcontains $id){throw 'O snapshot não pertence ao registro desta instalação.'}
  $copy=Get-CimInstance Win32_ShadowCopy -Filter ("ID = '"+$id+"'")
  if($null -ne $copy){Remove-CimInstance -InputObject $copy}
  Write-Owned @($owned | Where-Object {$_ -ne $id})
 }
 if($request.action -eq 'cleanup') {foreach($id in @(Read-Owned)){Delete-Owned $id};@{cleaned=$true} | ConvertTo-Json -Compress;exit 0}

 if($request.action -eq 'create'){
  $root=[string]$request.volume
  if($root -notmatch '^[A-Za-z]:\\$'){throw 'VSS suporta somente volumes locais com letra de unidade.'}
  $letter=$root.Substring(0,2)
  $volume=Get-CimInstance Win32_Volume -Filter ("DriveLetter = '"+$letter+"'")
  if($null -eq $volume -or $volume.FileSystem -ne 'NTFS'){throw 'Esta versão do VSS requer origem em volume local NTFS; não suporta origem em compartilhamento de rede.'}
  # ClientAccessible has NO_WRITERS: disk/crash consistency, never claim Outlook writer consistency.
  $created=Invoke-CimMethod -ClassName Win32_ShadowCopy -MethodName Create -Arguments @{Volume=$root;Context='ClientAccessible'}
  if($created.ReturnValue -ne 0){throw ('Falha ao criar snapshot VSS. Código Windows: '+$created.ReturnValue)}
  try{Write-Owned @(@(Read-Owned)+[string]$created.ShadowID)}catch{Get-CimInstance Win32_ShadowCopy -Filter ("ID = '"+$created.ShadowID+"'") | Remove-CimInstance;throw}
  $snapshot=Get-CimInstance Win32_ShadowCopy -Filter ("ID = '"+$created.ShadowID+"'")
  if($null -eq $snapshot){throw 'Snapshot VSS criado mas não localizado.'}
  @{id=$snapshot.ID;device=$snapshot.DeviceObject;volume=$root;consistency='crash-consistent-no-writers'} | ConvertTo-Json -Compress
 }elseif($request.action -eq 'delete'){
  $id=[string]$request.id
  if($id -notmatch '^\{[a-fA-F0-9-]{36}\}$'){throw 'Identificador VSS inválido.'}
  Delete-Owned $id
  @{deleted=$true} | ConvertTo-Json -Compress
 }else{throw 'Ação VSS inválida.'}
}catch{[Console]::Error.WriteLine($_.Exception.Message);exit 1}
