@echo off
chcp 65001 >nul
title Cosmic拆分智能体 - 一键启动
color 0A

echo.
echo ╔════════════════════════════════════════════════════════════╗
echo ║                                                            ║
echo ║           🚀 Cosmic拆分智能体 - 一键启动脚本               ║
echo ║                                                            ║
echo ╚════════════════════════════════════════════════════════════╝
echo.

echo [0/4] 🧹 正在清理残留进程...
powershell -Command "$ports = @(2617, 3001, 3002, 5173); foreach($port in $ports) { $p = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Where-Object { $_.OwningProcess -gt 4 } | Select-Object -ExpandProperty OwningProcess -Unique; if($p) { foreach($id in $p) { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue; echo \"已杀死占用端口 $port 的进程: $id\" } } }"
timeout /t 1 /nobreak >nul
echo ✅ 端口清理完成
echo.

:: 检查Node.js是否安装
echo [1/4] 🔍 检查Node.js环境...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ⚠️  未检测到Node.js，正在自动下载安装...
    echo.
    
    :: 检查是否有winget
    where winget >nul 2>nul
    if %errorlevel% equ 0 (
        echo 📦 使用winget安装Node.js LTS版本...
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        if %errorlevel% neq 0 (
            echo ❌ winget安装失败，尝试手动下载安装...
            goto :manual_install
        )
        echo ✅ Node.js安装完成
        echo ⚠️  请关闭此窗口，重新打开命令行后再次运行此脚本
        pause
        exit /b 0
    ) else (
        goto :manual_install
    )
)

goto :node_ok

:manual_install
echo 📥 正在下载Node.js安装包...
set "NODE_INSTALLER=%TEMP%\node_installer.msi"
set "NODE_URL=https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi"

:: 使用PowerShell下载
powershell -Command "& {[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%NODE_URL%' -OutFile '%NODE_INSTALLER%'}"
if %errorlevel% neq 0 (
    echo ❌ 下载失败，请手动安装Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

echo 📦 正在安装Node.js...
msiexec /i "%NODE_INSTALLER%" /qn /norestart
if %errorlevel% neq 0 (
    echo ⚠️  静默安装失败，启动交互式安装...
    msiexec /i "%NODE_INSTALLER%"
)

:: 清理安装包
del "%NODE_INSTALLER%" >nul 2>nul

echo ✅ Node.js安装完成
echo ⚠️  请关闭此窗口，重新打开命令行后再次运行此脚本
pause
exit /b 0

:node_ok
node -v
echo ✅ Node.js环境正常
echo.

:: 检查依赖是否已安装
echo [2/4] 📦 检查项目依赖...
if not exist "node_modules" (
    echo ⚠️  未检测到根目录依赖，开始安装...
    call npm install
    if %errorlevel% neq 0 (
        echo ❌ 根目录依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo ✅ 根目录依赖已存在
)

if not exist "client\node_modules" (
    echo ⚠️  未检测到客户端依赖，开始安装...
    cd client
    call npm install
    if %errorlevel% neq 0 (
        echo ❌ 客户端依赖安装失败
        pause
        exit /b 1
    )
    cd ..
) else (
    echo ✅ 客户端依赖已存在
)
echo.

:: 检查.env配置文件
echo [3/4] ⚙️  检查配置文件...
if not exist ".env" (
    echo ⚠️  未检测到.env文件，从.env.example复制...
    copy .env.example .env >nul
    echo ⚠️  请编辑.env文件配置您的API密钥
    echo 推荐使用心流开放平台 DeepSeek-V3: https://apis.iflow.cn
    pause
)
echo ✅ 配置文件检查完成
echo.

:: 启动应用
echo [4/4] 🚀 启动应用服务...
echo.
echo ┌────────────────────────────────────────────────────────────┐
echo │  服务启动中，请稍候...                                     │
echo │  后端服务: http://localhost:2617                           │
echo │  前端服务: http://localhost:5173                           │
echo │                                                            │
echo │  💡 提示: 按 Ctrl+C 可停止服务                             │
echo └────────────────────────────────────────────────────────────┘
echo.

:: 等待3秒后自动打开浏览器
start /b timeout /t 3 /nobreak >nul && start http://localhost:5173

:: 启动开发服务器
call npm run dev

:: 如果服务异常退出
echo.
echo ⚠️  服务已停止
pause
