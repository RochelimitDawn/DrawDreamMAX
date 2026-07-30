@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
title DrawDream Agent

:: Product root = this bat's folder
cd /d "%~dp0"
if not exist "package.json" (
  echo [ERROR] package.json not found. Put start.bat in the DrawDream Agent folder.
  goto :fail
)
if not exist "server\main.ts" (
  echo [ERROR] server\main.ts not found. This is not the DrawDream Agent directory.
  goto :fail
)

echo.
echo  ========================================
echo    DrawDream Agent
echo  ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node ^>= 22 and add to PATH.
  echo         https://nodejs.org/
  goto :fail
)

for /f "tokens=*" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
echo [drawdream] Node %NODE_VER%

:: First-run defaults (no personal keys)
if not exist "drawdream.config.json" if exist "drawdream.config.example.json" (
  echo [drawdream] Creating drawdream.config.json from example ...
  copy /Y "drawdream.config.example.json" "drawdream.config.json" >nul
)
if not exist "drawdream.agent.json" if exist "drawdream.agent.example.json" (
  echo [drawdream] Creating drawdream.agent.json from example ...
  copy /Y "drawdream.agent.example.json" "drawdream.agent.json" >nul
  echo [drawdream] Edit drawdream.agent.json and set your API key before chatting.
)

if not exist "node_modules\" (
  echo [drawdream] node_modules missing — running npm install ...
  echo [drawdream] First run needs network; later starts are offline-ready.
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    goto :fail
  )
  echo.
)

if not defined DRAWDREAM_UI_DIST (
  if exist "..\dist\index.html" (
    for %%I in ("..\dist") do set "DRAWDREAM_UI_DIST=%%~fI"
  )
)
if defined DRAWDREAM_UI_DIST (
  echo [drawdream] UI dist: %DRAWDREAM_UI_DIST%
) else (
  echo [drawdream] WARN: no UI dist — set DRAWDREAM_UI_DIST or build parent drawdream first
)

set "PORT=7620"
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr ":%PORT% " ^| findstr LISTENING') do (
  echo [drawdream] Port %PORT% in use, killing PID %%p ...
  taskkill /F /PID %%p >nul 2>&1
)

echo [drawdream] Starting server on http://localhost:%PORT%
echo [drawdream] Continues last session. New session:  start.bat --new
echo [drawdream] Close this window to stop the server.
echo.

:: Delayed open via silent VBS (no second console)
set "VBS=%TEMP%\drawdream-open-browser.vbs"
> "%VBS%" echo WScript.Sleep 2000
>>"%VBS%" echo CreateObject("WScript.Shell").Run "http://localhost:%PORT%/", 1, False
wscript //nologo "%VBS%"

node server\main.ts %*
set "EC=%ERRORLEVEL%"
if exist "%VBS%" del /f /q "%VBS%" >nul 2>&1
if not "%EC%"=="0" goto :fail
exit /b 0

:fail
echo.
echo [drawdream] Failed. Press any key to close.
pause >nul
exit /b 1
