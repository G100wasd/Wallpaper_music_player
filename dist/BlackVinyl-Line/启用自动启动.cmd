@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Setup-Autostart.ps1" -Action Enable
if errorlevel 1 goto done
call "%~dp0Start-Config-Quiet.cmd"
:done
pause
