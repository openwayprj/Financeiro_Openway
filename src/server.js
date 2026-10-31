'use strict';
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const { db, DESTINO } = require('./db');
const auth = require('./auth');
const cadastros = require('./routes/cadastros');
const lancamentos = require('./routes/lancamentos');
const dashboard = require('./routes/dashboard');
const centros = require('./routes/centros');
const projecao = require('./routes/projecao');
const importacao = require('./routes/importacao');
const importacaoDiaria = require('./routes/importacao-diaria');
const admin = require('./routes/admin');
const rapido = require('./routes/rapido');
const { HttpError } = require('./util');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true); // atrás do Netlify/proxy: IP real e cookie Secure em HTTPS
const jsonPadrao = express.json({ limit: '1mb' });
app.use((req, res, next) => (req.path.startsWith('/api/importacao') ? next() : jsonPadrao(req, res, next)));
app.use(cookieParser());

// Cabeçalhos básicos de segurança
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

// Netlify pode entregar o caminho da função; normaliza para /api/...
app.use((req, res, next) => { req.url = req.url.replace(/^\/\.netlify\/functions\/api/, '') || '/'; next(); });
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

// ---------------- API ----------------
// Garante o schema no banco (consulta rápida; só cria as tabelas se ainda não existirem)
app.use('/api', async (req, res, next) => { await db.ready(); next(); });
app.use('/api/auth', auth.router);
app.use('/api', auth.exigirLogin);
app.use('/api/usuarios', auth.usuarios);
app.use('/api/cadastros', cadastros);
app.use('/api/receber', lancamentos.receber);
app.use('/api/pagar', lancamentos.pagar);
app.use('/api/rapido', rapido);
app.use('/api', dashboard);
app.use('/api', centros);
app.use('/api', projecao);
app.use('/api', importacao.router);
app.use('/api', importacaoDiaria.router);
app.use('/api/admin', admin);
app.use('/api', (req, res, next) => next(new HttpError(404, 'Rota não encontrada.')));

// ---------------- Front-end ----------------
app.use('/vendor/chart.js', express.static(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist')));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

// ---------------- Tratamento de erros ----------------
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  let status = err.status || 500;
  let msg = err.message || 'Erro interno.';
  // Erros do PostgreSQL (códigos SQLSTATE)
  if (err.code === '23503') {
    if (/still referenced/i.test(err.detail || '')) { status = 409; msg = 'Este registro está em uso por outros lançamentos e não pode ser excluído. Considere inativá-lo.'; }
    else { status = 400; msg = 'Referência inválida: o cadastro informado não existe.'; }
  } else if (err.code === '23505') {
    status = 409; msg = 'Já existe um registro com esses dados (duplicidade).';
  } else if (['22P02', '22003', '22007', '22008', '22001', '23502', '23514'].includes(err.code)) {
    status = 400; msg = 'Valor inválido em um dos campos informados.';
  } else if (err.type === 'entity.parse.failed') {
    status = 400; msg = 'JSON inválido.';
  } else if (status === 500) {
    console.error(err);
    msg = 'Erro interno no servidor.';
  }
  res.status(status).json({ erro: msg });
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
if (require.main === module) {
  db.ready().then(() => app.listen(PORT, HOST, () => {
    console.log('==============================================');
    console.log('  OPENWAY FINANCEIRO');
    console.log(`  Acesse: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
    console.log(`  Banco : PostgreSQL (${DESTINO})`);
    console.log('==============================================');
  })).catch((e) => { console.error('\n[ERRO] Não foi possível conectar ao banco de dados:', e.message); process.exit(1); });
}

module.exports = app;
