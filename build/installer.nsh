; Registro del verbo "Imprimir con PrintLayout" en el menú del clic derecho de
; Windows, para fotos y PDF. Va en HKCU (instalación por usuario, perMachine:false
; → no requiere admin). El desinstalador lo quita; las actualizaciones lo conservan
; (y PrintLayout lo repara al arrancar si falta). En Windows 11 aparece bajo
; "Mostrar más opciones". MultiSelectModel=Player → Explorer pasa TODA la selección
; a una sola invocación (además el main coalesce por las dudas).

!macro RegisterPrintVerb ext
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${ext}\shell\PrintLayout.Print" "" "Imprimir con PrintLayout"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${ext}\shell\PrintLayout.Print" "Icon" "$INSTDIR\PrintLayout.exe,0"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${ext}\shell\PrintLayout.Print" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${ext}\shell\PrintLayout.Print\command" "" '$\"$INSTDIR\PrintLayout.exe$\" --imprimir $\"%1$\"'
!macroend

!macro UnregisterPrintVerb ext
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\${ext}\shell\PrintLayout.Print"
!macroend

!macro customInstall
  !insertmacro RegisterPrintVerb ".jpg"
  !insertmacro RegisterPrintVerb ".jpeg"
  !insertmacro RegisterPrintVerb ".png"
  !insertmacro RegisterPrintVerb ".heic"
  !insertmacro RegisterPrintVerb ".heif"
  !insertmacro RegisterPrintVerb ".pdf"
!macroend

!macro customUnInstall
  !insertmacro UnregisterPrintVerb ".jpg"
  !insertmacro UnregisterPrintVerb ".jpeg"
  !insertmacro UnregisterPrintVerb ".png"
  !insertmacro UnregisterPrintVerb ".heic"
  !insertmacro UnregisterPrintVerb ".heif"
  !insertmacro UnregisterPrintVerb ".pdf"
!macroend
