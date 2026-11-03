@echo off
cd /d "%~dp0source"
if exist "dist\desktop-personal-current\win-unpacked\xinhai-source.exe" (
  start "" "dist\desktop-personal-current\win-unpacked\xinhai-source.exe"
  exit /b 0
)
if exist "dist\desktop-x64\win-unpacked\xinhai-source.exe" (
  start "" "dist\desktop-x64\win-unpacked\xinhai-source.exe"
  exit /b 0
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Please install dependencies in source and run npm run build first.
  pause
  exit /b 1
)
if not exist "out\main\index.js" (
  echo Please run npm run build in source first.
  pause
  exit /b 1
)
start "" "node_modules\electron\dist\electron.exe" "."
