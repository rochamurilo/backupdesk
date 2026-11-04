; Run the installer-only helper with elevation BEFORE replacing any application file.
; The helper checks exact executable paths and stops supervisors before their workers.
!macro UPDATE_GUARD Prefix
Function ${Prefix}StopInstalledProcesses
 nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -NonInteractive -Command "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value"'
 Pop $0
 Pop $1
 ${TrimNewLines} "$1" $VssOwnerSid
 ${If} $0 != 0
  MessageBox MB_OK|MB_ICONSTOP "Não foi possível identificar o usuário da instalação. Nenhum arquivo foi substituído."
  Abort
 ${EndIf}
!if "${Prefix}" == "un."
 ClearErrors
 ExecShellWait "runas" "$INSTDIR\VSSComponentSetup.exe" '/SID=$VssOwnerSid /UPDATE="$INSTDIR" /REMOVE' SW_HIDE $0
!else
 CreateDirectory "$INSTDIR"
 InitPluginsDir
 SetOutPath "$PLUGINSDIR"
!ifdef CLIENT
 File /oname=BackupDeskSetupHelper.exe "build/BackupDeskClientVSSComponent.exe"
!else
 File /oname=BackupDeskSetupHelper.exe "build/BackupDeskVSSComponent.exe"
!endif
 ClearErrors
 ExecShellWait "runas" "$PLUGINSDIR\BackupDeskSetupHelper.exe" '/SID=$VssOwnerSid /UPDATE="$INSTDIR"' SW_HIDE $0
!endif
 ${If} ${Errors}
  Delete "$INSTDIR\data\update-lock.json"
  MessageBox MB_OK|MB_ICONSTOP "Autorize o instalador para encerrar o BackupDesk desta pasta e continuar. Nenhum arquivo do aplicativo foi substituído."
  Abort
 ${EndIf}
 ${If} $0 != 0
  Delete "$INSTDIR\data\update-lock.json"
  MessageBox MB_OK|MB_ICONSTOP "A preparação da instalação não foi concluída. Nenhum arquivo do aplicativo foi substituído. Confira o erro informado pelo componente."
  Abort
 ${EndIf}
!if "${Prefix}" == "un."
 DeleteRegValue HKCU "Software\BackupDeskVSS" "${KEY}"
!else
 WriteRegStr HKCU "Software\BackupDeskVSS" "${KEY}" "$VssOwnerSid"
!endif
FunctionEnd
!macroend
!insertmacro UPDATE_GUARD ""
!ifndef UPDATE_GUARD_NO_UNINSTALL
!insertmacro UPDATE_GUARD "un."
!endif
