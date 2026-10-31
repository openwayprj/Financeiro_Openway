'use strict';
/**
 * Lançamento rápido de Contas a Pagar (celular / voz).
 *   GET  /api/rapido/catalogo   -> cadastros ativos + histórico do último lançamento de cada fornecedor
 *   POST /api/rapido/confirmar  -> grava o lançamento (e cria o fornecedor, se for novo)
 * A interpretação da frase falada é feita no navegador (public/js/rapido-parser.js).
 */
const express = require('express');
const { db } = require('../db');
const { HttpError, hoje, isData, texto, inteiroPositivo } = require('../util');
const { CONFIG, inserirTitulo } = require('./lancamentos');

const r = express.Router();

r.get('/catalogo', async (req, res) => {
  const [fornecedores, categorias, centros, formas, contas] = await Promise.all([
    db.prepare(`SELECT f.id, f.nome,
                       CASE WHEN u.categoria_id IS NULL AND u.centro_custo_id IS NULL AND u.forma_pagamento_id IS NULL THEN NULL
                            ELSE json_build_object('categoria_id', u.categoria_id, 'centro_custo_id', u.centro_custo_id,
                                                   'forma_pagamento_id', u.forma_pagamento_id, 'tipo_ambiente', u.tipo_ambiente) END AS ultimo
                  FROM fornecedores f
                  LEFT JOIN LATERAL (SELECT categoria_id, centro_custo_id, forma_pagamento_id, tipo_ambiente
                                       FROM contas_pagar WHERE fornecedor_id = f.id ORDER BY nro_documento DESC LIMIT 1) u ON true
                 WHERE f.ativo = 1 ORDER BY f.nome`).all(),
    db.prepare("SELECT id, nome, natureza FROM categorias WHERE tipo = 'DESPESA' AND ativo = 1 ORDER BY nome").all(),
    db.prepare('SELECT id, codigo, nome FROM centros_custo WHERE ativo = 1 ORDER BY nome').all(),
    db.prepare('SELECT id, nome FROM formas_pagamento WHERE ativo = 1 ORDER BY nome').all(),
    db.prepare('SELECT id, nome, natureza FROM contas_bancarias WHERE ativo = 1 ORDER BY nome').all(),
  ]);
  res.json({ fornecedores, categorias, centros, formas, contas, hoje: hoje() });
});

r.post('/confirmar', async (req, res) => {
  const b = req.body || {};
  const dia = hoje();
  if (!isData(b.data_vencimento)) throw new HttpError(400, 'Informe a data de vencimento.');
  const pago = b.pago === true || b.pago === 'true';
  const dataPgto = pago ? (isData(b.data_pagamento) ? b.data_pagamento : dia) : null;
  const novoNome = texto(b.fornecedor_novo);

  const nro = await db.transaction(async () => {
    let fornecedorId = inteiroPositivo(b.fornecedor_id);
    if (!fornecedorId) {
      if (!novoNome) throw new HttpError(400, 'Informe o fornecedor.');
      if (novoNome.length > 120) throw new HttpError(400, 'Nome do fornecedor muito longo.');
      const ja = await db.prepare('SELECT id FROM fornecedores WHERE lower(nome) = lower(?)').get(novoNome);
      fornecedorId = ja ? ja.id : (await db.prepare('INSERT INTO fornecedores (nome) VALUES (?)').run(novoNome)).lastInsertRowid;
    }
    // A emissão nunca pode ser posterior ao vencimento (lançamentos de datas passadas)
    const emissao = b.data_vencimento < dia ? b.data_vencimento : dia;
    return inserirTitulo(CONFIG.pagar, {
      data_emissao: emissao,
      data_vencimento: b.data_vencimento,
      data_pagamento: dataPgto,
      tipo_ambiente: b.tipo_ambiente,
      fornecedor_id: fornecedorId,
      categoria_id: b.categoria_id,
      centro_custo_id: b.centro_custo_id,
      valor_centavos: b.valor_centavos,
      observacoes: b.observacoes,
      forma_pagamento_id: b.forma_pagamento_id,
      conta_bancaria_id: b.conta_bancaria_id,
    }, req.usuario.id);
  })();

  const t = await db.prepare(`SELECT t.nro_documento, t.data_vencimento, t.data_pagamento, t.valor_centavos, t.tipo_ambiente, f.nome AS fornecedor_nome, c.nome AS categoria_nome
                                FROM contas_pagar t JOIN fornecedores f ON f.id = t.fornecedor_id JOIN categorias c ON c.id = t.categoria_id
                               WHERE t.nro_documento = ?`).get(nro);
  res.status(201).json(t);
});

module.exports = r;
