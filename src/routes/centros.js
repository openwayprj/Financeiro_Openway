'use strict';
/**
 * Resumo de despesas por Centro de Custo (Contas a Pagar).
 *
 * Regras (mesmas do dashboard):
 *  - PREVISTO  = títulos com data_vencimento no período (pagos ou não)
 *  - REALIZADO = títulos com data_pagamento no período
 *  - EM ABERTO = vencimento no período e sem pagamento; EM ATRASO = em aberto com vencimento < hoje
 *  - Títulos sem centro de custo aparecem como "Sem centro de custo" (id = null)
 *
 * Filtros: de, ate, ambiente (TODAS|PESSOAL|EMPRESA), centro_custo_id ('' = todos | 'SEM' | id)
 */
const express = require('express');
const { db } = require('../db');
const { hoje, fmtData, filtroPeriodo, inteiroPositivo } = require('../util');

const router = express.Router();
const SEM = 'Sem centro de custo';
const TOP_SERIE = 5;

function baldes(de, ate) {
  const d0 = new Date(de + 'T00:00:00'), d1 = new Date(ate + 'T00:00:00');
  const dias = Math.round((d1 - d0) / 86400000) + 1;
  const granularidade = dias <= 31 ? 'dia' : 'mes';
  const chaves = [];
  if (granularidade === 'dia') for (let d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) chaves.push(fmtData(d));
  else { const d = new Date(d0.getFullYear(), d0.getMonth(), 1); while (d <= d1) { chaves.push(fmtData(d).slice(0, 7)); d.setMonth(d.getMonth() + 1); } }
  return { granularidade, chaves, len: granularidade === 'dia' ? 10 : 7 };
}

router.get('/resumo-centros-custo', async (req, res) => {
  const f = filtroPeriodo(req.query);
  const p = { de: f.de, ate: f.ate, ambiente: f.ambiente, hoje: hoje() };
  const where = ['(t.data_vencimento BETWEEN @de AND @ate OR t.data_pagamento BETWEEN @de AND @ate)'];
  if (f.ambiente !== 'TODAS') where.push('t.tipo_ambiente = @ambiente');
  let centro = '';
  if (req.query.centro_custo_id === 'SEM') { where.push('t.centro_custo_id IS NULL'); centro = 'SEM'; }
  else if (inteiroPositivo(req.query.centro_custo_id)) { where.push('t.centro_custo_id = @cc'); p.cc = Number(req.query.centro_custo_id); centro = p.cc; }
  const W = where.join(' AND ');

  const PREV = 'CASE WHEN t.data_vencimento BETWEEN @de AND @ate THEN t.valor_centavos END';
  const REAL = 'CASE WHEN t.data_pagamento BETWEEN @de AND @ate THEN t.valor_centavos END';
  const ABERTO = 'CASE WHEN t.data_vencimento BETWEEN @de AND @ate AND t.data_pagamento IS NULL THEN t.valor_centavos END';
  const ATRASO = 'CASE WHEN t.data_vencimento BETWEEN @de AND @ate AND t.data_pagamento IS NULL AND t.data_vencimento < @hoje THEN t.valor_centavos END';
  const metricas = `COALESCE(SUM(${PREV}),0) AS previsto, COALESCE(SUM(${REAL}),0) AS realizado,
    COALESCE(SUM(${ABERTO}),0) AS em_aberto, COALESCE(SUM(${ATRASO}),0) AS em_atraso,
    COUNT(CASE WHEN t.data_vencimento BETWEEN @de AND @ate THEN 1 END) AS qtd`;

  // KPIs
  const kpis = await db.prepare(`SELECT ${metricas},
      COUNT(DISTINCT CASE WHEN t.data_vencimento BETWEEN @de AND @ate THEN t.centro_custo_id END) AS qtd_centros,
      COALESCE(SUM(CASE WHEN t.data_vencimento BETWEEN @de AND @ate AND t.centro_custo_id IS NULL THEN t.valor_centavos END),0) AS sem_centro
    FROM contas_pagar t WHERE ${W}`).get(p);

  // Por centro de custo
  const porCentro = await db.prepare(`SELECT t.centro_custo_id AS id, cc.codigo, COALESCE(cc.nome, '${SEM}') AS nome, cc.ativo, ${metricas}
      FROM contas_pagar t LEFT JOIN centros_custo cc ON cc.id = t.centro_custo_id
     WHERE ${W} GROUP BY t.centro_custo_id, cc.codigo, cc.nome, cc.ativo ORDER BY previsto DESC, realizado DESC`).all(p);

  // Por categoria (dentro do filtro)
  const porCategoria = await db.prepare(`SELECT cat.id, cat.nome, ${metricas}
      FROM contas_pagar t JOIN categorias cat ON cat.id = t.categoria_id
     WHERE ${W} GROUP BY cat.id ORDER BY previsto DESC LIMIT 10`).all(p);

  // Principais fornecedores (dentro do filtro)
  const porFornecedor = await db.prepare(`SELECT fo.id, fo.nome, ${metricas}
      FROM contas_pagar t JOIN fornecedores fo ON fo.id = t.fornecedor_id
     WHERE ${W} GROUP BY fo.id ORDER BY previsto DESC LIMIT 10`).all(p);

  // Série temporal empilhada: top N centros + "Outros"
  const b = baldes(f.de, f.ate);
  // "Sem centro de custo" é sempre um grupo próprio; os demais: top N + "Outros"
  const topIds = porCentro.filter((c) => c.id !== null && (c.previsto > 0 || c.realizado > 0)).slice(0, TOP_SERIE).map((c) => c.id);
  const chaveGrupo = (id) => (id === null ? 'null' : topIds.includes(id) ? String(id) : 'OUTROS');
  const serieDe = async (campo) => {
    const rows = await db.prepare(`SELECT t.centro_custo_id AS id, substr(t.${campo}::text, 1, ${b.len}) AS k, SUM(t.valor_centavos) AS v
        FROM contas_pagar t WHERE ${W} AND t.${campo} BETWEEN @de AND @ate GROUP BY t.centro_custo_id, 2`).all(p);
    const m = {};
    for (const r of rows) {
      const g = chaveGrupo(r.id);
      m[g] = m[g] || {};
      m[g][r.k] = (m[g][r.k] || 0) + r.v;
    }
    return m;
  };
  const sp = await serieDe('data_vencimento'), sr = await serieDe('data_pagamento');
  const grupos = [...topIds.map((id) => ({ chave: String(id), id, nome: porCentro.find((c) => c.id === id).nome }))];
  if (sp.OUTROS || sr.OUTROS) grupos.push({ chave: 'OUTROS', id: 'OUTROS', nome: 'Outros centros' });
  if (sp.null || sr.null) grupos.push({ chave: 'null', id: null, nome: SEM });
  const serie = {
    granularidade: b.granularidade,
    rotulos: b.chaves,
    grupos: grupos.map((g) => ({
      id: g.id, nome: g.nome,
      previsto: b.chaves.map((k) => (sp[g.chave] || {})[k] || 0),
      realizado: b.chaves.map((k) => (sr[g.chave] || {})[k] || 0),
    })),
  };

  res.json({ filtros: { ...f, centro_custo_id: centro }, kpis, centros: porCentro, categorias: porCategoria, fornecedores: porFornecedor, serie });
});

module.exports = router;
