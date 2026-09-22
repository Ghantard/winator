@echo off
rem Double-clickable launcher: installs what is missing, then asks for the site
rem address if none was given on the command line.
setlocal enabledelayedexpansion
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 ou plus est requis : https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installation des dependances, une minute...
  call npm ci --no-audit --no-fund || goto :fail
)

if not exist dist\cli.js (
  echo Compilation...
  call npm run build || goto :fail
)

if not "%~1"=="" (
  node dist\cli.js build %*
  exit /b %errorlevel%
)

set "SITE="
set "NOM="
set /p "SITE=Adresse du site (https://...) ou chemin d'un dossier : "
if "!SITE!"=="" goto :fail
set /p "NOM=Nom de l'application (Entree pour la valeur par defaut) : "

if "!NOM!"=="" (
  node dist\cli.js build "!SITE!"
) else (
  node dist\cli.js build "!SITE!" --app-name "!NOM!"
)
echo.
pause
exit /b %errorlevel%

:fail
echo.
echo Echec. Verifiez le message ci-dessus.
pause
exit /b 1
