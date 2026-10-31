'use strict';
/**
 * Contas a Receber e Contas a Pagar.
 * Mesma lógica, parametrizada pela configuração de cada tipo de título.
 */
const express = require('express');
const { db } = require('../db');
const { HttpError, hoje, isData, texto, inteiroPositivo, sqlStatus } = require('../util');

const CONFIG = {
  receber: {
    tabela: 'contas_receber',
    rateio: 'contas_receber_colaboradores',
    parte: { campo: 'cliente_id', tabela: 'clientes', rotulo: 'Cliente' },
    tipoCategoria: 'RECEITA',
    colaboradorObrigatorio: true,
  },
  pagar: {
    tabela: 'contas_pagar',
    rateio: 'contas_pagar_colaboradores',
    parte: { campo: 'fornecedor_id', tabela: 'fornecedores', rotulo: 'Fornecedor' },
    tipoCategoria: 'DESPESA',
    colaboradorObrigatorio: false,
    centroCusto: true,
  },
};

async function existe(tabela, id) {
  return !!(await db.prepare(`SELECT 1 FROM ${tabela} WHERE id = ?`).get(id));
}

/** Valida e normaliza o payload de um título. Retorna { dados, rateio } */
async function validar(cfg, b) {
  const erros = [];
  const d = {
    data_emissao: b.data_emissao,
    data_vencimento: b.data_vencimento,
    data_pagamento: texto(b.data_pagamento),
    tipo_ambiente: String(b.tipo_ambiente || '').toUpperCase(),
    [cfg.parte.campo]: inteiroPositivo(b[cfg.parte.campo]),
    categoria_id: inteiroPositivo(b.categoria_id),
    colaborador_id: inteiroPositivo(b.colaborador_id),
    valor_centavos: Number(b.valor_centavos),
    observacoes: texto(b.observacoes),
    forma_pagamento_id: inteiroPositivo(b.forma_pagamento_id),
    conta_bancaria_id: inteiroPositivo(b.conta_bancaria_id),
  };

  if (cfg.centroCusto) {
    d.centro_custo_id = inteiroPositivo(b.centro_custo_id);
    if (d.centro_custo_id && !(await existe('centros_custo', d.centro_custo_id))) erros.push('Centro de custo inválido.');
  }

  if (!isData(d.data_emissao)) erros.push('Data de emissão inválida.');
  if (!isData(d.data_vencimento)) erros.push('Data de vencimento inválida.');
  if (d.data_pagamento && !isData(d.data_pagamento)) erros.push('Data de pagamento inválida.');
  if (isData(d.data_emissao) && isData(d.data_vencimento) && d.data_vencimento < d.data_emissao)
    erros.push('O vencimento não pode ser anterior à emissão.');
  if (!['PESSOAL', 'EMPRESA'].includes(d.tipo_ambiente)) erros.push('Selecione o ambiente (Pessoal ou Empresa).');
  if (!Number.isInteger(d.valor_centavos) || d.valor_centavos <= 0) erros.push('Informe um valor maior que zero.');

  const idParte = d[cfg.parte.campo];
  if (!idParte || !(await existe(cfg.parte.tabela, idParte))) erros.push(`${cfg.parte.rotulo} inválido.`);

  const cat = d.categoria_id && await db.prepare('SELECT * FROM categorias WHERE id = ?').get(d.categoria_id);
  if (!cat) erros.push('Categoria inválida.');
  else {
    if (cat.tipo !== cfg.tipoCategoria) erros.push(`A categoria deve ser do tipo ${cfg.tipoCategoria}.`);
    // Princípio da Entidade: a natureza da categoria deve casar com o ambiente do título
    // (categorias com natureza AMBOS servem para os dois ambientes)
    if (d.tipo_ambiente && cat.natureza !== 'AMBOS' && cat.natureza !== d.tipo_ambiente)
      erros.push(`A categoria "${cat.nome}" é de natureza ${cat.natureza}; o lançamento é ${d.tipo_ambiente}.`);
  }

  if (cfg.colaboradorObrigatorio && !d.colaborador_id) erros.push('O colaborador responsável é obrigatório.');
  if (d.colaborador_id && !(await existe('colaboradores', d.colaborador_id))) erros.push('Colaborador inválido.');
  if (d.forma_pagamento_id && !(await existe('formas_pagamento', d.forma_pagamento_id))) erros.push('Forma de pagamento inválida.');
  if (d.conta_bancaria_id && !(await existe('contas_bancarias', d.conta_bancaria_id))) erros.push('Conta bancária inválida.');

  // Rateio opcional por colaborador
  const rateio = [];
  const vistos = new Set();
  for (const item of Array.isArray(b.rateio) ? b.rateio : []) {
    const cid = inteiroPositivo(item.colaborador_id);
    const v = Number(item.valor_centavos);
    if (!cid && !v) continue; // linha em branco
    if (!cid || !(await existe('colaboradores', cid))) { erros.push('Rateio: colaborador inválido.'); continue; }
    if (!Number.isInteger(v) || v <= 0) { erros.push('Rateio: informe valores maiores que zero.'); continue; }
    if (vistos.has(cid)) { erros.push('Rateio: o mesmo colaborador foi informado mais de uma vez.'); continue; }
    vistos.add(cid);
    rateio.push({ colaborador_id: cid, valor_centavos: v });
  }
  const somaRateio = rateio.reduce((s, x) => s + x.valor_centavos, 0);
  if (somaRateio > d.valor_centavos) erros.push('A soma do rateio entre colaboradores não pode ultrapassar o valor do título.');

  if (erros.length) throw new HttpError(400, erros.join('\n'));
  return { dados: d, rateio };
}

async function gravarRateioDe(cfg, nro, rateio) {
  await db.prepare(`DELETE FROM ${cfg.rateio} WHERE nro_documento = ?`).run(nro);
  const ins = db.prepare(`INSERT INTO ${cfg.rateio} (nro_documento, colaborador_id, valor_centavos) VALUES (?, ?, ?)`);
  for (const x of rateio) await ins.run(nro, x.colaborador_id, x.valor_centavos);
}

/** Valida e grava um título (com rateio) em uma transação. Retorna o nº do documento. */
async function inserirTitulo(cfg, body, usuarioId) {
  const { dados, rateio } = await validar(cfg, body);
  return db.transaction(async () => {
    const cols = Object.keys(dados);
    const info = await db.prepare(`INSERT INTO ${cfg.tabela} (${cols.join(',')}, criado_por) VALUES (${cols.map((c) => '@' + c).join(',')}, @criado_por)`)
      .run({ ...dados, criado_por: usuarioId });
    await gravarRateioDe(cfg, info.lastInsertRowid, rateio);
    return info.lastInsertRowid;
  })();
}

function criarRouter(cfg) {
  const r = express.Router();
  const T = cfg.tabela, R = cfg.rateio, P = cfg.parte;

  const SELECT_BASE = `
    SELECT t.*, ${sqlStatus('t')} AS status,
           pt.nome AS parte_nome, cat.nome AS categoria_nome, col.nome AS colaborador_nome,
           fp.nome AS forma_pagamento_nome, cb.nome AS conta_bancaria_nome,
           ${cfg.centroCusto ? "cc.nome AS centro_custo_nome, cc.codigo AS centro_custo_codigo," : ''}
           (SELECT COALESCE(json_agg(json_build_object('colaborador_id', x.colaborador_id, 'colaborador_nome', c2.nome, 'valor_centavos', x.valor_centavos) ORDER BY x.id), '[]'::json)::text
              FROM ${R} x JOIN colaboradores c2 ON c2.id = x.colaborador_id WHERE x.nro_documento = t.nro_documento) AS rateio_json
      FROM ${T} t
      JOIN ${P.tabela} pt ON pt.id = t.${P.campo}
      JOIN categorias cat ON cat.id = t.categoria_id
      LEFT JOIN colaboradores col ON col.id = t.colaborador_id
      LEFT JOIN formas_pagamento fp ON fp.id = t.forma_pagamento_id
      LEFT JOIN contas_bancarias cb ON cb.id = t.conta_bancaria_id
      ${cfg.centroCusto ? 'LEFT JOIN centros_custo cc ON cc.id = t.centro_custo_id' : ''}`;

  const mapear = (row) => {
    const { rateio_json, ...resto } = row;
    return { ...resto, rateio: JSON.parse(rateio_json || '[]') };
  };

  const buscar = async (nro) => {
    const row = Number.isInteger(nro) && nro > 0 && nro <= 2147483647 ? await db.prepare(`${SELECT_BASE} WHERE t.nro_documento = @nro`).get({ nro, hoje: hoje() }) : null;
    if (!row) throw new HttpError(404, 'Título não encontrado.');
    return mapear(row);
  };

  // Listagem com filtros: de, ate, base (vencimento|pagamento|emissao), ambiente, status, q, parte_id (cliente/fornecedor), colaborador_id, categoria_id
  r.get('/', async (req, res) => {
    const q = req.query;
    const where = [], p = { hoje: hoje() };
    const base = { vencimento: 'data_vencimento', pagamento: 'data_pagamento', emissao: 'data_emissao' }[q.base || 'vencimento'];
    if (!base) throw new HttpError(400, 'Base de data inválida.');
    if (isData(q.de)) { where.push(`t.${base} >= @de`); p.de = q.de; }
    if (isData(q.ate)) { where.push(`t.${base} <= @ate`); p.ate = q.ate; }
    if (['PESSOAL', 'EMPRESA'].includes(q.ambiente)) { where.push('t.tipo_ambiente = @amb'); p.amb = q.ambiente; }
    if (['REALIZADO', 'PENDENTE', 'ATRASADO'].includes(q.status)) { where.push(`${sqlStatus('t')} = @status`); p.status = q.status; }
    if (q.status === 'ABERTO') where.push('t.data_pagamento IS NULL');
    if (cfg.centroCusto && q.centro_custo_id === 'SEM') where.push('t.centro_custo_id IS NULL');
    else if (cfg.centroCusto && inteiroPositivo(q.centro_custo_id)) { where.push('t.centro_custo_id = @cc'); p.cc = Number(q.centro_custo_id); }
    if (inteiroPositivo(q.categoria_id)) { where.push('t.categoria_id = @cat'); p.cat = Number(q.categoria_id); }
    if (inteiroPositivo(q.parte_id)) { where.push(`t.${cfg.parte.campo} = @parte`); p.parte = Number(q.parte_id); }
    if (inteiroPositivo(q.colaborador_id)) {
      where.push(`(t.colaborador_id = @col OR EXISTS (SELECT 1 FROM ${R} x WHERE x.nro_documento = t.nro_documento AND x.colaborador_id = @col))`);
      p.col = Number(q.colaborador_id);
    }
    if (q.q) {
      where.push(`(pt.nome LIKE @q OR cat.nome LIKE @q OR t.observacoes LIKE @q${cfg.centroCusto ? ' OR cc.nome LIKE @q' : ''} OR CAST(t.nro_documento AS TEXT) = @qexato)`);
      p.q = `%${q.q}%`; p.qexato = String(q.q).trim();
    }
    const rows = (await db.prepare(`${SELECT_BASE} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                             ORDER BY t.data_vencimento, t.nro_documento`).all(p)).map(mapear);
    const totais = rows.reduce((a, x) => {
      a.total += x.valor_centavos;
      a[x.status.toLowerCase()] += x.valor_centavos;
      return a;
    }, { total: 0, realizado: 0, pendente: 0, atrasado: 0 });
    res.json({ itens: rows, totais });
  });

  r.get('/:nro', async (req, res) => res.json(await buscar(Number(req.params.nro))));

  const gravarRateio = (nro, rateio) => gravarRateioDe(cfg, nro, rateio);

  r.post('/', async (req, res) => {
    const nro = await inserirTitulo(cfg, req.body || {}, req.usuario.id);
    res.status(201).json(await buscar(nro));
  });

  r.put('/:nro', async (req, res) => {
    const nro = Number(req.params.nro);
    await buscar(nro);
    const { dados, rateio } = await validar(cfg, req.body || {});
    await db.transaction(async () => {
      const sets = Object.keys(dados).map((c) => `${c} = @${c}`).join(', ');
      await db.prepare(`UPDATE ${T} SET ${sets}, atualizado_em = datetime('now') WHERE nro_documento = @nro`).run({ ...dados, nro });
      await gravarRateio(nro, rateio);
    })();
    res.json(await buscar(nro));
  });

  // Baixa (liquidação / recebimento)
  r.patch('/:nro/baixa', async (req, res) => {
    const nro = Number(req.params.nro);
    await buscar(nro);
    const data = req.body.data_pagamento || hoje();
    if (!isData(data)) throw new HttpError(400, 'Data de pagamento inválida.');
    const fp = inteiroPositivo(req.body.forma_pagamento_id), cb = inteiroPositivo(req.body.conta_bancaria_id);
    await db.prepare(`UPDATE ${T} SET data_pagamento = @data,
                  forma_pagamento_id = COALESCE(@fp, forma_pagamento_id),
                  conta_bancaria_id = COALESCE(@cb, conta_bancaria_id),
                  atualizado_em = datetime('now') WHERE nro_documento = @nro`).run({ data, fp, cb, nro });
    res.json(await buscar(nro));
  });

  // Estorno da baixa
  r.patch('/:nro/estorno', async (req, res) => {
    const nro = Number(req.params.nro);
    await buscar(nro);
    await db.prepare(`UPDATE ${T} SET data_pagamento = NULL, atualizado_em = datetime('now') WHERE nro_documento = ?`).run(nro);
    res.json(await buscar(nro));
  });

  r.delete('/:nro', async (req, res) => {
    const nro = Number(req.params.nro);
    const info = Number.isInteger(nro) && nro > 0 && nro <= 2147483647 ? await db.prepare(`DELETE FROM ${T} WHERE nro_documento = ?`).run(nro) : { changes: 0 };
    if (!info.changes) throw new HttpError(404, 'Título não encontrado.');
    res.json({ ok: true });
  });

  return r;
}

module.exports = { receber: criarRouter(CONFIG.receber), pagar: criarRouter(CONFIG.pagar), CONFIG, inserirTitulo };
