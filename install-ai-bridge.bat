@echo off
setlocal
cd /d "%~dp0"
echo Registering dfbridge:// protocol for the current Windows user...
reg add "HKCU\Software\Classes\dfbridge" /ve /d "URL:Dark Forest AI Bridge" /f >nul
reg add "HKCU\Software\Classes\dfbridge" /v "URL Protocol" /d "" /f >nul
reg add "HKCU\Software\Classes\dfbridge\shell\open\command" /ve /d "\"%~dp0start-ai-bridge.bat\" \"%%1\"" /f >nul
if errorlevel 1 (
  echo Failed. You can still run start-ai-bridge.bat manually.
) else (
  echo Registered: dfbridge://
  echo You can now use the "Open local Bridge" button in the room.
)
echo.
pause
