@echo off
REM ============================================================================
REM  Menyiapkan Node.js untuk jendela ini - TANPA perlu install Node di laptop.
REM  Dipanggil oleh setup.bat / start.bat / dev.bat:   call "scripts\use-node.bat"
REM
REM  Urutan pencarian:
REM    1. Folder node-v*-win-x64 di root project (bisa disalin manual, misalnya
REM       dari folder initiative_studio atau Lacak Pilot, untuk laptop tanpa internet)
REM    2. .tools\node-v24.21.0-win-x64 (hasil unduhan setup sebelumnya)
REM    3. Node.js yang sudah terpasang di laptop (bila ada)
REM    4. Belum ada sama sekali -> unduh Node.js portable resmi dari nodejs.org,
REM       cek checksum SHA-256, lalu ekstrak ke .tools\
REM  Hasil: folder Node ditaruh paling depan di PATH jendela ini saja (tidak
REM  mengubah setting Windows). Exit code 1 bila gagal.
REM  Sengaja TANPA setlocal, supaya PATH tetap berlaku setelah "call".
REM ============================================================================
set "NODE_VERSION=v24.21.0"
set "NODE_DIST=node-%NODE_VERSION%-win-x64"
set "NODE_SHA256=158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541"
for %%I in ("%~dp0..") do set "TRACE_ROOT=%%~fI"
set "TRACE_TOOLS=%TRACE_ROOT%\.tools"
set "TRACE_NODE_DIR="

REM --- 1. node-v*-win-x64 di root project ---
for /f "delims=" %%D in ('dir /b /ad "%TRACE_ROOT%\node-v*-win-x64" 2^>nul') do (
  if exist "%TRACE_ROOT%\%%D\node.exe" set "TRACE_NODE_DIR=%TRACE_ROOT%\%%D"
)
if defined TRACE_NODE_DIR goto found

REM --- 2. hasil unduhan sebelumnya ---
if exist "%TRACE_TOOLS%\%NODE_DIST%\node.exe" set "TRACE_NODE_DIR=%TRACE_TOOLS%\%NODE_DIST%"
if defined TRACE_NODE_DIR goto found

REM --- 3. Node.js yang terpasang di laptop ---
where node >nul 2>nul
if errorlevel 1 goto download
where npm >nul 2>nul
if errorlevel 1 goto download
echo  Memakai Node.js yang terpasang di laptop.
exit /b 0

REM --- 4. unduh Node.js portable ---
:download
echo  Node.js belum ada. Mengunduh Node.js %NODE_VERSION% portable (~37 MB) dari nodejs.org ...
if not exist "%TRACE_TOOLS%" mkdir "%TRACE_TOOLS%"
set "NODE_ZIP=%TRACE_TOOLS%\%NODE_DIST%.zip"
set "NODE_URL=https://nodejs.org/dist/%NODE_VERSION%/%NODE_DIST%.zip"
if exist "%NODE_ZIP%" del /q "%NODE_ZIP%"
curl.exe -fL --retry 3 -o "%NODE_ZIP%" "%NODE_URL%"
if not errorlevel 1 goto verify
echo  curl gagal - mencoba lewat PowerShell ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '%NODE_URL%' -OutFile '%NODE_ZIP%'"
if errorlevel 1 goto download_failed

:verify
powershell -NoProfile -ExecutionPolicy Bypass -Command "if ((Get-FileHash -Algorithm SHA256 -LiteralPath '%NODE_ZIP%').Hash -ne '%NODE_SHA256%') { exit 1 }"
if errorlevel 1 (
  echo [GAGAL] Checksum file unduhan tidak cocok - file rusak atau bukan dari nodejs.org.
  del /q "%NODE_ZIP%" 2>nul
  goto download_failed
)
echo  Mengekstrak ...
tar -xf "%NODE_ZIP%" -C "%TRACE_TOOLS%" 2>nul
if not exist "%TRACE_TOOLS%\%NODE_DIST%\node.exe" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%NODE_ZIP%' -DestinationPath '%TRACE_TOOLS%' -Force"
)
del /q "%NODE_ZIP%" 2>nul
if not exist "%TRACE_TOOLS%\%NODE_DIST%\node.exe" goto download_failed
set "TRACE_NODE_DIR=%TRACE_TOOLS%\%NODE_DIST%"

:found
set "PATH=%TRACE_NODE_DIR%;%PATH%"
echo  Memakai Node.js portable: %TRACE_NODE_DIR%
exit /b 0

:download_failed
echo.
echo [GAGAL] Node.js portable tidak bisa diunduh.
echo         Alternatif tanpa internet: salin folder "%NODE_DIST%" dari folder
echo         initiative_studio atau Lacak Pilot ke folder ini:
echo           %TRACE_ROOT%
echo         lalu jalankan ulang.
exit /b 1
