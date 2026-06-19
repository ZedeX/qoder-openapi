@echo off
cd /d "%~dp0"

echo ============================================
echo   QoderWork API Gateway
echo ============================================
echo.

REM Check if QoderWork is logged in
echo Checking QoderWork login status...
d:\_program\QoderWork\resources\bin\qodercli.exe status
echo.

echo If you see "Not logged in", please:
echo   1. Start QoderWork desktop app and login
echo   2. Or run: d:\_program\QoderWork\resources\bin\qodercli.exe login
echo.

echo Starting API Gateway on http://localhost:9680
echo.

node server.js
pause
