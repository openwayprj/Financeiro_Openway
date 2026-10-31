'use strict';
/**
 * Importação de Contas a Pagar e Contas a Receber a partir de planilha (.xlsx / .csv).
 *
 * Aba: escolhida pelo usuário; se não informada, a última aba com cabeçalho reconhecido cujo nome
 * combine com o tipo (ex.: "Recebimentos" para Receber, "Pagamentos" para Pagar).
 * O cabeçalho define as colunas. Reconhece, sem diferenciar maiúsculas/acentos:
 * Fornecedor (Pagar) / Cliente (Receber) | Descrição/Histórico/Observação | Tipo/Ambiente (P/E, Pessoal/Empresa)
 * Quando não há coluna Fornecedor/Cliente e existem duas colunas "Descrição", a 1ª é o cliente/fornecedor.
 * | Vencimento | Emissão | Pagamento | Valor | Categoria | Centro de Custo | Colaborador
 * | Forma de Pagamento | Conta Bancária.   Colunas desconhecidas são ignoradas.
 *
 * Em Contas a Receber o colaborador responsável é obrigatório: usa a coluna Colaborador ou o padrão informado.
 * Cadastros inexistentes (fornecedor/cliente, categoria, centro de custo, colaborador, forma de pgto,
 * conta bancária) são criados automaticamente. Nomes parecidos de categoria/centro são unificados
 * (maiúsculas, acentos, plural simples e erros de digitação de 1 letra).
 * A natureza da categoria nova é EMPRESA, PESSOAL ou AMBOS conforme os tipos das linhas.
 */
const express = require('express');
const { db } = require('../db');
const { HttpError, isData, fmtData, texto } = require('../util');
const { lerPlanilha } = require('../planilha');

const router = express.Router();

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const chave = (s) => norm(s).split(' ').map((w) => (w.length > 3 ? w.replace(/(es|s)$/, '') : w)).join(' ');
const nomeLimpo = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const COLUNAS = {
  fornecedor: ['fornecedor', 'credor', 'favorecido'],
  cliente: ['cliente', 'sacado', 'pagador', 'tomador', 'devedor'],
  nome: ['razao social', 'nome'],
  descricao: ['descricao', 'historico', 'observacao', 'observacoes', 'obs', 'detalhe'],
  tipo: ['tipo', 'ambiente', 'natureza', 'ambito'],
  vencimento: ['vencimento', 'data vencimento', 'dt vencimento', 'venc'],
  emissao: ['emissao', 'data emissao', 'dt emissao'],
  pagamento: ['pagamento', 'data pagamento', 'dt pagamento', 'pago em', 'data pagto'],
  valor: ['valor', 'valor r', 'valor rs', 'vlr', 'valor total'],
  categoria: ['categoria', 'plano de conta', 'plano de contas', 'conta'],
  centro: ['centro custo', 'centro de custo', 'cc', 'c custo'],
  colaborador: ['colaborador', 'responsavel', 'funcionario'],
  forma: ['forma pagamento', 'forma de pagamento', 'forma pgto'],
  conta: ['conta bancaria', 'banco pagador', 'conta pagadora'],
};

const TIPO = {
  pagar: { tabela: 'contas_pagar', parteCol: 'fornecedor_id', parteTab: 'fornecedores', tipoCat: 'DESPESA', catPadrao: 'Outras Despesas',
    rotParte: 'fornecedor', abaRe: /pag|despes|saida/ },
  receber: { tabela: 'contas_receber', parteCol: 'cliente_id', parteTab: 'clientes', tipoCat: 'RECEITA', catPadrao: 'Outras Receitas',
    rotParte: 'cliente', abaRe: /receb|receit|entrad/ },
};

function mapearCabecalho(linhas) {
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const mapa = {}, descricoes = [];
    (linhas[i] || []).forEach((h, idx) => {
      const n = norm(h);
      if (!n) return;
      if (COLUNAS.descricao.includes(n)) descricoes.push(idx);
      for (const [campo, nomes] of Object.entries(COLUNAS)) if (mapa[campo] === undefined && nomes.includes(n)) mapa[campo] = idx;
    });
    // Parte (fornecedor/cliente): coluna própria; senão, com 2 colunas "Descrição", a 1ª é a parte e a 2ª a descrição
    const parte = mapa.fornecedor ?? mapa.cliente ?? mapa.nome;
    if (parte !== undefined) mapa.parte = parte;
    else if (descricoes.length >= 2) { mapa.parte = descricoes[0]; mapa.descricao = descricoes[1]; }
    if (mapa.valor !== undefined && (mapa.parte !== undefined || mapa.descricao !== undefined)) return { linhaCab: i, mapa, cab: linhas[i] };
  }
  return null;
}

function data(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { // número de série do Excel
    const d = new Date(Math.round((v - 25569) * 86400000));
    return fmtData(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); const iso = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return isData(iso) ? iso : null; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m && isData(m[0].slice(0, 10)) ? m[0].slice(0, 10) : null;
}
function valor(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100);
  let s = String(v).replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
function ambiente(v) {
  const n = norm(v);
  if (['e', 'emp', 'empresa', 'pj', 'empresarial'].includes(n)) return 'EMPRESA';
  if (['p', 'pes', 'pessoal', 'pf', 'particular'].includes(n)) return 'PESSOAL';
  return null;
}

/** Agrupa nomes parecidos e escolhe o nome canônico (existente no banco > mais frequente) */
function unificar(nomes, existentes, aproximado = true) {
  const grupos = [];
  for (const nome of nomes) {
    const k = chave(nome);
    let g = grupos.find((x) => x.k === k || (aproximado && k.length >= 8 && x.k.length >= 8 && lev(k, x.k) <= 1));
    if (!g) { g = { k, variantes: new Map() }; grupos.push(g); }
    g.variantes.set(nome, (g.variantes.get(nome) || 0) + 1);
  }
  const mapa = new Map(), unificados = [];
  for (const g of grupos) {
    const exist = existentes.find((e) => chave(e.nome) === g.k || (aproximado && g.k.length >= 8 && lev(chave(e.nome), g.k) <= 1));
    const canon = exist ? exist.nome : [...g.variantes.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
    for (const v of g.variantes.keys()) mapa.set(v, canon);
    const outras = [...g.variantes.keys()].filter((v) => v !== canon);
    if (outras.length) unificados.push({ de: outras, para: canon });
  }
  return { mapa, unificados };
}

async function analisar(buf, nomeArq, opcoes = {}) {
  const tipo = opcoes.tipo === 'receber' ? 'receber' : 'pagar';
  const T = TIPO[tipo];
  const abas = lerPlanilha(buf, nomeArq).map((a) => ({ ...a, cabecalho: mapearCabecalho(a.linhas) }));
  const validas = abas.filter((a) => a.cabecalho);
  if (!validas.length) throw new HttpError(400, 'Cabeçalho não reconhecido. A planilha precisa ter ao menos as colunas "Fornecedor"/"Cliente" (ou "Descrição") e "Valor".');
  let aba = opcoes.aba ? validas.find((a) => a.nome === opcoes.aba) : null;
  if (!aba) {
    const pelaNome = validas.filter((a) => T.abaRe.test(norm(a.nome)));
    aba = (pelaNome.length ? pelaNome : validas).slice(-1)[0];
  }
  const { linhas } = aba;
  const { linhaCab, mapa, cab } = aba.cabecalho;
  const pega = (l, c) => (mapa[c] === undefined ? null : l[mapa[c]] ?? null);
  const emissaoModo = opcoes.emissao === 'vencimento' ? 'vencimento' : 'inicio_mes';

  const brutas = [];
  for (let i = linhaCab + 1; i < linhas.length; i++) {
    const l = linhas[i] || [];
    if (!l.some((c) => c !== null && c !== '')) continue;
    const r = {
      linha: i + 1,
      parte: nomeLimpo(pega(l, 'parte')) || nomeLimpo(pega(l, 'descricao')),
      descricao: nomeLimpo(pega(l, 'descricao')) || null,
      tipo_bruto: pega(l, 'tipo'),
      tipo_ambiente: mapa.tipo === undefined ? opcoes.ambientePadrao || 'EMPRESA' : ambiente(pega(l, 'tipo')),
      vencimento: data(pega(l, 'vencimento')),
      emissao: data(pega(l, 'emissao')),
      pagamento: data(pega(l, 'pagamento')),
      valor_centavos: valor(pega(l, 'valor')),
      categoria: nomeLimpo(pega(l, 'categoria')) || T.catPadrao,
      centro: tipo === 'pagar' ? nomeLimpo(pega(l, 'centro')) || null : null,
      colaborador: nomeLimpo(pega(l, 'colaborador')) || nomeLimpo(opcoes.colaboradorPadrao) || null,
      forma: nomeLimpo(pega(l, 'forma')) || null,
      conta: nomeLimpo(pega(l, 'conta')) || null,
    };
    brutas.push(r);
  }

  // Unificação de nomes de categoria e centro de custo
  const catsExist = await db.prepare('SELECT id, nome, natureza FROM categorias WHERE tipo = ?').all(T.tipoCat);
  const ccExist = await db.prepare('SELECT id, nome FROM centros_custo').all();
  const uCat = unificar(brutas.map((r) => r.categoria), catsExist);
  const uCC = unificar(brutas.filter((r) => r.centro).map((r) => r.centro), ccExist);
  for (const r of brutas) {
    r.categoria = uCat.mapa.get(r.categoria);
    if (r.centro) r.centro = uCC.mapa.get(r.centro);
    if (!r.emissao && r.vencimento) r.emissao = emissaoModo === 'vencimento' ? r.vencimento : r.vencimento.slice(0, 8) + '01';
    if (r.emissao && r.vencimento && r.emissao > r.vencimento) r.emissao = r.vencimento;
    r.erros = [];
    if (!r.parte) r.erros.push(`sem ${T.rotParte}`);
    if (tipo === 'receber' && !r.colaborador) r.erros.push('sem colaborador');
    if (!r.tipo_ambiente) r.erros.push(`tipo "${r.tipo_bruto ?? ''}" inválido (use P ou E)`);
    if (!r.vencimento) r.erros.push('sem vencimento');
    if (!r.valor_centavos || r.valor_centavos <= 0) r.erros.push('sem valor');
    delete r.tipo_bruto;
  }

  // Natureza das categorias pelos tipos das linhas
  const natCat = {};
  for (const r of brutas.filter((x) => x.tipo_ambiente)) {
    const s = natCat[r.categoria] || new Set(); s.add(r.tipo_ambiente); natCat[r.categoria] = s;
  }
  const novos = { partes: new Set(), categorias: [], centros: new Set(), colaboradores: new Set() };
  const parteExist = new Set((await db.prepare(`SELECT nome FROM ${T.parteTab}`).all()).map((f) => norm(f.nome)));
  const colExist = new Set((await db.prepare('SELECT nome FROM colaboradores').all()).map((f) => norm(f.nome)));
  for (const r of brutas) {
    if (r.parte && !parteExist.has(norm(r.parte))) novos.partes.add(r.parte);
    if (r.colaborador && !colExist.has(norm(r.colaborador))) novos.colaboradores.add(r.colaborador);
    if (r.centro && !ccExist.some((c) => c.nome === r.centro)) novos.centros.add(r.centro);
  }
  for (const [nome, s] of Object.entries(natCat)) {
    const nat = s.size > 1 ? 'AMBOS' : [...s][0];
    const ex = catsExist.find((c) => c.nome === nome);
    if (!ex) novos.categorias.push({ nome, natureza: nat });
  }

  return {
    tipo,
    arquivo: nomeArq,
    aba: aba.nome,
    abas: abas.map((a) => ({ nome: a.nome, valida: !!a.cabecalho, linhas: a.linhas.filter((l) => l.some((c) => c !== null && c !== '')).length })),
    cabecalho: Object.fromEntries(Object.entries(mapa).map(([k, idx]) => [k, cab[idx]])),
    ignoradas: (cab || []).filter((h, idx) => h && !Object.values(mapa).includes(idx) && !(tipo === 'receber' && idx === mapa.centro)),
    linhas: brutas,
    unificados: { categorias: uCat.unificados, centros: uCC.unificados },
    novos: { partes: [...novos.partes], categorias: novos.categorias, centros: [...novos.centros], colaboradores: [...novos.colaboradores] },
  };
}

// Planilhas podem ser maiores que o limite padrão de JSON
const jsonGrande = express.json({ limit: '15mb' });

router.post('/importacao/:tipo/preview', jsonGrande, async (req, res) => {
  if (!TIPO[req.params.tipo]) throw new HttpError(404, 'Tipo de importação inválido.');
  const { arquivo, nome } = req.body || {};
  if (!arquivo) throw new HttpError(400, 'Envie o arquivo da planilha.');
  let r;
  try { r = await analisar(Buffer.from(arquivo, 'base64'), nome || '', { ...(req.body.opcoes || {}), tipo: req.params.tipo }); } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'Não foi possível ler a planilha: ' + e.message);
  }
  res.json(r);
});

/** Grava as linhas (já revisadas na prévia). Body: { linhas: [...] } */
router.post('/importacao/:tipo/executar', jsonGrande, async (req, res) => {
  const tipo = req.params.tipo;
  if (!TIPO[tipo]) throw new HttpError(404, 'Tipo de importação inválido.');
  const linhas = Array.isArray(req.body?.linhas) ? req.body.linhas : [];
  if (!linhas.length) throw new HttpError(400, 'Nenhuma linha selecionada para importar.');
  for (const [i, r] of linhas.entries()) {
    const ref = `Linha ${r.linha || i + 1}`;
    r.parte = r.parte ?? r.fornecedor;
    if (!texto(r.parte)) throw new HttpError(400, `${ref}: ${TIPO[tipo].rotParte} obrigatório.`);
    if (tipo === 'receber' && !texto(r.colaborador)) throw new HttpError(400, `${ref}: colaborador responsável obrigatório.`);
    if (!['PESSOAL', 'EMPRESA'].includes(r.tipo_ambiente)) throw new HttpError(400, `${ref}: tipo deve ser Pessoal ou Empresa.`);
    if (!isData(r.vencimento)) throw new HttpError(400, `${ref}: vencimento inválido.`);
    if (!Number.isInteger(r.valor_centavos) || r.valor_centavos <= 0) throw new HttpError(400, `${ref}: valor inválido.`);
  }

  res.status(201).json(await gravar(linhas, req.usuario ? req.usuario.id : null, tipo));
});

/** Grava as linhas numa transação única, criando os cadastros que faltarem */
async function gravar(linhas, usuarioId, tipo = 'pagar') {
  return db.transaction(async () => {
    const cont = novoContador(tipo);
    await gravarLinhas(linhas, usuarioId, tipo, cont);
    return cont;
  })();
}

const novoContador = (tipo) => ({ tipo, titulos: 0, valor: 0, partes: 0, categorias: 0, centros: 0, colaboradores: 0, formas: 0, contas: 0 });

/**
 * Insere as linhas (sem abrir transação). Retorna os nº de documento criados, na ordem das linhas.
 * Campos da linha: parte, tipo_ambiente, emissao, vencimento, pagamento, valor_centavos, categoria,
 * centro (pagar), colaborador, forma, conta, descricao (observações).
 */
async function gravarLinhas(linhas, usuarioId, tipo, cont, cache = {}) {
  const T = TIPO[tipo];
  const achar = async (tabela, nome, criar, contador) => {
    const k = `${tabela}|${norm(nome)}`;
    if (cache[k]) return cache[k];
    const lista = await db.prepare(`SELECT id, nome FROM ${tabela}`).all();
    const ex = lista.find((x) => norm(x.nome) === norm(nome));
    if (ex) cache[k] = ex.id;
    else { cont[contador]++; cache[k] = await criar(); }
    return cache[k];
  };
  // Natureza das categorias pelo conjunto de ambientes das linhas
  const natCat = {};
  for (const r of linhas) (natCat[r.categoria] = natCat[r.categoria] || new Set()).add(r.tipo_ambiente);
  const catId = async (nome) => {
    const k = `cat${T.tipoCat}|${norm(nome)}`;
    if (cache[k]) return cache[k];
    const conj = natCat[nome] || new Set(['EMPRESA']);
    const nat = conj.size > 1 ? 'AMBOS' : [...conj][0];
    const ex = (await db.prepare('SELECT id, nome, natureza FROM categorias WHERE tipo = ?').all(T.tipoCat)).find((c) => norm(c.nome) === norm(nome));
    if (ex) {
      if (ex.natureza !== 'AMBOS' && ![...conj].every((a) => a === ex.natureza)) await db.prepare("UPDATE categorias SET natureza = 'AMBOS' WHERE id = ?").run(ex.id);
      return (cache[k] = ex.id);
    }
    cont.categorias++;
    return (cache[k] = (await db.prepare('INSERT INTO categorias (nome, tipo, natureza) VALUES (?, ?, ?)').run(nomeLimpo(nome), T.tipoCat, nat)).lastInsertRowid);
  };
  const ins = db.prepare(`INSERT INTO ${T.tabela} (data_emissao, data_vencimento, data_pagamento, tipo_ambiente, ${T.parteCol}, categoria_id,
      colaborador_id, ${tipo === 'pagar' ? 'centro_custo_id,' : ''} valor_centavos, observacoes, forma_pagamento_id, conta_bancaria_id, criado_por)
    VALUES (@emi, @venc, @pag, @amb, @forn, @cat, @col, ${tipo === 'pagar' ? '@cc,' : ''} @valor, @obs, @fp, @cb, @usr)`);
  const ids = [];
  for (const r of linhas) {
    const venc = r.vencimento;
    const emi = isData(r.emissao) && r.emissao <= venc ? r.emissao : venc.slice(0, 8) + '01';
    const criarSimples = (sql, ...args) => async () => (await db.prepare(sql).run(...args)).lastInsertRowid;
    const forn = await achar(T.parteTab, r.parte, criarSimples(`INSERT INTO ${T.parteTab} (nome) VALUES (?)`, nomeLimpo(r.parte)), 'partes');
    const cat = await catId(texto(r.categoria) || T.catPadrao);
    const col = texto(r.colaborador) ? await achar('colaboradores', r.colaborador, criarSimples('INSERT INTO colaboradores (nome) VALUES (?)', nomeLimpo(r.colaborador)), 'colaboradores') : null;
    const cc = tipo === 'pagar' && texto(r.centro) ? await achar('centros_custo', r.centro, criarSimples('INSERT INTO centros_custo (nome) VALUES (?)', nomeLimpo(r.centro)), 'centros') : null;
    const fp = texto(r.forma) ? await achar('formas_pagamento', r.forma, criarSimples('INSERT INTO formas_pagamento (nome) VALUES (?)', nomeLimpo(r.forma)), 'formas') : null;
    const cb = texto(r.conta) ? await achar('contas_bancarias', r.conta, criarSimples('INSERT INTO contas_bancarias (nome, natureza) VALUES (?, ?)', nomeLimpo(r.conta), r.tipo_ambiente), 'contas') : null;
    const res = await ins.run({
      emi, venc, pag: isData(r.pagamento) ? r.pagamento : null, amb: r.tipo_ambiente,
      forn, cat, col, cc, valor: r.valor_centavos, obs: texto(r.descricao), fp, cb, usr: usuarioId,
    });
    ids.push(Number(res.lastInsertRowid));
    cont.titulos++; cont.valor += r.valor_centavos;
  }
  return ids;
}

module.exports = { router, analisar, gravar, gravarLinhas, novoContador, TIPO, util: { norm, chave, nomeLimpo, lev, unificar, data, valor, ambiente } };
