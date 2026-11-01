; GCP-Drive owns the application installer. The signed shared driver keeps its own MSI lifecycle.
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "MUI2.nsh"

!ifndef BUILD_UNINSTALLER
Var GCPDriverNeed
Var GCPDriverConsent
Var GCPDriverCheckbox
Var GCPDriverPath
!endif

!ifndef BUILD_UNINSTALLER
Function GCPCheckDriveSupport
  StrCpy $GCPDriverNeed "1"
  SetRegView 64
  ReadRegStr $GCPDriverPath HKLM "SOFTWARE\WinFsp" "InstallDir"
  ${If} $GCPDriverPath != ""
    ${If} ${FileExists} "$GCPDriverPath\bin\winfsp-x64.dll"
      StrCpy $GCPDriverNeed "0"
    ${EndIf}
  ${EndIf}
  SetRegView 32
  ReadRegStr $GCPDriverPath HKLM "SOFTWARE\WinFsp" "InstallDir"
  ${If} $GCPDriverPath != ""
    ${If} ${FileExists} "$GCPDriverPath\bin\winfsp-x64.dll"
      StrCpy $GCPDriverNeed "0"
    ${EndIf}
  ${EndIf}
  ; Matches electron-builder's x64 installer registry view.
  SetRegView 64
  ${If} ${FileExists} "$PROGRAMFILES32\WinFsp\bin\winfsp-x64.dll"
    StrCpy $GCPDriverNeed "0"
  ${EndIf}
  ${If} ${FileExists} "$PROGRAMFILES64\WinFsp\bin\winfsp-x64.dll"
    StrCpy $GCPDriverNeed "0"
  ${EndIf}
FunctionEnd

Function GCPDriveSupportPage
  Call GCPCheckDriveSupport
  !insertmacro MUI_HEADER_TEXT "Suas nuvens no computador" "Um único instalador para começar."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 0 100% 30% "O GCP-Drive inclui tudo o que é necessário para conectar suas contas e acessar os arquivos pelo Explorador de Arquivos. Você não precisa baixar nem configurar ferramentas separadas."
  Pop $0
  ${If} $GCPDriverNeed == "1"
    ${NSD_CreateCheckbox} 0 38% 100% 12% "Ativar o suporte a unidades virtuais neste computador"
    Pop $GCPDriverCheckbox
    ${If} $GCPDriverConsent == ""
      StrCpy $GCPDriverConsent "1"
    ${EndIf}
    ${If} $GCPDriverConsent == "1"
      ${NSD_Check} $GCPDriverCheckbox
    ${EndIf}
    ${NSD_CreateLabel} 0 53% 100% 26% "Esta etapa instala um componente de sistema assinado para criar suas unidades. O Windows poderá pedir uma confirmação de administrador. Os demais programas, suas contas e seus arquivos serão preservados."
    Pop $0
  ${Else}
    StrCpy $GCPDriverConsent "0"
    ${NSD_CreateLabel} 0 38% 100% 30% "O suporte a unidades virtuais já está instalado. O GCP-Drive utilizará o componente existente, sem reinstalá-lo."
    Pop $0
  ${EndIf}
  ${NSD_CreateLink} 0 85% 100% 12% "Desenvolvido por Bruno Albertini | Gestão Cultural Pro"
  Pop $0
  ${NSD_OnClick} $0 GCPWebsite
  nsDialogs::Show
FunctionEnd

Function GCPWebsite
  Pop $0
  ExecShell "open" "https://gestaoculturalpro.com.br"
FunctionEnd

Function GCPDriveSupportLeave
  ${If} $GCPDriverNeed == "1"
    ${NSD_GetState} $GCPDriverCheckbox $GCPDriverConsent
  ${EndIf}
FunctionEnd
!endif

!macro customPageAfterChangeDir
  Page custom GCPDriveSupportPage GCPDriveSupportLeave
!macroend

!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Bem-vindo ao GCP-Drive"
  !define MUI_WELCOMEPAGE_TEXT "Suas nuvens, no seu computador.$\r$\n$\r$\nConecte suas contas, abra os arquivos nos programas que você já usa e acompanhe as transferências em uma interface simples.$\r$\n$\r$\nEste instalador prepara o aplicativo e o suporte às unidades virtuais.$\r$\n$\r$\nDesenvolvido por Bruno Albertini$\r$\nGestão Cultural Pro$\r$\ngestaoculturalpro.com.br"
  !insertmacro MUI_PAGE_WELCOME
!macroend

!macro customInstall
  Call GCPCheckDriveSupport
  ${If} $GCPDriverNeed == "1"
    ${If} ${Silent}
      ; A silent invocation must explicitly opt into a machine-wide driver change.
      ${StdUtils.TestParameter} $R0 "GCPDriveInstallSupport"
      ${If} $R0 == "true"
        StrCpy $GCPDriverConsent "1"
      ${EndIf}
    ${EndIf}
    ${If} $GCPDriverConsent == "1"
      DetailPrint "Ativando o suporte a unidades virtuais do GCP-Drive..."
      ${StdUtils.ExecShellWaitEx} $R0 $R1 "$SYSDIR\msiexec.exe" "runas" '/i "$INSTDIR\resources\support\winfsp.msi" /qn /norestart ADDLOCAL=F.Main,F.User'
      ${If} $R0 != "ok"
        MessageBox MB_OK|MB_ICONEXCLAMATION "A confirmação de administrador não foi concluída. O aplicativo foi instalado, mas o suporte a unidades virtuais ainda precisa ser ativado." /SD IDOK
        SetErrorLevel 5
        Abort
      ${EndIf}
      ; The second value is a process HANDLE, not a PID; wait only after an 'ok' result.
      ${StdUtils.WaitForProcEx} $R2 $R1
      ${If} $R2 == "3010"
        SetRebootFlag true
      ${ElseIf} $R2 == "1618"
        MessageBox MB_OK|MB_ICONEXCLAMATION "Há outra instalação do Windows em andamento. Aguarde sua conclusão e execute novamente o instalador do GCP-Drive." /SD IDOK
        SetErrorLevel 5
        Abort
      ${ElseIf} $R2 != "0"
        MessageBox MB_OK|MB_ICONEXCLAMATION "Não foi possível concluir o suporte a unidades virtuais (código $R2). O aplicativo e seus dados foram preservados. Execute novamente o instalador para tentar concluir esta etapa." /SD IDOK
        SetErrorLevel 5
        Abort
      ${EndIf}
      DetailPrint "Suporte a unidades virtuais preparado."
    ${EndIf}
  ${EndIf}
  ; Never remove the shared driver during GCP-Drive uninstall: other applications may use it.
!macroend

!macro customUnInstall
  ; Remove only shell registrations carrying our exact ownership marker.
  ${ForEach} $R5 0 2 + 1
    ${If} $R5 == 0
      StrCpy $R6 "*"
    ${ElseIf} $R5 == 1
      StrCpy $R6 "Directory"
    ${Else}
      StrCpy $R6 "Drive"
    ${EndIf}
    ReadRegStr $R7 HKCU "Software\Classes\$R6\shell\GCPDrive" "GCPOwner"
    ${If} $R7 == "br.com.gestaoculturalpro.drive"
      DeleteRegKey HKCU "Software\Classes\$R6\shell\GCPDrive"
    ${EndIf}
  ${Next}
  StrCpy $R5 0
  ${Do}
    EnumRegKey $R6 HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\Desktop\NameSpace" $R5
    ${If} $R6 == ""
      ${ExitDo}
    ${EndIf}
    ReadRegStr $R7 HKCU "Software\Classes\CLSID\$R6" "GCPOwner"
    StrCpy $R8 $R7 4
    StrCpy $R9 $R7 "" 4
    ${If} $R8 == "gcp-"
    ${AndIf} "{$R9}" == $R6
      ClearErrors
      DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\Desktop\NameSpace\$R6"
      DeleteRegKey HKCU "Software\Classes\CLSID\$R6"
      ${If} ${Errors}
        IntOp $R5 $R5 + 1
      ${EndIf}
    ${Else}
      IntOp $R5 $R5 + 1
    ${EndIf}
  ${Loop}
  ${IfNot} ${Silent}
    MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Deseja remover também TODOS os dados locais do GCP-Drive?$\r$\n$\r$\nSim: remove contas salvas, configurações, índice, cache e históricos internos. Alterações que ainda não foram enviadas poderão ser perdidas.$\r$\n$\r$\nNão: mantém os dados para uma futura reinstalação.$\r$\n$\r$\nOs arquivos da nuvem e as pastas do computador escolhidas para sincronizar não serão apagados.$\r$\n$\r$\nLocal: $APPDATA\GCP-Drive" IDNO gcpKeepData
    ; Exact application-owned directory only; never recurse over chosen sync/mount paths.
    ${If} $APPDATA != ""
      GetFullPathName $R3 "$APPDATA\GCP-Drive"
      StrCmp $R3 "$APPDATA\GCP-Drive" 0 gcpKeepData
      RMDir /r "$R3"
    ${EndIf}
    gcpKeepData:
  ${EndIf}
!macroend
