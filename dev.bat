@echo off
title TRACE - Development
cd /d "%~dp0"
REM Mode development: API (auto-reload) + UI Vite (hot reload) di http://localhost:5174
REM Untuk pemakaian biasa cukup start.bat.

call "%~dp0scripts\use-node.bat"
if errorlevel 1 goto fail
if not exist ".env" copy /y ".env.example" ".env" >nul
if exist "node_modules\snowflake-sdk" goto run
call npm install
if errorlevel 1 goto fail

:run
echo.
echo  Buka http://localhost:5174 setelah muncul tulisan "ready". Ctrl+C untuk berhenti.
echo.
call npm run dev
pause
exit /b 0

:fail
echo.
echo [GAGAL] Baca pesan error di atas.
pause
exit /b 1
