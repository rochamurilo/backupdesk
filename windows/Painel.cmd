@echo off
cd /d "%~dp0"
echo BackupDesk Master - painel local: http://127.0.0.1:3000
echo Credenciais: data\initial-admin.txt
echo O agente local inicia automaticamente. Mantenha esta janela aberta.
"%~dp0node.exe" "%~dp0master.mjs"
pause
