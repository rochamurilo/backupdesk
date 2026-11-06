$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$archive=Join-Path $env:TEMP ('restic-'+[guid]::NewGuid().ToString('N')+'.zip')
$folder=$archive+'.files'
try{
 Invoke-WebRequest -UseBasicParsing 'https://github.com/restic/restic/releases/download/v0.19.1/restic_0.19.1_windows_amd64.zip' -OutFile $archive
 if((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'da948ad707ed690426473aaba2046cd61f8f90f6f0e7dab6be0d5796531de67d'){throw 'Restic archive hash mismatch.'}
 Expand-Archive $archive -DestinationPath $folder
 New-Item -ItemType Directory -Path (Join-Path $repo 'windows') -Force | Out-Null
 $target=Join-Path $repo 'windows/restic.exe'
 Copy-Item (Join-Path $folder 'restic_0.19.1_windows_amd64.exe') $target
 if((Get-FileHash $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'b0dd1fd21eea5d8fe1325f55f7118213c21f36de8a261e04c0624a5ab9fd7830'){throw 'Restic binary hash mismatch.'}
}finally{Remove-Item $archive -Force -ErrorAction SilentlyContinue;Remove-Item $folder -Recurse -Force -ErrorAction SilentlyContinue}
