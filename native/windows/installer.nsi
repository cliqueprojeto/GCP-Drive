; Instalador do GCP-Drive para Windows, por usuário, sem pedir administrador.
; makensis /INPUTCHARSET UTF8 /DVERSION=x.y.z installer.nsi   (o executável vem de build\gcp-drive.exe)
Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define APP "GCP-Drive"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP}"
!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"

Name "${APP}"
OutFile "build\GCP-Drive-${VERSION}-instalador.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP}"
BrandingText "${APP} ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APP}"
VIAddVersionKey "FileDescription" "Instalador do ${APP}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "CompanyName" "Bruno Albertini"
VIAddVersionKey "LegalCopyright" "Bruno Albertini"

!include "MUI2.nsh"
!define MUI_ICON "..\files\icons\gcp-drive.ico"
!define MUI_UNICON "..\files\icons\gcp-drive.ico"
!define MUI_WELCOMEPAGE_TITLE "Instalar o ${APP} ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "O ${APP} mostra cada conta do Google Drive como uma pasta do computador, dentro de GCP-Drive na sua pasta de usuário. Os arquivos são baixados quando você os abre.$\r$\n$\r$\nO que esta instalação faz:$\r$\n• instala o programa só para o seu usuário, sem pedir administrador;$\r$\n• cria um atalho no menu Iniciar;$\r$\n• inicia o ${APP} junto com o Windows.$\r$\n$\r$\nNenhum outro programa é instalado e nenhuma associação de arquivos é alterada."
!define MUI_FINISHPAGE_RUN "$INSTDIR\gcp-drive.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o ${APP}"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"

Section "Instalar"
  SetOutPath "$INSTDIR"
  ; Uma versão em uso é encerrada antes de ser substituída; o que estava na fila de envio continua guardado.
  IfFileExists "$INSTDIR\gcp-drive.exe" 0 copy
    ExecWait '"$INSTDIR\gcp-drive.exe" quit'
    StrCpy $1 0
  wait:
    ClearErrors
    Delete "$INSTDIR\gcp-drive.exe"
    IfErrors 0 copy
    IntOp $1 $1 + 1
    IntCmp $1 40 0 0 busy
    Sleep 500
    Goto wait
  busy:
    Abort "O GCP-Drive em uso não encerrou. Saia dele pelo ícone ao lado do relógio e instale de novo."
  copy:
  File "build\gcp-drive.exe"
  File "..\files\icons\gcp-drive.ico"
  SetOutPath "$INSTDIR\licenses"
  File "..\files\licenses\*.txt"
  SetOutPath "$INSTDIR"
  ; O cadastro do aplicativo no Google não vem no instalador: quem instala põe o seu ao lado dele.
  IfFileExists "$EXEDIR\google-oauth.json" 0 +2
    CopyFiles /SILENT "$EXEDIR\google-oauth.json" "$INSTDIR\google-oauth.json"
  WriteUninstaller "$INSTDIR\Desinstalar.exe"
  CreateShortcut "$SMPROGRAMS\${APP}.lnk" "$INSTDIR\gcp-drive.exe" "" "$INSTDIR\gcp-drive.ico"
  WriteRegStr HKCU "${RUN_KEY}" "${APP}" '"$INSTDIR\gcp-drive.exe" daemon'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Bruno Albertini"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\gcp-drive.ico"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Desinstalar.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Desinstalar.exe" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  StrCpy $0 ""
  IfSilent remove
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Remover também as contas conectadas e as configurações deste computador?$\r$\n$\r$\nNada é apagado no Google Drive. As pastas das contas saem do Explorador de Arquivos; arquivos que ainda não foram enviados continuam na pasta GCP-Drive." IDNO remove
  StrCpy $0 " --accounts"
  remove:
  ; O próprio programa encerra o serviço, tira as pastas do Explorador e apaga o cache.
  ExecWait '"$INSTDIR\gcp-drive.exe" uninstall$0'
  Delete "$INSTDIR\gcp-drive.exe"
  Delete "$INSTDIR\gcp-drive.ico"
  Delete "$INSTDIR\google-oauth.json"
  Delete "$INSTDIR\licenses\*.txt"
  RMDir "$INSTDIR\licenses"
  Delete "$INSTDIR\Desinstalar.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${APP}.lnk"
  DeleteRegValue HKCU "${RUN_KEY}" "${APP}"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
SectionEnd
