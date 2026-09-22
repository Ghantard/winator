@echo off
rem Place this file next to html2apk.exe and double-click it instead of the exe:
rem a failure stays on screen instead of closing with the console window.
setlocal
cd /d "%~dp0"

if not exist html2apk.exe (
  echo html2apk.exe est introuvable dans ce dossier :
  echo   %~dp0
  echo.
  echo Extrayez l'archive ZIP avant de lancer ce fichier ^(clic droit ^> Extraire tout^).
  echo.
  pause
  exit /b 1
)

echo Demarrage de html2apk...
echo.
html2apk.exe ui
set CODE=%errorlevel%

echo.
if not "%CODE%"=="0" (
  echo html2apk s'est arrete avec le code %CODE%.
  echo Recopiez le message ci-dessus pour obtenir de l'aide.
)
pause
exit /b %CODE%
