@echo off
setlocal enabledelayedexpansion
cd /d C:\Users\HP\Projects\GROWW_Trading_Project
title NIFTY Scanner - Morning Setup

echo ==================================================
echo    NIFTY Scanner  -  Morning Setup
echo ==================================================
echo.
set /p REQ="1) Paste today's Kite request_token (- to skip): "
set /p OPEN="2) Today's NIFTY open price (blank = skip levels): "
echo.
echo --- Updating token + calculating levels ---
node scripts\morning.mjs "%REQ%" "%OPEN%"
if errorlevel 1 (
  echo.
  echo *** SETUP FAILED - see message above. Server NOT restarted. ***
  echo.
  pause
  exit /b 1
)
echo.
echo --- Restarting dev server on port 3000 ---
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1
timeout /t 2 /nobreak >nul
start "NIFTY Scanner" cmd /k "npm run dev -- -H 0.0.0.0"
echo.
echo Done. Server launching in a new window:
echo    Local : http://localhost:3000
echo    LAN   : http://192.168.29.136:3000  (other devices on the WiFi)
echo.
pause
