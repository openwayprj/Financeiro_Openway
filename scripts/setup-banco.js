'use strict';
/** Cria/atualiza as tabelas no PostgreSQL (idempotente). Uso: npm run db:setup */
const { db, pool, DESTINO } = require('../src/db');

db.aplicarSchema()
  .then(() => { console.log(`Tabelas criadas/atualizadas em ${DESTINO}.`); return pool.end(); })
  .catch(async (e) => { console.error('ERRO:', e.message); try { await pool.end(); } catch (_) { /* ignora */ } process.exit(1); });
