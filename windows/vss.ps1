$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
function Write-VssReply($Result,[string]$ErrorText=''){
 if($BackupDeskVssResultFile){
  $parent=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($env:BACKUPDESK_VSS_LEDGER))
  $reply=[IO.Path]::GetFullPath($BackupDeskVssResultFile)
  if([IO.Path]::GetDirectoryName($reply) -ine $parent -or [IO.Path]::GetFileName($reply) -notmatch '^reply-[a-f0-9]{32}\.json$'){throw 'Destino de confirmação VSS inválido.'}
  $data=@{format='backupdesk-vss-result-v1';ok=($ErrorText -eq '')};if($ErrorText){$data.error=$ErrorText}else{$data.result=$Result}
  $bytes=[Text.Encoding]::UTF8.GetBytes(($data | ConvertTo-Json -Depth 8 -Compress))
  if($bytes.Length -gt 65536){throw 'Confirmação VSS excede o limite.'}
  $file=New-Object IO.FileStream($reply,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try{$file.Write($bytes,0,$bytes.Length);$file.Flush($true)}finally{$file.Dispose()}
 }elseif($ErrorText){[Console]::Error.WriteLine($ErrorText)}else{$Result | ConvertTo-Json -Depth 8 -Compress}
}
try {
 $phase='identity'
 $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
 if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'VSS exige privilégios administrativos. Abra o atalho VSS (administrador) desta instalação e confirme o UAC.'}
 $request=$env:BACKUPDESK_VSS_REQUEST | ConvertFrom-Json
 $ledger=$env:BACKUPDESK_VSS_LEDGER
 function Read-Owned {if(Test-Path -LiteralPath $ledger){$data=Get-Content -Raw -LiteralPath $ledger | ConvertFrom-Json;if($data.format -ne 'backupdesk-vss-owned-v1'){throw 'Registro VSS do aplicativo inválido.'};return @($data.ids | Where-Object {$_})};return @()}
 function Write-Owned($ids){@{format='backupdesk-vss-owned-v1';ids=@($ids | Where-Object {$_})} | ConvertTo-Json -Compress | Set-Content -LiteralPath $ledger -Encoding UTF8}
 function Delete-Owned($id){
  if($id -notmatch '^\{[a-fA-F0-9-]{36}\}$'){throw 'Identificador VSS inválido.'}
  $owned=@(Read-Owned);if($owned -notcontains $id){throw 'O snapshot não pertence ao registro desta instalação.'}
  $script:phase='query-snapshot';$copy=Get-CimInstance Win32_ShadowCopy -Filter ("ID = '"+$id+"'")
  $script:phase='delete-snapshot'
  if($null -ne $copy){Remove-CimInstance -InputObject $copy}
  Write-Owned @($owned | Where-Object {$_ -ne $id})
 }
 if($request.action -eq 'cleanup') {foreach($id in @(Read-Owned)){Delete-Owned $id};Write-VssReply @{cleaned=$true};exit 0}

 if($request.action -eq 'create'){
  $root=[string]$request.volume
  if($root -notmatch '^[A-Za-z]:\\$'){throw 'VSS suporta somente volumes locais com letra de unidade.'}
  $letter=$root.Substring(0,2)
  $phase='query-volume';$volume=Get-CimInstance Win32_Volume -Filter ("DriveLetter = '"+$letter+"'")
  if($null -eq $volume -or $volume.FileSystem -ne 'NTFS'){throw 'Esta versão do VSS requer origem em volume local NTFS; não suporta origem em compartilhamento de rede.'}
  # ClientAccessible has NO_WRITERS: disk/crash consistency, never claim Outlook writer consistency.
  $phase='create-snapshot';$created=Invoke-CimMethod -ClassName Win32_ShadowCopy -MethodName Create -Arguments @{Volume=$root;Context='ClientAccessible'}
  if($created.ReturnValue -ne 0){throw ('Falha ao criar snapshot VSS. Código Windows: '+$created.ReturnValue)}
  try{Write-Owned @(@(Read-Owned)+[string]$created.ShadowID)}catch{Get-CimInstance Win32_ShadowCopy -Filter ("ID = '"+$created.ShadowID+"'") | Remove-CimInstance;throw}
  $snapshot=Get-CimInstance Win32_ShadowCopy -Filter ("ID = '"+$created.ShadowID+"'")
  if($null -eq $snapshot){throw 'Snapshot VSS criado mas não localizado.'}
  Write-VssReply @{id=$snapshot.ID;device=$snapshot.DeviceObject;volume=$root;consistency='crash-consistent-no-writers'}
 }elseif($request.action -eq 'delete'){
  $id=[string]$request.id
  if($id -notmatch '^\{[a-fA-F0-9-]{36}\}$'){throw 'Identificador VSS inválido.'}
  Delete-Owned $id
  Write-VssReply @{deleted=$true}
 }else{throw 'Ação VSS inválida.'}
}catch{try{Write-VssReply $null ('VSS Windows ['+$phase+']: '+$_.Exception.Message)}catch{[Console]::Error.WriteLine('Não foi possível registrar a confirmação VSS.')};exit 1}
