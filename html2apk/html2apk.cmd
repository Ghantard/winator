@echo off
rem Double-clickable launcher: installs what is missing, then opens the
rem interface in the browser. Arguments, if any, go straight to the CLI.
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
  node dist\cli.js %*
  exit /b %errorlevel%
)

rem No argument: open the interface in the browser and keep the window open.
node dist\cli.js ui
echo.
pause
exit /b %errorlevel%

:fail
echo.
echo Echec. Verifiez le message ci-dessus.
pause
exit /b 1
