@echo off
setlocal
cd /d "%~dp0"
title Dark Forest AI Bridge
set "NODE=node"
if exist "%~dp0runtime\node.exe" set "NODE=%~dp0runtime\node.exe"
if "%~1"=="" (
  "%NODE%" ai-bridge.mjs %*
) else (
  echo %~1 | findstr /b /i "dfbridge://" >nul
  if errorlevel 1 (
    "%NODE%" ai-bridge.mjs %*
  ) else (
    "%NODE%" ai-bridge.mjs --url="%~1"
  )
)
echo.
echo Bridge exited. Press any key to close.
pause >nul
