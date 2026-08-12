@echo off
cd /d "%~dp0"

set NODE_EXE=node
where node >nul 2>nul
if not errorlevel 1 goto :havenode
if exist ".node-portable\node.exe" goto :haveportablenode
echo Node.js not found. Please double-click install.bat first.
pause
exit /b 1

:haveportablenode
set NODE_EXE=.node-portable\node.exe

:havenode
if not exist "node_modules" goto :notinstalled

echo Starting Chat Monitor server...
start "YoliaChatMonitor (close this window to stop the server)" cmd /c ""%NODE_EXE%" server.js"
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:3100/
goto :eof

:notinstalled
echo Packages not installed yet. Please double-click install.bat first.
pause
exit /b 1
