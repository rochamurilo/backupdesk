Unicode True
!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "TextFunc.nsh"
Var VssOwnerSid
Var PreparedUpdate
!ifdef CLIENT
  !define PRODUCT "BackupDesk Client"
  !define VERSION "0.32.0"
  !define KEY "BackupDeskClient"
  !define FOLDER "BackupDeskClient"
  !define UPDATE_PRODUCT "client"
  !ifdef UPDATE_ONLY
   OutFile "../dist/BackupDesk-Atualizacao-Client-0.32.0-x64.exe"
  !else
   OutFile "../windows/build/BackupDesk-Client-0.32.0-x64.exe"
  !endif
!else
  !define PRODUCT "BackupDesk Master"
  !define VERSION "0.32.0"
  !define KEY "BackupDesk"
  !define FOLDER "BackupDesk"
  !define UPDATE_PRODUCT "master"
  !ifdef UPDATE_ONLY
   OutFile "../dist/BackupDesk-Atualizacao-Master-0.32.0-x64.exe"
  !else
   OutFile "../dist/BackupDesk-Master-0.32.0-x64.exe"
  !endif
!endif
!ifdef UPDATE_ONLY
 Name "${PRODUCT} — Atualização"
 !define MUI_WELCOMEPAGE_TITLE "Atualização do ${PRODUCT}"
 !define MUI_WELCOMEPAGE_TEXT "Este arquivo atualiza somente uma instalação existente. O nome, as chaves de criptografia, as rotinas e as preferências são preservados. Não é necessário informar nome ou chave. Execute com o mesmo usuário da instalação."
 !define MUI_DIRECTORYPAGE_TEXT_TOP "Confirme a pasta original do aplicativo. A atualização será bloqueada se a identificação ou as chaves existentes não puderem ser validadas."
!else
 Name "${PRODUCT} (teste local)"
!endif
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
 ${If} $PreparedUpdate == 1
  Delete "$INSTDIR\data\update-lock.json"
 ${EndIf}
FunctionEnd
Function CancelUpdate
 ${If} $PreparedUpdate == 1
  Delete "$INSTDIR\data\update-lock.json"
 ${EndIf}
FunctionEnd
Function un.onUninstSuccess
 Delete "$INSTDIR\data\update-lock.json"
FunctionEnd
!include "update.nsh"
!ifndef UPDATE_ONLY
 !include "client-preflight.nsh"
!endif
!include "installation-preflight.nsh"
Section "${PRODUCT}" Main
!ifdef UPDATE_ONLY
 Call VerifyExistingInstallation
!else ifdef CLIENT
 Call VerifyClientIdentity
!endif
 Call StopInstalledProcesses
 StrCpy $PreparedUpdate 1
 SetOutPath "$INSTDIR"
 File "build/node.exe"
 File /oname=NODE-LICENSE.txt "build/LICENSE"
 File "../agent.mjs"
 File "../schedule.mjs"
 File "../agent-schedule-state.mjs"
 File "../filesystem.mjs"
 File "../disk-backup.mjs"
 File "../restic-backup.mjs"
 File "../restic-runner.mjs"
 File "../restic-policy.mjs"
 File "../restic-release.mjs"
 File "../backup-repository.mjs"
 File "../client-package.mjs"
 File "../installation-update.mjs"
 File "../crypto-vault.mjs"
 File "../encrypted-files.mjs"
 File "../encryption-service.mjs"
 File "../telemetry.mjs"
 File "../office-client.mjs"
 File "../auth.mjs"
 File "../preferences.mjs"
 File "../bandwidth.mjs"
 File "../backup-control.mjs"
 File "../restic-local-transport.mjs"
 File "../repository-catalog.mjs"
 File "../repository-store.mjs"
 File "../progress.mjs"
 File "../restore-tree.mjs"
 File "../calendar-events.mjs"
 File "../network-share.mjs"
 File "../logs-io.mjs"
 File "../status-logs.mjs"
 File "../log-settings.mjs"
 File "../overview-status.mjs"
 File "../overview-notifications.mjs"
 File "../vss.mjs"
 SetOutPath "$INSTDIR\windows"
 File "vss-client.ps1"
 File "protect-key.ps1"
 File /oname=restic.exe "build/restic.exe"
 SetOutPath "$INSTDIR\licenses\restic"
 File "../licenses/restic/LICENSE"
 File "../licenses/restic/THIRD-PARTY-NOTICES.txt"
 SetOutPath "$INSTDIR\windows"
 File "network-share.ps1"
 SetOutPath "$INSTDIR"
 File "../background.mjs"
 File "../catalog-transfer.mjs"
!ifdef CLIENT
 File "launch-agent.mjs"
 File "Configure.ps1"
 File "Agente.cmd"
 File "Configurar.cmd"
 File "build/BackupDeskClient.exe"
 File /oname=VSSComponentSetup.exe "build/BackupDeskClientVSSComponent.exe"
!ifndef UPDATE_ONLY
 nsExec::ExecToStack '"$INSTDIR\node.exe" "$INSTDIR\client-package.mjs" --install "$EXEPATH"'
 Pop $0
 Pop $1
 ${If} $0 != 0
  MessageBox MB_OK|MB_ICONSTOP "Não foi possível configurar a identificação do client. $1"
  Abort
 ${EndIf}
!endif
!endif
 File "../server.mjs"
 File "../native-picker.mjs"
 File "../local-master.mjs"
 SetOutPath "$INSTDIR\windows"
 File "folder-picker.ps1"
 SetOutPath "$INSTDIR\public"
 File "../public/index.html"
 File "../public/app.js"
 File "../public/style.css"
 SetOutPath "$INSTDIR"
 File "LEIA-ME.txt"
 CreateDirectory "$SMPROGRAMS\${FOLDER}"
!ifndef CLIENT
 File "../master.mjs"
 File "Painel.cmd"
 File "build/BackupDesk.exe"
 File /oname=VSSComponentSetup.exe "build/BackupDeskVSSComponent.exe"
 SetOutPath "$INSTDIR\dist"
 File "build/BackupDesk-Client-0.32.0-x64.exe"
 File "../dist/BackupDesk-Atualizacao-Client-0.32.0-x64.exe"
 SetOutPath "$INSTDIR"
!ifndef UPDATE_ONLY
 nsExec::ExecToStack '"$INSTDIR\node.exe" "$INSTDIR\server.mjs" --prepare-master'
 Pop $0
 Pop $1
 ${If} $0 != 0
  MessageBox MB_OK "Não foi possível preparar o master. Confira as permissões da pasta e abra Painel local para consultar o erro."
 ${EndIf}
!endif
 Delete "$SMPROGRAMS\${FOLDER}\Painel local.lnk"
 CreateShortcut "$SMPROGRAMS\BackupDesk.lnk" "$INSTDIR\BackupDesk.exe" "" "$INSTDIR\BackupDesk.exe" 0 SW_SHOWNORMAL "" "Abrir BackupDesk e iniciar o painel"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\BackupDesk.exe" "" "$INSTDIR\BackupDesk.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\BackupDesk.exe" "Path" "$INSTDIR"
 System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
 Delete "$SMPROGRAMS\BackupDesk VSS (administrador).lnk"
 Delete "$INSTDIR\BackupDeskVSS.exe"
 Delete "$DESKTOP\BackupDesk.lnk"
!else
 Delete "$SMPROGRAMS\${FOLDER}\Client VSS (administrador).lnk"
 Delete "$INSTDIR\BackupDeskClientVSS.exe"
 Delete "$DESKTOP\BackupDesk Client.lnk"
 CreateShortcut "$SMPROGRAMS\BackupDesk Client.lnk" "$INSTDIR\BackupDeskClient.exe" "" "$INSTDIR\BackupDeskClient.exe" 0 SW_SHOWNORMAL "" "Abrir BackupDesk Client"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\BackupDeskClient.exe" "" "$INSTDIR\BackupDeskClient.exe"
 WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\BackupDeskClient.exe" "Path" "$INSTDIR"
 System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'

!endif
!ifdef CLIENT
 CreateShortcut "$SMPROGRAMS\${FOLDER}\Configurar agente.lnk" "$INSTDIR\Configurar.cmd"
 CreateShortcut "$SMPROGRAMS\${FOLDER}\Iniciar agente.lnk" "$INSTDIR\BackupDeskClient.exe"
!else
 Delete "$SMPROGRAMS\${FOLDER}\Configurar agente.lnk"
 Delete "$SMPROGRAMS\${FOLDER}\Iniciar agente.lnk"
!endif
 CreateShortcut "$SMPROGRAMS\${FOLDER}\Instruções.lnk" "$INSTDIR\LEIA-ME.txt"
!ifdef UPDATE_ONLY
 nsExec::ExecToStack '"$INSTDIR\node.exe" "$INSTDIR\installation-update.mjs" --check "$INSTDIR" "${UPDATE_PRODUCT}"'
 Pop $0
 Pop $1
 ${If} $0 != 0
  IfSilent +2 0
  MessageBox MB_OK|MB_ICONSTOP "Os arquivos foram atualizados, mas a identificação não pôde ser revalidada. O aplicativo não será iniciado e nenhuma chave foi criada. $1"
  SetErrorLevel 12
  Abort
 ${EndIf}
!endif
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
 Delete "$INSTDIR\server.mjs"
 Delete "$INSTDIR\native-picker.mjs"
 Delete "$INSTDIR\local-master.mjs"
 Delete "$INSTDIR\windows\folder-picker.ps1"
 Delete "$INSTDIR\public\index.html"
 Delete "$INSTDIR\public\app.js"
 Delete "$INSTDIR\public\style.css"
 RMDir "$INSTDIR\public"
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
 Delete "$INSTDIR\dist\BackupDesk-Client-0.32.0-x64.exe"
 Delete "$INSTDIR\dist\BackupDesk-Atualizacao-Client-0.32.0-x64.exe"
 RMDir "$INSTDIR\dist"
!else
 Delete "$DESKTOP\BackupDesk Client.lnk"
 Delete "$SMPROGRAMS\BackupDesk Client.lnk"
 DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\App Paths\BackupDeskClient.exe"
!endif
 Delete "$SMPROGRAMS\${FOLDER}\Configurar agente.lnk"
 Delete "$SMPROGRAMS\${FOLDER}\Iniciar agente.lnk"
 Delete "$SMPROGRAMS\${FOLDER}\Instruções.lnk"
 RMDir "$SMPROGRAMS\${FOLDER}"
 Delete "$INSTDIR\node.exe"
 Delete "$INSTDIR\NODE-LICENSE.txt"
 Delete "$INSTDIR\agent.mjs"
 Delete "$INSTDIR\schedule.mjs"
 Delete "$INSTDIR\agent-schedule-state.mjs"
 Delete "$INSTDIR\filesystem.mjs"
 Delete "$INSTDIR\disk-backup.mjs"
 Delete "$INSTDIR\restic-backup.mjs"
 Delete "$INSTDIR\restic-runner.mjs"
 Delete "$INSTDIR\restic-policy.mjs"
 Delete "$INSTDIR\restic-release.mjs"
 Delete "$INSTDIR\windows\restic.exe"
 Delete "$INSTDIR\licenses\restic\LICENSE"
 Delete "$INSTDIR\licenses\restic\THIRD-PARTY-NOTICES.txt"
 RMDir "$INSTDIR\licenses\restic"
 RMDir "$INSTDIR\licenses"
 Delete "$INSTDIR\backup-repository.mjs"
 Delete "$INSTDIR\client-package.mjs"
 Delete "$INSTDIR\installation-update.mjs"
 Delete "$INSTDIR\crypto-vault.mjs"
 Delete "$INSTDIR\encrypted-files.mjs"
 Delete "$INSTDIR\encryption-service.mjs"
 Delete "$INSTDIR\telemetry.mjs"
 Delete "$INSTDIR\office-client.mjs"
 Delete "$INSTDIR\auth.mjs"
 Delete "$INSTDIR\windows\protect-key.ps1"
 Delete "$INSTDIR\preferences.mjs"
 Delete "$INSTDIR\bandwidth.mjs"
 Delete "$INSTDIR\backup-control.mjs"
 Delete "$INSTDIR\restic-local-transport.mjs"
 Delete "$INSTDIR\repository-catalog.mjs"
 Delete "$INSTDIR\repository-store.mjs"
 Delete "$INSTDIR\progress.mjs"
 Delete "$INSTDIR\restore-tree.mjs"
 Delete "$INSTDIR\calendar-events.mjs"
 Delete "$INSTDIR\network-share.mjs"
 Delete "$INSTDIR\logs-io.mjs"
 Delete "$INSTDIR\status-logs.mjs"
 Delete "$INSTDIR\log-settings.mjs"
 Delete "$INSTDIR\overview-status.mjs"
 Delete "$INSTDIR\overview-notifications.mjs"
 Delete "$INSTDIR\windows\network-share.ps1"
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
 Delete "$INSTDIR\catalog-transfer.mjs"
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
