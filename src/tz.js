'use strict';
// Todo o sistema trabalha no horário de Brasília (datas de vencimento, "hoje", alertas).
// No Netlify/AWS Lambda o relógio é UTC; fixar o TZ evita que "hoje" vire "amanhã" depois das 21h.
if (!process.env.OW_TZ_FIXED) {
  process.env.TZ = process.env.OW_TZ || 'America/Sao_Paulo';
  process.env.OW_TZ_FIXED = '1';
}
