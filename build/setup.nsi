; MojarraCut — instalador propio con páginas oscuras animadas.
; Compilar con scripts/make-setup.js (define VERSION, SRC = carpeta win-unpacked, OUTFILE, ART = build/setup)
Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel user
!ifdef PLUGINS
  !addplugindir "${PLUGINS}"
!endif

!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "WinMessages.nsh"

Name "MojarraCut"
Caption "Instalar MojarraCut"
OutFile "${OUTFILE}"
Icon "${ART}\icon.ico"
UninstallIcon "${ART}\icon.ico"
InstallDir "$LOCALAPPDATA\Programs\MojarraCut"
InstallDirRegKey HKCU "Software\MojarraCut" "InstallDir"
ShowInstDetails nevershow
ShowUninstDetails nevershow
AutoCloseWindow true
BrandingText " "
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "MojarraCut"
VIAddVersionKey "FileDescription" "Instalador de MojarraCut"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "MojarraCut"

!define UNKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\MojarraCut"
; Medidas base a 100 % (iguales que scripts/setup-art.js)
!define W 640
!define H 430

Var S        ; escala en % (100,125,150,175,200)
Var DLG
Var hBg
Var hAnim
Var chkDesk
Var lblDesk
Var lblPath
Var lnkPath
Var chkRun
Var lblRun
Var wantDesk
Var wantRun
Var fNorm
Var fLink
Var imgBg
Var imgBtn

Page custom WelcomeShow WelcomeLeave
Page instfiles "" InstShow
Page custom FinishShow FinishLeave

; ---------- utilidades ----------
!macro PX out v
  IntOp ${out} ${v} * $S
  IntOp ${out} ${out} / 100
!macroend

!macro EXTRACT_SCALE s
  File /oname=$PLUGINSDIR\welcome.bmp "${ART}\welcome_${s}.bmp"
  File /oname=$PLUGINSDIR\install.bmp "${ART}\install_${s}.bmp"
  File /oname=$PLUGINSDIR\finish.bmp "${ART}\finish_${s}.bmp"
  File /oname=$PLUGINSDIR\btn_welcome.bmp "${ART}\btn_welcome_${s}.bmp"
  File /oname=$PLUGINSDIR\btn_finish.bmp "${ART}\btn_finish_${s}.bmp"
  File /oname=$PLUGINSDIR\anim.avi "${ART}\anim_${s}.avi"
!macroend

Function ResizeWin
  ; tamaño de la ventana = área de contenido + bordes, centrada
  System::Call '*(i,i,i,i) p .r9'
  System::Call 'user32::GetWindowRect(p $HWNDPARENT, p r9)'
  System::Call '*$9(i .r1, i .r2, i .r3, i .r4)'
  System::Call 'user32::GetClientRect(p $HWNDPARENT, p r9)'
  System::Call '*$9(i, i, i .r5, i .r6)'
  System::Free $9
  IntOp $1 $3 - $1
  IntOp $1 $1 - $5   ; borde horizontal
  IntOp $2 $4 - $2
  IntOp $2 $2 - $6   ; borde vertical + título
  !insertmacro PX $3 ${W}
  !insertmacro PX $4 ${H}
  IntOp $3 $3 + $1
  IntOp $4 $4 + $2
  System::Call 'user32::GetSystemMetrics(i 0) i .r5'
  System::Call 'user32::GetSystemMetrics(i 1) i .r6'
  IntOp $5 $5 - $3
  IntOp $5 $5 / 2
  IntOp $6 $6 - $4
  IntOp $6 $6 / 2
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r5, i r6, i r3, i r4, i 4)'
FunctionEnd

; Oculta los controles estándar de la ventana (botones, línea, marca)
Function HideChrome
  Push $1
  StrCpy $1 0
  loop:
    FindWindow $1 "" "" $HWNDPARENT $1
    StrCmp $1 0 done
    System::Call 'user32::GetDlgCtrlID(p r1) i .r2'
    ${If} $2 <> 1018
      ShowWindow $1 ${SW_HIDE}
    ${EndIf}
    Goto loop
  done:
  Pop $1
FunctionEnd

; Coloca la página a pantalla completa con fondo + animación
Function PageFrame ; entrada: $0 = nombre del fondo (welcome|install|finish)
  !insertmacro PX $1 ${W}
  !insertmacro PX $2 ${H}
  System::Call 'user32::SetWindowPos(p $DLG, p 0, i 0, i 0, i r1, i r2, i 4)'
  SetCtlColors $DLG "FFFFFF" "15122E"
  ; animación del pez (control nativo SysAnimate32: se reproduce solo, sin temporizadores)
  !insertmacro PX $3 220
  !insertmacro PX $4 30
  !insertmacro PX $5 200
  !insertmacro PX $6 128
  System::Call 'user32::CreateWindowExW(i 0, w "SysAnimate32", w "", i 0x54000005, i r3, i r4, i r5, i r6, p $DLG, p 0, p 0, p 0) p .s'
  Pop $hAnim
  SendMessage $hAnim 0x467 0 "STR:$PLUGINSDIR\anim.avi" ; ACM_OPENW (ACS_AUTOPLAY la inicia)
  ; fondo (se crea al final para quedar debajo de todo)
  System::Call 'user32::CreateWindowExW(i 0, w "STATIC", w "", i 0x5400000E, i 0, i 0, i r1, i r2, p $DLG, p 0, p 0, p 0) p .s'
  Pop $hBg
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\$0.bmp", i 0, i 0, i 0, i 0x10) p .s'
  Pop $imgBg
  SendMessage $hBg ${STM_SETIMAGE} ${IMAGE_BITMAP} $imgBg
  System::Call 'user32::SetWindowPos(p $hBg, p 1, i 0, i 0, i 0, i 0, i 0x13)' ; HWND_BOTTOM
FunctionEnd

; Botón hecho con imagen (clic = STN_CLICKED)
Function MakeButton ; $0 = imagen, devuelve control en la pila
  !insertmacro PX $1 210
  !insertmacro PX $2 356
  !insertmacro PX $3 220
  !insertmacro PX $4 46
  nsDialogs::CreateControl STATIC ${WS_CHILD}|${WS_VISIBLE}|${WS_CLIPSIBLINGS}|${SS_BITMAP}|${SS_NOTIFY} 0 $1 $2 $3 $4 ""
  Pop $5
  System::Call 'user32::LoadImageW(p 0, w "$PLUGINSDIR\$0.bmp", i 0, i 0, i 0, i 0x10) p .s'
  Pop $imgBtn
  SendMessage $5 ${STM_SETIMAGE} ${IMAGE_BITMAP} $imgBtn
  System::Call 'user32::LoadCursorW(p 0, i 32649) p .r6'               ; mano
  System::Call 'user32::SetClassLongPtrW(p r5, i -12, p r6)'
  Push $5
FunctionEnd

Function .onInit
  InitPluginsDir
  ReadRegStr $0 HKCU "Software\MojarraCut" "InstallDir"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
  StrCpy $wantDesk 1
  StrCpy $wantRun 1
FunctionEnd

Function .onGUIInit
  ; escala según el DPI de la pantalla
  System::Call 'user32::GetDC(p 0) p .r1'
  System::Call 'gdi32::GetDeviceCaps(p r1, i 88) i .r0'
  System::Call 'user32::ReleaseDC(p 0, p r1)'
  IntOp $0 $0 * 100
  IntOp $0 $0 / 96
  ${If} $0 >= 188
    StrCpy $S 200
    !insertmacro EXTRACT_SCALE 200
  ${ElseIf} $0 >= 163
    StrCpy $S 175
    !insertmacro EXTRACT_SCALE 175
  ${ElseIf} $0 >= 138
    StrCpy $S 150
    !insertmacro EXTRACT_SCALE 150
  ${ElseIf} $0 >= 113
    StrCpy $S 125
    !insertmacro EXTRACT_SCALE 125
  ${Else}
    StrCpy $S 100
    !insertmacro EXTRACT_SCALE 100
  ${EndIf}
  System::Call '*(i 8, i 0x80) p .r1'
  System::Call 'comctl32::InitCommonControlsEx(p r1)'
  System::Free $1
  Call ResizeWin
  ; barra de título oscura del color del instalador (Windows 11)
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 20, *i 1, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 35, *i 0x002E1215, i 4)'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 36, *i 0x00FFE6E9, i 4)'
  SetCtlColors $HWNDPARENT "FFFFFF" "15122E"
  CreateFont $fNorm "Segoe UI" 10 400
  CreateFont $fLink "Segoe UI" 10 600 /UNDERLINE
  Call HideChrome
FunctionEnd

; ---------- Página 1: bienvenida ----------
Function WelcomeShow
  Call HideChrome
  Call ResizeWin
  nsDialogs::Create 1018
  Pop $DLG
  ; fila 1: acceso directo
  !insertmacro PX $1 140
  !insertmacro PX $2 278
  !insertmacro PX $3 16
  ${NSD_CreateCheckbox} $1 $2 $3 $3 ""
  Pop $chkDesk
  SetCtlColors $chkDesk "FFFFFF" "221D45"
  ${If} $wantDesk == 1
    ${NSD_Check} $chkDesk
  ${EndIf}
  !insertmacro PX $1 164
  !insertmacro PX $2 276
  !insertmacro PX $3 330
  !insertmacro PX $4 20
  nsDialogs::CreateControl STATIC ${WS_CHILD}|${WS_VISIBLE}|${WS_CLIPSIBLINGS}|${SS_NOTIFY} 0 $1 $2 $3 $4 "Crear acceso directo en el escritorio"
  Pop $lblDesk
  SetCtlColors $lblDesk "E9E6FF" "221D45"
  SendMessage $lblDesk ${WM_SETFONT} $fNorm 1
  ${NSD_OnClick} $lblDesk ToggleDesk
  ; fila 2: carpeta de instalación + "Cambiar carpeta…"
  !insertmacro PX $1 140
  !insertmacro PX $2 302
  !insertmacro PX $3 222
  !insertmacro PX $4 20
  nsDialogs::CreateControl STATIC ${WS_CHILD}|${WS_VISIBLE}|${WS_CLIPSIBLINGS}|${SS_PATHELLIPSIS}|${SS_NOPREFIX} 0 $1 $2 $3 $4 "$INSTDIR"
  Pop $lblPath
  SetCtlColors $lblPath "A9A2DE" "221D45"
  SendMessage $lblPath ${WM_SETFONT} $fNorm 1
  !insertmacro PX $1 366
  !insertmacro PX $3 144
  nsDialogs::CreateControl STATIC ${WS_CHILD}|${WS_VISIBLE}|${WS_CLIPSIBLINGS}|${SS_NOTIFY}|${SS_RIGHT} 0 $1 $2 $3 $4 "Cambiar carpeta…"
  Pop $lnkPath
  SetCtlColors $lnkPath "B7ACFF" "221D45"
  SendMessage $lnkPath ${WM_SETFONT} $fLink 1
  ${NSD_OnClick} $lnkPath ChangeDir
  System::Call 'user32::LoadCursorW(p 0, i 32649) p .r6'
  System::Call 'user32::SetClassLongPtrW(p $lnkPath, i -12, p r6)'
  ; botón Instalar
  StrCpy $0 "btn_welcome"
  Call MakeButton
  Pop $1
  ${NSD_OnClick} $1 GoNext
  StrCpy $0 "welcome"
  Call PageFrame
  nsDialogs::Show
  System::Call 'gdi32::DeleteObject(p $imgBg)'
  System::Call 'gdi32::DeleteObject(p $imgBtn)'
FunctionEnd

Function ToggleDesk
  ${NSD_GetState} $chkDesk $0
  ${If} $0 == ${BST_CHECKED}
    ${NSD_Uncheck} $chkDesk
  ${Else}
    ${NSD_Check} $chkDesk
  ${EndIf}
FunctionEnd

Function ChangeDir
  nsDialogs::SelectFolderDialog "Elige la carpeta donde instalar MojarraCut" "$INSTDIR"
  Pop $0
  ${If} $0 != "error"
  ${AndIf} $0 != ""
    ; si la carpeta elegida no termina en MojarraCut, se crea una subcarpeta con ese nombre
    StrCpy $1 $0 10 -10
    ${If} $1 != "MojarraCut"
      StrCpy $0 "$0\MojarraCut"
    ${EndIf}
    StrCpy $INSTDIR $0
    ${NSD_SetText} $lblPath "$INSTDIR"
    System::Call 'user32::InvalidateRect(p $DLG, p 0, i 1)'
  ${EndIf}
FunctionEnd

Function GoNext
  SendMessage $HWNDPARENT 0x408 1 0
FunctionEnd

Function WelcomeLeave
  ${NSD_GetState} $chkDesk $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $wantDesk 1
  ${Else}
    StrCpy $wantDesk 0
  ${EndIf}
  ; cerrar MojarraCut si está abierto (para poder actualizarlo)
  nsProcess::_FindProcess "MojarraCut.exe"
  Pop $0
  ${If} $0 = 0
    MessageBox MB_OKCANCEL|MB_ICONINFORMATION "MojarraCut está abierto. Se cerrará para poder instalar la nueva versión (tus proyectos ya están guardados)." IDOK +2
    Abort
    nsProcess::_KillProcess "MojarraCut.exe"
    Pop $0
    Sleep 800
  ${EndIf}
  nsProcess::_Unload
FunctionEnd

; ---------- Página 2: instalando ----------
Function InstShow
  Call HideChrome
  Call ResizeWin
  FindWindow $DLG "#32770" "" $HWNDPARENT
  ; ocultar textos y lista estándar; solo queda la barra de progreso, con nuestro estilo
  GetDlgItem $0 $DLG 1016
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $DLG 1027
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $DLG 1006
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $DLG 1004
  !insertmacro PX $1 140
  !insertmacro PX $2 268
  !insertmacro PX $3 360
  !insertmacro PX $4 8
  System::Call 'user32::SetWindowPos(p r0, p 0, i r1, i r2, i r3, i r4, i 4)'
  System::Call 'uxtheme::SetWindowTheme(p r0, w "", w "")'
  SendMessage $0 0x409 0 0x00FF8C9A   ; PBM_SETBARCOLOR (#9a8cff)
  SendMessage $0 0x2001 0 0x00451D22  ; PBM_SETBKCOLOR  (#221d45)
  System::Call 'user32::GetWindowLongW(p r0, i -16) i .r5'
  IntOp $5 $5 & 0xFF7FFFFF            ; sin borde
  System::Call 'user32::SetWindowLongW(p r0, i -16, i r5)'
  System::Call 'user32::GetWindowLongW(p r0, i -20) i .r5'
  IntOp $5 $5 & 0xFFFDFDFF            ; sin borde 3D (WS_EX_CLIENTEDGE/STATICEDGE)
  System::Call 'user32::SetWindowLongW(p r0, i -20, i r5)'
  System::Call 'user32::SetWindowPos(p r0, p 0, i 0, i 0, i 0, i 0, i 0x37)'
  StrCpy $0 "install"
  Call PageFrame
FunctionEnd

; ---------- Página 3: listo ----------
Function FinishShow
  Call HideChrome
  Call ResizeWin
  nsDialogs::Create 1018
  Pop $DLG
  !insertmacro PX $1 232
  !insertmacro PX $2 290
  !insertmacro PX $3 16
  ${NSD_CreateCheckbox} $1 $2 $3 $3 ""
  Pop $chkRun
  SetCtlColors $chkRun "FFFFFF" "221D45"
  ${NSD_Check} $chkRun
  !insertmacro PX $1 256
  !insertmacro PX $2 288
  !insertmacro PX $3 200
  !insertmacro PX $4 20
  nsDialogs::CreateControl STATIC ${WS_CHILD}|${WS_VISIBLE}|${WS_CLIPSIBLINGS}|${SS_NOTIFY} 0 $1 $2 $3 $4 "Abrir MojarraCut ahora"
  Pop $lblRun
  SetCtlColors $lblRun "E9E6FF" "221D45"
  SendMessage $lblRun ${WM_SETFONT} $fNorm 1
  ${NSD_OnClick} $lblRun ToggleRun
  StrCpy $0 "btn_finish"
  Call MakeButton
  Pop $1
  ${NSD_OnClick} $1 GoNext
  StrCpy $0 "finish"
  Call PageFrame
  nsDialogs::Show
  System::Call 'gdi32::DeleteObject(p $imgBg)'
  System::Call 'gdi32::DeleteObject(p $imgBtn)'
FunctionEnd

Function ToggleRun
  ${NSD_GetState} $chkRun $0
  ${If} $0 == ${BST_CHECKED}
    ${NSD_Uncheck} $chkRun
  ${Else}
    ${NSD_Check} $chkRun
  ${EndIf}
FunctionEnd

Function FinishLeave
  ${NSD_GetState} $chkRun $0
  ${If} $0 == ${BST_CHECKED}
    Exec '"$INSTDIR\MojarraCut.exe"'
  ${EndIf}
FunctionEnd

; ---------- Instalación ----------
Section "MojarraCut" SecMain
  SetOutPath "$INSTDIR"
  ; quitar archivos de la versión anterior que ya no existan
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  File /r "${SRC}\*.*"
  WriteUninstaller "$INSTDIR\Desinstalar MojarraCut.exe"
  CreateShortCut "$SMPROGRAMS\MojarraCut.lnk" "$INSTDIR\MojarraCut.exe"
  ${If} $wantDesk == 1
    CreateShortCut "$DESKTOP\MojarraCut.lnk" "$INSTDIR\MojarraCut.exe"
  ${Else}
    Delete "$DESKTOP\MojarraCut.lnk"
  ${EndIf}
  ; quitar la entrada del instalador anterior (electron-builder) para no duplicar en "Aplicaciones"
  StrCpy $0 0
  enum:
    EnumRegKey $1 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall" $0
    StrCmp $1 "" enumdone
    IntOp $0 $0 + 1
    StrCmp $1 "MojarraCut" enum
    ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1" "DisplayName"
    StrCmp $2 "MojarraCut" 0 enum
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\$1"
    IntOp $0 $0 - 1
    Goto enum
  enumdone:
  Delete "$INSTDIR\Uninstall MojarraCut.exe"
  WriteRegStr HKCU "Software\MojarraCut" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "DisplayName" "MojarraCut"
  WriteRegStr HKCU "${UNKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNKEY}" "Publisher" "MojarraCut"
  WriteRegStr HKCU "${UNKEY}" "DisplayIcon" "$INSTDIR\MojarraCut.exe"
  WriteRegStr HKCU "${UNKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNKEY}" "UninstallString" '"$INSTDIR\Desinstalar MojarraCut.exe"'
  WriteRegStr HKCU "${UNKEY}" "QuietUninstallString" '"$INSTDIR\Desinstalar MojarraCut.exe" /S'
  WriteRegDWORD HKCU "${UNKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNKEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNKEY}" "EstimatedSize" 520000
SectionEnd

; ---------- Desinstalación (no toca los proyectos de Documentos\MojarraCut) ----------
Function un.onInit
  IfSilent +3
  MessageBox MB_YESNO|MB_ICONQUESTION "¿Desinstalar MojarraCut?$\r$\n$\r$\nTus proyectos en Documentos\MojarraCut no se borran." IDYES +2
  Abort
  SetSilent silent
FunctionEnd

Section "Uninstall"
  nsProcess::_KillProcess "MojarraCut.exe"
  Pop $0
  nsProcess::_Unload
  Sleep 500
  Delete "$SMPROGRAMS\MojarraCut.lnk"
  Delete "$DESKTOP\MojarraCut.lnk"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNKEY}"
  DeleteRegKey HKCU "Software\MojarraCut"
SectionEnd
