!include "LogicLib.nsh"

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Checking Microsoft Visual C++ 2015-2022 Redistributable (x64)..."

  ; Switch to 64-bit registry view to query native 64-bit VC++ runtime registration
  SetRegView 64
  ReadRegDWord $0 HKLM "SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64" "Installed"
  SetRegView lastused

  ${If} $0 == 1
    DetailPrint "Visual C++ Redistributable (x64) is already installed. Skipping installation."
  ${Else}
    DetailPrint "Visual C++ Redistributable (x64) not detected. Initiating background installation..."
    ${If} ${FileExists} "$INSTDIR\resources\vc_redist.x64.exe"
      DetailPrint "Installing Visual C++ Redistributable silently..."
      ExecWait '"$INSTDIR\resources\vc_redist.x64.exe" /install /quiet /norestart' $1
      DetailPrint "Visual C++ Redistributable setup completed (exit code: $1)."
    ${Else}
      DetailPrint "Notice: vc_redist.x64.exe was not found in resources folder. Skipping."
    ${EndIf}
  ${EndIf}
!macroend
