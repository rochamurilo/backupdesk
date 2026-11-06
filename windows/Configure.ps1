$ErrorActionPreference='Stop'
try {
 $file=Join-Path $PSScriptRoot 'agent-config.json'
 if(-not (Test-Path -LiteralPath $file)){throw 'Baixe o client identificado pelo botão Baixar client Windows no master e instale novamente.'}
 $config=Get-Content -Raw -Encoding UTF8 -LiteralPath $file | ConvertFrom-Json
 if($config.device_id -notmatch '^[a-f0-9]{64}$' -or $config.token -notmatch '^[a-f0-9]{64}$'){throw 'A identificação do client não está completa. Gere novamente o instalador no master.'}
 Start-Process -FilePath (Join-Path $PSScriptRoot 'BackupDeskClient.exe') -WorkingDirectory $PSScriptRoot
} catch {
 Add-Type -AssemblyName System.Windows.Forms
 [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'BackupDesk') | Out-Null
 exit 1
}
