'use strict';
/**
 * CRUD genérico dos cadastros base.
 * Cada entidade declara seus campos e validações; o roteador gera
 * GET (lista com busca), GET /:id, POST, PUT /:id e DELETE /:id.
 */
const express = require('express');
const { db } = require('../db');
const { HttpError, texto, soDigitos, cpfCnpjValido } = require('../util');

const bool = (v) => (v === false || v === 0 || v === '0' || v === 'false' ? 0 : 1);
const enumOf = (lista, rotulo) => (v) => {
  const x = String(v || '').toUpperCase();
  if (!lista.includes(x)) throw new HttpError(400, `${rotulo} inválido(a). Use: ${lista.join(', ')}.`);
  return x;
};
const obrigatorio = (rotulo) => (v) => {
  const t = texto(v);
  if (!t) throw new HttpError(400, `O campo "${rotulo}" é obrigatório.`);
  return t;
};
const documento = (v) => {
  const d = soDigitos(v);
  if (d && !cpfCnpjValido(d)) throw new HttpError(400, 'CPF/CNPJ inválido.');
  return d;
};

const pessoa = {
  campos: {
    nome: obrigatorio('Nome / Razão Social'),
    cpf_cnpj: documento,
    contato: texto,
    email: texto,
    telefone: texto,
    ativo: bool,
  },
  busca: ['nome', 'cpf_cnpj', 'contato', 'email'],
  ordem: 'LOWER(nome)',
};

const ENTIDADES = {
  categorias: {
    tabela: 'categorias',
    campos: {
      nome: obrigatorio('Nome'),
      tipo: enumOf(['RECEITA', 'DESPESA'], 'Tipo'),
      natureza: enumOf(['PESSOAL', 'EMPRESA', 'AMBOS'], 'Natureza'),
      ativo: bool,
    },
    busca: ['nome'],
    filtros: ['tipo', 'natureza', 'ativo'],
    ordem: 'tipo, LOWER(nome), natureza',
    // Impede alterar tipo/natureza de uma categoria de forma incompatível com lançamentos já existentes
    async antesDeAlterar(id, d) {
      const usoTipo = d.tipo === 'RECEITA' ? 'contas_pagar' : 'contas_receber';
      if (await db.prepare(`SELECT 1 FROM ${usoTipo} WHERE categoria_id = ? LIMIT 1`).get(id))
        throw new HttpError(409, `Esta categoria já é usada em ${usoTipo === 'contas_pagar' ? 'Contas a Pagar' : 'Contas a Receber'}; não é possível mudar o tipo.`);
      if (d.natureza !== 'AMBOS') {
        const conflito = (await db.prepare(`SELECT COUNT(*) AS n FROM (
            SELECT tipo_ambiente FROM contas_receber WHERE categoria_id = @id AND tipo_ambiente <> @nat
            UNION ALL SELECT tipo_ambiente FROM contas_pagar WHERE categoria_id = @id AND tipo_ambiente <> @nat) u`).get({ id, nat: d.natureza })).n;
        if (conflito) throw new HttpError(409, `Esta categoria possui ${conflito} lançamento(s) no outro ambiente. Mantenha a natureza "Empresa e Pessoal" ou ajuste esses lançamentos antes.`);
      }
    },
  },
  clientes: { tabela: 'clientes', ...pessoa, filtros: ['ativo'] },
  fornecedores: { tabela: 'fornecedores', ...pessoa, filtros: ['ativo'] },
  colaboradores: {
    tabela: 'colaboradores',
    campos: {
      nome: obrigatorio('Nome'),
      cargo: texto,
      status: enumOf(['ATIVO', 'INATIVO'], 'Status'),
    },
    busca: ['nome', 'cargo'],
    filtros: ['status'],
    ordem: 'LOWER(nome)',
  },
  'centros-custo': {
    tabela: 'centros_custo',
    campos: { codigo: texto, nome: obrigatorio('Nome'), descricao: texto, ativo: bool },
    busca: ['nome', 'codigo', 'descricao'],
    filtros: ['ativo'],
    ordem: "LOWER(COALESCE(NULLIF(codigo, ''), nome)), LOWER(nome)",
  },
  'formas-pagamento': {
    tabela: 'formas_pagamento',
    campos: { nome: obrigatorio('Nome'), ativo: bool },
    busca: ['nome'],
    filtros: ['ativo'],
    ordem: 'LOWER(nome::text)',
  },
  'contas-bancarias': {
    tabela: 'contas_bancarias',
    campos: {
      nome: obrigatorio('Nome'),
      banco: texto,
      agencia: texto,
      conta: texto,
      natureza: enumOf(['PESSOAL', 'EMPRESA'], 'Natureza'),
      ativo: bool,
    },
    busca: ['nome', 'banco'],
    filtros: ['natureza', 'ativo'],
    ordem: 'LOWER(nome)',
  },
};

// Id da rota: inteiro válido (evita erro de conversão no Postgres com ids como "abc")
const idParam = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw new HttpError(404, 'Registro não encontrado.');
  return n;
};

function montar(ent, body) {
  const out = {};
  for (const [campo, fn] of Object.entries(ent.campos)) out[campo] = fn(body[campo]);
  return out;
}

function criarRouter(ent) {
  const r = express.Router();
  const t = ent.tabela;

  r.get('/', async (req, res) => {
    const where = [], p = {};
    if (req.query.q) {
      where.push('(' + ent.busca.map((c) => `${c} LIKE @q`).join(' OR ') + ')');
      p.q = `%${req.query.q}%`;
    }
    for (const f of ent.filtros || []) {
      if (req.query[f] !== undefined && req.query[f] !== '') { where.push(`${f} = @${f}`); p[f] = req.query[f]; }
    }
    const sql = `SELECT * FROM ${t} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${ent.ordem}`;
    res.json(await db.prepare(sql).all(p));
  });

  r.get('/:id', async (req, res) => {
    const row = await db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(idParam(req));
    if (!row) throw new HttpError(404, 'Registro não encontrado.');
    res.json(row);
  });

  r.post('/', async (req, res) => {
    const d = montar(ent, req.body || {});
    const cols = Object.keys(d);
    const info = await db.prepare(`INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(d);
    res.status(201).json(await db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(info.lastInsertRowid));
  });

  r.put('/:id', async (req, res) => {
    const d = montar(ent, req.body || {});
    d.id = idParam(req);
    if (ent.antesDeAlterar) await ent.antesDeAlterar(d.id, d);
    const sets = Object.keys(ent.campos).map((c) => `${c} = @${c}`).join(', ');
    const info = await db.prepare(`UPDATE ${t} SET ${sets} WHERE id = @id`).run(d);
    if (!info.changes) throw new HttpError(404, 'Registro não encontrado.');
    res.json(await db.prepare(`SELECT * FROM ${t} WHERE id = ?`).get(d.id));
  });

  r.delete('/:id', async (req, res) => {
    const info = await db.prepare(`DELETE FROM ${t} WHERE id = ?`).run(idParam(req));
    if (!info.changes) throw new HttpError(404, 'Registro não encontrado.');
    res.json({ ok: true });
  });

  return r;
}

const router = express.Router();
for (const [rota, ent] of Object.entries(ENTIDADES)) router.use('/' + rota, criarRouter(ent));

module.exports = router;
