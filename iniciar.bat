@echo off
chcp 65001 >nul
title Openway Financeiro
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERRO] Node.js nao encontrado.
  echo Instale a versao LTS em https://nodejs.org e execute este arquivo novamente.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\.openway-v3" (
  echo Instalando dependencias ^(somente na primeira execucao^)...
  if exist "node_modules" rmdir /s /q "node_modules" 2>nul
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao instalar dependencias.
    echo Feche outros programas que usem esta pasta e tente novamente.
    pause
    exit /b 1
  )
  echo ok> "node_modules\.openway-v3"
)

if not exist ".env.local" if "%DATABASE_URL%"=="" (
  echo.
  echo [ERRO] Arquivo .env.local nao encontrado.
  echo Crie-o com a linha DATABASE_URL="..." ^(string de conexao do Neon^). Veja .env.example
  echo.
  pause
  exit /b 1
)

rem Para liberar acesso pela rede local, descomente a linha abaixo:
rem set HOST=0.0.0.0
if "%PORT%"=="" set PORT=3000

start "" http://localhost:%PORT%
node --disable-warning=ExperimentalWarning src\server.js
pause
