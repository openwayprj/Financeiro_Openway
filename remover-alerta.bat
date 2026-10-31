@echo off
chcp 65001 >nul
powershell -NoProfile -Command "Unregister-ScheduledTask -TaskName 'Openway Financeiro - Alerta diario' -Confirm:$false"
if errorlevel 1 (echo Nenhum agendamento encontrado.) else (echo Agendamento removido.)
pause
