@echo off
REM Cai moi hoan toan: xoa data + ban cai, roi npm install va build lai.
REM Giu ma nguon trong thu muc project.
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo Chua cai Node.js. Hay cai tu https://nodejs.org
  pause
  exit /b 1
)

echo.
echo Cai moi hoan toan Chrome Manager
echo - Dong app neu dang mo
echo - Xoa data, ho so, AppData, shortcut, ban cai trong LocalAppData
echo - Xoa node_modules, out, release roi cai va build lai
echo - Giu ma nguon du an
echo.
echo Moi ho so Chrome, Gmail va cau hinh se mat, khong khoi phuc duoc.
choice /C YN /N /M "Tiep tuc? Y/N"
if errorlevel 2 exit /b 0

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-fresh.ps1" -ProjectRoot "%CD%"
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" (
  echo Cai moi that bai. Ma loi %EXITCODE%.
) else (
  echo Cai moi xong. Double-click "Chrome Manager.lnk" de mo app.
)
pause
exit /b %EXITCODE%
