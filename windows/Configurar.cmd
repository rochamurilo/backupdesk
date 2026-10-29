@echo off
powershell.exe -NoProfile -File "%~dp0Configure.ps1"
if errorlevel 1 pause
