'use strict';
/**
 * Alerta diário por e-mail: resumo do que vence no dia (e atrasados / próximos dias).
 * Configuração guardada na tabela `configuracoes` (chave 'alerta').
 * Disparo: função agendada do Netlify (netlify/functions/alerta-agendado.js), Agendador de Tarefas do
 * Windows (enviar-alerta.bat) ou botão "Enviar agora" na tela.
 */
const { db } = require('./db');
const { hoje, fmtData } = require('./util');
const { enviarEmail } = require('./email');

const PADRAO = {
  ativo: true,
  destinatarios: 'marcelo.opw@gmail.com',
  horario: '08:00',
  diasAFrente: 3,             // também lista o que vence nos próximos N dias
  incluirAtrasados: true,
  incluirReceber: true,       // inclui o que há para receber
  fimDeSemanaNaSexta: true,   // na sexta, "hoje" inclui sábado e domingo
  enviarSemVencimentos: true, // envia mesmo se nada vencer
  smtp: { host: 'smtp.gmail.com', porta: 465, seguranca: 'ssl', usuario: '', senha: '', remetente: '', remetenteNome: 'Openway Financeiro', ignorarCertificado: false },
};

async function lerConfig() {
  const row = await db.prepare("SELECT valor FROM configuracoes WHERE chave = 'alerta'").get();
  const c = row ? JSON.parse(row.valor) : {};
  return { ...PADRAO, ...c, smtp: { ...PADRAO.smtp, ...(c.smtp || {}) } };
}
async function salvarConfig(c) {
  await db.prepare("INSERT INTO configuracoes (chave, valor) VALUES ('alerta', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor")
    .run(JSON.stringify(c));
}
async function estado() {
  const row = await db.prepare("SELECT valor FROM configuracoes WHERE chave = 'alerta_estado'").get();
  return row ? JSON.parse(row.valor) : {};
}
async function salvarEstado(e) {
  await db.prepare("INSERT INTO configuracoes (chave, valor) VALUES ('alerta_estado', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor")
    .run(JSON.stringify(e));
}

const addDias = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return fmtData(d); };
const brl = (c) => ((c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const br = (iso) => iso.split('-').reverse().join('/');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/** Consulta os títulos em aberto que compõem o resumo */
async function dadosResumo(cfg, dataRef = hoje()) {
  const dow = new Date(dataRef + 'T00:00:00').getDay();
  const fimHoje = cfg.fimDeSemanaNaSexta && dow === 5 ? addDias(dataRef, 2) : dataRef;
  const fimProx = addDias(fimHoje, Number(cfg.diasAFrente) || 0);
  const busca = async (tipo, cond, p) => {
    const T = tipo === 'pagar'
      ? { tab: 'contas_pagar', parte: 'fornecedores', col: 'fornecedor_id', cc: 'LEFT JOIN centros_custo cc ON cc.id = t.centro_custo_id', ccn: 'cc.nome' }
      : { tab: 'contas_receber', parte: 'clientes', col: 'cliente_id', cc: '', ccn: 'NULL' };
    return db.prepare(`SELECT t.nro_documento, t.data_vencimento, t.valor_centavos, t.tipo_ambiente, t.observacoes,
        pt.nome AS parte, cat.nome AS categoria, ${T.ccn} AS centro
      FROM ${T.tab} t JOIN ${T.parte} pt ON pt.id = t.${T.col} JOIN categorias cat ON cat.id = t.categoria_id ${T.cc}
      WHERE t.data_pagamento IS NULL AND ${cond} ORDER BY t.data_vencimento, t.valor_centavos DESC`).all(p);
  };
  const r = { dataRef, fimHoje, fimProx, pagar: {}, receber: {} };
  for (const tipo of ['pagar', ...(cfg.incluirReceber ? ['receber'] : [])]) {
    r[tipo].hoje = await busca(tipo, 't.data_vencimento BETWEEN @a AND @b', { a: dataRef, b: fimHoje });
    r[tipo].atrasados = cfg.incluirAtrasados ? await busca(tipo, 't.data_vencimento < @a', { a: dataRef }) : [];
    r[tipo].proximos = fimProx > fimHoje ? await busca(tipo, 't.data_vencimento > @a AND t.data_vencimento <= @b', { a: fimHoje, b: fimProx }) : [];
  }
  return r;
}

const soma = (l) => l.reduce((s, x) => s + x.valor_centavos, 0);

/** Monta assunto, HTML e texto do e-mail */
async function montarResumo(cfg, dataRef) {
  const d = await dadosResumo(cfg, dataRef);
  const P = d.pagar, R = d.receber;
  const dow = DIAS[new Date(d.dataRef + 'T00:00:00').getDay()];
  const periodoHoje = d.fimHoje > d.dataRef ? `${br(d.dataRef)} a ${br(d.fimHoje)} (inclui o fim de semana)` : br(d.dataRef);
  const qtdHoje = P.hoje.length;
  const assunto = qtdHoje
    ? `Openway Financeiro · ${br(d.dataRef)} · ${qtdHoje} conta(s) a pagar hoje (${brl(soma(P.hoje))})`
    : `Openway Financeiro · ${br(d.dataRef)} · nenhuma conta a pagar hoje`;

  const COR = { pagar: '#d03b3b', receber: '#199e70', atraso: '#b7791f', borda: '#e3e8f0', cinza: '#6b7688' };
  const tabela = (lista, tipo, mostrarData) => !lista.length ? '' : `
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:13px;margin:6px 0 4px">
      <tr style="background:#f4f6fa;color:${COR.cinza};text-align:left">
        ${mostrarData ? '<th style="padding:6px 8px">Venc.</th>' : ''}<th style="padding:6px 8px">${tipo === 'pagar' ? 'Fornecedor' : 'Cliente'}</th>
        <th style="padding:6px 8px">Categoria${tipo === 'pagar' ? ' / C. Custo' : ''}</th><th style="padding:6px 8px">Âmbito</th><th style="padding:6px 8px;text-align:right">Valor</th></tr>
      ${lista.map((x) => `<tr style="border-top:1px solid ${COR.borda}">
        ${mostrarData ? `<td style="padding:6px 8px;white-space:nowrap">${br(x.data_vencimento)}</td>` : ''}
        <td style="padding:6px 8px"><b>${esc(x.parte)}</b>${x.observacoes && x.observacoes !== x.parte ? `<br><span style="color:${COR.cinza}">${esc(x.observacoes)}</span>` : ''}</td>
        <td style="padding:6px 8px">${esc(x.categoria)}${x.centro ? `<br><span style="color:${COR.cinza}">${esc(x.centro)}</span>` : ''}</td>
        <td style="padding:6px 8px">${x.tipo_ambiente === 'EMPRESA' ? 'Empresa' : 'Pessoal'}</td>
        <td style="padding:6px 8px;text-align:right;white-space:nowrap"><b>${brl(x.valor_centavos)}</b></td></tr>`).join('')}
      <tr style="border-top:2px solid ${COR.borda}"><td colspan="${mostrarData ? 4 : 3}" style="padding:6px 8px;text-align:right;color:${COR.cinza}">Total (${lista.length})</td>
        <td style="padding:6px 8px;text-align:right"><b>${brl(soma(lista))}</b></td></tr>
    </table>`;
  const secao = (titulo, cor, lista, tipo, mostrarData, vazio) => `
    <h3 style="margin:22px 0 4px;font-size:15px;color:${cor}">${titulo}</h3>
    ${lista.length ? tabela(lista, tipo, mostrarData) : `<p style="margin:4px 0;color:${COR.cinza}">${vazio}</p>`}`;
  const card = (rot, val, cor) => `<td style="padding:10px 12px;border:1px solid ${COR.borda};border-radius:8px;background:#fff">
      <div style="font-size:11px;color:${COR.cinza};text-transform:uppercase;letter-spacing:.05em">${rot}</div>
      <div style="font-size:18px;font-weight:bold;color:${cor};margin-top:2px">${val}</div></td>`;

  const html = `<!doctype html><html><body style="margin:0;background:#eef1f6;font-family:Segoe UI,Arial,sans-serif;color:#1c2433">
  <div style="max-width:760px;margin:0 auto;padding:20px">
    <div style="background:#0d1422;color:#fff;padding:16px 20px;border-radius:10px 10px 0 0">
      <div style="font-size:18px;font-weight:bold">Openway Financeiro</div>
      <div style="font-size:13px;color:#b7c2d6">Resumo diário · ${dow}, ${br(d.dataRef)}</div>
    </div>
    <div style="background:#fff;padding:18px 20px;border-radius:0 0 10px 10px">
      <table cellpadding="0" cellspacing="8" style="width:100%;border-collapse:separate"><tr>
        ${card('A pagar hoje', brl(soma(P.hoje)), COR.pagar)}
        ${cfg.incluirAtrasados ? card('Pagar em atraso', brl(soma(P.atrasados)), COR.atraso) : ''}
        ${cfg.incluirReceber ? card('A receber hoje', brl(soma(R.hoje)), COR.receber) : ''}
      </tr></table>
      ${secao(`Contas a pagar · vencimento ${periodoHoje}`, COR.pagar, P.hoje, 'pagar', d.fimHoje > d.dataRef, 'Nenhuma conta a pagar vence hoje.')}
      ${cfg.incluirAtrasados ? secao('Contas a pagar em atraso', COR.atraso, P.atrasados, 'pagar', true, 'Nenhuma conta a pagar em atraso.') : ''}
      ${d.fimProx > d.fimHoje ? secao(`Próximos vencimentos a pagar (até ${br(d.fimProx)})`, '#3987e5', P.proximos, 'pagar', true, 'Nada vence nos próximos dias.') : ''}
      ${cfg.incluirReceber ? secao(`Contas a receber · vencimento ${periodoHoje}`, COR.receber, R.hoje, 'receber', d.fimHoje > d.dataRef, 'Nenhum recebimento previsto para hoje.')
        + (cfg.incluirAtrasados && R.atrasados.length ? secao('Recebimentos em atraso', COR.atraso, R.atrasados, 'receber', true, '') : '') : ''}
      <p style="margin:24px 0 0;font-size:12px;color:${COR.cinza}">E-mail automático do sistema Openway Financeiro. Os valores consideram apenas títulos sem data de pagamento.</p>
    </div>
  </div></body></html>`;

  const linhas = (l, data) => l.map((x) => `  - ${data ? br(x.data_vencimento) + ' ' : ''}${x.parte}${x.observacoes && x.observacoes !== x.parte ? ' (' + x.observacoes + ')' : ''}: ${brl(x.valor_centavos)}`).join('\n');
  const texto = [
    `OPENWAY FINANCEIRO - Resumo de ${dow}, ${br(d.dataRef)}`, '',
    `A PAGAR (${periodoHoje}): ${P.hoje.length} título(s), ${brl(soma(P.hoje))}`, linhas(P.hoje, d.fimHoje > d.dataRef),
    ...(cfg.incluirAtrasados ? ['', `EM ATRASO: ${P.atrasados.length} título(s), ${brl(soma(P.atrasados))}`, linhas(P.atrasados, true)] : []),
    ...(d.fimProx > d.fimHoje ? ['', `PRÓXIMOS (até ${br(d.fimProx)}): ${P.proximos.length} título(s), ${brl(soma(P.proximos))}`, linhas(P.proximos, true)] : []),
    ...(cfg.incluirReceber ? ['', `A RECEBER HOJE: ${R.hoje.length} título(s), ${brl(soma(R.hoje))}`, linhas(R.hoje, false)] : []),
  ].join('\n');

  return { assunto, html, texto, dados: d, vazio: !P.hoje.length && !P.atrasados.length && !(R.hoje || []).length };
}

/**
 * Envia o resumo.  opcoes.forcar = ignora "já enviado hoje" e "desativado".
 * Retorna { enviado, motivo?, para, assunto }
 */
async function enviarResumo(opcoes = {}) {
  const cfg = await lerConfig();
  const hojeIso = hoje();
  const st = await estado();
  if (!opcoes.forcar) {
    if (!cfg.ativo) return { enviado: false, motivo: 'Alerta desativado nas configurações.' };
    if (st.ultimoEnvio === hojeIso) return { enviado: false, motivo: `Resumo de ${br(hojeIso)} já foi enviado.` };
  }
  const para = String(cfg.destinatarios || '').split(/[;,\s]+/).map((s) => s.trim()).filter((s) => /@/.test(s));
  if (!para.length) throw new Error('Nenhum destinatário configurado.');
  if (!cfg.smtp.host || !cfg.smtp.usuario || !cfg.smtp.senha) throw new Error('Configure o servidor de e-mail (SMTP): servidor, usuário e senha de app.');
  const r = await montarResumo(cfg, hojeIso);
  if (r.vazio && !cfg.enviarSemVencimentos && !opcoes.forcar) {
    await salvarEstado({ ...st, ultimaVerificacao: new Date().toISOString(), ultimoResultado: 'Nada a pagar/receber hoje — e-mail não enviado.' });
    return { enviado: false, motivo: 'Nada vence hoje (envio sem vencimentos desativado).' };
  }
  try {
    await enviarEmail(cfg.smtp, { de: cfg.smtp.remetente || cfg.smtp.usuario, deNome: cfg.smtp.remetenteNome, para, assunto: r.assunto, html: r.html, texto: r.texto });
    await salvarEstado({ ultimoEnvio: hojeIso, ultimaVerificacao: new Date().toISOString(), ultimoResultado: `Enviado para ${para.join(', ')}: ${r.assunto}` });
    return { enviado: true, para, assunto: r.assunto };
  } catch (e) {
    await salvarEstado({ ...st, ultimaVerificacao: new Date().toISOString(), ultimoResultado: 'ERRO: ' + e.message });
    throw e;
  }
}

module.exports = { lerConfig, salvarConfig, estado, montarResumo, enviarResumo, PADRAO };
