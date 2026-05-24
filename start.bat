@echo off
echo.
echo  TubeBot - YouTube Automation Bot
echo  ==================================
echo.

cd /d "%~dp0"

:: Check if node is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found! Please install from https://nodejs.org
    echo.
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    npm install
)

echo.
echo [INFO] Server starting on http://localhost:3000
echo [INFO] Press Ctrl+C to stop
echo.
node server.js
