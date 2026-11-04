Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot 'agent-config.json'
$existing=@{}
if(Test-Path -LiteralPath $configPath){$data=Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json;foreach($property in $data.PSObject.Properties){$existing[$property.Name]=$property.Value}}
$form = New-Object System.Windows.Forms.Form
$form.Text = 'BackupDesk — '+$(if($existing.name){$existing.name}else{'Configurar agente'})
$form.Size = New-Object System.Drawing.Size(530,310)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Endereço do painel (use HTTPS fora do computador local):'
$label.Location = New-Object System.Drawing.Point(20,20)
$label.Size = New-Object System.Drawing.Size(480,25)
$form.Controls.Add($label)
$url = New-Object System.Windows.Forms.TextBox
$url.Location = New-Object System.Drawing.Point(20,50)
$url.Size = New-Object System.Drawing.Size(475,25)
$url.Text = $(if($existing.url){$existing.url}else{''})
$form.Controls.Add($url)
$label2 = New-Object System.Windows.Forms.Label
$label2.Text = 'Token gerado no cadastro do computador no painel:'
$label2.Location = New-Object System.Drawing.Point(20,95)
$label2.Size = New-Object System.Drawing.Size(480,25)
$form.Controls.Add($label2)
$token = New-Object System.Windows.Forms.TextBox
$token.Location = New-Object System.Drawing.Point(20,125)
$token.Size = New-Object System.Drawing.Size(475,25)
$token.UseSystemPasswordChar = $true
if($existing.token){$token.Text=$existing.token;$token.ReadOnly=$true}
$form.Controls.Add($token)
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Salvar configuração'
$button.Location = New-Object System.Drawing.Point(20,180)
$button.Size = New-Object System.Drawing.Size(180,35)
$button.Add_Click({
    try {
        $parsed = $null
        if (-not [Uri]::TryCreate($url.Text.Trim(), [UriKind]::Absolute, [ref]$parsed) -or $parsed.Scheme -notin @('http','https') -or $parsed.UserInfo) { throw 'Informe uma URL HTTP/HTTPS válida.' }
        if ($parsed.Scheme -eq 'http' -and -not $parsed.IsLoopback) { throw 'Use HTTPS para acessar outro computador.' }
        if ($token.Text.Trim() -notmatch '^[a-f0-9]{64}$') { throw 'Informe o token de 64 caracteres exibido no painel.' }
        $configPath = Join-Path $PSScriptRoot 'agent-config.json'
        $existing.url=$url.Text.Trim().TrimEnd('/');$existing.token=$token.Text.Trim()
        $existing | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
        Start-Process -FilePath (Join-Path $PSScriptRoot 'BackupDeskClient.exe') -WorkingDirectory $PSScriptRoot
        [System.Windows.Forms.MessageBox]::Show('Client configurado. O agente ficará em segundo plano e iniciará ao entrar no Windows.', 'BackupDesk') | Out-Null
        $form.Close()
    } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'BackupDesk') | Out-Null }
})
$form.Controls.Add($button)
[void]$form.ShowDialog()
