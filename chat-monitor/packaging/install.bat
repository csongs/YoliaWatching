@echo off
cd /d "%~dp0"
rem --ignore-scripts: better-sqlite3 ships prebuilt binaries for every platform inside the
rem package itself, but npm still runs "node-gyp rebuild" by default because it sees a
rem binding.gyp file and no explicit install script. That compile step needs Python/MSVC,
rem which most people testing this don't have, and it's not actually needed.

set NODE_VERSION=v22.14.0
set NODE_ZIP_URL=https://nodejs.org/dist/%NODE_VERSION%/node-%NODE_VERSION%-win-x64.zip

where node >nul 2>nul
if errorlevel 1 goto :nosystemnode
echo Found system Node.js, using it.
call npm install --ignore-scripts
goto :done

:nosystemnode
if exist ".node-portable\npm.cmd" goto :haveportable

echo No Node.js found. Downloading a portable copy (about 35MB) into this folder.
echo This will not touch your system or need admin rights. Please wait...
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri '%NODE_ZIP_URL%' -OutFile '%TEMP%\yolia-node-portable.zip' } catch { exit 1 }"
if errorlevel 1 goto :downloadfailed

echo Download complete, extracting...
powershell -NoProfile -Command "Expand-Archive -Path '%TEMP%\yolia-node-portable.zip' -DestinationPath '%TEMP%\yolia-node-portable-extract' -Force"
if exist ".node-portable" rmdir /S /Q ".node-portable"
move "%TEMP%\yolia-node-portable-extract\node-%NODE_VERSION%-win-x64" ".node-portable" >nul
del "%TEMP%\yolia-node-portable.zip" >nul 2>nul
rmdir /S /Q "%TEMP%\yolia-node-portable-extract" >nul 2>nul
goto :haveportable

:downloadfailed
echo.
echo Download failed. Check your internet connection, or install Node.js
echo manually from https://nodejs.org then run this file again.
pause
exit /b 1

:haveportable
echo Installing packages with the bundled portable Node.js, this may take 1-2 minutes...
set PATH=%~dp0.node-portable;%PATH%
call ".node-portable\npm.cmd" install --ignore-scripts

:done
echo.
echo Done! Double-click start.bat to launch.
pause
