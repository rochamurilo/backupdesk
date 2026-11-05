$ErrorActionPreference='Stop'
$repo=Split-Path $PSScriptRoot -Parent
$master=Join-Path $repo 'dist\BackupDesk-Master-0.19.0-x64.exe'
if(-not (Test-Path -LiteralPath $master)){'Instalador ainda não publicado; teste de pacote será executado na publicação.';return}
$root=Join-Path $env:TEMP ('BackupDesk Client Test '+[guid]::NewGuid().ToString('N'))
$extract=Join-Path $root 'extracted'
$target=Join-Path $root 'client instalado'
$renamed=Join-Path $root 'arquivo renomeado.exe'
$sevenZip=(Get-Command 7z.exe -ErrorAction SilentlyContinue).Source
if(-not $sevenZip){$sevenZip=Join-Path $env:ProgramFiles '7-Zip\7z.exe'}
New-Item -ItemType Directory -Path $root | Out-Null
try{
 $null=& $sevenZip x $master ('-o'+$extract) -y
 if($LASTEXITCODE -ne 0){throw 'Falha ao extrair o pacote publicado.'}
 $generic=Get-ChildItem -LiteralPath $extract -Filter 'BackupDesk-Client-0.19.0-x64.exe' -Recurse | Select-Object -First 1
 if(-not $generic){throw 'Master não contém o client esperado.'}
 $env:BACKUPDESK_TEST_CLIENT_BASE=$generic.FullName
 $env:BACKUPDESK_TEST_CLIENT_NAMED=$renamed
 Set-Location $repo
 & node --input-type=module -e "import {readFile,writeFile} from 'node:fs/promises';import {enrollmentTrailer} from './client-package.mjs';const {generateKeyPairSync}=await import('node:crypto');const publicKey=generateKeyPairSync('rsa',{modulusLength:3072,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}).publicKey;const config={security_key:'07'.repeat(32),recovery_public_key:publicKey,format:'backupdesk-client-v1',device_id:'d'.repeat(64),name:'Financeiro São Paulo',url:'http://127.0.0.1:3339',token:'a'.repeat(64)};await writeFile(process.env.BACKUPDESK_TEST_CLIENT_NAMED,Buffer.concat([await readFile(process.env.BACKUPDESK_TEST_CLIENT_BASE),enrollmentTrailer(config)]));"
 if($LASTEXITCODE -ne 0){throw 'Falha ao incorporar identificação no instalador.'}
 $process=Start-Process -FilePath $renamed -ArgumentList @('/S',('/D='+$target)) -PassThru
 if(-not $process.WaitForExit(180000)){$process.Kill();throw 'Instalação identificada excedeu o prazo.'}
 if($process.ExitCode -ne 0){throw ('Instalador retornou '+$process.ExitCode)}
 $config=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $target 'agent-config.json') | ConvertFrom-Json
 if($config.name -ne 'Financeiro São Paulo' -or $config.device_id -ne ('d'*64) -or -not $config.installation_id){throw 'Identidade não foi instalada automaticamente.'}
 if($config.url -ne 'http://127.0.0.1:3339'){throw 'Conexão automática não foi incorporada no instalador.'}
 $instance=$config.installation_id
 $installedAt=$config.installed_at
 if(-not $installedAt){throw 'A data de instalação não foi registrada.'}
 $crypto=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $target 'data\keys\computer.json') | ConvertFrom-Json
 if($crypto.protected.scheme -ne 'windows-dpapi-current-user'){throw 'Chave do computador não está protegida por DPAPI.'}
 $dataKey=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $target 'data\keys\device.json') | ConvertFrom-Json
 $keyId=$dataKey.header.key_id
 if($keyId -ne '4bb06f8e4e3a7715d201d573d0aa423762e55dabd61a2c02278fa56cc6d294e0'){throw 'A chave de segurança não originou a chave de dados do computador.'}
 if($config.PSObject.Properties.Name -contains 'security_key'){throw 'A chave de segurança ficou em texto aberto na configuração.'}
 $process=Start-Process -FilePath $renamed -ArgumentList @('/S',('/D='+$target)) -PassThru
 if(-not $process.WaitForExit(180000)){$process.Kill();throw 'Atualização do client excedeu o prazo.'}
 if($process.ExitCode -ne 0){throw 'Atualização identificada falhou.'}
 $updated=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $target 'agent-config.json') | ConvertFrom-Json
 if((Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $target 'data\keys\device.json') | ConvertFrom-Json).header.key_id -ne $keyId){throw 'A atualização trocou a chave de dados.'}
 if($updated.installed_at -ne $installedAt){throw 'A atualização alterou a data original de instalação.'}
 if($updated.installation_id -ne $instance){throw 'A atualização mudou a identificação da instalação.'}
 if(-not (Test-Path -LiteralPath (Join-Path $target 'client-package.mjs'))){throw 'Módulo de identificação não foi incluído no pacote.'}
 'Instalador NSIS real: CRC preservado com identificação incorporada, nome independente do arquivo e vínculo mantido na atualização: OK.'
}finally{
 $uninstall=Join-Path $target 'Uninstall.exe'
 if(Test-Path -LiteralPath $uninstall){$process=Start-Process -FilePath $uninstall -ArgumentList @('/S',('_?='+$target)) -PassThru;if(-not $process.WaitForExit(60000)){$process.Kill();throw 'Desinstalação do teste excedeu o prazo.'}}
 if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Recurse -Force}
}
