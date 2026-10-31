'use strict';
/**
 * Envio do resumo diário por e-mail (executado pelo Agendador de Tarefas do Windows via enviar-alerta.bat).
 * No Netlify o envio é feito pela função agendada (netlify/functions/alerta-agendado.js).
 * Uso: node src/alerta-diario.js [--forcar]
 *  - Sem --forcar: não envia de novo se o resumo do dia já foi enviado (evita duplicidade quando o
 *    computador liga depois do horário e a tarefa roda "assim que possível").
 */
const { db, pool } = require('./db');
const { enviarResumo } = require('./alerta');

const agora = () => new Date().toLocaleString('pt-BR');
db.ready().then(() => enviarResumo({ forcar: process.argv.includes('--forcar') }))
  .then(async (r) => {
    await pool.end();
    console.log(`[${agora()}] ${r.enviado ? `Enviado para ${r.para.join(', ')} — ${r.assunto}` : `Não enviado: ${r.motivo}`}`);
    process.exit(0);
  })
  .catch(async (e) => {
    console.error(`[${agora()}] ERRO: ${e.message}`);
    try { await pool.end(); } catch (_) { /* ignora */ }
    process.exit(1);
  });
