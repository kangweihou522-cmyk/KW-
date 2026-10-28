@echo off
setlocal
if exist "%~dp0..\..\package-lock.json" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-PaperDesk.ps1" -BuildFromSource %*
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-PaperDesk.ps1" %*
)
if errorlevel 1 (
  echo Setup failed. Read the error above; no paid service is used.
  pause
  exit /b 1
)
pause
