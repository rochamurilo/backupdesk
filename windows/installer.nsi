Unicode True
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!ifdef CLIENT
  !define PRODUCT "BackupDesk Client"
  !define VERSION "0.3.1"
  !define KEY "BackupDeskClient"
  !define FOLDER "BackupDeskClient"
  OutFile "../windows/build/BackupDesk-Client-0.3.1-x64.exe"
!else
  !define PRODUCT "BackupDesk Master"
  !define VERSION "0.3.2"
  !define KEY "BackupDesk"
  !define FOLDER "BackupDesk"
  OutFile "../dist/BackupDesk-Master-0.3.2-x64.exe"
!endif
Name "${PRODUCT} (teste local)"
InstallDir "$LOCALAPPDATA\${FOLDER}"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchInstalled
!ifdef CLIENT
 !define MUI_FINISHPAGE_RUN "$INSTDIR\Configurar.cmd"
 !define MUI_FINISHPAGE_RUN_TEXT "Configurar este client"
!else
 !define MUI_FINISHPAGE_RUN "$INSTDIR\Painel.cmd"
 !define MUI_FINISHPAGE_RUN_TEXT "Abrir master e criar rotinas"
!endif
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"
Function LaunchInstalled
!ifdef CLIENT
 ExecShell "open" "$INSTDIR\Configurar.cmd"
!else
 ExecShell "open" "$INSTDIR\Painel.cmd"
!endif
FunctionEnd
Function .onInit
 ${IfNot} ${RunningX64}
  MessageBox MB_OK "Este instalador requer Windows x64."
  Abort
 ${EndIf}
FunctionEnd
!include "update.nsh"
Section "${PRODUCT}" Main
 Call StopInstalledProcesses
 SetOutPath "$INSTDIR"
 File "build/node.exe"
 File /oname=NODE-LICENSE.txt "build/LICENSE"
 File "../agent.mjs"
 File "../filesystem.mjs"
!ifdef CLIENT
 File "launch-agent.mjs"
 File "Configure.ps1"
 File "Agente.cmd"
 File "Configurar.cmd"
!endif
 File "LEIA-ME.txt"
 CreateDirectory "$SMPROGRAMS\${FOLDER}"
!ifndef CLIENT
 File "../server.mjs"
 File "../local-master.mjs"
 File "../master.mjs"
 File "Painel.cmd"
 SetOutPath "$INSTDIR\public"
 File "../public/index.html"
 File "../public/app.js"
 File "../public/style.css"
 SetOutPath "$INSTDIR\dist"
 File "build/BackupDesk-Client-0.3.1-x64.exe"
 SetOutPath "$INSTDIR"
 ExecWait '"$INSTDIR\node.exe" "$INSTDIR\server.mjs" --prepare-master' $0
 ${If} $0 != 0
  MessageBox MB_OK "Não foi possível preparar o master. Confira as permissões da pasta e abra Painel local para consultar o erro."
 ${EndIf}
 CreateShortcut "$SMPROGRAMS\${FOLDER}\Painel local.lnk" "$INSTDIR\Painel.cmd"
 CreateShortcut "$DESKTOP\BackupDesk.lnk" "$INSTDIR\Painel.cmd"
!else
 CreateShortcut "$DESKTOP\BackupDesk Client.lnk" "$INSTDIR\Agente.cmd"
!endif
!ifdef CLIENT
 CreateShortcut "$SMPROGRAMS\${FOLDER}\Configurar agente.lnk" "$INSTDIR\Configurar.cmd"
 CreateShortcut "$SMPROGRAMS\${FOLDER}\Iniciar agente.lnk" "$INSTDIR\Agente.cmd"
!else
 Delete "$SMPROGRAMS\${FOLDER}\Configurar agente.lnk"
 Delete "$SMPROGRAMS\${FOLDER}\Iniciar agente.lnk"
!endif
 CreateShortcut "$SMPROGRAMS\${FOLDER}\Instruções.lnk" "$INSTDIR\LEIA-ME.txt"
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "DisplayName" "${PRODUCT} (teste local)"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "DisplayVersion" "${VERSION}"
SectionEnd
Section "Uninstall"
 Call un.StopInstalledProcesses
!ifndef CLIENT
 Delete "$DESKTOP\BackupDesk.lnk"
 Delete "$SMPROGRAMS\${FOLDER}\Painel local.lnk"
 Delete "$INSTDIR\server.mjs"
 Delete "$INSTDIR\local-master.mjs"
 Delete "$INSTDIR\master.mjs"
 Delete "$INSTDIR\Painel.cmd"
 Delete "$INSTDIR\public\index.html"
 Delete "$INSTDIR\public\app.js"
 Delete "$INSTDIR\public\style.css"
 RMDir "$INSTDIR\public"
 Delete "$INSTDIR\dist\BackupDesk-Client-0.3.1-x64.exe"
 RMDir "$INSTDIR\dist"
!else
 Delete "$DESKTOP\BackupDesk Client.lnk"
!endif
 Delete "$SMPROGRAMS\${FOLDER}\Configurar agente.lnk"
 Delete "$SMPROGRAMS\${FOLDER}\Iniciar agente.lnk"
 Delete "$SMPROGRAMS\${FOLDER}\Instruções.lnk"
 RMDir "$SMPROGRAMS\${FOLDER}"
 Delete "$INSTDIR\node.exe"
 Delete "$INSTDIR\NODE-LICENSE.txt"
 Delete "$INSTDIR\agent.mjs"
 Delete "$INSTDIR\filesystem.mjs"
 Delete "$INSTDIR\launch-agent.mjs"
 Delete "$INSTDIR\Configure.ps1"
 Delete "$INSTDIR\Agente.cmd"
 Delete "$INSTDIR\Configurar.cmd"
 Delete "$INSTDIR\LEIA-ME.txt"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}"
SectionEnd
