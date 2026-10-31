'use strict';
/**
 * Netlify Scheduled Function: alerta diário por e-mail.
 * Roda a cada 30 minutos (cron em UTC) e envia o resumo do dia na primeira execução depois do horário
 * configurado em Administração > Alertas (horário de Brasília). Não reenvia no mesmo dia.
 */
const { schedule } = require('@netlify/functions');

const executar = async () => {
  require('../../src/tz');
  const { db } = require('../../src/db');
  const alerta = require('../../src/alerta');
  try {
    await db.ready();
    const cfg = await alerta.lerConfig();
    if (!cfg.ativo) return { statusCode: 200, body: 'Alerta desativado.' };
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    if (`${p(d.getHours())}:${p(d.getMinutes())}` < cfg.horario) return { statusCode: 200, body: `Ainda não é ${cfg.horario}.` };
    const r = await alerta.enviarResumo(); // sem "forçar": respeita "já enviado hoje"
    console.log(r.enviado ? `Enviado para ${r.para.join(', ')} — ${r.assunto}` : `Não enviado: ${r.motivo}`);
    return { statusCode: 200, body: r.enviado ? 'Enviado.' : r.motivo };
  } catch (e) {
    console.error('Falha no alerta diário:', e.message);
    return { statusCode: 200, body: 'Erro: ' + e.message };
  }
};

exports.handler = schedule('*/30 * * * *', executar);
