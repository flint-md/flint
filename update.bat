@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1" %*
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Update failed with error code %ERRORLEVEL%.
)
echo.
pause
endlocal
