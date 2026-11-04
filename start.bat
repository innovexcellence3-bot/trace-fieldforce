@echo off
title TRACE
cd /d "%~dp0"
echo ================================================================
echo  TRACE - Field Force Location Intelligence
echo  Aplikasi berjalan di http://localhost:8020
echo  Tutup jendela ini untuk mematikan aplikasi.
echo ================================================================
echo.

call "%~dp0scripts\use-node.bat"
if errorlevel 1 goto fail

if not exist ".env" copy /y ".env.example" ".env" >nul

REM --- setup otomatis bila belum pernah dijalankan ---
if exist "node_modules\snowflake-sdk" goto build
echo.
echo  Pertama kali dijalankan: install dependency (beberapa menit) ...
echo  TIP: pause sinkronisasi OneDrive selama proses ini.
echo.
call npm install
if errorlevel 1 goto fail

:build
REM Selalu build ulang (beberapa detik) supaya perubahan kode setelah git pull
REM langsung terlihat - tampilan disajikan dari frontend\dist.
echo.
echo  Build tampilan aplikasi ...
call npm run build
if errorlevel 1 goto fail

echo.
echo  Browser akan terbuka otomatis begitu server siap.
echo  Saat query Snowflake pertama, jendela login SSO juga akan terbuka di browser.
echo.
set "TRACE_OPEN_BROWSER=1"
call npm start
echo.
echo  Server berhenti.
pause
exit /b 0

:fail
echo.
echo [GAGAL] Baca pesan error di atas.
pause
exit /b 1
