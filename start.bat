@echo off
setlocal
cd /d "%~dp0"

rem --console keeps a visible server window for debugging.
rem --hidden is used internally by run-hidden.vbs.
if /i "%~1"=="--console" goto main
if /i "%~1"=="--hidden" goto main

rem Start the real server hidden. DARK_FOREST_NO_OPEN tells launcher.mjs
rem not to open a second browser; this visible wrapper opens it below.
set "DARK_FOREST_NO_OPEN=1"
if exist "%~dp0run-hidden.vbs" (
  start "" /b wscript //nologo "%~dp0run-hidden.vbs"
) else (
  start "" /b "runtime\node.exe" "launcher.mjs"
)

if "%PORT%"=="" (set "DF_PORT=3001") else (set "DF_PORT=%PORT%")
set WAIT=0
:wait
curl.exe -s --max-time 1 -o NUL "http://127.0.0.1:%DF_PORT%/api/health"
if not errorlevel 1 goto open
set /a WAIT+=1
if %WAIT% GEQ 15 goto open
timeout /t 1 /nobreak >nul
goto wait

:open
if "%DARK_FOREST_SKIP_OPEN%"=="1" exit /b 0
start "" "http://localhost:%DF_PORT%"
exit /b 0

:main
if not exist "runtime\node.exe" (
  echo Missing runtime\node.exe - please extract the whole release zip.
  if /i not "%~1"=="--hidden" pause
  exit /b 1
)

set ATTEMPTS=0
:restart
set /a ATTEMPTS+=1
"runtime\node.exe" "launcher.mjs"
set CODE=%errorlevel%

if "%CODE%"=="0" goto end

echo.
echo Server stopped unexpectedly. Restarting (attempt %ATTEMPTS%/3)...
if %ATTEMPTS% GEQ 3 (
  echo.
  echo Server failed 3 times. Check logs\server-errors.log and port 3001.
  if /i not "%~1"=="--hidden" pause
  goto end
)
timeout /t 3 /nobreak >nul
goto restart

:end
