@echo off
setlocal
chcp 65001 >nul
title Cosmic-Split-Agent-Starter

echo ========================================
echo    Cosmic Split Agent - Starting
echo ========================================

:: 1. Force release ports (2617 and 5173)
echo [1/3] Releasing system ports...
:: Filtering out PID 0 and 4 to avoid 'Access Denied' errors
powershell -Command "$ports = @(2617, 5173); foreach($port in $ports) { $p = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 4 } | Select-Object -ExpandProperty OwningProcess -Unique; if($p) { foreach($id in $p) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; } } }"

:: 2. Prepare to open browser
echo [2/3] Preparing browser redirection...
start /b cmd /c "timeout /t 10 /nobreak >nul && start http://127.0.0.1:5173"

:: 3. Start services
echo [3/3] Launching Engine...
echo.
echo 💡 TIP: When you see 'VITE ready', wait 2 seconds for the browser to pop up.
echo 🚀 App URL: http://127.0.0.1:5173
echo.

npm run dev
