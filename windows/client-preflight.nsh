!ifdef CLIENT
Function VerifyClientIdentity
 ; Read-only validation with the new checker, before touching the installation.
 DetailPrint "Verificando a identidade e a preservação das chaves..."
 InitPluginsDir
 SetOutPath "$PLUGINSDIR\identity-check"
 File "build/node.exe"
 File "../client-package.mjs"
 File "../crypto-vault.mjs"
 File "../log-settings.mjs"
 File "../network-share.mjs"
 File "../status-logs.mjs"
 File "../logs-io.mjs"
 File "../preferences.mjs"
 SetOutPath "$PLUGINSDIR\identity-check\windows"
 File "protect-key.ps1"
 nsExec::ExecToStack '"$PLUGINSDIR\identity-check\node.exe" "$PLUGINSDIR\identity-check\client-package.mjs" --check "$EXEPATH" "$INSTDIR"'
 Pop $0
 Pop $1
 ${If} $0 != 0
  IfSilent +2 0
  MessageBox MB_OK|MB_ICONSTOP "Atualização bloqueada. $1 Nenhuma chave ou arquivo do programa foi substituído."
  SetErrorLevel 10
  Abort
 ${EndIf}
 ; An existing registration must be updated in its original directory.
 ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\BackupDeskClient" "InstallLocation"
 ${If} $2 != ""
  GetFullPathName $3 "$2"
  GetFullPathName $4 "$INSTDIR"
  ${If} $3 != $4
   IfFileExists "$3\agent-config.json" RejectClientDirectory
   IfFileExists "$3\data\device-identity.json" RejectClientDirectory
   IfFileExists "$3\data\keys\device.json" RejectClientDirectory
  ${EndIf}
 ${EndIf}
 Return
 RejectClientDirectory:
 IfSilent +2 0
 MessageBox MB_OK|MB_ICONSTOP "Já existe um client instalado em $3. Atualize essa pasta para preservar a identificação e a chave."
 SetErrorLevel 11
 Abort
FunctionEnd
!endif
