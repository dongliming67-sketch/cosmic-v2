@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: 确保在脚本所在目录
pushd "%~dp0"
title Cosmic拆分智能体 V6 - 一键启动
color 0a

echo.
echo =============================
echo  Cosmic拆分智能体 V6 一键启动
echo  (雙擊本文件即可)
echo =============================
echo.

:: 0) 先关闭可能占用端口的 node 进程
echo 🔄 检查并关闭占用端口的进程...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":2617 " ^| findstr "LISTENING"') do (
    echo 关闭占用 2617 端口的进程 PID: %%a
    taskkill /F /PID %%a >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001 " ^| findstr "LISTENING"') do (
    echo 关闭占用 3001 端口的进程 PID: %%a
    taskkill /F /PID %%a >nul 2>nul
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":5173 " ^| findstr "LISTENING"') do (
    echo 关闭占用 5173 端口的进程 PID: %%a
    taskkill /F /PID %%a >nul 2>nul
)

:: 1) 检查 Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ 未检测到 Node.js，请先安装 https://nodejs.org/
    echo 按任意键退出...
    pause >nul
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do set NODE_VER=%%v
echo ✅ Node.js %NODE_VER%

:: 2) 安装依赖（仅缺失时）
if not exist "node_modules" (
    echo 📦 安装后端依赖...
    call npm install || goto :err
)
if not exist "client\node_modules" (
    echo 📦 安装前端依赖...
    pushd client
    call npm install || (popd & goto :err)
    popd
)

:: 3) 启动前后端
:: 后端端口固定 2617，前端 5173
set PORT=2617
set HOST=localhost

echo.
echo 🚀 正在启动前后端 (npm run dev)
echo 后端: http://localhost:2617
echo 前端: http://localhost:5173
echo.
call npm run dev

echo.
echo ⚠️ 服务已停止
popd
pause
exit /b 0

:err
echo.
echo ⚠️ 启动失败，请检查上方错误信息
popd
pause
exit /b 1
