Unicode True
!include "LogicLib.nsh"
!include "FileFunc.nsh"
Name "BackupDesk - componente VSS automático"
RequestExecutionLevel admin
SilentInstall silent
AutoCloseWindow true
!ifdef CLIENT
 !define PRODUCT "client"
 OutFile "build/BackupDeskClientVSSComponent.exe"
!else
 !define PRODUCT "master"
 OutFile "build/BackupDeskVSSComponent.exe"
!endif
Section
 ${GetParameters} $0
 ${GetOptions} $0 "/SID=" $1
 System::Call 'kernel32::SetEnvironmentVariableW(w "BACKUPDESK_VSS_OWNER_SID", w r1)'
 System::Call 'kernel32::SetEnvironmentVariableW(w "BACKUPDESK_VSS_PRODUCT", w "${PRODUCT}")'
 ClearErrors
 StrCpy $1 ""
 ${GetOptions} $0 "/UPDATE=" $1
 System::Call 'kernel32::SetEnvironmentVariableW(w "BACKUPDESK_UPDATE_DIR", w r1)'
 ClearErrors
 ${GetOptions} $0 "/REMOVE" $1
 ${IfNot} ${Errors}
  System::Call 'kernel32::SetEnvironmentVariableW(w "BACKUPDESK_VSS_REMOVE", w "1")'
 ${Else}
  System::Call 'kernel32::SetEnvironmentVariableW(w "BACKUPDESK_VSS_REMOVE", w "0")'
 ${EndIf}
 SetOutPath "$PROGRAMFILES64\BackupDesk VSS\${PRODUCT}"
 File "install-vss-component.ps1"
 File "vss-broker.ps1"
 File "vss-protocol.ps1"
 File "vss.ps1"
 File "update-application.ps1"
 nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$OUTDIR\install-vss-component.ps1"'
 Pop $0
 Pop $1
 ${If} $0 != 0
  MessageBox MB_OK|MB_ICONSTOP "Não foi possível configurar o componente automático VSS.$\r$\n$1"
  SetErrorLevel 1
 ${Else}
  SetErrorLevel 0
 ${EndIf}
SectionEnd
