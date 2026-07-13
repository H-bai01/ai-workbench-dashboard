@echo off
setlocal
chcp 65001 > nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 启动失败：请先安装 Node.js 22.13.0 或更高版本。
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo 启动失败：未找到 npm。
  exit /b 1
)

call npm run start:v2
exit /b %errorlevel%
