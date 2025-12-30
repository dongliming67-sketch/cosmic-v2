@echo off
chcp 65001 >nul
echo ========================================
echo 重启 COSMIC 拆分智能体服务器
echo ========================================
echo.

echo 正在停止现有服务器进程...
taskkill /F /IM node.exe /T 2>nul
timeout /t 2 /nobreak >nul

echo.
echo 清理缓存...
if exist node_modules\.cache rmdir /s /q node_modules\.cache

echo.
echo 启动服务器...
echo.
cd /d "%~dp0"
start "COSMIC服务器" cmd /k "npm start"

echo.
echo ========================================
echo ✓ 服务器已在新窗口中启动
echo ========================================
echo.
echo 请在新窗口中查看服务器日志
echo 应该能看到: "Groq客户端已初始化，API Key: 已配置"
echo.
echo 然后刷新浏览器页面测试三层分析框架模式
echo.
pause
