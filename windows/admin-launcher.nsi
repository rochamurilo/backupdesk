Unicode True
!include "LogicLib.nsh"
Name "BackupDesk VSS (administrador)"
RequestExecutionLevel admin
SilentInstall silent
AutoCloseWindow true
!ifdef CLIENT
 OutFile "build/BackupDeskClientVSS.exe"
!else
 OutFile "build/BackupDeskVSS.exe"
!endif
!define UPDATE_GUARD_NO_UNINSTALL
!include "update.nsh"
Section
 StrCpy $INSTDIR $EXEDIR
 MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "O modo VSS precisa de administrador. O BackupDesk desta pasta será reiniciado com essa permissão. Backups em andamento poderão ser interrompidos. Confirme somente para usar VSS nesta sessão do Windows." IDOK +2
 Quit
 Call StopInstalledProcesses
!ifdef CLIENT
 ExecShell "open" "$EXEDIR\BackupDeskClient.exe"
!else
 ExecShell "open" "$EXEDIR\BackupDesk.exe" "/vss-admin"
!endif
SectionEnd
