@echo off
title TRACE - Setup
cd /d "%~dp0"
echo ================================================================
echo  TRACE - Setup (sekali per laptop)
echo  Tidak perlu install Node.js: versi portable diunduh otomatis
echo  ke folder .tools\ (seperti "virtual environment").
echo ================================================================
echo.

echo [1/4] Menyiapkan Node.js ...
call "%~dp0scripts\use-node.bat"
if errorlevel 1 goto fail
echo.

echo [2/4] Menyiapkan file setting .env ...
if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  echo       .env dibuat dari .env.example - edit bila username Snowflake berbeda.
) else (
  echo       .env sudah ada - dipakai apa adanya.
)
echo.

echo [3/4] Install dependency npm (node_modules). Bisa beberapa menit.
echo       TIP: pause sinkronisasi OneDrive selama proses ini supaya file tidak terkunci.
call npm install
if errorlevel 1 goto fail
echo.

echo [4/4] Build tampilan aplikasi ...
call npm run build
if errorlevel 1 goto fail
echo.

echo ================================================================
echo  [SELESAI] Setup berhasil. Jalankan start.bat untuk membuka TRACE.
echo ================================================================
pause
exit /b 0

:fail
echo.
echo [GAGAL] Setup berhenti. Baca pesan error di atas.
pause
exit /b 1
