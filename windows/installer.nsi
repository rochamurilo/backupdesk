Unicode True
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "TextFunc.nsh"
Var VssOwnerSid
!ifdef CLIENT
  !define PRODUCT "BackupDesk Client"
  !define VERSION "0.17.0"
  !define KEY "BackupDeskClient"
  !define FOLDER "BackupDeskClient"
  OutFile "../windows/build/BackupDesk-Client-0.17.0-x64.exe"
!else
  !define PRODUCT "BackupDesk Master"
  !define VERSION "0.17.0"
  !define KEY "BackupDesk"
  !define FOLDER "BackupDesk"
  OutFile "../dist/BackupDesk-Master-0.17.0-x64.exe"
!endif
Name "${PRODUCT} (teste local)"
InstallDir "$LOCALAPPDATA\${FOLDER}"
InstallDirRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "InstallLocation"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ABORTWARNING
!define MUI_CUSTOMFUNCTION_ABORT CancelUpdate
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchInstalled
!ifdef CLIENT
 !define MUI_FINISHPAGE_RUN "$INSTDIR\Configurar.cmd"
 !define MUI_FINISHPAGE_RUN_TEXT "Abrir client"
!else
 !define MUI_FINISHPAGE_RUN "$INSTDIR\BackupDesk.exe"
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
 nsExec::ExecToStack '"$INSTDIR\node.exe" "$INSTDIR\client-package.mjs" --ready'
 Pop $0
 Pop $1
 ${If} $0 == 0
  ExecShell "open" "$INSTDIR\BackupDeskClient.exe"
 ${Else}
  ExecShell "open" "$INSTDIR\Configurar.cmd"
 ${EndIf}
!else
 ExecShell "open" "$INSTDIR\BackupDesk.exe"
!endif
FunctionEnd
Function .onInit
 SetShellVarContext current
 ${IfNot} ${RunningX64}
  MessageBox MB_OK "Este instalador requer Windows x64."
  Abort
 ${EndIf}
FunctionEnd
Function .onInstSuccess
 Delete "$INSTDIR\data\update-lock.json"
!ifdef CLIENT
 ExecShell "open" "$INSTDIR\BackupDeskClient.exe" "/background"
!else
 ExecShell "open" "$INSTDIR\BackupDesk.exe" "/background"
!endif
FunctionEnd
Function .onInstFailed
 Delete "$INSTDIR\data\update-lock.json"
FunctionEnd
Function CancelUpdate
 Delete "$INSTDIR\data\update-lock.json"
FunctionEnd
Function un.onUninstSuccess
 Delete "$INSTDIR\data\update-lock.json"
FunctionEnd
!include "update.nsh"
Section "${PRODUCT}" Main
 Call StopInstalledProcesses
 SetOutPath "$INSTDIR"
 File "build/node.exe"
 File /oname=NODE-LICENSE.txt "build/LICENSE"
 File "../agent.mjs"
 File "../schedule.mjs"
 File "../filesystem.mjs"
 File "../disk-backup.mjs"
 File "../backup-repository.mjs"
 File "../client-package.mjs"
 File "../crypto-vault.mjs"
 File "../encrypted-files.mjs"
 File "../encryption-service.mjs"
 File "../telemetry.mjs"
 File "../office-client.mjs"
 File "../auth.mjs"
 File "../preferences.mjs"
 File "../bandwidth.mjs"
 File "../repository-catalog.mjs"
 File "../repository-store.mjs"
 File "../progress.mjs"
 File "../restore-tree.mjs"
 File "../calendar-events.mjs"
 File "../vss.mjs"
 SetOutPath "$INSTDIR\windows"
 File "vss-client.ps1"
 File "protect-key.ps1"
 SetOutPath "$INSTDIR"
 File "../background.mjs"
!ifdef CLIENT
 File "launch-agent.mjs"
 File "Configure.ps1"
 File "Agente.cmd"
 File "Configurar.cmd"
 File "build/BackupDeskClient.exe"
 File /oname=VSSComponentSetup.exe "build/BackupDeskClientVSSComponent.exe"
 nsExec::ExecToStack '"$INSTDIR\node.exe" "$INSTDIR\client-package.mjs" --install "$EXEPATH"'
 Pop $0
 Pop $1
 ${If} $0 != 0
  MessageBox MB_OK|MB_ICONSTOP "Não foi possível configurar a identificação do client. $1"
  Abort
 ${EndIf}
!endif
 File "LEIA-ME.txt"
 CreateDirectory "$SMPROGRAMS\${FOLDER}"
!ifndef CLIENT
 File "../server.mjs"
 File "../native-picker.mjs"
 SetOutPath "$INSTDIR\windows"
 File "folder-picker.ps1"
 SetOutPath "$INSTDIR"
 File "../local-master.mjs"
 File "../master.mjs"
 File "Painel.cmd"
 File "build/BackupDesk.exe"
 File /oname=VSSComponentSetup.exe "build/BackupDeskVSSComponent.exe"
 SetOutPath "$INSTDIR\public"
 File "../public/index.html"
 File "../public/app.js"
 File "../public/style.css"
 SetOutPath "$INSTDIR\dist"
 File "build/BackupDesk-Client-0.17.0-x64.exe"
 SetOutPath "$INSTDIR"
 nsExec::ExecToStack '"$INSTDIR\node.exe" "$INSTDIR\server.mjs" --prepare-master'
 Pop $0
 Pop $1
 ${If} $0 != 0
  MessageBox MB_OK "Não foi possível preparar o master. Confira as permissões da pasta e abra Painel local para consultar o erro."
 ${EndIf}
 Delete "$SMPROGRAMS\${FOLDER}\Painel local.lnk"
 CreateShortcut "$SMPROGRAMS\BackupDesk.lnk" "$INSTDIR\BackupDesk.exe" "" "$INSTDIR\BackupDesk.exe" 0 SW_SHOWNORMAL "" "Abrir BackupDesk e iniciar o painel"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\BackupDesk.exe" "" "$INSTDIR\BackupDesk.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\BackupDesk.exe" "Path" "$INSTDIR"
 System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
 Delete "$SMPROGRAMS\BackupDesk VSS (administrador).lnk"
 Delete "$INSTDIR\BackupDeskVSS.exe"
 CreateShortcut "$DESKTOP\BackupDesk.lnk" "$INSTDIR\BackupDesk.exe"
!else
 Delete "$SMPROGRAMS\${FOLDER}\Client VSS (administrador).lnk"
 Delete "$INSTDIR\BackupDeskClientVSS.exe"
 CreateShortcut "$DESKTOP\BackupDesk Client.lnk" "$INSTDIR\BackupDeskClient.exe"
!endif
!ifdef CLIENT
 CreateShortcut "$SMPROGRAMS\${FOLDER}\Configurar agente.lnk" "$INSTDIR\Configurar.cmd"
 CreateShortcut "$SMPROGRAMS\${FOLDER}\Iniciar agente.lnk" "$INSTDIR\BackupDeskClient.exe"
!else
 Delete "$SMPROGRAMS\${FOLDER}\Configurar agente.lnk"
 Delete "$SMPROGRAMS\${FOLDER}\Iniciar agente.lnk"
!endif
 CreateShortcut "$SMPROGRAMS\${FOLDER}\Instruções.lnk" "$INSTDIR\LEIA-ME.txt"
!ifdef CLIENT
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "BackupDeskClient" '"$INSTDIR\BackupDeskClient.exe" /background'
!else
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "BackupDeskMaster" '"$INSTDIR\BackupDesk.exe" /background'
!endif
 WriteUninstaller "$INSTDIR\Uninstall.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "DisplayName" "${PRODUCT} (teste local)"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "DisplayVersion" "${VERSION}"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "InstallLocation" "$INSTDIR"
!ifndef CLIENT
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "DisplayIcon" "$INSTDIR\BackupDesk.exe"
!endif
SectionEnd
Section "Uninstall"
 Call un.StopInstalledProcesses
!ifdef CLIENT
 DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "BackupDeskClient"
!else
 DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "BackupDeskMaster"
!endif
!ifndef CLIENT
 Delete "$DESKTOP\BackupDesk.lnk"
 Delete "$SMPROGRAMS\BackupDesk.lnk"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\BackupDesk.exe"
 Delete "$SMPROGRAMS\${FOLDER}\Painel local.lnk"
 Delete "$INSTDIR\server.mjs"
 Delete "$INSTDIR\native-picker.mjs"
 Delete "$INSTDIR\native-admin.mjs"
 Delete "$INSTDIR\windows\folder-picker.ps1"
 RMDir "$INSTDIR\windows"
 Delete "$INSTDIR\local-master.mjs"
 Delete "$INSTDIR\master.mjs"
 Delete "$INSTDIR\Painel.cmd"
 Delete "$INSTDIR\BackupDesk.exe"
 Delete "$INSTDIR\public\index.html"
 Delete "$INSTDIR\public\app.js"
 Delete "$INSTDIR\public\style.css"
 RMDir "$INSTDIR\public"
 Delete "$INSTDIR\dist\BackupDesk-Client-0.17.0-x64.exe"
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
 Delete "$INSTDIR\schedule.mjs"
 Delete "$INSTDIR\filesystem.mjs"
 Delete "$INSTDIR\disk-backup.mjs"
 Delete "$INSTDIR\backup-repository.mjs"
 Delete "$INSTDIR\client-package.mjs"
 Delete "$INSTDIR\crypto-vault.mjs"
 Delete "$INSTDIR\encrypted-files.mjs"
 Delete "$INSTDIR\encryption-service.mjs"
 Delete "$INSTDIR\telemetry.mjs"
 Delete "$INSTDIR\office-client.mjs"
 Delete "$INSTDIR\auth.mjs"
 Delete "$INSTDIR\windows\protect-key.ps1"
 Delete "$INSTDIR\preferences.mjs"
 Delete "$INSTDIR\bandwidth.mjs"
 Delete "$INSTDIR\repository-catalog.mjs"
 Delete "$INSTDIR\repository-store.mjs"
 Delete "$INSTDIR\progress.mjs"
 Delete "$INSTDIR\restore-tree.mjs"
 Delete "$INSTDIR\calendar-events.mjs"
 Delete "$INSTDIR\vss.mjs"
 Delete "$INSTDIR\windows\vss.ps1"
 Delete "$INSTDIR\windows\vss-client.ps1"
 Delete "$INSTDIR\VSSComponentSetup.exe"
 RMDir "$INSTDIR\windows"
 Delete "$INSTDIR\BackupDeskVSS.exe"
 Delete "$INSTDIR\BackupDeskClientVSS.exe"
!ifndef CLIENT
 Delete "$SMPROGRAMS\BackupDesk VSS (administrador).lnk"
!endif
 Delete "$SMPROGRAMS\${FOLDER}\Client VSS (administrador).lnk"
 Delete "$INSTDIR\background.mjs"
 Delete "$INSTDIR\BackupDeskClient.exe"
 Delete "$INSTDIR\launch-agent.mjs"
 Delete "$INSTDIR\Configure.ps1"
 Delete "$INSTDIR\BackupDeskClient.exe"
 Delete "$INSTDIR\Configurar.cmd"
 Delete "$INSTDIR\LEIA-ME.txt"
 Delete "$INSTDIR\Uninstall.exe"
 RMDir "$INSTDIR"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}"
SectionEnd
