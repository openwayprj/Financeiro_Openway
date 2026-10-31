'use strict';
/**
 * Rotas analíticas: Dashboard Executivo e Resumo por Colaborador.
 *
 * REGRAS DE CÁLCULO (ver docs/ARQUITETURA.md, seção 4):
 *  - PREVISTO  = títulos com data_vencimento dentro do período (pagos ou não)   -> regime de competência do vencimento
 *  - REALIZADO = títulos com data_pagamento  dentro do período                  -> regime de caixa
 *  - Resultado Previsto  = Receitas Previstas  - Despesas Previstas
 *  - Resultado Realizado = Receitas Realizadas - Despesas Realizadas
 *  - Status (pizza)      = títulos com vencimento no período, classificados em REALIZADO/PENDENTE/ATRASADO em relação a hoje
 *  - Âmbito              = TODAS | PESSOAL | EMPRESA (filtro por tipo_ambiente)
 */
const express = require('express');
const { db } = require('../db');
const { HttpError, hoje, fmtData, filtroPeriodo, inteiroPositivo, sqlStatus } = require('../util');

const router = express.Router();

const filtroAmb = (alias, amb) => (amb === 'TODAS' ? '1=1' : `${alias}.tipo_ambiente = @ambiente`);

/** Gera a lista contínua de "baldes" do período (dia ou mês) para o gráfico temporal */
function baldes(de, ate) {
  const d0 = new Date(de + 'T00:00:00'), d1 = new Date(ate + 'T00:00:00');
  const dias = Math.round((d1 - d0) / 86400000) + 1;
  const granularidade = dias <= 31 ? 'dia' : 'mes';
  const chaves = [];
  if (granularidade === 'dia') {
    for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) chaves.push(fmtData(d));
  } else {
    const d = new Date(d0.getFullYear(), d0.getMonth(), 1);
    while (d <= d1) { chaves.push(fmtData(d).slice(0, 7)); d.setMonth(d.getMonth() + 1); }
  }
  return { granularidade, chaves, len: granularidade === 'dia' ? 10 : 7 };
}

router.get('/dashboard', async (req, res) => {
  const f = filtroPeriodo(req.query);
  const p = { de: f.de, ate: f.ate, ambiente: f.ambiente, hoje: hoje() };
  const fr = filtroAmb('t', f.ambiente);

  // ---------- KPIs ----------
  const kpi = async (tabela) => db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN t.data_vencimento BETWEEN @de AND @ate THEN t.valor_centavos END), 0) AS previsto,
      COALESCE(SUM(CASE WHEN t.data_pagamento  BETWEEN @de AND @ate THEN t.valor_centavos END), 0) AS realizado,
      COALESCE(SUM(CASE WHEN t.data_vencimento BETWEEN @de AND @ate AND t.data_pagamento IS NULL THEN t.valor_centavos END), 0) AS em_aberto,
      COALESCE(SUM(CASE WHEN t.data_vencimento BETWEEN @de AND @ate AND t.data_pagamento IS NULL AND t.data_vencimento < @hoje THEN t.valor_centavos END), 0) AS em_atraso
    FROM ${tabela} t WHERE ${fr}`).get(p);

  const [rec, desp] = await Promise.all([kpi('contas_receber'), kpi('contas_pagar')]);
  const kpis = {
    receitas_previstas: rec.previsto,
    despesas_previstas: desp.previsto,
    receitas_realizadas: rec.realizado,
    despesas_realizadas: desp.realizado,
    resultado_previsto: rec.previsto - desp.previsto,
    resultado_realizado: rec.realizado - desp.realizado,
    receber_em_aberto: rec.em_aberto,
    pagar_em_aberto: desp.em_aberto,
    receber_em_atraso: rec.em_atraso,
    pagar_em_atraso: desp.em_atraso,
  };

  // ---------- Série temporal (Receitas x Despesas, Previsto x Realizado) ----------
  const b = baldes(f.de, f.ate);
  const serieDe = async (tabela, campo) => {
    const rows = await db.prepare(`
      SELECT substr(t.${campo}::text, 1, ${b.len}) AS k, SUM(t.valor_centavos) AS v
        FROM ${tabela} t WHERE t.${campo} BETWEEN @de AND @ate AND ${fr} GROUP BY k`).all(p);
    const m = Object.fromEntries(rows.map((r) => [r.k, r.v]));
    return b.chaves.map((k) => m[k] || 0);
  };
  const [rp, rr, dp, dr] = await Promise.all([
    serieDe('contas_receber', 'data_vencimento'), serieDe('contas_receber', 'data_pagamento'),
    serieDe('contas_pagar', 'data_vencimento'), serieDe('contas_pagar', 'data_pagamento'),
  ]);
  const serie = {
    granularidade: b.granularidade,
    rotulos: b.chaves,
    receitas_previstas: rp,
    receitas_realizadas: rr,
    despesas_previstas: dp,
    despesas_realizadas: dr,
  };

  // ---------- Status dos títulos (vencimento no período) ----------
  const statusDe = async (tabela) => {
    const base = { REALIZADO: { qtd: 0, valor: 0 }, PENDENTE: { qtd: 0, valor: 0 }, ATRASADO: { qtd: 0, valor: 0 } };
    (await db.prepare(`SELECT ${sqlStatus('t')} AS s, COUNT(*) AS qtd, SUM(t.valor_centavos) AS valor
                  FROM ${tabela} t WHERE t.data_vencimento BETWEEN @de AND @ate AND ${fr} GROUP BY 1`)
      .all(p)).forEach((r) => { base[r.s] = { qtd: r.qtd, valor: r.valor }; });
    return base;
  };
  const [stR, stP] = await Promise.all([statusDe('contas_receber'), statusDe('contas_pagar')]);
  const status = { receber: stR, pagar: stP, geral: {} };
  for (const s of ['REALIZADO', 'PENDENTE', 'ATRASADO'])
    status.geral[s] = { qtd: stR[s].qtd + stP[s].qtd, valor: stR[s].valor + stP[s].valor };

  // ---------- Detalhamento por colaborador (view de atribuição com rateio) ----------
  const porColab = async (natureza) => db.prepare(`
    SELECT c.id, c.nome, c.cargo, c.status,
           COALESCE(SUM(CASE WHEN a.data_vencimento BETWEEN @de AND @ate THEN a.valor_centavos END), 0) AS previsto,
           COALESCE(SUM(CASE WHEN a.data_pagamento  BETWEEN @de AND @ate THEN a.valor_centavos END), 0) AS realizado,
           COUNT(DISTINCT CASE WHEN a.data_vencimento BETWEEN @de AND @ate THEN a.nro_documento END) AS qtd_titulos
      FROM v_atribuicao_colaborador a JOIN colaboradores c ON c.id = a.colaborador_id
     WHERE a.natureza_titulo = '${natureza}' AND ${filtroAmb('a', f.ambiente)}
       AND (a.data_vencimento BETWEEN @de AND @ate OR a.data_pagamento BETWEEN @de AND @ate)
     GROUP BY c.id ORDER BY previsto DESC, realizado DESC`).all(p);

  // ---------- Top categorias (bônus: visão DRE simplificada) ----------
  const porCategoria = async (tabela) => db.prepare(`
    SELECT cat.nome, SUM(t.valor_centavos) AS previsto,
           SUM(CASE WHEN t.data_pagamento IS NOT NULL THEN t.valor_centavos ELSE 0 END) AS realizado
      FROM ${tabela} t JOIN categorias cat ON cat.id = t.categoria_id
     WHERE t.data_vencimento BETWEEN @de AND @ate AND ${fr}
     GROUP BY cat.id ORDER BY previsto DESC LIMIT 8`).all(p);

  // ---------- Despesas por Centro de Custo (top 8) ----------
  const porCentro = await db.prepare(`
    SELECT t.centro_custo_id AS id, COALESCE(cc.nome, 'Sem centro de custo') AS nome, SUM(t.valor_centavos) AS previsto,
           SUM(CASE WHEN t.data_pagamento IS NOT NULL THEN t.valor_centavos ELSE 0 END) AS realizado,
           COUNT(*) AS qtd_titulos
      FROM contas_pagar t LEFT JOIN centros_custo cc ON cc.id = t.centro_custo_id
     WHERE t.data_vencimento BETWEEN @de AND @ate AND ${fr}
     GROUP BY t.centro_custo_id, cc.nome ORDER BY previsto DESC LIMIT 8`).all(p);

  // ---------- Próximos vencimentos / atrasados (lista de ação) ----------
  const proximos = await db.prepare(`
    SELECT * FROM (
      SELECT 'RECEBER' AS tipo, t.nro_documento, t.data_vencimento, t.valor_centavos, t.tipo_ambiente, c.nome AS parte_nome, ${sqlStatus('t')} AS status
        FROM contas_receber t JOIN clientes c ON c.id = t.cliente_id WHERE t.data_pagamento IS NULL AND ${fr}
      UNION ALL
      SELECT 'PAGAR', t.nro_documento, t.data_vencimento, t.valor_centavos, t.tipo_ambiente, f.nome, ${sqlStatus('t')}
        FROM contas_pagar t JOIN fornecedores f ON f.id = t.fornecedor_id WHERE t.data_pagamento IS NULL AND ${fr}
    ) x ORDER BY data_vencimento LIMIT 10`).all(p);

  res.json({
    filtros: f,
    hoje: p.hoje,
    kpis,
    serie,
    status,
    colaboradores: { receitas: await porColab('RECEBER'), despesas: await porColab('PAGAR') },
    categorias: { receitas: await porCategoria('contas_receber'), despesas: await porCategoria('contas_pagar') },
    centros_custo: porCentro,
    proximos,
  });
});

/**
 * Resumo por Colaborador: o que cada um trouxe de receita x o que gerou de despesa.
 * Atribuição (view v_atribuicao_colaborador): cada linha de rateio vai para o colaborador informado;
 * o saldo não rateado vai para o colaborador_id do título (responsável).
 */
router.get('/resumo-colaboradores', async (req, res) => {
  const f = filtroPeriodo(req.query);
  const p = { de: f.de, ate: f.ate, ambiente: f.ambiente };
  const incluirInativos = req.query.inativos === '1';
  const rows = (await db.prepare(`
    SELECT c.id, c.nome, c.cargo, c.status,
      COALESCE(SUM(CASE WHEN a.natureza_titulo='RECEBER' AND a.data_vencimento BETWEEN @de AND @ate THEN a.valor_centavos END),0) AS receita_prevista,
      COALESCE(SUM(CASE WHEN a.natureza_titulo='RECEBER' AND a.data_pagamento  BETWEEN @de AND @ate THEN a.valor_centavos END),0) AS receita_realizada,
      COALESCE(SUM(CASE WHEN a.natureza_titulo='PAGAR'   AND a.data_vencimento BETWEEN @de AND @ate THEN a.valor_centavos END),0) AS despesa_prevista,
      COALESCE(SUM(CASE WHEN a.natureza_titulo='PAGAR'   AND a.data_pagamento  BETWEEN @de AND @ate THEN a.valor_centavos END),0) AS despesa_realizada,
      COUNT(DISTINCT CASE WHEN a.natureza_titulo='RECEBER' AND a.data_vencimento BETWEEN @de AND @ate THEN a.nro_documento END) AS qtd_receber,
      COUNT(DISTINCT CASE WHEN a.natureza_titulo='PAGAR'   AND a.data_vencimento BETWEEN @de AND @ate THEN a.nro_documento END) AS qtd_pagar
    FROM colaboradores c
    LEFT JOIN v_atribuicao_colaborador a ON a.colaborador_id = c.id AND ${filtroAmb('a', f.ambiente)}
    ${incluirInativos ? '' : "WHERE c.status = 'ATIVO' OR a.colaborador_id IS NOT NULL"}
    GROUP BY c.id`).all(p)).map((r) => ({
      ...r,
      saldo_previsto: r.receita_prevista - r.despesa_prevista,
      saldo_realizado: r.receita_realizada - r.despesa_realizada,
      // ROI: quanto de receita cada R$ 1 de despesa gerou (null quando não há despesa)
      roi_previsto: r.despesa_prevista ? r.receita_prevista / r.despesa_prevista : null,
    }))
    .filter((r) => incluirInativos || r.status === 'ATIVO' || r.receita_prevista || r.receita_realizada || r.despesa_prevista || r.despesa_realizada)
    .sort((a, b) => b.saldo_previsto - a.saldo_previsto);

  const totais = rows.reduce((t, r) => {
    for (const k of ['receita_prevista', 'receita_realizada', 'despesa_prevista', 'despesa_realizada', 'saldo_previsto', 'saldo_realizado']) t[k] += r[k];
    return t;
  }, { receita_prevista: 0, receita_realizada: 0, despesa_prevista: 0, despesa_realizada: 0, saldo_previsto: 0, saldo_realizado: 0 });

  res.json({ filtros: f, itens: rows, totais });
});

/** Extrato de um colaborador: títulos atribuídos a ele no período (vencimento ou pagamento no período) */
router.get('/resumo-colaboradores/:id', async (req, res) => {
  const f = filtroPeriodo(req.query);
  const id = inteiroPositivo(req.params.id);
  const col = id && id <= 2147483647 && await db.prepare('SELECT * FROM colaboradores WHERE id = ?').get(id);
  if (!col) throw new HttpError(404, 'Colaborador não encontrado.');
  const p = { de: f.de, ate: f.ate, ambiente: f.ambiente, id, hoje: hoje() };
  const itens = await db.prepare(`
    SELECT a.natureza_titulo, a.nro_documento, a.tipo_ambiente, a.data_vencimento, a.data_pagamento,
           a.valor_centavos AS valor_atribuido,
           COALESCE(r.valor_centavos, pg.valor_centavos) AS valor_titulo,
           COALESCE(cl.nome, fo.nome) AS parte_nome,
           cat.nome AS categoria_nome,
           CASE WHEN a.data_pagamento IS NOT NULL THEN 'REALIZADO' WHEN a.data_vencimento < @hoje THEN 'ATRASADO' ELSE 'PENDENTE' END AS status
      FROM v_atribuicao_colaborador a
      LEFT JOIN contas_receber r  ON a.natureza_titulo = 'RECEBER' AND r.nro_documento = a.nro_documento
      LEFT JOIN contas_pagar   pg ON a.natureza_titulo = 'PAGAR'   AND pg.nro_documento = a.nro_documento
      LEFT JOIN clientes cl ON cl.id = r.cliente_id
      LEFT JOIN fornecedores fo ON fo.id = pg.fornecedor_id
      LEFT JOIN categorias cat ON cat.id = COALESCE(r.categoria_id, pg.categoria_id)
     WHERE a.colaborador_id = @id AND ${filtroAmb('a', f.ambiente)}
       AND (a.data_vencimento BETWEEN @de AND @ate OR a.data_pagamento BETWEEN @de AND @ate)
     ORDER BY a.data_vencimento`).all(p);
  res.json({ colaborador: col, itens });
});

module.exports = router;
