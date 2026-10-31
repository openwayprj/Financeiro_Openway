'use strict';
/**
 * Carga de dados de DEMONSTRAÇÃO.
 * Uso:  npm run seed          (só executa se não houver lançamentos)
 *       npm run seed -- --force  (apaga cadastros/lançamentos e recria; usuários são mantidos)
 */
const { db, pool } = require('./db');
const { fmtData } = require('./util');

const force = process.argv.includes('--force');

// Gerador pseudoaleatório determinístico
let semente = 42;
const rnd = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const entre = (min, max) => Math.round(min + rnd() * (max - min));

async function carregar() {
await db.ready();
const qtd = (await db.prepare('SELECT (SELECT COUNT(*) FROM contas_receber) + (SELECT COUNT(*) FROM contas_pagar) AS n').get()).n;
if (qtd > 0 && !force) {
  console.log('Já existem lançamentos. Use "npm run seed -- --force" para recriar os dados de demonstração.');
  return;
}
await db.transaction(async () => {
  if (force) {
    for (const t of ['contas_receber_colaboradores', 'contas_pagar_colaboradores', 'contas_receber', 'contas_pagar',
      'categorias', 'clientes', 'fornecedores', 'colaboradores', 'contas_bancarias', 'centros_custo']) await db.exec(`DELETE FROM ${t}`);
    await db.exec('DELETE FROM importacao_registros');
    for (const [t, pk] of [['contas_receber', 'nro_documento'], ['contas_pagar', 'nro_documento'], ['categorias', 'id'], ['clientes', 'id'], ['fornecedores', 'id'], ['colaboradores', 'id'], ['contas_bancarias', 'id'], ['contas_receber_colaboradores', 'id'], ['contas_pagar_colaboradores', 'id'], ['centros_custo', 'id']])
      await db.prepare('SELECT setval(pg_get_serial_sequence(?, ?), 1, false)').get(t, pk);
  }

  const ids = async (ins, linhas) => { const out = []; for (const l of linhas) out.push((await ins.run(...l)).lastInsertRowid); return out; };
  const insCat = db.prepare('INSERT INTO categorias (nome, tipo, natureza) VALUES (?, ?, ?)');
  const cats = {
    EMPRESA: {
      RECEITA: ['Venda de Licenças', 'Suporte Técnico', 'Consultoria', 'Desenvolvimento de Software', 'Infraestrutura / Redes'],
      DESPESA: ['Folha de Pagamento', 'Aluguel Escritório', 'Impostos (Simples Nacional)', 'Software / SaaS', 'Marketing', 'Comissões', 'Viagens e Deslocamentos', 'Telefonia / Internet'],
    },
    PESSOAL: {
      RECEITA: ['Pró-labore', 'Rendimentos de Investimentos', 'Aluguel Recebido'],
      DESPESA: ['Moradia', 'Alimentação', 'Educação', 'Saúde', 'Lazer', 'Transporte'],
    },
  };
  const catIds = { EMPRESA: { RECEITA: [], DESPESA: [] }, PESSOAL: { RECEITA: [], DESPESA: [] } };
  // Categorias que servem para Empresa e Pessoal
  await insCat.run('Tarifas Bancárias', 'DESPESA', 'AMBOS');
  await insCat.run('Impostos e Taxas Diversas', 'DESPESA', 'AMBOS');
  for (const nat of Object.keys(cats)) for (const tipo of Object.keys(cats[nat]))
    for (const nome of cats[nat][tipo]) catIds[nat][tipo].push((await insCat.run(nome, tipo, nat)).lastInsertRowid);

  const insCli = db.prepare('INSERT INTO clientes (nome, cpf_cnpj, contato, email, telefone) VALUES (?, ?, ?, ?, ?)');
  const clientes = await ids(insCli, [
    ['Alfa Comércio de Alimentos Ltda', '11222333000181', 'Renata', 'financeiro@alfa.com.br', '(11) 3333-1000'],
    ['Beta Logística S/A', '33000167000101', 'Paulo', 'contas@betalog.com.br', '(11) 3333-2000'],
    ['Clínica Gama', '60746948000112', 'Dra. Lúcia', 'adm@clinicagama.com.br', '(11) 3333-3000'],
    ['Delta Engenharia', '07526557000100', 'Marcos', 'marcos@delta.eng.br', '(11) 3333-4000'],
    ['Escola Épsilon', '45997418000153', 'Sandra', 'secretaria@epsilon.edu.br', '(11) 3333-5000'],
    ['Inquilino - Apto 12', null, 'João', null, '(11) 99999-1212'],
    ['Corretora XP (Rendimentos)', null, null, null, null],
    ['Openway Informática (Pró-labore)', null, null, null, null],
  ]);
  const cliEmpresa = clientes.slice(0, 5), cliPessoal = clientes.slice(5);

  const insFor = db.prepare('INSERT INTO fornecedores (nome, cpf_cnpj, contato, email, telefone) VALUES (?, ?, ?, ?, ?)');
  const fornecedores = await ids(insFor, [
    ['Imobiliária Centro', '19131243000197', 'Carla', null, '(11) 4000-1000'],
    ['Receita Federal (DAS)', null, null, null, null],
    ['Microsoft Brasil', '04712500000107', null, null, null],
    ['Google Ads', '06990590000123', null, null, null],
    ['Vivo Empresas', '02558157000162', null, null, null],
    ['Companhia Aérea Azul', '09296295000160', null, null, null],
    ['Supermercado Bom Preço', null, null, null, null],
    ['Colégio Aprender', null, null, null, null],
    ['Plano de Saúde Vida', null, null, null, null],
    ['Condomínio Residencial', null, null, null, null],
    ['Folha de Pagamento (Interno)', null, null, null, null],
  ]);

  const insCol = db.prepare('INSERT INTO colaboradores (nome, cargo, status) VALUES (?, ?, ?)');
  const colabs = await ids(insCol, [
    ['Marcelo Rafael', 'Diretor', 'ATIVO'],
    ['Ana Souza', 'Executiva de Vendas', 'ATIVO'],
    ['Bruno Lima', 'Consultor Técnico', 'ATIVO'],
    ['Carla Mendes', 'Analista de Suporte', 'ATIVO'],
    ['Diego Santos', 'Desenvolvedor', 'ATIVO'],
    ['Eduardo Rocha', 'Ex-Vendedor', 'INATIVO'],
  ]);
  const colabsAtivos = colabs.slice(0, 5);

  const insConta = db.prepare('INSERT INTO contas_bancarias (nome, banco, agencia, conta, natureza) VALUES (?, ?, ?, ?, ?)');
  const contaPJ = (await insConta.run('Itaú PJ', 'Itaú', '0001', '12345-6', 'EMPRESA')).lastInsertRowid;
  const contaPF = (await insConta.run('Bradesco PF', 'Bradesco', '1234', '98765-4', 'PESSOAL')).lastInsertRowid;
  const formas = (await db.prepare('SELECT id FROM formas_pagamento ORDER BY id').all()).map((r) => r.id);

  const insR = db.prepare(`INSERT INTO contas_receber (data_emissao, data_vencimento, data_pagamento, tipo_ambiente, cliente_id, categoria_id,
      colaborador_id, valor_centavos, observacoes, forma_pagamento_id, conta_bancaria_id)
      VALUES (@emi, @venc, @pag, @amb, @parte, @cat, @col, @valor, @obs, @fp, @cb)`);
  const insCC = db.prepare('INSERT INTO centros_custo (codigo, nome, descricao) VALUES (?, ?, ?)');
  const CC = {
    adm: (await insCC.run('1.01', 'Administrativo', 'Estrutura, aluguel, impostos e folha administrativa')).lastInsertRowid,
    com: (await insCC.run('1.02', 'Comercial', 'Vendas, marketing e comissões')).lastInsertRowid,
    tec: (await insCC.run('1.03', 'Técnico / Suporte', 'Atendimento e infraestrutura de clientes')).lastInsertRowid,
    dev: (await insCC.run('1.04', 'Desenvolvimento', 'Software, licenças e ferramentas')).lastInsertRowid,
    casa: (await insCC.run('2.01', 'Casa e Família', 'Despesas pessoais da família')).lastInsertRowid,
  };
  const insP = db.prepare(`INSERT INTO contas_pagar (data_emissao, data_vencimento, data_pagamento, tipo_ambiente, fornecedor_id, categoria_id,
      colaborador_id, valor_centavos, observacoes, forma_pagamento_id, conta_bancaria_id, centro_custo_id)
      VALUES (@emi, @venc, @pag, @amb, @parte, @cat, @col, @valor, @obs, @fp, @cb, @cc)`);
  const insRR = db.prepare('INSERT INTO contas_receber_colaboradores (nro_documento, colaborador_id, valor_centavos) VALUES (?, ?, ?)');
  const insPR = db.prepare('INSERT INTO contas_pagar_colaboradores (nro_documento, colaborador_id, valor_centavos) VALUES (?, ?, ?)');

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const ano = hoje.getFullYear();
  const pagamento = (venc) => {
    // títulos vencidos: 88% pagos; futuros próximos: 10% adiantados
    const v = new Date(venc + 'T00:00:00');
    if (v < hoje) {
      if (rnd() < 0.88) { const d = new Date(v); d.setDate(d.getDate() + entre(-3, 4)); return fmtData(d > hoje ? hoje : d); }
      return null;
    }
    return rnd() < 0.1 && (v - hoje) / 86400000 < 20 ? fmtData(hoje) : null;
  };

  for (let mes = 0; mes < 12; mes++) {
    const dia = (d) => fmtData(new Date(ano, mes, d));
    // ---- Receitas Empresa ----
    const nRec = entre(6, 10);
    for (let i = 0; i < nRec; i++) {
      const venc = dia(entre(5, 28));
      const emi = fmtData(new Date(new Date(venc + 'T00:00:00').getTime() - entre(5, 30) * 86400000));
      const valor = entre(1500, 18000) * 100;
      const resp = pick(colabsAtivos.slice(1));
      const nro = (await insR.run({ emi, venc, pag: pagamento(venc), amb: 'EMPRESA', parte: pick(cliEmpresa), cat: pick(catIds.EMPRESA.RECEITA),
        col: resp, valor, obs: null, fp: pick(formas), cb: contaPJ })).lastInsertRowid;
      if (rnd() < 0.35) { // rateio entre 2 colaboradores
        let outro = pick(colabsAtivos); while (outro === resp) outro = pick(colabsAtivos);
        const parte1 = Math.round(valor * 0.6);
        await insRR.run(nro, resp, parte1); await insRR.run(nro, outro, valor - parte1);
      }
    }
    // ---- Receitas Pessoais ----
    await insR.run({ emi: dia(1), venc: dia(5), pag: pagamento(dia(5)), amb: 'PESSOAL', parte: cliPessoal[2], cat: catIds.PESSOAL.RECEITA[0], col: colabs[0], valor: 1500000, obs: 'Pró-labore mensal', fp: formas[0], cb: contaPF });
    await insR.run({ emi: dia(1), venc: dia(10), pag: pagamento(dia(10)), amb: 'PESSOAL', parte: cliPessoal[0], cat: catIds.PESSOAL.RECEITA[2], col: colabs[0], valor: 280000, obs: 'Aluguel apto 12', fp: formas[0], cb: contaPF });
    if (mes % 3 === 2) await insR.run({ emi: dia(20), venc: dia(28), pag: pagamento(dia(28)), amb: 'PESSOAL', parte: cliPessoal[1], cat: catIds.PESSOAL.RECEITA[1], col: colabs[0], valor: entre(800, 2500) * 100, obs: 'Dividendos', fp: formas[2], cb: contaPF });

    // ---- Despesas Empresa ----
    const fixa = async (d, forn, catIdx, valor, obs, col, cc) => insP.run({ emi: dia(1), venc: dia(d), pag: pagamento(dia(d)), amb: 'EMPRESA', parte: fornecedores[forn], cat: catIds.EMPRESA.DESPESA[catIdx], col: col || null, valor, obs, fp: pick(formas), cb: contaPJ, cc: cc || null });
    await fixa(5, 0, 1, 450000, 'Aluguel sala comercial', null, CC.adm);
    await fixa(20, 1, 2, entre(3000, 6000) * 100, 'DAS mensal', null, CC.adm);
    await fixa(10, 2, 3, 89000, 'Microsoft 365', null, CC.dev);
    await fixa(15, 4, 7, 42000, 'Plano corporativo', colabs[3], CC.tec);
    await fixa(5, 10, 0, 1100000, 'Folha - equipe técnica', null, CC.tec);
    await fixa(5, 10, 0, 800000, 'Folha - desenvolvimento', null, CC.dev);
    await fixa(5, 10, 0, 500000, 'Folha - administrativo', null, CC.adm);
    const ads = await fixa(12, 3, 4, entre(1000, 3000) * 100, 'Campanha Google Ads', null, CC.com);
    const valAds = (await db.prepare('SELECT valor_centavos FROM contas_pagar WHERE nro_documento = ?').get(ads.lastInsertRowid)).valor_centavos;
    await insPR.run(ads.lastInsertRowid, colabs[1], Math.round(valAds * 0.7)); await insPR.run(ads.lastInsertRowid, colabs[2], valAds - Math.round(valAds * 0.7));
    for (let k = 0; k < entre(1, 3); k++) {
      const c = pick(colabsAtivos.slice(1));
      await fixa(entre(3, 27), 5, 6, entre(400, 2200) * 100, 'Visita a cliente', c, rnd() < 0.5 ? CC.com : CC.tec);
      await fixa(entre(3, 27), 10, 5, entre(300, 1500) * 100, 'Comissão sobre vendas', c, CC.com);
    }
    // ---- Despesas Pessoais ----
    const pes = async (d, forn, catIdx, valor, obs) => insP.run({ emi: dia(1), venc: dia(d), pag: pagamento(dia(d)), amb: 'PESSOAL', parte: fornecedores[forn], cat: catIds.PESSOAL.DESPESA[catIdx], col: null, valor, obs, fp: pick(formas), cb: contaPF, cc: rnd() < 0.75 ? CC.casa : null });
    await pes(10, 9, 0, 120000, 'Condomínio');
    await pes(entre(5, 25), 6, 1, entre(1200, 2200) * 100, 'Supermercado');
    await pes(8, 7, 2, 210000, 'Mensalidade escolar');
    await pes(15, 8, 3, 95000, 'Plano de saúde');
    if (rnd() < 0.5) await pes(entre(5, 25), 5, 4, entre(800, 4000) * 100, 'Viagem família');
  }
})();
console.log('Dados de demonstração criados com sucesso.');
}

carregar()
  .then(() => pool.end())
  .catch(async (e) => { console.error('ERRO:', e.message); try { await pool.end(); } catch (_) { /* ignora */ } process.exit(1); });
