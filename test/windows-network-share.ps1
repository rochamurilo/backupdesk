$ErrorActionPreference='Stop'
$id=[guid]::NewGuid().ToString('N').Substring(0,10)
$user='bkd'+$id
$share='Bkd'+$id
$folder=Join-Path $env:TEMP $share
$unc='\\127.0.0.1\'+$share
$password='BkD!'+[guid]::NewGuid().ToString('N')+' '+[char]0xE1+'`$;'
$config=Join-Path $env:TEMP ($share+'.json')
try {
 New-Item -ItemType Directory -Path $folder | Out-Null
 New-LocalUser -Name $user -Password (ConvertTo-SecureString $password -AsPlainText -Force) -PasswordNeverExpires | Out-Null
 $account=$env:COMPUTERNAME+'\'+$user
 $acl=Get-Acl $folder
 $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule($account,'Modify','ContainerInherit,ObjectInherit','None','Allow')))
 Set-Acl $folder $acl
 Start-Service LanmanServer
 New-SmbShare -Name $share -Path $folder -ChangeAccess $account | Out-Null
 @{destination=$unc;username=$account;password=$password;roots=@($unc.ToLowerInvariant())} | ConvertTo-Json | Set-Content -LiteralPath $config -Encoding UTF8
 $env:BACKUPDESK_NETWORK_TEST_CONFIG=$config
 & node (Join-Path $PSScriptRoot '../windows/network-share-check.mjs')
 if($LASTEXITCODE -ne 0){throw 'Native SMB authentication failed.'}
} finally {
 & net use $unc /delete /y 2>$null | Out-Null
 Remove-SmbShare -Name $share -Force -ErrorAction SilentlyContinue
 Remove-LocalUser -Name $user -ErrorAction SilentlyContinue
 Remove-Item $folder -Recurse -Force -ErrorAction SilentlyContinue
 Remove-Item $config -Force -ErrorAction SilentlyContinue
 Remove-Item Env:BACKUPDESK_NETWORK_TEST_CONFIG -ErrorAction SilentlyContinue
}
