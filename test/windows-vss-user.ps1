$ErrorActionPreference='Stop'
Set-Location (Join-Path $PSScriptRoot 'agent')
$key='b'*64
try{
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$env:BACKUPDESK_VSS_PRODUCT='master'
$clientScript=Join-Path $PSScriptRoot 'agent\windows\vss-client.ps1'
$powerShell=Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$fixture=Join-Path $PSScriptRoot ('backupdesk-vss-'+[guid]::NewGuid().ToString('N')+'.pst')
$handle=$null;$snapshot=$null
function Invoke-Client($Request){
 $Request.protocol=1;if(-not $Request.client){$Request.client=$key}
 $env:BACKUPDESK_VSS_REQUEST=$Request | ConvertTo-Json -Compress
 $out=& $powerShell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $clientScript 2>&1
 if($LASTEXITCODE -ne 0){throw ($out -join "`n")}
 return (($out -join "`n") | ConvertFrom-Json)
}
try{
 $principal=New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent());if($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'O cliente de teste não pode executar como administrador.'}
 $probe=Invoke-Client @{action='probe'};if(-not $probe.automatic){throw 'Componente não responde.'}
 $payload=[Text.Encoding]::UTF8.GetBytes('Arquivo de teste bloqueado; não é um PST real do Outlook.')
 [IO.File]::WriteAllBytes($fixture,$payload)
 [IO.File]::SetLastWriteTimeUtc($fixture,[datetime]'2025-06-15T11:12:13Z')
 $handle=[IO.File]::Open($fixture,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
 $blocked=$false;try{$null=[IO.File]::ReadAllBytes($fixture)}catch{$blocked=$true};if(-not $blocked){throw 'Arquivo de teste não foi bloqueado.'}
 $volume=[IO.Path]::GetPathRoot($fixture)
 $snapshot=Invoke-Client @{action='create';volume=$volume}
 $env:BACKUPDESK_TEST_SNAPSHOT=$snapshot.device+'\'+$fixture.Substring($volume.Length)
 $env:BACKUPDESK_TEST_CONTENT=[Convert]::ToBase64String($payload)
 & (Join-Path $PSScriptRoot 'node.exe') --input-type=module -e "import {readFile,stat} from 'node:fs/promises';import assert from 'node:assert/strict';assert.equal((await readFile(process.env.BACKUPDESK_TEST_SNAPSHOT)).toString('base64'),process.env.BACKUPDESK_TEST_CONTENT);console.log('Snapshot real leu arquivo bloqueado: OK')"
 if($LASTEXITCODE -ne 0){throw 'Não foi possível ler o snapshot real.'}
 $refused=$false;try{$null=Invoke-Client @{action='delete';id=$snapshot.id;client=('c'*64)}}catch{$refused=$true}
 if(-not $refused){throw 'Outra instalação conseguiu remover o snapshot.'}
 $removedId=$snapshot.id;$null=Invoke-Client @{action='delete';id=$snapshot.id};$snapshot=$null
 $env:BACKUPDESK_TEST_SOURCE=$fixture
 $env:BACKUPDESK_TEST_DEST=Join-Path $PSScriptRoot ('backupdesk-destination-'+[guid]::NewGuid().ToString('N'))
 New-Item -ItemType Directory -Path $env:BACKUPDESK_TEST_DEST | Out-Null
 & (Join-Path $PSScriptRoot 'node.exe') --input-type=module -e "import {backupToDisk} from './disk-backup.mjs';import {readFile,stat} from 'node:fs/promises';import assert from 'node:assert/strict';const {createBandwidthLimiter}=await import('./bandwidth.mjs');let uploaded=0;const limit=createBandwidthLimiter({getPolicy:()=>({enabled:true,start:'00:00',end:'00:00',upload_mbps:0.001,download_mbps:null})});const throttle=async(n,direction)=>{if(direction==='upload')uploaded+=n;await limit(n,direction)};const result=await backupToDisk({throttle,source:process.env.BACKUPDESK_TEST_SOURCE,destination:process.env.BACKUPDESK_TEST_DEST,device:'native',routine:1,run:'native',useVss:false});assert.equal(result.consistency,'vss-crash-consistent-no-writers');assert.equal((await readFile(result.snapshot+'/files/'+result.files[0].path)).toString('base64'),process.env.BACKUPDESK_TEST_CONTENT);assert.equal(result.backup_type,'full');assert.equal(uploaded,result.files[0].size);assert.equal(result.files[0].modified_at,'2025-06-15T11:12:13.000Z');const differential=await backupToDisk({source:process.env.BACKUPDESK_TEST_SOURCE,destination:process.env.BACKUPDESK_TEST_DEST,device:'native',routine:2,run:'native_diff',useVss:false});assert.equal(differential.backup_type,'differential');assert.equal(differential.base_run,'native');assert.equal(differential.changed_files,0);assert.equal(differential.pst_validation.outlook,'not-tested');const {restoreFromDisk}=await import('./disk-backup.mjs');const restored=await restoreFromDisk({snapshot:differential.snapshot,files:differential.files,target:process.env.BACKUPDESK_TEST_DEST,job:'restore_diff'});assert.equal((await readFile(restored.destination+'/'+differential.files[0].path)).toString('base64'),process.env.BACKUPDESK_TEST_CONTENT);assert.equal((await stat(restored.destination+'/'+differential.files[0].path)).mtime.toISOString(),'2025-06-15T11:12:13.000Z');const {cp,rename,rm}=await import('node:fs/promises');const {scanRepository}=await import('./repository-catalog.mjs');const portable=process.env.BACKUPDESK_TEST_DEST+'-moved';await cp(process.env.BACKUPDESK_TEST_DEST,portable,{recursive:true});await rename(result.snapshot,result.snapshot+'-offline');const entries=[];await scanRepository(portable,{onSnapshot:async entry=>entries.push(entry)});const moved=entries.find(e=>e.metadata.run==='native_diff');assert.ok(moved);const recovered=await restoreFromDisk({snapshot:moved.snapshot,files:moved.files,target:portable,job:'portable_diff'});assert.equal((await readFile(recovered.destination+'/'+moved.files[0].path)).toString('base64'),process.env.BACKUPDESK_TEST_CONTENT);await rm(portable,{recursive:true,force:true});console.log('VSS, limite no fluxo de cópia, diferencial e restauração de repositório movido: OK');"
 if($LASTEXITCODE -ne 0){throw 'O motor de backup VSS falhou.'}
 $null=Invoke-Client @{action='cleanup'}
 'Windows: tarefa SYSTEM, pipe autenticado, snapshot de arquivo bloqueado, isolamento e limpeza: OK.'
 'A recuperação lógica de um PST real com Outlook aberto não foi testada.'
}finally{
 if($handle){$handle.Dispose()}
 if($snapshot){try{$null=Invoke-Client @{action='delete';id=$snapshot.id}}catch{Write-Warning $_}}
 if($env:BACKUPDESK_TEST_DEST -and (Test-Path -LiteralPath $env:BACKUPDESK_TEST_DEST)){Remove-Item -LiteralPath $env:BACKUPDESK_TEST_DEST -Recurse -Force}
 if(Test-Path -LiteralPath $fixture){Remove-Item -LiteralPath $fixture -Force}
}

 @{success=$true;nonAdministrator=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'result.json') -Encoding UTF8
}catch{
 @{success=$false;error=$_.Exception.Message;stack=$_.ScriptStackTrace} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'result.json') -Encoding UTF8
 exit 1
}
