@echo off
rem Double-click to start Dawnshift on Windows.
title Dawnshift
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
node -e "process.exit(parseInt(process.versions.node) < 20 ? 1 : 0)"
if errorlevel 1 goto nonode
node server.js --open
pause
exit /b 0
:nonode
echo Dawnshift needs Node.js version 20 or newer.
echo Opening nodejs.org. Install the LTS version, then double-click this file again.
start "" "https://nodejs.org"
pause
exit /b 1
