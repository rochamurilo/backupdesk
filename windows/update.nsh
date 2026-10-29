; Restart Manager matches users of this installation's exact node.exe path.
; It never stops unrelated Node.js executables or processes by image name.
Var UpdateSession
!macro UPDATE_GUARD Prefix
Function ${Prefix}StopInstalledProcesses
 IfFileExists "$INSTDIR\node.exe" 0 update_done
 System::Call 'rstrtmgr::RmStartSession(*i .r0, i 0, w .r1) i .r2'
 ${If} $2 != 0
  MessageBox MB_OK|MB_ICONSTOP "Não foi possível verificar os processos desta instalação (código $2). Feche o BackupDesk e tente novamente. Nenhum arquivo foi substituído."
  Abort
 ${EndIf}
 StrCpy $UpdateSession $0
 ; Array of one LPCWSTR; the path comes from $INSTDIR, not a shell command.
 System::Call '*(&w${NSIS_MAX_STRLEN} "$INSTDIR\node.exe") p.r0'
 System::Call '*(p r0) p.r1'
 System::Call 'rstrtmgr::RmRegisterResources(i $UpdateSession, i 1, p r1, i 0, p 0, i 0, p 0) i .r2'
 System::Free $1
 System::Free $0
 ${If} $2 != 0
  System::Call 'rstrtmgr::RmEndSession(i $UpdateSession)'
  MessageBox MB_OK|MB_ICONSTOP "Não foi possível verificar o executável desta instalação (código $2). Nenhum arquivo foi substituído."
  Abort
 ${EndIf}
 System::Call 'rstrtmgr::RmGetList(i $UpdateSession, *i .r0, *i 0, p 0, *i .r1) i .r2'
 ${If} $2 == 234
  MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "O BackupDesk desta pasta está em execução.$\r$\n$\r$\nPara continuar, o instalador encerrará o painel e os agentes que usam este executável. Um backup em andamento poderá ser interrompido.$\r$\n$\r$\nCadastros, configurações e backups já gravados serão preservados. Outros programas Node.js não serão encerrados.$\r$\n$\r$\nClique em OK para fechar o BackupDesk e continuar, ou Cancelar para aguardar o término do backup." IDOK update_close
  System::Call 'rstrtmgr::RmEndSession(i $UpdateSession)'
  Abort
 update_close:
  ; RmForceShutdown is used only after the explicit warning above.
  DetailPrint "Encerrando os processos do BackupDesk desta pasta..."
  System::Call 'rstrtmgr::RmShutdown(i $UpdateSession, i 1, p 0) i .r2'
  ${If} $2 != 0
   System::Call 'rstrtmgr::RmEndSession(i $UpdateSession)'
   MessageBox MB_OK|MB_ICONSTOP "O Windows não permitiu encerrar o BackupDesk (código $2). Feche as janelas do programa e tente novamente. Nenhum arquivo foi substituído."
   Abort
  ${EndIf}
  Sleep 1500
 ${ElseIf} $2 != 0
  System::Call 'rstrtmgr::RmEndSession(i $UpdateSession)'
  MessageBox MB_OK|MB_ICONSTOP "Falha ao consultar programas em execução (código $2). Feche o BackupDesk e tente novamente."
  Abort
 ${EndIf}
 System::Call 'rstrtmgr::RmEndSession(i $UpdateSession)'
 update_check_file:
 ; Require write access before extracting anything. Never offer Ignore here.
 System::Call 'kernel32::CreateFileW(w "$INSTDIR\node.exe", i 0xC0000000, i 3, p 0, i 3, i 128, p 0) p .r0'
 ${If} $0 == -1
  MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "O Windows ainda não liberou node.exe para gravação. Feche todas as janelas do BackupDesk desta instalação e confira a permissão da pasta.$\r$\n$\r$\nClique em Repetir para verificar novamente. Cancelar interrompe antes de substituir arquivos." IDRETRY update_check_file
  Abort
 ${EndIf}
 System::Call 'kernel32::CloseHandle(p r0)'
 update_done:
FunctionEnd
!macroend
!insertmacro UPDATE_GUARD ""
!insertmacro UPDATE_GUARD "un."
