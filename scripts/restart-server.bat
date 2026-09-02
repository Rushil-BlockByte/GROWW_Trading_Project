@echo off
setlocal

set "PORT=%~1"
if "%PORT%"=="" set "PORT=3001"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restart-server.ps1" -Port "%PORT%"

endlocal
