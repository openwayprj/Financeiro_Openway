'use strict';
/**
 * Projeção de Mês: copia os lançamentos de um mês de origem para um mês de destino,
 * sem data de pagamento (ficam PENDENTES), para não ser preciso relançar tudo.
 *
 *  - Seleção na origem: títulos com data_vencimento dentro do mês de origem
 *  - Datas: emissão e vencimento avançam a mesma quantidade de meses mantendo o dia
 *           (limitado ao último dia do mês: 31/01 -> 28/02)
 *  - Copia: ambiente, cliente/fornecedor, categoria, colaborador, centro de custo, forma de pgto,
 *           conta bancária, observações e o rateio entre colaboradores
 *  - Valor: pode ser ajustado por item; se ficar menor que o rateio, o rateio é reduzido proporcionalmente
 *  - Rastreio: o novo título guarda `projetado_de` = nº do título de origem; o preview avisa
 *              quando o título já foi projetado para o mês de destino (evita duplicidade)
 */
const express = require('express');
const { db } = require('../db');
const { HttpError, addMeses, inteiroPositivo } = require('../util');

const router = express.Router();

const TIPOS = {
  receber: { tabela: 'contas_receber', rateio: 'contas_receber_colaboradores', parte: 'cliente_id', parteTab: 'clientes',
    campos: ['tipo_ambiente', 'cliente_id', 'categoria_id', 'colaborador_id', 'observacoes', 'forma_pagamento_id', 'conta_bancaria_id'] },
  pagar: { tabela: 'contas_pagar', rateio: 'contas_pagar_colaboradores', parte: 'fornecedor_id', parteTab: 'fornecedores',
    campos: ['tipo_ambiente', 'fornecedor_id', 'categoria_id', 'colaborador_id', 'centro_custo_id', 'observacoes', 'forma_pagamento_id', 'conta_bancaria_id'] },
};

const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const limitesMes = (m) => {
  const [y, mm] = m.split('-').map(Number);
  const ultimo = new Date(y, mm, 0).getDate();
  return [`${m}-01`, `${m}-${String(ultimo).padStart(2, '0')}`];
};
const difMeses = (a, b) => {
  const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
};

function parametros(q) {
  const { origem, destino } = q;
  if (!RE_MES.test(origem || '') || !RE_MES.test(destino || '')) throw new HttpError(400, 'Informe o mês de origem e o mês de destino (AAAA-MM).');
  if (origem === destino) throw new HttpError(400, 'O mês de destino deve ser diferente do mês de origem.');
  const tipos = q.tipo === 'receber' || q.tipo === 'pagar' ? [q.tipo] : ['receber', 'pagar'];
  const ambiente = ['PESSOAL', 'EMPRESA'].includes(q.ambiente) ? q.ambiente : null;
  return { origem, destino, tipos, ambiente, n: difMeses(origem, destino) };
}

/** Lista os títulos do mês de origem com as datas projetadas */
router.get('/projecao/preview', async (req, res) => {
  const P = parametros(req.query);
  const [de, ate] = limitesMes(P.origem);
  const [dDe, dAte] = limitesMes(P.destino);
  const itens = [];
  for (const tipo of P.tipos) {
    const T = TIPOS[tipo];
    const rows = await db.prepare(`
      SELECT t.nro_documento, t.data_emissao, t.data_vencimento, t.data_pagamento, t.tipo_ambiente, t.valor_centavos, t.observacoes,
             pt.nome AS parte_nome, pt.ativo AS parte_ativa, cat.nome AS categoria_nome, cat.ativo AS categoria_ativa,
             col.nome AS colaborador_nome,
             ${tipo === 'pagar' ? 'cc.nome AS centro_custo_nome,' : 'NULL AS centro_custo_nome,'}
             (SELECT COUNT(*) FROM ${T.rateio} x WHERE x.nro_documento = t.nro_documento) AS qtd_rateio,
             (SELECT MIN(d.nro_documento) FROM ${T.tabela} d WHERE d.projetado_de = t.nro_documento
                 AND d.data_vencimento BETWEEN @dDe AND @dAte) AS ja_projetado
        FROM ${T.tabela} t
        JOIN ${T.parteTab} pt ON pt.id = t.${T.parte}
        JOIN categorias cat ON cat.id = t.categoria_id
        LEFT JOIN colaboradores col ON col.id = t.colaborador_id
        ${tipo === 'pagar' ? 'LEFT JOIN centros_custo cc ON cc.id = t.centro_custo_id' : ''}
       WHERE t.data_vencimento BETWEEN @de AND @ate ${P.ambiente ? 'AND t.tipo_ambiente = @amb' : ''}
       ORDER BY t.data_vencimento, t.nro_documento`).all({ de, ate, dDe, dAte, amb: P.ambiente });
    for (const r of rows) {
      itens.push({
        tipo, ...r,
        nova_emissao: addMeses(r.data_emissao, P.n),
        novo_vencimento: addMeses(r.data_vencimento, P.n),
        inativos: [!r.parte_ativa && (tipo === 'receber' ? 'cliente' : 'fornecedor'), !r.categoria_ativa && 'categoria'].filter(Boolean),
      });
    }
  }
  res.json({ origem: P.origem, destino: P.destino, meses: P.n, itens });
});

/** Gera os novos títulos. Body: { origem, destino, itens: [{ tipo, nro_documento, valor_centavos? }] } */
router.post('/projecao/executar', async (req, res) => {
  const P = parametros(req.body || {});
  const lista = Array.isArray(req.body.itens) ? req.body.itens : [];
  if (!lista.length) throw new HttpError(400, 'Selecione ao menos um lançamento para projetar.');
  const [de, ate] = limitesMes(P.origem);

  const criados = await db.transaction(async () => {
    const out = [];
    for (const it of lista) {
      const T = TIPOS[it.tipo];
      const nro = inteiroPositivo(it.nro_documento);
      if (!T || !nro) throw new HttpError(400, 'Item inválido na projeção.');
      const o = await db.prepare(`SELECT * FROM ${T.tabela} WHERE nro_documento = ?`).get(nro);
      if (!o) throw new HttpError(404, `Título ${nro} não encontrado.`);
      if (o.data_vencimento < de || o.data_vencimento > ate) throw new HttpError(400, `O título ${nro} não vence no mês de origem.`);

      let valor = it.valor_centavos === undefined || it.valor_centavos === null ? o.valor_centavos : Number(it.valor_centavos);
      if (!Number.isInteger(valor) || valor <= 0) throw new HttpError(400, `Valor inválido para o título ${nro}.`);

      const novo = { data_emissao: addMeses(o.data_emissao, P.n), data_vencimento: addMeses(o.data_vencimento, P.n), valor_centavos: valor };
      for (const c of T.campos) novo[c] = o[c];
      novo.criado_por = req.usuario.id;
      novo.projetado_de = nro;
      const cols = Object.keys(novo);
      const info = await db.prepare(`INSERT INTO ${T.tabela} (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(novo);

      // Rateio: copia; se o novo valor for menor que a soma, reduz proporcionalmente
      const rateio = await db.prepare(`SELECT colaborador_id, valor_centavos FROM ${T.rateio} WHERE nro_documento = ?`).all(nro);
      const soma = rateio.reduce((s, x) => s + x.valor_centavos, 0);
      const fator = soma > valor ? valor / soma : 1;
      const ins = db.prepare(`INSERT INTO ${T.rateio} (nro_documento, colaborador_id, valor_centavos) VALUES (?, ?, ?)`);
      for (const x of rateio) {
        const v = fator === 1 ? x.valor_centavos : Math.floor(x.valor_centavos * fator); // floor garante soma <= valor
        if (v > 0) await ins.run(info.lastInsertRowid, x.colaborador_id, v);
      }
      out.push({ tipo: it.tipo, origem: nro, novo: info.lastInsertRowid, vencimento: novo.data_vencimento, valor_centavos: valor });
    }
    return out;
  })();

  const total = (t) => criados.filter((c) => c.tipo === t);
  res.status(201).json({
    criados,
    resumo: {
      receber: { qtd: total('receber').length, valor: total('receber').reduce((s, c) => s + c.valor_centavos, 0) },
      pagar: { qtd: total('pagar').length, valor: total('pagar').reduce((s, c) => s + c.valor_centavos, 0) },
    },
  });
});

module.exports = router;
