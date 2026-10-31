@echo off
chcp 65001 >nul
title Openway Financeiro - Agendar alerta diario
cd /d "%~dp0"
echo.
echo  Agenda o envio diario do resumo de contas a pagar por e-mail.
echo  (Configure antes o e-mail no sistema: Sistema ^> Alertas por E-mail)
echo.
set HORA=
set /p HORA=Horario do envio [08:00]: 
if "%HORA%"=="" set HORA=08:00
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0agendar-alerta.ps1" -Hora "%HORA%"
if errorlevel 1 (
  echo.
  echo [ERRO] Nao foi possivel criar a tarefa. Tente executar este arquivo como Administrador.
) else (
  echo.
  echo  Se o computador estiver desligado nesse horario, o envio acontece assim que ele for ligado.
  echo  Historico dos envios: data\logs\alerta-email.log
)
echo.
pause
