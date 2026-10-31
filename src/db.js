'use strict';
/**
 * Acesso ao banco PostgreSQL (Neon) com o driver `pg`.
 *
 * Mantém a API usada no sistema, agora ASSÍNCRONA:
 *   await db.prepare(sql).get(params)   -> primeira linha (ou undefined)
 *   await db.prepare(sql).all(params)   -> todas as linhas
 *   await db.prepare(sql).run(params)   -> { changes, lastInsertRowid }
 *   await db.exec(sql)                  -> executa SQL sem parâmetros (pode ter vários comandos)
 *   await db.transaction(async () => {...})()   -> BEGIN/COMMIT (ROLLBACK em caso de erro)
 *
 * Parâmetros: posicionais (?) ou nomeados (@nome). Dentro de db.transaction(), todas as
 * chamadas a db.* usam automaticamente a mesma conexão (AsyncLocalStorage).
 *
 * Pequenas conversões automáticas de dialeto: datetime('now'), LIKE (sem diferenciar maiúsculas).
 */
require('./tz');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { Pool, types } = require('pg');

// ---- Carrega variáveis de ambiente de .env.local / .env (sem depender de pacote extra) ----
(function carregarEnv() {
  if (process.env.DATABASE_URL) return;
  const raiz = path.join(__dirname, '..');
  for (const nome of ['.env.local', '.env']) {
    const arq = path.join(raiz, nome);
    if (!fs.existsSync(arq)) continue;
    for (const linha of fs.readFileSync(arq, 'utf8').split(/\r?\n/)) {
      const m = linha.match(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
      if (!m || linha.trim().startsWith('#')) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    }
  }
})();

// ---- Tipos: BIGINT/NUMERIC viram number; DATE e TIMESTAMP continuam texto (YYYY-MM-DD / YYYY-MM-DD HH:MM:SS) ----
types.setTypeParser(20, (v) => Number(v));     // int8 (COUNT, BIGINT)
types.setTypeParser(1700, (v) => Number(v));   // numeric (SUM de BIGINT)
types.setTypeParser(1082, (v) => v);           // date
types.setTypeParser(1114, (v) => v);           // timestamp (sem fuso)

const URL_BANCO = process.env.DATABASE_URL;
if (!URL_BANCO) {
  console.error('\n[ERRO] Variável DATABASE_URL não definida.');
  console.error('       Crie o arquivo .env.local na pasta do sistema com a linha:');
  console.error('       DATABASE_URL="postgresql://usuario:senha@host/banco?sslmode=require"\n');
  throw new Error('DATABASE_URL não definida.');
}

/** Monta a configuração do Pool a partir da URL (ssl obrigatório, exceto para localhost) */
function configPool(url) {
  const u = new URL(url);
  const local = ['localhost', '127.0.0.1', '::1', ''].includes(u.hostname) || u.searchParams.get('host');
  const sslmode = u.searchParams.get('sslmode');
  u.searchParams.delete('sslmode');
  u.searchParams.delete('channel_binding'); // não suportado pelo driver; o TLS já protege a conexão
  const semSsl = local || sslmode === 'disable';
  const emServidor = !!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
  return {
    connectionString: u.toString(),
    ssl: semSsl ? false : { rejectUnauthorized: true },
    max: Number(process.env.DB_POOL_MAX) || (emServidor ? 3 : 8),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 20000, // o Neon pode levar alguns segundos para "acordar"
    allowExitOnIdle: true,
  };
}

const pool = new Pool(configPool(URL_BANCO));
pool.on('error', (e) => console.error('[banco] conexão ociosa encerrada:', e.message));

const contexto = new AsyncLocalStorage(); // guarda o client da transação corrente

// ------------------------------------------------------------------
// Conversão de SQL: ? e @nome -> $1, $2 ...
// ------------------------------------------------------------------
const cacheSql = new Map();
function converter(sql) {
  if (cacheSql.has(sql)) return cacheSql.get(sql);
  let out = '';
  const nomes = [];
  let posicional = 0;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') { // literal / identificador entre aspas
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } break; }
        j++;
      }
      out += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '-' && sql[i + 1] === '-') { // comentário de linha
      const j = sql.indexOf('\n', i); const f = j < 0 ? sql.length : j;
      out += sql.slice(i, f); i = f; continue;
    }
    if (c === '?') { posicional++; nomes.push(posicional - 1); out += '$' + nomes.length; i++; continue; }
    if (c === '@' && /[A-Za-z_]/.test(sql[i + 1] || '')) {
      let j = i + 1;
      while (j < sql.length && /\w/.test(sql[j])) j++;
      const nome = sql.slice(i + 1, j);
      let idx = nomes.indexOf(nome);
      if (idx < 0) { nomes.push(nome); idx = nomes.length - 1; }
      out += '$' + (idx + 1); i = j; continue;
    }
    out += c; i++;
  }
  // Dialeto: datetime('now') -> UTC; LIKE -> ILIKE (SQLite ignorava maiúsculas/minúsculas)
  out = out.replace(/datetime\('now'\)/gi, "(now() AT TIME ZONE 'utc')").replace(/\bLIKE\b/g, 'ILIKE');
  const r = { sql: out, nomes };
  cacheSql.set(sql, r);
  return r;
}

function montarParams(nomes, args) {
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0]) && !(args[0] instanceof Date)) {
    const o = args[0];
    return nomes.map((n) => (o[n] === undefined ? null : o[n]));
  }
  return args.map((v) => (v === undefined ? null : v));
}

async function executar(sql, args) {
  const { sql: q, nomes } = converter(sql);
  const params = montarParams(nomes, args);
  const cli = contexto.getStore();
  return (cli || pool).query(q, params);
}

function prepare(sql) {
  const ehInsert = /^\s*INSERT\b/i.test(sql) && !/\bRETURNING\b/i.test(sql);
  return {
    get: async (...a) => (await executar(sql, a)).rows[0],
    all: async (...a) => (await executar(sql, a)).rows,
    run: async (...a) => {
      const r = await executar(ehInsert ? sql + ' RETURNING *' : sql, a);
      const row = r.rows && r.rows[0];
      const id = row ? (row.id ?? row.nro_documento ?? null) : null;
      return { changes: r.rowCount || 0, lastInsertRowid: id };
    },
  };
}

/** Executa SQL puro (sem parâmetros; admite vários comandos separados por ;) */
async function exec(sql) {
  return (contexto.getStore() || pool).query(sql);
}

/** Envolve fn em BEGIN/COMMIT, com ROLLBACK em caso de erro. Uso: await db.transaction(async () => {...})() */
function transaction(fn) {
  return async (...args) => {
    if (contexto.getStore()) return fn(...args); // já dentro de uma transação
    const cli = await pool.connect();
    try {
      await cli.query('BEGIN');
      const r = await contexto.run(cli, () => fn(...args));
      await cli.query('COMMIT');
      return r;
    } catch (e) {
      try { await cli.query('ROLLBACK'); } catch (_) { /* conexão já perdida */ }
      throw e;
    } finally {
      cli.release();
    }
  };
}

// ------------------------------------------------------------------
// Inicialização do schema (apenas se o banco ainda estiver vazio)
// ------------------------------------------------------------------
const ARQ_SCHEMA = path.join(__dirname, '..', 'database', 'schema.sql');
const FORMAS_PADRAO = ['Pix', 'Boleto', 'Transferência (TED/DOC)', 'Cartão de Crédito', 'Cartão de Débito', 'Dinheiro', 'Débito Automático'];

/** Aplica o schema.sql (idempotente) e cria os dados auxiliares padrão */
async function aplicarSchema() {
  if (!fs.existsSync(ARQ_SCHEMA)) throw new Error('Arquivo database/schema.sql não encontrado. Rode "npm run db:setup" na sua máquina.');
  const sql = fs.readFileSync(ARQ_SCHEMA, 'utf8');
  await transaction(async () => {
    await exec('SELECT pg_advisory_xact_lock(727274)'); // evita corrida entre instâncias
    await exec(sql);
    const n = (await prepare('SELECT COUNT(*) AS n FROM formas_pagamento').get()).n;
    if (n === 0) for (const nome of FORMAS_PADRAO) await prepare('INSERT INTO formas_pagamento (nome) VALUES (?)').run(nome);
  })();
}

let prontoPromise = null;
/** Garante que as tabelas existem (consulta única e barata; só cria se necessário). */
function ready() {
  if (!prontoPromise) {
    prontoPromise = (async () => {
      const r = await pool.query("SELECT to_regclass('public.usuarios') AS t, to_regclass('public.backups') AS b, to_regclass('public.v_atribuicao_colaborador') AS v");
      if (!r.rows[0].t || !r.rows[0].b || !r.rows[0].v) await aplicarSchema();
    })().catch((e) => { prontoPromise = null; throw e; });
  }
  return prontoPromise;
}

const db = { prepare, transaction, exec, ready, aplicarSchema };

/** Descrição do destino (sem expor a senha) para exibir no console */
const DESTINO = (() => { const u = new URL(URL_BANCO); return `${u.hostname}${u.pathname}`; })();

module.exports = { db, pool, DESTINO };
