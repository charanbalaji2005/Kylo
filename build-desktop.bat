@echo off
REM Kylo / Klyo Desktop Build Wrapper

setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-desktop.ps1" %*

if %ERRORLEVEL% NEQ 0 (
    echo [build] FAILED.
    exit /b %ERRORLEVEL%
)

endlocal

