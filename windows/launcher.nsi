Unicode True
!include "LogicLib.nsh"
Name "BackupDesk"
OutFile "build/BackupDesk.exe"
RequestExecutionLevel user
SilentInstall silent
AutoCloseWindow true
Section
 ; 32-bit launcher, STARTUPINFOW = 68 bytes. CREATE_NO_WINDOW prevents
 ; console QuickEdit/selection from pausing the master or its startup.
 System::Call '*(i 68, p 0, p 0, p 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, i 0, &i2 0, &i2 0, p 0, p 0, p 0, p 0) p.r0'
 System::Call '*(p 0, p 0, i 0, i 0) p.r1'
 StrCpy $3 '"$EXEDIR\node.exe" "$EXEDIR\master.mjs"'
 System::Call '*(&w${NSIS_MAX_STRLEN} r3) p.r2'
 System::Call 'kernel32::CreateProcessW(w "$EXEDIR\node.exe", p r2, p 0, p 0, i 0, i 0x08000000, p 0, w "$EXEDIR", p r0, p r1) i.r3'
 ${If} $3 == 0
  System::Call 'kernel32::GetLastError() i.r4'
  MessageBox MB_OK|MB_ICONSTOP "Não foi possível iniciar o BackupDesk (erro Windows $4). Confira a instalação em $EXEDIR."
 ${Else}
  System::Call '*$1(p .r3, p .r4)'
  System::Call 'kernel32::CloseHandle(p r3)'
  System::Call 'kernel32::CloseHandle(p r4)'
 ${EndIf}
 System::Free $2
 System::Free $1
 System::Free $0
SectionEnd
