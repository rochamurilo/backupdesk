@echo off
cd /d "%~dp0"
echo BackupDesk - painel local: http://127.0.0.1:3000
echo Na primeira execucao, consulte data\initial-admin.txt para usuario e senha.
echo Mantenha esta janela aberta enquanto usa o painel.
start "" "http://127.0.0.1:3000"
"%~dp0node.exe" "%~dp0server.mjs"
pause
