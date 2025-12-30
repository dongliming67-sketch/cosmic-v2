@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul
title COSMIC 拆分智能体 - Gemini 1.5 版本

echo ========================================
echo   COSMIC 拆分智能体 - Gemini 1.5 版本
echo ========================================
echo.

:: 检查是否配置了代理
if "%HTTP_PROXY%"=="" (
    echo [提示] 检测到代理未设置。
    echo Google Gemini API 需要科学上网环境（代理）才能在中国大陆运行。
    echo.
    echo 请选择操作：
    echo   1. 输入代理地址并启动 (推荐，如 http://127.0.0.1:7890)
    echo   2. 使用智谱 AI 模式启动 (无需代理)
    echo   3. 强制启动（如果您有系统级全局代理）
    echo.
    set /p choice=请输入选项 (1/2/3): 

    if "!choice!"=="1" (
        set /p proxy_addr=请输入代理地址: 
        set "HTTP_PROXY=!proxy_addr!"
        set "HTTPS_PROXY=!proxy_addr!"
        echo [已设置代理] !proxy_addr!
    ) else if "!choice!"=="2" (
        echo [切换模式] 已切换为智谱 AI 模式
        set "THREE_LAYER_PROVIDER=zhipu"
    )
)

echo.
echo [1/2] 正在清理残留进程...
powershell -Command "$ports = @(3001, 5173); foreach($port in $ports) { $p = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 4 } | Select-Object -ExpandProperty OwningProcess -Unique; if($p) { foreach($id in $p) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; } } }"

echo [2/2] 正在启动服务 (前端+后端)...
echo.
echo 💡 提示: 
echo 1. 当看到 "VITE ready" 后，浏览器将在一秒后自动打开。
echo 2. 后端端口: 3001, 前端端口: 5173
echo.

:: 启动前端和后端
start /b cmd /c "timeout /t 5 /nobreak >nul && start http://127.0.0.1:5173"
npm run dev

pause
