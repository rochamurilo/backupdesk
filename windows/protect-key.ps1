param([switch]$Unprotect)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security
try {
 $inputBytes=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
 $scope=[Security.Cryptography.DataProtectionScope]::CurrentUser
 $entropy=[Text.Encoding]::UTF8.GetBytes('BackupDesk key vault v1')
 if($Unprotect){$result=[Security.Cryptography.ProtectedData]::Unprotect($inputBytes,$entropy,$scope)}
 else{$result=[Security.Cryptography.ProtectedData]::Protect($inputBytes,$entropy,$scope)}
 [Console]::Out.Write([Convert]::ToBase64String($result))
} catch { exit 1 }
