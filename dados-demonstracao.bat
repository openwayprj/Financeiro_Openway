@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Carregando dados de DEMONSTRACAO...
node --disable-warning=ExperimentalWarning src\seed.js
pause
