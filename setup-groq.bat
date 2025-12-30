@echo off
chcp 65001 >nul
echo ========================================
echo 配置 Groq API 密钥
echo ========================================
echo.

REM 检查 .env 文件是否存在
if not exist .env (
    echo 创建新的 .env 文件...
    copy .env.example .env >nul
    echo .env 文件已创建
) else (
    echo .env 文件已存在
)

echo.
echo 正在添加 Groq API 配置...

REM 检查是否已经有 GROQ_API_KEY 配置
findstr /C:"GROQ_API_KEY" .env >nul
if %errorlevel%==0 (
    echo GROQ_API_KEY 配置已存在，正在更新...
    powershell -Command "(Get-Content .env) -replace '^GROQ_API_KEY=.*', 'GROQ_API_KEY=your_groq_api_key_here' | Set-Content .env"
    powershell -Command "(Get-Content .env) -replace '^# GROQ_API_KEY=.*', 'GROQ_API_KEY=your_groq_api_key_here' | Set-Content .env"
) else (
    echo 添加新的 GROQ_API_KEY 配置...
    echo. >> .env
    echo # Groq API配置（用于三层分析框架模式） >> .env
    echo GROQ_API_KEY=your_groq_api_key_here >> .env
    echo GROQ_MODEL=llama-3.3-70b-versatile >> .env
)

echo.
echo ========================================
echo ✓ Groq API 配置完成！
echo ========================================
echo.
echo 当前配置：
echo GROQ_API_KEY=your_groq_api_key_here
echo GROQ_MODEL=llama-3.3-70b-versatile
echo.
echo 请重启服务器以使配置生效：
echo   1. 停止当前服务器 (Ctrl+C)
echo   2. 运行: npm start
echo.
pause
