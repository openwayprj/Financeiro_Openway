'use strict';
/**
 * Restaura um backup baixado pela tela Administração (arquivo .json.gz), SUBSTITUINDO os dados atuais.
 * Uso: node scripts/restaurar-backup.js caminho/backup-AAAAMMDD-HHMMSS.json.gz --confirmar
 * (Alternativa: o Neon permite restaurar o banco a um ponto no tempo pelo painel — Restore.)
 */
const fs = require('fs');
const zlib = require('zlib');
const { db, pool, DESTINO } = require('../src/db');
const L = require('./lib-copia');

const [arq] = process.argv.slice(2);
async function main() {
  if (!arq || !fs.existsSync(arq)) throw new Error('Informe o arquivo de backup (.json.gz).');
  if (!process.argv.includes('--confirmar')) throw new Error(`Isto apaga os dados atuais de ${DESTINO}. Rode novamente com --confirmar.`);
  const dump = JSON.parse(zlib.gunzipSync(fs.readFileSync(arq)).toString());
  if (dump.sistema !== 'openway-financeiro' || !dump.tabelas) throw new Error('Arquivo de backup inválido.');
  await db.aplicarSchema();
  const cli = await pool.connect();
  try {
    await cli.query('BEGIN');
    await L.limpar(cli);
    for (const t of L.ORDEM) console.log(`  ${t.padEnd(30)} ${await L.inserir(cli, t, dump.tabelas[t] || [])} registro(s)`);
    await L.acertarSequencias(cli);
    await cli.query('COMMIT');
    console.log('Backup restaurado com sucesso.');
  } catch (e) { await cli.query('ROLLBACK'); throw e; } finally { cli.release(); }
}
main().then(() => pool.end()).catch(async (e) => { console.error('ERRO:', e.message); try { await pool.end(); } catch (_) { /* ignora */ } process.exit(1); });
