@echo off
echo.
echo ============================================
echo   GitHub Login + Push Guide for TubeBot
echo ============================================
echo.
echo Step 1: GitHub me login karo
echo.
set PATH=%PATH%;C:\Program Files\GitHub CLI\
gh auth login
echo.
echo Step 2: Remote add karo (pehli baar)
git remote add origin https://github.com/kadiwalarman1-rgb/tubebot-youtube-automation.git 2>nul
echo.
echo Step 3: Push karo
git push -u origin master
echo.
echo ============================================
echo   Done! GitHub pe upload ho gaya.
echo ============================================
pause
