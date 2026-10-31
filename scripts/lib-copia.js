'use strict';
/**
 * Utilitário comum aos scripts de migração/restauração: grava linhas (objetos) nas tabelas do
 * PostgreSQL preservando os ids, e ajusta as sequências (numeração) depois.
 */

// Ordem respeitando as chaves estrangeiras
const ORDEM = ['usuarios', 'configuracoes', 'categorias', 'clientes', 'fornecedores', 'colaboradores', 'formas_pagamento',
  'contas_bancarias', 'centros_custo', 'contas_receber', 'contas_pagar', 'contas_receber_colaboradores',
  'contas_pagar_colaboradores', 'importacao_registros'];

// Coluna de identidade (numeração automática) de cada tabela
const PK_SEQ = {
  usuarios: 'id', categorias: 'id', clientes: 'id', fornecedores: 'id', colaboradores: 'id', formas_pagamento: 'id',
  contas_bancarias: 'id', centros_custo: 'id', contas_receber: 'nro_documento', contas_pagar: 'nro_documento',
  contas_receber_colaboradores: 'id', contas_pagar_colaboradores: 'id',
};

// Colunas que, se vierem do SQLite, precisam de conversão
const COLUNAS_DATA_HORA = new Set(['criado_em', 'atualizado_em', 'importado_em']);

async function colunasDestino(cli, tabela) {
  const r = await cli.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position", [tabela]);
  return r.rows.map((x) => x.column_name);
}

/** Valor do SQLite/JSON -> valor aceito pelo Postgres */
function converter(coluna, v) {
  if (v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (COLUNAS_DATA_HORA.has(coluna) && v === '') return null;
  return v;
}

/** Insere `linhas` (array de objetos) em `tabela`, em lotes. Colunas inexistentes no destino são ignoradas. */
async function inserir(cli, tabela, linhas) {
  if (!linhas.length) return 0;
  const destino = new Set(await colunasDestino(cli, tabela));
  const cols = Object.keys(linhas[0]).filter((c) => destino.has(c));
  const porLote = Math.max(1, Math.floor(30000 / cols.length));
  let n = 0;
  for (let i = 0; i < linhas.length; i += porLote) {
    const lote = linhas.slice(i, i + porLote);
    const params = [];
    const valores = lote.map((l) => `(${cols.map((c) => { params.push(converter(c, l[c])); return '$' + params.length; }).join(',')})`);
    await cli.query(`INSERT INTO ${tabela} (${cols.join(',')}) OVERRIDING SYSTEM VALUE VALUES ${valores.join(',')}`, params);
    n += lote.length;
  }
  return n;
}

/** Ajusta as sequências para continuar depois do maior id existente */
async function acertarSequencias(cli) {
  for (const [tabela, pk] of Object.entries(PK_SEQ)) {
    await cli.query(`SELECT setval(pg_get_serial_sequence('${tabela}', '${pk}'), COALESCE((SELECT MAX(${pk}) FROM ${tabela}), 0) + 1, false)`);
  }
}

/** Apaga o conteúdo das tabelas (ordem inversa das chaves estrangeiras) */
async function limpar(cli) {
  for (const t of [...ORDEM].reverse()) await cli.query(`DELETE FROM ${t}`);
}

/** Totais de conferência por tabela: quantidade e soma de valor_centavos (quando existir) */
async function totais(cli) {
  const out = {};
  for (const t of ORDEM) {
    const cols = await colunasDestino(cli, t);
    const soma = cols.includes('valor_centavos') ? ', COALESCE(SUM(valor_centavos),0)::bigint AS soma' : '';
    const r = await cli.query(`SELECT COUNT(*)::int AS n${soma} FROM ${t}`);
    out[t] = { n: r.rows[0].n, soma: r.rows[0].soma === undefined ? null : Number(r.rows[0].soma) };
  }
  return out;
}

module.exports = { ORDEM, PK_SEQ, inserir, acertarSequencias, limpar, totais };
