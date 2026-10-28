; Vidalune for Windows: installs the server, its web interface, Node, FFmpeg and the tray program.
; Built by packaging/windows/build.sh with: makensis -DVERSION=<x.y.z> -DSTAGE=<dir> -DOUTFILE=<exe>
; The server runs as the signed-in user, started by the tray program (VidaluneTray.exe) at sign-in;
; its settings and library stay in C:\ProgramData\Vidalune, also across updates.
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel admin
ManifestDPIAware true

!include "MUI2.nsh"
!include "x64.nsh"
!include "LogicLib.nsh"

Name "Vidalune"
OutFile "${OUTFILE}"
InstallDir "$PROGRAMFILES64\Vidalune"
BrandingText "Vidalune ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Vidalune"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "Vidalune media server"
VIAddVersionKey "CompanyName" "Vidalune"
VIAddVersionKey "LegalCopyright" "Vidalune"

!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Vidalune"
!define MUI_ICON "${STAGE}\vidalune.ico"
!define MUI_UNICON "${STAGE}\vidalune.ico"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "$(StartNow)"
!define MUI_FINISHPAGE_RUN_FUNCTION StartTray
!define MUI_FINISHPAGE_TEXT "$(FinishText)"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${STAGE}\LICENSE.txt"
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "Dutch"

LangString StartNow ${LANG_ENGLISH} "Start Vidalune now"
LangString StartNow ${LANG_DUTCH} "Vidalune nu starten"
LangString FinishText ${LANG_ENGLISH} "Vidalune starts with Windows and shows an icon next to the clock. Right-click it to open Vidalune, restart it or quit it.$\r$\n$\r$\nUsing this PC as a server? Turn on automatic sign-in in Windows, so Vidalune also runs again after a restart."
LangString FinishText ${LANG_DUTCH} "Vidalune start met Windows en staat als icoon naast de klok. Klik er met rechts op om Vidalune te openen, te herstarten of af te sluiten.$\r$\n$\r$\nGebruik je deze pc als server? Zet dan automatisch aanmelden aan in Windows, zodat Vidalune na een herstart ook weer draait."
LangString Needs64 ${LANG_ENGLISH} "Vidalune needs a 64-bit version of Windows 10 or 11."
LangString Needs64 ${LANG_DUTCH} "Vidalune heeft een 64-bits versie van Windows 10 of 11 nodig."
LangString RemoveData ${LANG_ENGLISH} "Also remove your Vidalune settings, users and library information (C:\ProgramData\Vidalune)? Your movies and shows themselves are never removed."
LangString RemoveData ${LANG_DUTCH} "Ook je Vidalune-instellingen, gebruikers en bibliotheekgegevens verwijderen (C:\ProgramData\Vidalune)? Je films en series zelf worden nooit verwijderd."

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "$(Needs64)"
    Abort
  ${EndIf}
  SetRegView 64
  ; For every user of this PC: $APPDATA is then C:\ProgramData and the shortcut is everyone's.
  SetShellVarContext all
FunctionEnd

Function un.onInit
  SetRegView 64
  SetShellVarContext all
FunctionEnd

; Started through Explorer, so the tray program (and the server) run as the signed-in user, not as
; the administrator that runs this installer.
Function StartTray
  Exec '"$WINDIR\explorer.exe" "$INSTDIR\VidaluneTray.exe"'
FunctionEnd

!macro StopVidalune
  ; Ending the tray program ends the server and FFmpeg with it (its job object).
  nsExec::Exec 'taskkill /IM VidaluneTray.exe /F'
  Pop $0
  Sleep 1500
!macroend

Section "Vidalune" SecMain
  SectionIn RO
  !insertmacro StopVidalune

  ; A clean copy: nothing left over from an older version (the data folder is elsewhere).
  RMDir /r "$INSTDIR\app"
  RMDir /r "$INSTDIR\node"
  RMDir /r "$INSTDIR\ffmpeg"
  SetOutPath "$INSTDIR"
  File /r "${STAGE}\*.*"

  ; The data folder: kept across updates. Only for Windows itself, administrators and the account
  ; that installs Vidalune (which runs it): other users of this PC cannot read the database or
  ; change vidalune.env. Also takes away what older versions gave every user.
  CreateDirectory "$APPDATA\Vidalune"
  CreateDirectory "$APPDATA\Vidalune\logs"
  ReadEnvStr $1 USERDOMAIN
  ReadEnvStr $2 USERNAME
  nsExec::Exec 'icacls "$APPDATA\Vidalune" /inheritance:r /remove:g *S-1-5-32-545 /grant:r *S-1-5-18:(OI)(CI)F *S-1-5-32-544:(OI)(CI)F "$1\$2:(OI)(CI)M" /T /Q'
  Pop $0
  ${IfNot} ${FileExists} "$APPDATA\Vidalune\vidalune.env"
    CopyFiles /SILENT "$INSTDIR\vidalune.env" "$APPDATA\Vidalune\vidalune.env"
  ${EndIf}

  ; Starts with Windows (at sign-in), for every user of this PC.
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Vidalune" '"$INSTDIR\VidaluneTray.exe"'
  CreateShortcut "$SMPROGRAMS\Vidalune.lnk" "$INSTDIR\VidaluneTray.exe" "--open" "$INSTDIR\VidaluneTray.exe" 0

  ; Other devices at home (and from outside, through the port set in Vidalune) reach the server, on
  ; networks Windows calls private (home, work); not on public ones (a café, a hotel).
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Vidalune"'
  Pop $0
  nsExec::Exec 'netsh advfirewall firewall add rule name="Vidalune" dir=in action=allow program="$INSTDIR\node\node.exe" enable=yes profile=private,domain'
  Pop $0

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayName" "Vidalune"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "Publisher" "Vidalune"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "URLInfoAbout" "https://vidalune.com"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\VidaluneTray.exe"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKLM "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  !insertmacro StopVidalune
  DeleteRegValue HKLM "Software\Microsoft\Windows\CurrentVersion\Run" "Vidalune"
  Delete "$SMPROGRAMS\Vidalune.lnk"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Vidalune"'
  Pop $0
  RMDir /r "$INSTDIR"
  DeleteRegKey HKLM "${UNINSTALL_KEY}"
  ; Kept unless asked (and always kept when uninstalling silently, as an update script would).
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "$(RemoveData)" /SD IDNO IDNO keep
    RMDir /r "$APPDATA\Vidalune"
  keep:
SectionEnd
