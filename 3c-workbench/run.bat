@echo off
REM 一键同步：拉数据 → 增量上传 JoySpace → 写 web/data/minutes.json
REM 用法（在本目录双击或终端跑）：
REM   run.bat              -> 同步 + 上传
REM   run.bat --no-upload  -> 只拉数据不上传
REM   run.bat --serve      -> 起本地预览（http://localhost:8080/）
REM   run.bat --limit 3    -> 试水：只处理前 3 条

setlocal enabledelayedexpansion
cd /d "%~dp0"

REM 先看有没有 --serve
for %%a in (%*) do (
  if "%%a"=="--serve" goto :serve
)

REM 默认 = 同步并尝试上传
set FORWARD=%*
if "%FORWARD%"=="" set FORWARD=--upload

echo [run] node scripts\sync_minutes.mjs %FORWARD%
node scripts\sync_minutes.mjs %FORWARD%
goto :eof

:serve
echo [run] starting local server on http://localhost:8080/
node scripts\serve.mjs
