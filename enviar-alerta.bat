@echo off
rem Envia o resumo diario de contas a pagar por e-mail (usado pelo Agendador de Tarefas).
rem Use "enviar-alerta.bat --forcar" para reenviar no mesmo dia.
cd /d "%~dp0"
if not exist "data\logs" mkdir "data\logs"
node --disable-warning=ExperimentalWarning src\alerta-diario.js %* >> "data\logs\alerta-email.log" 2>&1
