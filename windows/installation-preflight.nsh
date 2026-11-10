!ifdef UPDATE_ONLY
Function VerifyExistingInstallation
 DetailPrint "Validando a instalação existente e suas chaves, sem modificar os dados..."
 InitPluginsDir
 SetOutPath "$PLUGINSDIR\identity-check"
 File "build/node.exe"
 File "../installation-update.mjs"
 File "../client-package.mjs"
 File "../crypto-vault.mjs"
 File "../log-settings.mjs"
 File "../network-share.mjs"
 File "../status-logs.mjs"
 File "../logs-io.mjs"
 File "../preferences.mjs"
 SetOutPath "$PLUGINSDIR\identity-check\windows"
 File "protect-key.ps1"
 nsExec::ExecToStack '"$PLUGINSDIR\identity-check\node.exe" "$PLUGINSDIR\identity-check\installation-update.mjs" --check "$INSTDIR" "${UPDATE_PRODUCT}" "$EXEPATH"'
 Pop $0
 Pop $1
 ${If} $0 != 0
  IfSilent +2 0
  MessageBox MB_OK|MB_ICONSTOP "Atualização bloqueada. Este arquivo exige uma instalação existente com identificação e chaves válidas. $1 Nenhum arquivo do programa foi substituído."
  SetErrorLevel 10
  Abort
 ${EndIf}
 ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${KEY}" "InstallLocation"
 ${If} $2 != ""
  GetFullPathName $3 "$2"
  GetFullPathName $4 "$INSTDIR"
  ${If} $3 != $4
   IfSilent +2 0
   MessageBox MB_OK|MB_ICONSTOP "A instalação está registrada em $3. Atualize a pasta original para preservar sua identificação e suas chaves."
   SetErrorLevel 11
   Abort
  ${EndIf}
 ${EndIf}
FunctionEnd
!endif
