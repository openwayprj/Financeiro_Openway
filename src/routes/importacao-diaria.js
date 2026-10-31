'use strict';
/**
 * Importação Diária — lê a planilha padrão (Google Sheets pelo link compartilhado, ou arquivo .xlsx/.csv)
 * e lança Contas a Pagar e a Receber de uma data (ou intervalo) escolhida.
 *
 * Planilha padrão (aba "Lançamentos"; o cabeçalho define as colunas, a ordem não importa):
 *   Data Emissão | Movimento (Pagar/Receber) | Pessoal/Empresa | Cliente/Fornecedor | Data Vencimento | Data Pagamento
 *   | Valor | Categoria | Centro de Custo | Forma de Pagamento | Colaborador | Observação | ID
 *
 * Duplicidade: cada linha importada é registrada em importacao_registros pela chave
 *   "id:<ID>" (quando a coluna ID está preenchida) ou "h:<hash dos campos>#<ocorrência>".
 *   Ao importar de novo a mesma data, as linhas já lançadas são ignoradas; se a linha ganhou
 *   Data de Pagamento na planilha e o título ainda está em aberto, a importação registra a baixa.
 *
 * Rotas (/api/importacao-diaria):
 *   GET  /config            PUT /config
 *   GET  /modelo            -> .xlsx modelo com abas de cadastros
 *   POST /preview  { origem: 'link'|'arquivo', url?, arquivo?(base64), nome?, de, ate, base, ambientePadrao, colaboradorPadrao, aba? }
 *   POST /executar { linhas: [...] }
 */
const crypto = require('crypto');
const express = require('express');
const { db } = require('../db');
const { HttpError, isData, hoje, texto } = require('../util');
const { lerPlanilha } = require('../planilha');
const { gerarXlsx } = require('../xlsx');
const { baixar } = require('../rede');
const imp = require('./importacao');

const { norm, nomeLimpo, unificar, data, valor, ambiente } = imp.util;
const router = express.Router();
const jsonGrande = express.json({ limit: '25mb' });

/* ------------------------------ Configuração ------------------------------ */
const CFG_PADRAO = { url: '', base: 'emissao', ambientePadrao: 'EMPRESA', colaboradorPadrao: '', ignorarCertificado: false, ultima: null };
async function lerConfig() {
  const r = await db.prepare("SELECT valor FROM configuracoes WHERE chave = 'importacao_diaria'").get();
  let c = {};
  try { c = r ? JSON.parse(r.valor) : {}; } catch (_) { c = {}; }
  return { ...CFG_PADRAO, ...c };
}
async function salvarConfig(c) {
  const v = JSON.stringify({ ...(await lerConfig()), ...c });
  await db.prepare("INSERT INTO configuracoes (chave, valor) VALUES ('importacao_diaria', ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor").run(v);
  return lerConfig();
}
function limparConfig(b = {}) {
  const c = {};
  if (b.url !== undefined) {
    const u = String(b.url || '').trim();
    if (u && !/^https:\/\//i.test(u)) throw new HttpError(400, 'O link deve começar com https://');
    c.url = u.slice(0, 1000);
  }
  if (b.base !== undefined) c.base = ['emissao', 'vencimento', 'pagamento', 'todas'].includes(b.base) ? b.base : 'emissao';
  if (b.ambientePadrao !== undefined) c.ambientePadrao = ['EMPRESA', 'PESSOAL'].includes(b.ambientePadrao) ? b.ambientePadrao : 'EMPRESA';
  if (b.colaboradorPadrao !== undefined) c.colaboradorPadrao = nomeLimpo(b.colaboradorPadrao).slice(0, 120);
  if (b.ignorarCertificado !== undefined) c.ignorarCertificado = !!b.ignorarCertificado;
  return c;
}

router.get('/importacao-diaria/config', async (req, res) => res.json(await lerConfig()));
router.put('/importacao-diaria/config', jsonGrande, async (req, res) => res.json(await salvarConfig(limparConfig(req.body || {}))));

/* ------------------------------ Google Sheets ------------------------------ */
/** Converte o link de compartilhamento do Google Sheets no link de exportação .xlsx */
function urlExportacao(link) {
  const s = String(link || '').trim();
  let m = s.match(/docs\.google\.com\/spreadsheets\/d\/e\/([\w-]+)/);
  if (m) return `https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?output=xlsx`;
  m = s.match(/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([\w-]+)/);
  if (m) return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`;
  if (/^https:\/\//i.test(s)) return s;
  throw new HttpError(400, 'Link inválido. Cole o link da planilha do Google Sheets (https://docs.google.com/spreadsheets/d/...).');
}

const MSG_COMPARTILHAR = 'Não consegui ler a planilha pelo link. No Google Sheets clique em Compartilhar → Acesso geral → "Qualquer pessoa com o link" (Leitor) e tente de novo.';

async function baixarPlanilha(link, ignorarCertificado) {
  const url = urlExportacao(link);
  let r;
  try { r = await baixar(url, { ignorarCertificado }); } catch (e) {
    throw new HttpError(502, 'Falha ao acessar o Google Sheets: ' + e.message);
  }
  const ehZip = r.corpo.length > 4 && r.corpo.readUInt32LE(0) === 0x04034b50;
  if (r.status === 404) throw new HttpError(400, 'Planilha não encontrada. Confira o link.');
  if (r.status >= 400 || (!ehZip && /html/i.test(r.tipo))) throw new HttpError(400, MSG_COMPARTILHAR);
  return { buf: r.corpo, nome: ehZip ? 'google-sheets.xlsx' : 'google-sheets.csv' };
}

/* ------------------------------ Leitura ------------------------------ */
const COL = {
  movimento: ['movimento', 'operacao', 'pagar receber', 'receber pagar', 'pagar ou receber', 'receber ou pagar', 'entrada saida', 'tipo lancamento',
    'tipo movimento', 'lancamento', 'receita despesa', 'despesa receita', 'receita ou despesa', 'despesa ou receita', 'tipo conta'],
  ambiente: ['pessoal empresa', 'empresa pessoal', 'pessoal ou empresa', 'empresa ou pessoal', 'ambiente', 'tipo', 'ambito', 'pf pj', 'natureza'],
  parte: ['cliente fornecedor', 'fornecedor cliente', 'cliente ou fornecedor', 'fornecedor ou cliente', 'favorecido', 'fornecedor', 'cliente',
    'nome', 'razao social', 'credor', 'pagador'],
  emissao: ['data emissao', 'emissao', 'dt emissao', 'data lancamento', 'data registro', 'data'],
  vencimento: ['data vencimento', 'vencimento', 'dt vencimento', 'venc'],
  pagamento: ['data pagamento', 'pagamento', 'dt pagamento', 'pago em', 'data pagto', 'data recebimento', 'recebimento', 'data baixa', 'data pagamento recebimento'],
  valor: ['valor', 'valor r', 'valor rs', 'vlr', 'valor total'],
  categoria: ['categoria', 'plano de contas', 'plano de conta'],
  centro: ['centro de custo', 'centro custo', 'cc', 'c custo'],
  forma: ['forma de pagamento', 'forma pagamento', 'forma pgto', 'forma', 'meio de pagamento'],
  colaborador: ['colaborador', 'responsavel', 'funcionario'],
  observacao: ['observacao', 'observacoes', 'obs', 'descricao', 'historico', 'detalhe'],
  conta: ['conta bancaria', 'banco'],
  id: ['id', 'codigo', 'cod', 'identificador', 'id lancamento'],
};

function mapear(linhas) {
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const mapa = {};
    (linhas[i] || []).forEach((h, idx) => {
      const n = norm(h);
      if (!n) return;
      for (const [campo, nomes] of Object.entries(COL)) {
        if (nomes.includes(n)) { (mapa[campo] = mapa[campo] || []).push(idx); break; }
      }
    });
    if (mapa.valor && (mapa.parte || mapa.movimento)) return { linhaCab: i, mapa, cab: linhas[i] };
  }
  return null;
}

function movimento(v) {
  const n = norm(v);
  if (!n) return null;
  if (/^(a )?pagar$|^contas? a pagar$|^pag$|^despesas?$|^saidas?$|^debito$|^pagamento$|^cp$/.test(n)) return 'pagar';
  if (/^(a )?receber$|^contas? a receber$|^rec$|^receitas?$|^entradas?$|^credito$|^recebimento$|^cr$/.test(n)) return 'receber';
  return undefined; // preenchido mas não reconhecido
}

const rotParte = (t) => (t === 'receber' ? 'cliente' : 'fornecedor');
const TAB = { pagar: { tabela: 'contas_pagar', parteCol: 'fornecedor_id', parteTab: 'fornecedores' }, receber: { tabela: 'contas_receber', parteCol: 'cliente_id', parteTab: 'clientes' } };

function hash(campos) { return crypto.createHash('sha1').update(campos.join('|')).digest('hex').slice(0, 20); }

/** Data de referência da linha para o filtro */
function dataRef(r, base) {
  if (base === 'vencimento') return r.vencimento;
  if (base === 'pagamento') return r.pagamento;
  return r.emissao || r.pagamento || r.vencimento; // emissão (se vazia, pagamento; depois vencimento)
}

async function analisar(buf, nomeArq, op = {}) {
  const abas = lerPlanilha(buf, nomeArq).map((a) => ({ ...a, cab: mapear(a.linhas) }));
  const validas = abas.filter((a) => a.cab);
  if (!validas.length) {
    throw new HttpError(400, 'Não encontrei a aba de lançamentos. A planilha precisa de um cabeçalho com pelo menos "Valor" e "Cliente/Fornecedor" (use o botão "Gerar planilha modelo").');
  }
  let aba = op.aba ? validas.find((a) => a.nome === op.aba) : null;
  if (!aba) aba = validas.find((a) => /lancamento/.test(norm(a.nome))) || validas[0];
  const { linhaCab, mapa, cab } = aba.cab;
  const pega = (l, c) => {
    for (const idx of mapa[c] || []) { const v = l[idx]; if (v !== null && v !== undefined && String(v).trim() !== '') return v; }
    return null;
  };
  const obs = (l) => (mapa.observacao || []).map((i) => nomeLimpo(l[i])).filter(Boolean).join(' — ') || null;

  const base = ['emissao', 'vencimento', 'pagamento', 'todas'].includes(op.base) ? op.base : 'emissao';
  const de = isData(op.de) ? op.de : null;
  const ate = isData(op.ate) ? op.ate : de;
  if (base !== 'todas' && !de) throw new HttpError(400, 'Informe a data a importar.');
  const hj = hoje();

  // Cadastros existentes
  const catsTodas = await db.prepare('SELECT id, nome, tipo, natureza FROM categorias').all();
  const forn = await db.prepare('SELECT id, nome FROM fornecedores').all();
  const clis = await db.prepare('SELECT id, nome FROM clientes').all();
  const ccs = await db.prepare('SELECT id, nome FROM centros_custo').all();
  const formas = await db.prepare('SELECT id, nome FROM formas_pagamento').all();
  const colabs = await db.prepare('SELECT id, nome FROM colaboradores').all();
  const fornN = new Set(forn.map((x) => norm(x.nome))), cliN = new Set(clis.map((x) => norm(x.nome)));

  const linhas = [];
  const ocorr = new Map();
  let lidas = 0, fora = 0;
  for (let i = linhaCab + 1; i < aba.linhas.length; i++) {
    const l = aba.linhas[i] || [];
    if (!l.some((c) => c !== null && c !== '' && String(c).trim() !== '')) continue;
    lidas++;
    const movBruto = pega(l, 'movimento');
    const r = {
      linha: i + 1,
      tipo: movimento(movBruto),
      parte: nomeLimpo(pega(l, 'parte')),
      amb_bruto: pega(l, 'ambiente'),
      tipo_ambiente: ambiente(pega(l, 'ambiente')),
      emissao: data(pega(l, 'emissao')),
      vencimento: data(pega(l, 'vencimento')),
      pagamento: data(pega(l, 'pagamento')),
      valor_centavos: valor(pega(l, 'valor')),
      categoria: nomeLimpo(pega(l, 'categoria')) || null,
      centro: nomeLimpo(pega(l, 'centro')) || null,
      forma: nomeLimpo(pega(l, 'forma')) || null,
      colaborador: nomeLimpo(pega(l, 'colaborador')) || null,
      conta: nomeLimpo(pega(l, 'conta')) || null,
      descricao: obs(l),
      id_planilha: nomeLimpo(pega(l, 'id')) || null,
      avisos: [], erros: [],
    };
    if (r.valor_centavos != null && r.valor_centavos < 0) r.valor_centavos = -r.valor_centavos;

    // Chave de duplicidade (dos dados brutos da planilha)
    const h = r.id_planilha ? null : hash([norm(movBruto), norm(r.amb_bruto), norm(r.parte), r.emissao, r.vencimento, r.valor_centavos, norm(r.categoria), norm(r.descricao)]);
    if (h) { const n = (ocorr.get(h) || 0) + 1; ocorr.set(h, n); r.chave = `h:${h}#${n}`; } else r.chave = `id:${String(r.id_planilha).trim().toLowerCase()}`;

    // Filtro pela data escolhida
    if (base !== 'todas') {
      const ref = dataRef(r, base);
      if (!ref || ref < de || ref > ate) { fora++; continue; }
    }
    delete r.amb_bruto;

    // Movimento (Pagar/Receber): coluna; senão pela categoria; senão pelo cadastro da parte
    if (r.tipo === undefined) { r.erros.push(`movimento "${nomeLimpo(movBruto)}" inválido (use Pagar ou Receber)`); r.tipo = null; }
    else if (!r.tipo) {
      const cs = r.categoria ? [...new Set(catsTodas.filter((c) => norm(c.nome) === norm(r.categoria)).map((c) => c.tipo))] : [];
      const ehF = fornN.has(norm(r.parte)), ehC = cliN.has(norm(r.parte));
      if (cs.length === 1) r.tipo = cs[0] === 'RECEITA' ? 'receber' : 'pagar';
      else if (ehF !== ehC) r.tipo = ehF ? 'pagar' : 'receber';
      if (r.tipo) r.avisos.push(`movimento deduzido: ${r.tipo === 'pagar' ? 'Pagar' : 'Receber'}`);
      else r.erros.push('informe Pagar ou Receber');
    }
    if (!r.tipo_ambiente) {
      if (!pega(l, 'ambiente')) { r.tipo_ambiente = op.ambientePadrao === 'PESSOAL' ? 'PESSOAL' : 'EMPRESA'; r.avisos.push(`sem Pessoal/Empresa: usado ${r.tipo_ambiente === 'PESSOAL' ? 'Pessoal' : 'Empresa'}`); }
      else r.erros.push(`Pessoal/Empresa "${nomeLimpo(pega(l, 'ambiente'))}" inválido`);
    }
    if (!r.vencimento && r.pagamento) { r.vencimento = r.pagamento; r.avisos.push('sem vencimento: usado a data do pagamento'); }
    if (!r.emissao && r.vencimento) r.emissao = r.vencimento <= hj ? r.vencimento : hj;
    if (r.emissao && r.vencimento && r.emissao > r.vencimento) { r.emissao = r.vencimento; r.avisos.push('emissão depois do vencimento: ajustada'); }
    if (!r.categoria && r.tipo) { r.categoria = r.tipo === 'receber' ? 'Outras Receitas' : 'Outras Despesas'; r.avisos.push('sem categoria'); }
    if (r.tipo === 'receber' && r.centro) { r.avisos.push('centro de custo só vale para Pagar (ignorado)'); r.centro = null; }
    if (r.tipo === 'receber' && !r.colaborador && op.colaboradorPadrao) r.colaborador = nomeLimpo(op.colaboradorPadrao);
    linhas.push(r);
  }

  // Unificação de nomes parecidos com os cadastros existentes
  const unif = { partes: [], categorias: [], centros: [], formas: [], colaboradores: [] };
  const aplicar = (lista, campo, existentes, destino, aproximado = true) => {
    const nomes = lista.filter((r) => r[campo]).map((r) => r[campo]);
    if (!nomes.length) return;
    const u = unificar(nomes, existentes, aproximado);
    for (const r of lista) if (r[campo]) r[campo] = u.mapa.get(r[campo]) || r[campo];
    destino.push(...u.unificados);
  };
  for (const t of ['pagar', 'receber']) {
    const ls = linhas.filter((r) => r.tipo === t);
    aplicar(ls, 'parte', t === 'pagar' ? forn : clis, unif.partes, false);
    aplicar(ls, 'categoria', catsTodas.filter((c) => c.tipo === (t === 'pagar' ? 'DESPESA' : 'RECEITA')), unif.categorias);
  }
  aplicar(linhas, 'centro', ccs, unif.centros);
  aplicar(linhas, 'forma', formas, unif.formas);
  aplicar(linhas, 'colaborador', colabs, unif.colaboradores);

  // Validações, duplicidade e situação
  const regs = await db.prepare('SELECT chave, tipo, nro_documento FROM importacao_registros').all();
  const regPorChave = new Map(regs.map((x) => [x.chave, x]));
  const importados = { pagar: new Set(), receber: new Set() };
  for (const x of regs) importados[x.tipo].add(x.nro_documento);
  const tituloExiste = async (t, nro) => db.prepare(`SELECT nro_documento, data_pagamento FROM ${TAB[t].tabela} WHERE nro_documento = ?`).get(nro);

  for (const r of linhas) {
    if (!r.parte) r.erros.push(r.tipo ? `sem ${rotParte(r.tipo)}` : 'sem cliente/fornecedor');
    if (!r.vencimento) r.erros.push('sem vencimento');
    if (!r.valor_centavos) r.erros.push('sem valor');
    if (r.tipo === 'receber' && !r.colaborador) r.erros.push('sem colaborador');
    r.situacao = 'novo';
    const reg = regPorChave.get(r.chave);
    const tit = reg && await tituloExiste(reg.tipo, reg.nro_documento);
    if (tit) {
      r.nro = reg.nro_documento; r.tipo_reg = reg.tipo;
      if (r.pagamento && !tit.data_pagamento) r.situacao = 'baixa';
      else r.situacao = 'importado';
    } else if (r.tipo && r.parte && r.valor_centavos && r.vencimento) {
      const T = TAB[r.tipo];
      const iguais = (await db.prepare(`SELECT t.nro_documento, p.nome FROM ${T.tabela} t JOIN ${T.parteTab} p ON p.id = t.${T.parteCol}
        WHERE t.valor_centavos = ? AND t.data_vencimento = ?`).all(r.valor_centavos, r.vencimento))
        .filter((x) => norm(x.nome) === norm(r.parte) && !importados[r.tipo].has(x.nro_documento));
      if (iguais.length) { r.situacao = 'possivel'; r.nro = iguais[0].nro_documento; }
    }
    r.sel = (r.situacao === 'novo' && !r.erros.length) || (r.situacao === 'baixa');
  }

  // Cadastros que serão criados
  const novos = { fornecedores: new Set(), clientes: new Set(), categorias: [], centros: new Set(), formas: new Set(), colaboradores: new Set() };
  const temN = (lista, nome) => lista.some((x) => norm(x.nome) === norm(nome));
  const natCat = {};
  for (const r of linhas.filter((x) => x.tipo && x.situacao !== 'importado')) {
    if (r.parte && !temN(r.tipo === 'pagar' ? forn : clis, r.parte)) novos[r.tipo === 'pagar' ? 'fornecedores' : 'clientes'].add(r.parte);
    if (r.centro && !temN(ccs, r.centro)) novos.centros.add(r.centro);
    if (r.forma && !temN(formas, r.forma)) novos.formas.add(r.forma);
    if (r.colaborador && !temN(colabs, r.colaborador)) novos.colaboradores.add(r.colaborador);
    const tc = r.tipo === 'pagar' ? 'DESPESA' : 'RECEITA';
    if (r.categoria && !catsTodas.some((c) => c.tipo === tc && norm(c.nome) === norm(r.categoria))) {
      const k = tc + '|' + r.categoria; (natCat[k] = natCat[k] || new Set()).add(r.tipo_ambiente);
    }
  }
  for (const [k, s] of Object.entries(natCat)) {
    const [tc, nome] = k.split('|');
    novos.categorias.push({ nome, tipo: tc, natureza: s.size > 1 ? 'AMBOS' : [...s][0] });
  }

  return {
    arquivo: nomeArq, aba: aba.nome,
    abas: abas.map((a) => ({ nome: a.nome, valida: !!a.cab })),
    colunas: Object.fromEntries(Object.entries(mapa).map(([k, idxs]) => [k, idxs.map((i) => cab[i])])),
    ignoradas: (cab || []).filter((h, idx) => h && !Object.values(mapa).flat().includes(idx)),
    filtro: { base, de, ate }, lidas, fora,
    linhas,
    unificados: unif,
    novos: {
      fornecedores: [...novos.fornecedores], clientes: [...novos.clientes], categorias: novos.categorias,
      centros: [...novos.centros], formas: [...novos.formas], colaboradores: [...novos.colaboradores],
    },
  };
}

router.post('/importacao-diaria/preview', jsonGrande, async (req, res) => {
  const b = req.body || {};
  const cfg = await lerConfig();
  const op = { ...cfg, ...limparConfig(b), de: b.de, ate: b.ate, aba: b.aba };
  let buf, nome;
  if (b.origem === 'arquivo') {
    if (!b.arquivo) throw new HttpError(400, 'Selecione o arquivo da planilha.');
    buf = Buffer.from(b.arquivo, 'base64'); nome = b.nome || 'planilha.xlsx';
  } else {
    if (!op.url) throw new HttpError(400, 'Informe o link da planilha do Google Sheets.');
    ({ buf, nome } = await baixarPlanilha(op.url, op.ignorarCertificado));
  }
  let r;
  try { r = await analisar(buf, nome, op); } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, 'Não foi possível ler a planilha: ' + e.message);
  }
  // guarda as preferências usadas (link, base, padrões)
  await salvarConfig(limparConfig({ url: b.origem === 'arquivo' ? undefined : op.url, base: op.base, ambientePadrao: op.ambientePadrao, colaboradorPadrao: op.colaboradorPadrao, ignorarCertificado: op.ignorarCertificado }));
  res.json(r);
});

router.post('/importacao-diaria/executar', jsonGrande, async (req, res) => {
  const linhas = Array.isArray(req.body?.linhas) ? req.body.linhas : [];
  if (!linhas.length) throw new HttpError(400, 'Nenhuma linha selecionada.');
  const usuarioId = req.usuario ? req.usuario.id : null;

  const novas = { pagar: [], receber: [] }, baixas = [];
  for (const [i, r] of linhas.entries()) {
    const ref = `Linha ${r.linha || i + 1}`;
    if (!texto(r.chave)) throw new HttpError(400, `${ref}: linha sem identificação. Analise a planilha novamente.`);
    if (r.situacao === 'baixa') {
      if (!TAB[r.tipo_reg] || !Number.isInteger(r.nro) || !isData(r.pagamento)) throw new HttpError(400, `${ref}: baixa inválida.`);
      baixas.push(r); continue;
    }
    if (!TAB[r.tipo]) throw new HttpError(400, `${ref}: informe Pagar ou Receber.`);
    if (!texto(r.parte)) throw new HttpError(400, `${ref}: ${rotParte(r.tipo)} obrigatório.`);
    if (r.tipo === 'receber' && !texto(r.colaborador)) throw new HttpError(400, `${ref}: colaborador responsável obrigatório em Receber.`);
    if (!['PESSOAL', 'EMPRESA'].includes(r.tipo_ambiente)) throw new HttpError(400, `${ref}: informe Pessoal ou Empresa.`);
    if (!isData(r.vencimento)) throw new HttpError(400, `${ref}: vencimento inválido.`);
    if (r.pagamento && !isData(r.pagamento)) throw new HttpError(400, `${ref}: data de pagamento inválida.`);
    if (!Number.isInteger(r.valor_centavos) || r.valor_centavos <= 0) throw new HttpError(400, `${ref}: valor inválido.`);
    if (r.tipo !== 'pagar') r.centro = null;
    novas[r.tipo].push(r);
  }

  const resultado = await db.transaction(async () => {
    const out = { pagar: imp.novoContador('pagar'), receber: imp.novoContador('receber'), baixas: 0, ignoradas: 0 };
    const regExiste = db.prepare('SELECT tipo, nro_documento FROM importacao_registros WHERE chave = ?');
    const regGrava = db.prepare(`INSERT INTO importacao_registros (chave, tipo, nro_documento, importado_por) VALUES (?, ?, ?, ?)
      ON CONFLICT(chave) DO UPDATE SET tipo = excluded.tipo, nro_documento = excluded.nro_documento, importado_em = datetime('now'), importado_por = excluded.importado_por`);
    const cache = {};
    for (const t of ['pagar', 'receber']) {
      // proteção contra duplo clique / importação simultânea
      const pend = [];
      for (const r of novas[t]) {
        const x = await regExiste.get(r.chave);
        if (x && await db.prepare(`SELECT 1 FROM ${TAB[x.tipo].tabela} WHERE nro_documento = ?`).get(x.nro_documento)) { out.ignoradas++; continue; }
        pend.push(r);
      }
      if (!pend.length) continue;
      const ids = await imp.gravarLinhas(pend, usuarioId, t, out[t], cache);
      for (const [i, r] of pend.entries()) await regGrava.run(r.chave, t, ids[i], usuarioId);
    }
    for (const r of baixas) {
      const T = TAB[r.tipo_reg];
      const tit = await db.prepare(`SELECT data_emissao FROM ${T.tabela} WHERE nro_documento = ? AND data_pagamento IS NULL`).get(r.nro);
      if (!tit) { out.ignoradas++; continue; }
      await db.prepare(`UPDATE ${T.tabela} SET data_pagamento = ?, atualizado_em = datetime('now') WHERE nro_documento = ?`).run(r.pagamento, r.nro);
      out.baixas++;
    }
    return out;
  })();

  await salvarConfig({ ultima: { em: new Date().toISOString(), titulos: resultado.pagar.titulos + resultado.receber.titulos, baixas: resultado.baixas } });
  res.status(201).json(resultado);
});

/* ------------------------------ Planilha modelo ------------------------------ */
const NAT = { PESSOAL: 'Pessoal', EMPRESA: 'Empresa', AMBOS: 'Empresa e Pessoal' };
const MAX = 2000;

async function modelo() {
  const ativos = (sql) => db.prepare(sql).all();
  const fornecedores = await ativos('SELECT nome, cpf_cnpj, telefone, email FROM fornecedores WHERE ativo = 1 ORDER BY LOWER(nome)');
  const clientes = await ativos('SELECT nome, cpf_cnpj, telefone, email FROM clientes WHERE ativo = 1 ORDER BY LOWER(nome)');
  const categorias = await ativos("SELECT nome, tipo, natureza FROM categorias WHERE ativo = 1 ORDER BY CASE tipo WHEN 'DESPESA' THEN 0 ELSE 1 END, LOWER(nome)");
  const formas = await ativos('SELECT nome::text AS nome FROM formas_pagamento WHERE ativo = 1 ORDER BY LOWER(nome::text)');
  const centros = await ativos('SELECT nome, codigo, descricao FROM centros_custo WHERE ativo = 1 ORDER BY LOWER(COALESCE(codigo, nome)), LOWER(nome)');
  const colabs = await ativos("SELECT nome, cargo FROM colaboradores WHERE status = 'ATIVO' ORDER BY LOWER(nome)");
  const doc = (d) => (d ? String(d) : '');
  const ref = (aba) => `'${aba}'!$A$2:$A$${MAX}`;
  const instr = [
    ['COMO USAR ESTA PLANILHA'],
    ['1. Lance cada conta (a pagar ou a receber) em uma linha da aba "Lançamentos". Não altere os nomes das colunas.'],
    ['2. No sistema, abra Sistema › Importar Planilha › Importação diária, informe a data e clique em "Ler planilha". Confira a prévia e importe.'],
    ['3. Pode importar a mesma data quantas vezes quiser: linhas já importadas são ignoradas. Se depois você preencher a Data Pagamento, a próxima importação registra a baixa.'],
    ['4. As abas de cadastros (Fornecedores, Clientes, Categorias...) servem de lista para as colunas. Nome novo é cadastrado automaticamente na importação.'],
    ['5. Para atualizar as listas, gere a planilha modelo novamente no sistema e copie as abas de cadastros para esta planilha.'],
    [''],
    ['COLUNA', 'O QUE PREENCHER', 'EXEMPLO'],
    ['Data Emissão', 'Data do lançamento (normalmente o dia em que foi registrado). É a data usada para escolher o que importar.', '07/10/2026'],
    ['Movimento', 'Pagar (despesa) ou Receber (receita). Também aceita Despesa/Receita, Saída/Entrada.', 'Pagar'],
    ['Pessoal/Empresa', 'Pessoal ou Empresa (aceita P / E).', 'Empresa'],
    ['Cliente/Fornecedor', 'Fornecedor (em Pagar) ou Cliente (em Receber). Se não existir, é cadastrado.', 'Enel Energia'],
    ['Data Vencimento', 'Vencimento do título. Se vazio e houver Data Pagamento, usa a data do pagamento.', '15/10/2026'],
    ['Data Pagamento', 'Preencha somente se já foi pago/recebido. Vazio = em aberto.', ''],
    ['Valor', 'Valor em reais, sem sinal. Aceita 1234,56 ou R$ 1.234,56.', '389,90'],
    ['Categoria', 'Categoria do plano de contas (veja a aba Categorias). Vazio = Outras Despesas / Outras Receitas.', 'Energia Elétrica'],
    ['Centro de Custo', 'Opcional, só para Pagar.', 'Administrativo'],
    ['Forma de Pagamento', 'Opcional: Pix, Boleto, Cartão de Crédito...', 'Boleto'],
    ['Colaborador', 'Em Receber é o responsável (se vazio, usa o padrão configurado no sistema). Em Pagar é opcional.', 'Marcelo Rafael'],
    ['Observação', 'Texto livre.', 'Conta de luz do escritório'],
    ['ID', 'Opcional. Um código único por linha (ex.: gerado pela automação). Com ID, você pode corrigir valores na planilha sem gerar duplicidade.', 'WA-20261007-0001'],
    [''],
    ['DICA PARA A AUTOMAÇÃO (WhatsApp/áudio)'],
    ['• Acrescente uma linha por lançamento ao final da aba "Lançamentos", com Data Emissão = data do dia.'],
    ['• Use os nomes exatos das abas de cadastros. Datas em dd/mm/aaaa (ou aaaa-mm-dd) e valor como número.'],
    ['• Se a automação puder, preencha a coluna ID com um código único (evita duplicidade se a linha for corrigida).'],
  ];

  return gerarXlsx([
    {
      nome: 'Lançamentos', congelar: true, filtro: true, linhasVazias: MAX,
      colunas: [
        { titulo: 'Data Emissão', largura: 14, tipo: 'data' },
        { titulo: 'Movimento', largura: 11 },
        { titulo: 'Pessoal/Empresa', largura: 17 },
        { titulo: 'Cliente/Fornecedor', largura: 30 },
        { titulo: 'Data Vencimento', largura: 17, tipo: 'data' },
        { titulo: 'Data Pagamento', largura: 17, tipo: 'data' },
        { titulo: 'Valor', largura: 13, tipo: 'valor' },
        { titulo: 'Categoria', largura: 24 },
        { titulo: 'Centro de Custo', largura: 20 },
        { titulo: 'Forma de Pagamento', largura: 21 },
        { titulo: 'Colaborador', largura: 20 },
        { titulo: 'Observação', largura: 40 },
        { titulo: 'ID', largura: 18 },
      ],
      linhas: [],
      validacoes: [
        { coluna: 'B', lista: ['Pagar', 'Receber'], erro: 'Use Pagar ou Receber.' },
        { coluna: 'C', lista: ['Pessoal', 'Empresa'], erro: 'Use Pessoal ou Empresa.' },
        { coluna: 'H', origem: ref('Categorias') },
        { coluna: 'I', origem: ref('Centros de Custo') },
        { coluna: 'J', origem: ref('Formas de Pagamento') },
        { coluna: 'K', origem: ref('Colaboradores') },
      ],
    },
    { nome: 'Fornecedores', congelar: true, filtro: true, colunas: [{ titulo: 'Nome', largura: 36 }, { titulo: 'CPF/CNPJ', largura: 18 }, { titulo: 'Telefone', largura: 16 }, { titulo: 'E-mail', largura: 28 }],
      linhas: fornecedores.map((f) => [f.nome, doc(f.cpf_cnpj), doc(f.telefone), doc(f.email)]) },
    { nome: 'Clientes', congelar: true, filtro: true, colunas: [{ titulo: 'Nome', largura: 36 }, { titulo: 'CPF/CNPJ', largura: 18 }, { titulo: 'Telefone', largura: 16 }, { titulo: 'E-mail', largura: 28 }],
      linhas: clientes.map((f) => [f.nome, doc(f.cpf_cnpj), doc(f.telefone), doc(f.email)]) },
    { nome: 'Categorias', congelar: true, filtro: true, colunas: [{ titulo: 'Nome', largura: 32 }, { titulo: 'Movimento', largura: 12 }, { titulo: 'Natureza', largura: 18 }],
      linhas: categorias.map((c) => [c.nome, c.tipo === 'RECEITA' ? 'Receber' : 'Pagar', NAT[c.natureza] || c.natureza]) },
    { nome: 'Formas de Pagamento', congelar: true, colunas: [{ titulo: 'Nome', largura: 28 }], linhas: formas.map((f) => [f.nome]) },
    { nome: 'Centros de Custo', congelar: true, filtro: true, colunas: [{ titulo: 'Nome', largura: 30 }, { titulo: 'Código', largura: 10 }, { titulo: 'Descrição', largura: 40 }],
      linhas: centros.map((c) => [c.nome, doc(c.codigo), doc(c.descricao)]) },
    { nome: 'Colaboradores', congelar: true, colunas: [{ titulo: 'Nome', largura: 30 }, { titulo: 'Cargo', largura: 24 }], linhas: colabs.map((c) => [c.nome, doc(c.cargo)]) },
    { nome: 'Instruções', semCabecalho: true,
      colunas: [{ titulo: '', largura: 22 }, { titulo: '', largura: 80 }, { titulo: '', largura: 22 }],
      linhas: instr.map((l, i) => {
        if (i === 0 || l[0].startsWith('DICA')) return { estilo: 5, valores: l };
        if (l[0] === 'COLUNA') return { estilo: 1, valores: l };
        if (l.length === 1) return { estilo: 0, valores: l }; // texto corrido (sem quebra)
        return { estilo: 4, valores: l };
      }),
    },
  ]);
}

router.get('/importacao-diaria/modelo', async (req, res) => {
  const buf = await modelo();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-importacao-openway.xlsx"');
  res.setHeader('Cache-Control', 'no-store');
  res.send(buf);
});

module.exports = { router, analisar, modelo, urlExportacao };
