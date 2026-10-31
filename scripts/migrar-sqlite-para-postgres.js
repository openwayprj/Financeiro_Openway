'use strict';
/**
 * Migra TODOS os dados do banco SQLite antigo (data/financeiro.db) para o PostgreSQL (Neon).
 *
 * Uso (feche o sistema antes):
 *   node --disable-warning=ExperimentalWarning scripts/migrar-sqlite-para-postgres.js [--arquivo caminho.db] [--limpar]
 *
 *  - Lê DATABASE_URL de .env.local (ou da variável de ambiente).
 *  - Cria as tabelas no Postgres (schema.sql) se ainda não existirem.
 *  - Recusa-se a rodar se o Postgres já tiver dados, a menos que use --limpar (apaga e recria os dados).
 *  - Tudo acontece em UMA transação: se algo falhar, nada é gravado.
 *  - No fim compara quantidades e somas (valor_centavos) entre origem e destino.
 *  - Sessões de login não são migradas: todos precisarão entrar de novo.
 */
const path = require('path');
const fs = require('fs');

let DatabaseSync;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (e) {
  console.error('Esta versão do Node.js não tem SQLite embutido (precisa Node 22.13+).'); process.exit(1);
}
const { db, pool, DESTINO } = require('../src/db');
const L = require('./lib-copia');

const args = process.argv.slice(2);
const limparDestino = args.includes('--limpar');
const iArq = args.indexOf('--arquivo');
const arquivo = path.resolve(iArq >= 0 ? args[iArq + 1] : path.join(__dirname, '..', 'data', 'financeiro.db'));

async function main() {
  if (!fs.existsSync(arquivo)) throw new Error(`Banco SQLite não encontrado: ${arquivo}`);
  console.log(`Origem : ${arquivo}`);
  console.log(`Destino: PostgreSQL ${DESTINO}`);

  const origem = new DatabaseSync(arquivo, { readOnly: false });
  const existe = (t) => !!origem.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const ler = (t) => (existe(t) ? origem.prepare(`SELECT * FROM ${t}`).all().map((r) => ({ ...r })) : []);

  await db.aplicarSchema(); // cria/atualiza as tabelas
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    await cli.query('SELECT pg_advisory_xact_lock(727275)');

    const antes = await L.totais(cli);
    const temDados = Object.entries(antes).some(([t, v]) => t !== 'formas_pagamento' && v.n > 0);
    if (temDados && !limparDestino) {
      throw new Error('O PostgreSQL já contém dados. Se deseja substituí-los pelos do SQLite, rode novamente com --limpar.');
    }
    if (limparDestino) { console.log('Limpando dados existentes no PostgreSQL...'); await L.limpar(cli); }
    else await cli.query('DELETE FROM formas_pagamento'); // remove as formas padrão criadas junto com o schema; as do SQLite entram com os mesmos ids

    const origemTotais = {};
    for (const t of L.ORDEM) {
      const linhas = ler(t);
      const colunas = linhas.length ? Object.keys(linhas[0]) : [];
      origemTotais[t] = { n: linhas.length, soma: colunas.includes('valor_centavos') ? linhas.reduce((s, r) => s + Number(r.valor_centavos), 0) : null };
      const gravadas = await L.inserir(cli, t, linhas);
      console.log(`  ${t.padEnd(30)} ${String(gravadas).padStart(6)} registro(s)`);
    }
    await L.acertarSequencias(cli);

    // Conferência
    const depois = await L.totais(cli);
    let ok = true;
    console.log('\nConferência (origem x destino):');
    for (const t of L.ORDEM) {
      const o = origemTotais[t], d = depois[t];
      const igual = o.n === d.n && (o.soma === null || o.soma === d.soma);
      if (!igual) ok = false;
      console.log(`  ${igual ? 'OK ' : 'ERRO'} ${t.padEnd(30)} ${o.n} x ${d.n}${o.soma !== null ? `   soma R$ ${(o.soma / 100).toFixed(2)} x ${(d.soma / 100).toFixed(2)}` : ''}`);
    }
    if (!ok) throw new Error('A conferência encontrou diferenças — nada foi gravado.');

    await cli.query('COMMIT');
    console.log('\nMigração concluída com sucesso. Os dados já estão no PostgreSQL (Neon).');
  } catch (e) {
    try { await cli.query('ROLLBACK'); } catch (_) { /* ignora */ }
    throw e;
  } finally {
    cli.release();
    origem.close();
  }
}

main()
  .then(() => pool.end())
  .catch(async (e) => { console.error('\nERRO:', e.message); try { await pool.end(); } catch (_) { /* ignora */ } process.exit(1); });
