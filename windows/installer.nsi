Unicode True
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
Name "BackupDesk (teste local)"
OutFile "../dist/BackupDesk-Setup-0.1.0-x64.exe"
InstallDir "$LOCALAPPDATA\BackupDesk"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\LEIA-ME.txt"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Ler instruções de teste"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK "Este instalador requer Windows x64."
    Abort
  ${EndIf}
FunctionEnd
Section "BackupDesk" Main
  SetOutPath "$INSTDIR"
  File "build/node.exe"
  File /oname=NODE-LICENSE.txt "build/LICENSE"
  File "../server.mjs"
  File "../agent.mjs"
  File "launch-agent.mjs"
  File "Configure.ps1"
  File "Painel.cmd"
  File "Agente.cmd"
  File "Configurar.cmd"
  File "LEIA-ME.txt"
  SetOutPath "$INSTDIR\public"
  File "../public/index.html"
  File "../public/app.js"
  File "../public/style.css"
  SetOutPath "$INSTDIR"
  CreateDirectory "$SMPROGRAMS\BackupDesk"
  CreateShortcut "$SMPROGRAMS\BackupDesk\Painel local.lnk" "$INSTDIR\Painel.cmd"
  CreateShortcut "$SMPROGRAMS\BackupDesk\Configurar agente.lnk" "$INSTDIR\Configurar.cmd"
  CreateShortcut "$SMPROGRAMS\BackupDesk\Iniciar agente.lnk" "$INSTDIR\Agente.cmd"
  CreateShortcut "$SMPROGRAMS\BackupDesk\Instruções.lnk" "$INSTDIR\LEIA-ME.txt"
  CreateShortcut "$DESKTOP\BackupDesk.lnk" "$INSTDIR\Painel.cmd"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BackupDesk" "DisplayName" "BackupDesk (teste local)"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BackupDesk" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BackupDesk" "DisplayVersion" "0.1.0"
SectionEnd
Section "Uninstall"
  Delete "$DESKTOP\BackupDesk.lnk"
  Delete "$SMPROGRAMS\BackupDesk\Painel local.lnk"
  Delete "$SMPROGRAMS\BackupDesk\Configurar agente.lnk"
  Delete "$SMPROGRAMS\BackupDesk\Iniciar agente.lnk"
  Delete "$SMPROGRAMS\BackupDesk\Instruções.lnk"
  RMDir "$SMPROGRAMS\BackupDesk"
  Delete "$INSTDIR\node.exe"
  Delete "$INSTDIR\NODE-LICENSE.txt"
  Delete "$INSTDIR\server.mjs"
  Delete "$INSTDIR\agent.mjs"
  Delete "$INSTDIR\launch-agent.mjs"
  Delete "$INSTDIR\Configure.ps1"
  Delete "$INSTDIR\Painel.cmd"
  Delete "$INSTDIR\Agente.cmd"
  Delete "$INSTDIR\Configurar.cmd"
  Delete "$INSTDIR\LEIA-ME.txt"
  Delete "$INSTDIR\public\index.html"
  Delete "$INSTDIR\public\app.js"
  Delete "$INSTDIR\public\style.css"
  RMDir "$INSTDIR\public"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BackupDesk"
SectionEnd
