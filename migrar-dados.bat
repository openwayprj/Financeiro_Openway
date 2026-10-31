@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Migrando os dados do SQLite (data\financeiro.db) para o PostgreSQL (Neon)...
echo Feche o sistema antes. Use "migrar-dados.bat --limpar" para refazer a migracao.
echo.
if not exist "node_modules\pg" call npm install --omit=dev --no-audit --no-fund
node --disable-warning=ExperimentalWarning scripts\migrar-sqlite-para-postgres.js %*
pause
