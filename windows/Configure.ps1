Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = 'Stop'
$form = New-Object System.Windows.Forms.Form
$form.Text = 'BackupDesk — Configurar agente'
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
$url.Text = 'http://127.0.0.1:3000'
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
        @{url=$url.Text.Trim().TrimEnd('/');token=$token.Text.Trim()} | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8
        [System.Windows.Forms.MessageBox]::Show('Configuração salva. Abra o atalho Iniciar agente. Reinicie o agente se ele já estiver aberto.', 'BackupDesk') | Out-Null
        $form.Close()
    } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'BackupDesk') | Out-Null }
})
$form.Controls.Add($button)
[void]$form.ShowDialog()
