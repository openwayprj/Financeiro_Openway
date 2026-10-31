'use strict';
/* Testes de integração da API (node --test). Usa um banco temporário. */
const test = require('node:test');
const assert = require('node:assert');

// Usa um banco PostgreSQL de teste. Defina TEST_DATABASE_URL (ex.: uma branch "test" do Neon ou um Postgres local).
// ATENÇÃO: o teste APAGA as tabelas do schema "public" desse banco para recomeçar do zero.
const URL_TESTE = process.env.TEST_DATABASE_URL;
if (!URL_TESTE) throw new Error('Defina TEST_DATABASE_URL para rodar os testes (banco descartável!).');
process.env.DATABASE_URL = URL_TESTE;
const app = require('../src/server');
const { db, pool } = require('../src/db');
const { hoje } = require('../src/util');

let base, server, cookie = '';
async function req(method, url, body) {
  const r = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined,
  });
  const sc = r.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json().catch(() => null) };
}

const ontem = () => { const d = new Date(); d.setDate(d.getDate() - 1); return require('../src/util').fmtData(d); };
const ids = {};

test.before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await db.ready();
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => { server.close(); await pool.end(); });

test('exige login e permite setup do primeiro admin', async () => {
  assert.equal((await req('GET', '/api/cadastros/clientes')).status, 401);
  assert.equal((await req('GET', '/api/auth/status')).body.precisaConfigurar, true);
  assert.equal((await req('POST', '/api/auth/setup', { nome: 'Admin', login: 'admin', senha: '123456' })).status, 201);
  assert.equal((await req('POST', '/api/auth/setup', { nome: 'X', login: 'x', senha: '123456' })).status, 409);
  assert.equal((await req('GET', '/api/auth/me')).body.login, 'admin');
});

test('cadastros base', async () => {
  ids.catRecEmp = (await req('POST', '/api/cadastros/categorias', { nome: 'Serviços', tipo: 'RECEITA', natureza: 'EMPRESA' })).body.id;
  ids.catDespEmp = (await req('POST', '/api/cadastros/categorias', { nome: 'Aluguel', tipo: 'DESPESA', natureza: 'EMPRESA' })).body.id;
  ids.catRecPes = (await req('POST', '/api/cadastros/categorias', { nome: 'Salário', tipo: 'RECEITA', natureza: 'PESSOAL' })).body.id;
  assert.equal((await req('POST', '/api/cadastros/clientes', { nome: 'Cli', cpf_cnpj: '111.111.111-11' })).status, 400, 'CPF inválido');
  ids.cli = (await req('POST', '/api/cadastros/clientes', { nome: 'Cli', cpf_cnpj: '529.982.247-25' })).body.id;
  ids.forn = (await req('POST', '/api/cadastros/fornecedores', { nome: 'Forn' })).body.id;
  ids.ana = (await req('POST', '/api/cadastros/colaboradores', { nome: 'Ana', cargo: 'Vendas', status: 'ATIVO' })).body.id;
  ids.bia = (await req('POST', '/api/cadastros/colaboradores', { nome: 'Bia', cargo: 'Suporte', status: 'ATIVO' })).body.id;
  assert.ok(ids.cli && ids.forn && ids.ana && ids.bia);
});

test('contas a receber: validações e numeração sequencial', async () => {
  const t = hoje();
  const base = { data_emissao: t, data_vencimento: t, tipo_ambiente: 'EMPRESA', cliente_id: ids.cli, categoria_id: ids.catRecEmp, valor_centavos: 100000 };
  let r = await req('POST', '/api/receber', base);
  assert.equal(r.status, 400, 'colaborador obrigatório');
  r = await req('POST', '/api/receber', { ...base, colaborador_id: ids.ana, categoria_id: ids.catRecPes });
  assert.equal(r.status, 400, 'natureza da categoria deve casar com ambiente');
  r = await req('POST', '/api/receber', { ...base, colaborador_id: ids.ana, rateio: [{ colaborador_id: ids.bia, valor_centavos: 200000 }] });
  assert.equal(r.status, 400, 'rateio maior que o título');

  const a = await req('POST', '/api/receber', { ...base, colaborador_id: ids.ana, rateio: [{ colaborador_id: ids.bia, valor_centavos: 40000 }] });
  const b = await req('POST', '/api/receber', { ...base, data_vencimento: t, colaborador_id: ids.ana, valor_centavos: 50000, data_pagamento: t });
  assert.equal(a.status, 201);
  assert.equal(b.body.nro_documento, a.body.nro_documento + 1);
  assert.equal(a.body.status, 'PENDENTE');
  assert.equal(b.body.status, 'REALIZADO');
  ids.rec1 = a.body.nro_documento;
});

test('status em atraso', async () => {
  const d = ontem();
  const r = await req('POST', '/api/pagar', { data_emissao: d, data_vencimento: d, tipo_ambiente: 'EMPRESA', fornecedor_id: ids.forn, categoria_id: ids.catDespEmp, valor_centavos: 30000, colaborador_id: ids.bia });
  assert.equal(r.status, 201);
  assert.equal(r.body.status, 'ATRASADO');
  ids.pag1 = r.body.nro_documento;
  const bx = await req('PATCH', `/api/pagar/${ids.pag1}/baixa`, { data_pagamento: hoje() });
  assert.equal(bx.body.status, 'REALIZADO');
  const es = await req('PATCH', `/api/pagar/${ids.pag1}/estorno`, {});
  assert.equal(es.body.status, 'ATRASADO');
});

test('dashboard: KPIs previsto x realizado', async () => {
  const d = ontem(), t = hoje();
  const r = await req('GET', `/api/dashboard?de=${d}&ate=${t}&ambiente=TODAS`);
  const k = r.body.kpis;
  assert.equal(k.receitas_previstas, 150000);
  assert.equal(k.receitas_realizadas, 50000);
  assert.equal(k.despesas_previstas, 30000);
  assert.equal(k.despesas_realizadas, 0);
  assert.equal(k.resultado_previsto, 120000);
  assert.equal(k.resultado_realizado, 50000);
  assert.equal(r.body.status.geral.ATRASADO.qtd, 1);
  const p = await req('GET', `/api/dashboard?de=${d}&ate=${t}&ambiente=PESSOAL`);
  assert.equal(p.body.kpis.receitas_previstas, 0, 'filtro de âmbito');
});

test('resumo por colaborador: rateio + saldo para o responsável', async () => {
  const r = await req('GET', `/api/resumo-colaboradores?de=${ontem()}&ate=${hoje()}&ambiente=TODAS`);
  const ana = r.body.itens.find((x) => x.id === ids.ana), bia = r.body.itens.find((x) => x.id === ids.bia);
  // título 1: 1000,00 com 400,00 rateado para Bia -> Ana fica com 600,00; título 2: 500,00 Ana
  assert.equal(ana.receita_prevista, 110000);
  assert.equal(bia.receita_prevista, 40000);
  assert.equal(bia.despesa_prevista, 30000);
  assert.equal(bia.saldo_previsto, 10000);
  assert.equal(r.body.totais.receita_prevista, 150000, 'soma por colaborador fecha com o total');
});

test('categoria "Empresa e Pessoal" (AMBOS) vale nos dois ambientes', async () => {
  const t = hoje();
  const cat = (await req('POST', '/api/cadastros/categorias', { nome: 'Tarifas', tipo: 'DESPESA', natureza: 'AMBOS' })).body.id;
  const base = { data_emissao: t, data_vencimento: t, fornecedor_id: ids.forn, categoria_id: cat, valor_centavos: 1000 };
  assert.equal((await req('POST', '/api/pagar', { ...base, tipo_ambiente: 'EMPRESA' })).status, 201);
  assert.equal((await req('POST', '/api/pagar', { ...base, tipo_ambiente: 'PESSOAL' })).status, 201);
  // não pode virar "somente Empresa" pois já tem lançamento Pessoal
  const r = await req('PUT', `/api/cadastros/categorias/${cat}`, { nome: 'Tarifas', tipo: 'DESPESA', natureza: 'EMPRESA', ativo: 1 });
  assert.equal(r.status, 409);
  // nem mudar o tipo para RECEITA
  assert.equal((await req('PUT', `/api/cadastros/categorias/${cat}`, { nome: 'Tarifas', tipo: 'RECEITA', natureza: 'AMBOS', ativo: 1 })).status, 409);
});

test('centro de custo em contas a pagar + resumo', async () => {
  const d = ontem(), t = hoje();
  const cc = (await req('POST', '/api/cadastros/centros-custo', { codigo: '1.01', nome: 'Comercial' })).body.id;
  assert.ok(cc);
  const base = { data_emissao: t, data_vencimento: t, tipo_ambiente: 'EMPRESA', fornecedor_id: ids.forn, categoria_id: ids.catDespEmp };
  assert.equal((await req('POST', '/api/pagar', { ...base, valor_centavos: 5000, centro_custo_id: 999 })).status, 400, 'centro inválido');
  const a = await req('POST', '/api/pagar', { ...base, valor_centavos: 7000, centro_custo_id: cc });
  assert.equal(a.body.centro_custo_nome, 'Comercial');
  const lista = await req('GET', `/api/pagar?de=${d}&ate=${t}&centro_custo_id=${cc}`);
  assert.equal(lista.body.itens.length, 1);
  const r = await req('GET', `/api/resumo-centros-custo?de=${d}&ate=${t}&ambiente=TODAS`);
  const com = r.body.centros.find((x) => x.id === cc), sem = r.body.centros.find((x) => x.id === null);
  assert.equal(com.previsto, 7000);
  assert.equal(r.body.kpis.previsto, com.previsto + sem.previsto, 'soma por centro fecha com o total');
  const f = await req('GET', `/api/resumo-centros-custo?de=${d}&ate=${t}&ambiente=TODAS&centro_custo_id=${cc}`);
  assert.equal(f.body.kpis.previsto, 7000);
  assert.equal((await req('GET', `/api/dashboard?de=${d}&ate=${t}&ambiente=TODAS`)).body.centros_custo.find((x) => x.id === cc).previsto, 7000);
  assert.equal((await req('DELETE', `/api/cadastros/centros-custo/${cc}`)).status, 409, 'centro em uso');
});

test('projeção de mês: copia sem pagamento, ajusta datas e rateio', async () => {
  const mk = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  // título a receber em 31/01/2030, pago, com rateio 400 de 1000
  const orig = await req('POST', '/api/receber', { data_emissao: mk(2030, 1, 15), data_vencimento: mk(2030, 1, 31), data_pagamento: mk(2030, 1, 31),
    tipo_ambiente: 'EMPRESA', cliente_id: ids.cli, categoria_id: ids.catRecEmp, colaborador_id: ids.ana, valor_centavos: 1000,
    rateio: [{ colaborador_id: ids.bia, valor_centavos: 400 }] });
  const pag = await req('POST', '/api/pagar', { data_emissao: mk(2030, 1, 10), data_vencimento: mk(2030, 1, 20), tipo_ambiente: 'EMPRESA',
    fornecedor_id: ids.forn, categoria_id: ids.catDespEmp, valor_centavos: 300 });
  assert.equal((await req('GET', '/api/projecao/preview?origem=2030-01&destino=2030-01')).status, 400);
  const pv = await req('GET', '/api/projecao/preview?origem=2030-01&destino=2030-02');
  assert.equal(pv.body.itens.length, 2);
  const it = pv.body.itens.find((x) => x.tipo === 'receber');
  assert.equal(it.novo_vencimento, '2030-02-28', 'dia 31 vira último dia de fevereiro');
  assert.equal(it.ja_projetado, null);
  const ex = await req('POST', '/api/projecao/executar', { origem: '2030-01', destino: '2030-02', itens: [
    { tipo: 'receber', nro_documento: orig.body.nro_documento, valor_centavos: 200 },
    { tipo: 'pagar', nro_documento: pag.body.nro_documento } ] });
  assert.equal(ex.status, 201);
  assert.equal(ex.body.resumo.receber.qtd, 1);
  const novo = await req('GET', `/api/receber/${ex.body.criados.find((c) => c.tipo === 'receber').novo}`);
  assert.equal(novo.body.data_pagamento, null, 'sem data de pagamento');
  assert.equal(novo.body.status, 'PENDENTE');
  assert.equal(novo.body.data_emissao, '2030-02-15');
  assert.equal(novo.body.valor_centavos, 200);
  assert.equal(novo.body.projetado_de, orig.body.nro_documento);
  assert.ok(novo.body.rateio[0].valor_centavos <= 200, 'rateio reduzido proporcionalmente');
  const pv2 = await req('GET', '/api/projecao/preview?origem=2030-01&destino=2030-02');
  assert.ok(pv2.body.itens.every((x) => x.ja_projetado), 'detecta já projetados');
});

test('exclusão protegida por integridade referencial', async () => {
  const r = await req('DELETE', `/api/cadastros/clientes/${ids.cli}`);
  assert.equal(r.status, 409);
});

test('alerta diário por e-mail (SMTP simulado)', async () => {
  const net = require('net');
  const recebidos = [];
  const smtp = net.createServer((sock) => {
    let dados = false, buf = '', msg = '';
    sock.write('220 teste ESMTP\r\n');
    sock.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const linha = buf.slice(0, i); buf = buf.slice(i + 2);
        if (dados) { if (linha === '.') { dados = false; recebidos.push(msg); sock.write('250 OK\r\n'); } else msg += linha + '\n'; continue; }
        if (/^EHLO/.test(linha)) sock.write('250-teste\r\n250 AUTH LOGIN\r\n');
        else if (linha === 'AUTH LOGIN') sock.write('334 VXNlcm5hbWU6\r\n');
        else if (/^[A-Za-z0-9+/=]+$/.test(linha) && !/^(QUIT|DATA)$/.test(linha)) sock.write(Buffer.from(linha, 'base64').toString() === 'segredo' ? '235 OK\r\n' : '334 UGFzc3dvcmQ6\r\n');
        else if (linha === 'DATA') { dados = true; sock.write('354 go\r\n'); }
        else if (linha === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
  });
  await new Promise((r) => smtp.listen(0, '127.0.0.1', r));
  const t = hoje();
  await req('POST', '/api/pagar', { data_emissao: t, data_vencimento: t, tipo_ambiente: 'EMPRESA', fornecedor_id: ids.forn, categoria_id: ids.catDespEmp, valor_centavos: 123456, observacoes: 'Conta de teste do alerta' });
  const cfg = await req('PUT', '/api/admin/alerta', { ativo: true, destinatarios: 'marcelo.opw@gmail.com', horario: '08:00', diasAFrente: 3,
    incluirAtrasados: true, incluirReceber: true, fimDeSemanaNaSexta: true, enviarSemVencimentos: true,
    smtp: { host: '127.0.0.1', porta: smtp.address().port, seguranca: 'nenhuma', usuario: 'robo@teste', senha: 'segredo', remetenteNome: 'Openway Financeiro' } });
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.config.smtp.senha, '', 'senha não volta para a tela');
  assert.equal(cfg.body.config.smtp.temSenha, true);
  const pv = await req('GET', '/api/admin/alerta/previa');
  assert.ok(pv.body.html.includes('Conta de teste do alerta'));
  assert.ok(pv.body.assunto.includes('a pagar hoje'));
  const env = await req('POST', '/api/admin/alerta/enviar', {});
  assert.equal(env.status, 200, JSON.stringify(env.body));
  assert.equal(env.body.enviado, true);
  assert.equal(recebidos.length, 1);
  assert.ok(recebidos[0].includes('To: marcelo.opw@gmail.com'));
  const b64 = recebidos[0].split('Content-Type: text/html; charset=UTF-8')[1].split('--=_ow_')[0].replace(/Content-Transfer-Encoding: base64|\s/g, '');
  assert.ok(Buffer.from(b64, 'base64').toString().includes('1.234,56'));
  // sem --forcar não reenvia no mesmo dia
  const { enviarResumo } = require('../src/alerta');
  const again = await enviarResumo();
  assert.equal(again.enviado, false);
  smtp.close();
});

test('importação diária: modelo, prévia por data, duplicidade e baixa', async () => {
  const m = await fetch(base + '/api/importacao-diaria/modelo', { headers: { Cookie: cookie } });
  assert.equal(m.status, 200);
  const { lerPlanilha } = require('../src/planilha');
  const abas = lerPlanilha(Buffer.from(await m.arrayBuffer()), 'm.xlsx');
  assert.deepEqual(abas.map((a) => a.nome), ['Lançamentos', 'Fornecedores', 'Clientes', 'Categorias', 'Formas de Pagamento', 'Centros de Custo', 'Colaboradores', 'Instruções']);
  assert.ok(abas[1].linhas.some((l) => l[0] === 'Forn'), 'aba de fornecedores com cadastros');

  const csv = (linhas) => Buffer.from(['Data Emissão;Movimento;Pessoal/Empresa;Cliente/Fornecedor;Data Vencimento;Data Pagamento;Valor;Categoria;Centro de Custo;Forma de Pagamento;Colaborador;Observação;ID', ...linhas].join('\n')).toString('base64');
  const planilha = csv([
    '05/03/2032;Pagar;Empresa;forn;10/03/2032;;150,00;Aluguel;Obra X;Pix;;sala;',
    '05/03/2032;Receber;Empresa;Cli Novo;20/03/2032;;R$ 2.000,00;Serviços;;;;projeto;A1',
    '05/03/2032;Pagar;Pessoal;Mercado;;05/03/2032;80;Mercado;;;;compra;',
    '05/03/2032;Pagar;Pessoal;Mercado;;05/03/2032;80;Mercado;;;;compra;',
    '06/03/2032;Pagar;Empresa;Outro;10/03/2032;;99;;;;;fora do dia;',
    '05/03/2032;;Empresa;Ninguém;10/03/2032;;10;;;;;sem movimento;',
  ]);
  const prev = (b) => req('POST', '/api/importacao-diaria/preview', { origem: 'arquivo', nome: 'p.csv', arquivo: planilha, de: '2032-03-05', colaboradorPadrao: 'Ana', ...b });
  let r = await prev();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.linhas.length, 5);
  assert.equal(r.body.fora, 1);
  const L = r.body.linhas;
  assert.equal(L[0].parte, 'Forn', 'nome unificado com o cadastro');
  assert.equal(L[1].colaborador, 'Ana');
  assert.equal(L[2].vencimento, '2032-03-05', 'sem vencimento usa pagamento');
  assert.notEqual(L[2].chave, L[3].chave, 'linhas iguais têm chaves diferentes');
  assert.ok(L[4].erros.length && !L[4].sel);
  let e = await req('POST', '/api/importacao-diaria/executar', { linhas: L.filter((l) => l.sel) });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.equal(e.body.pagar.titulos, 3);
  assert.equal(e.body.receber.titulos, 1);
  // de novo: tudo já importado
  r = await prev();
  assert.ok(r.body.linhas.slice(0, 4).every((l) => l.situacao === 'importado' && !l.sel));
  // pagamento preenchido depois -> baixa
  const p2 = csv(['05/03/2032;Pagar;Empresa;forn;10/03/2032;09/03/2032;150,00;Aluguel;Obra X;Pix;;sala;', '05/03/2032;Receber;Empresa;Cli Novo;20/03/2032;;R$ 2.100,00;Serviços;;;;projeto corrigido;A1']);
  r = await req('POST', '/api/importacao-diaria/preview', { origem: 'arquivo', nome: 'p.csv', arquivo: p2, de: '2032-03-05' });
  assert.equal(r.body.linhas[0].situacao, 'baixa');
  assert.equal(r.body.linhas[1].situacao, 'importado', 'com ID não duplica mesmo alterando valor');
  e = await req('POST', '/api/importacao-diaria/executar', { linhas: r.body.linhas.filter((l) => l.sel) });
  assert.equal(e.body.baixas, 1);
  const lp = await req('GET', '/api/pagar?de=2032-03-01&ate=2032-03-31');
  assert.equal(lp.body.itens.find((x) => x.valor_centavos === 15000).data_pagamento, '2032-03-09');
  assert.ok(lp.body.itens.find((x) => x.valor_centavos === 15000).centro_custo_nome === 'Obra X');
  // título igual lançado à mão -> possível duplicado
  const p3 = csv(['07/03/2032;Pagar;Empresa;Forn;10/03/2032;;150,00;Aluguel;;;;outra;']);
  r = await req('POST', '/api/importacao-diaria/preview', { origem: 'arquivo', nome: 'p.csv', arquivo: p3, de: '2032-03-07' });
  assert.equal(r.body.linhas[0].situacao, 'novo', 'título igual que veio da importação não conta como duplicado');
  await req('POST', '/api/pagar', { data_emissao: '2032-03-01', data_vencimento: '2032-03-10', tipo_ambiente: 'EMPRESA', fornecedor_id: ids.forn, categoria_id: ids.catDespEmp, valor_centavos: 15000 });
  r = await req('POST', '/api/importacao-diaria/preview', { origem: 'arquivo', nome: 'p.csv', arquivo: p3, de: '2032-03-07' });
  assert.equal(r.body.linhas[0].situacao, 'possivel');
  assert.equal(r.body.linhas[0].sel, false);
  // filtro por fornecedor
  const pf = await req('GET', `/api/pagar?de=2032-03-01&ate=2032-03-31&parte_id=${ids.forn}`);
  assert.ok(pf.body.itens.length >= 2 && pf.body.itens.every((x) => x.parte_nome === 'Forn'));
  assert.ok(pf.body.itens.length < lp.body.itens.length + 1);
  // link inválido
  assert.equal((await req('POST', '/api/importacao-diaria/preview', { origem: 'link', url: 'http://x', de: '2032-03-07' })).status, 400);
});

test('lançamento rápido (celular/voz): catálogo e confirmação', async () => {
  const t = hoje();
  const cat = await req('GET', '/api/rapido/catalogo');
  assert.equal(cat.status, 200);
  assert.ok(cat.body.fornecedores.some((f) => f.id === ids.forn));
  assert.ok(cat.body.categorias.every((c) => c.nome) && !cat.body.categorias.some((c) => c.nome === 'Serviços'), 'só categorias de despesa');
  assert.equal(cat.body.hoje, t);

  const base = { data_vencimento: '2031-05-10', pago: false, tipo_ambiente: 'EMPRESA', fornecedor_id: ids.forn, categoria_id: ids.catDespEmp, valor_centavos: 12345, observacoes: 'via voz', forma_pagamento_id: null };
  assert.equal((await req('POST', '/api/rapido/confirmar', { ...base, valor_centavos: 0 })).status, 400, 'valor obrigatório');
  assert.equal((await req('POST', '/api/rapido/confirmar', { ...base, tipo_ambiente: 'PESSOAL' })).status, 400, 'categoria EMPRESA em lançamento pessoal');
  assert.equal((await req('POST', '/api/rapido/confirmar', { ...base, fornecedor_id: null })).status, 400, 'fornecedor obrigatório');

  // a vencer: sem data de pagamento
  const a = await req('POST', '/api/rapido/confirmar', base);
  assert.equal(a.status, 201);
  assert.equal(a.body.data_pagamento, null);
  assert.equal(a.body.fornecedor_nome, 'Forn');
  // pago: data de pagamento = hoje; vencimento no passado não quebra a emissão
  const b = await req('POST', '/api/rapido/confirmar', { ...base, pago: true, data_vencimento: '2020-01-02' });
  assert.equal(b.status, 201);
  assert.equal(b.body.data_pagamento, t);
  // fornecedor novo é criado uma única vez (sem diferenciar maiúsculas)
  const c = await req('POST', '/api/rapido/confirmar', { ...base, fornecedor_id: null, fornecedor_novo: 'Padaria do Zé' });
  assert.equal(c.status, 201);
  const d = await req('POST', '/api/rapido/confirmar', { ...base, fornecedor_id: null, fornecedor_novo: 'padaria do zé' });
  assert.equal(d.status, 201);
  const fs = (await req('GET', '/api/cadastros/fornecedores')).body.filter((f) => f.nome.toLowerCase() === 'padaria do zé');
  assert.equal(fs.length, 1);
  // histórico: o último lançamento do fornecedor aparece no catálogo
  const cat2 = await req('GET', '/api/rapido/catalogo');
  const f2 = cat2.body.fornecedores.find((f) => f.nome === 'Forn');
  assert.equal(f2.ultimo.categoria_id, ids.catDespEmp);
  assert.equal(f2.ultimo.tipo_ambiente, 'EMPRESA');
  // aparece na listagem do dia de vencimento
  const lst = await req('GET', '/api/pagar?de=2031-05-10&ate=2031-05-10');
  assert.ok(lst.body.itens.some((i) => i.nro_documento === a.body.nro_documento));
});

test('importação de planilha (.csv) e zerar banco (admin)', async () => {
  const csv = 'Fornecedor;Descrição;Tipo;Vencimento;Valor R$;Categoria;Centro Custo\n'
    + 'Enel;Luz escritório;E;15/03/2031;150,50;Energia;Escritório\n'
    + 'Enel;Luz casa;P;16/03/2031;200;Energía;Casa\n'
    + 'Vivo;Celular;E;;50;Telefone;Escritorio\n';
  const pv = await req('POST', '/api/importacao/pagar/preview', { arquivo: Buffer.from(csv).toString('base64'), nome: 'x.csv' });
  assert.equal(pv.status, 200);
  assert.equal(pv.body.linhas.length, 3);
  assert.deepEqual(pv.body.linhas[2].erros, ['sem vencimento']);
  assert.equal(pv.body.novos.categorias.find((c) => c.nome === 'Energia').natureza, 'AMBOS', 'Energia/Energía unificadas e usadas em P e E');
  assert.equal(pv.body.unificados.centros.length, 1, 'Escritório/Escritorio unificados');
  const ok = pv.body.linhas.filter((l) => !l.erros.length);
  const ex = await req('POST', '/api/importacao/pagar/executar', { linhas: ok });
  assert.equal(ex.status, 201);
  assert.equal(ex.body.titulos, 2);
  assert.equal(ex.body.valor, 35050);
  const lista = await req('GET', '/api/pagar?de=2031-03-01&ate=2031-03-31');
  assert.equal(lista.body.itens.length, 2);
  assert.equal(lista.body.itens[0].data_emissao, '2031-03-01');
  // Contas a Receber: duas colunas "Descrição" (1ª = cliente), sem coluna Tipo/Colaborador
  const csvR = 'Descrição;Descrição;Vencimento;Valor R$;Categoria\nCliente Alfa;Mensalidade;10/03/2031;500;Serviços\nCliente Beta;Firewall;12/03/2031;750;Firewall\n';
  const semCol = await req('POST', '/api/importacao/receber/preview', { arquivo: Buffer.from(csvR).toString('base64'), nome: 'r.csv' });
  assert.ok(semCol.body.linhas.every((l) => l.erros.includes('sem colaborador')), 'colaborador obrigatório');
  const pr = await req('POST', '/api/importacao/receber/preview', { arquivo: Buffer.from(csvR).toString('base64'), nome: 'r.csv', opcoes: { colaboradorPadrao: 'Ana' } });
  assert.equal(pr.body.linhas[0].parte, 'Cliente Alfa');
  assert.equal(pr.body.linhas[0].descricao, 'Mensalidade');
  assert.equal(pr.body.linhas[0].tipo_ambiente, 'EMPRESA');
  const er = await req('POST', '/api/importacao/receber/executar', { linhas: pr.body.linhas });
  assert.equal(er.status, 201);
  assert.equal(er.body.titulos, 2);
  const lr = await req('GET', '/api/receber?de=2031-03-01&ate=2031-03-31');
  assert.equal(lr.body.itens.length, 2);
  assert.equal(lr.body.itens[0].colaborador_nome, 'Ana', 'usa colaborador existente');
  assert.equal(lr.body.itens[0].categoria_nome, 'Serviços');
  // backup manual (guardado no banco)
  const bk = await req('POST', '/api/admin/backup');
  assert.equal(bk.status, 201);
  assert.ok(/^backup-\d{8}-\d{6}(-\d+)?\.json\.gz$/.test(bk.body.nome));
  const lb = await req('GET', '/api/admin/backups');
  assert.ok(lb.body.backups.some((x) => x.nome === bk.body.nome));
  const dl = await fetch(base + '/api/admin/backups/' + bk.body.nome, { headers: { Cookie: cookie } });
  assert.equal(dl.status, 200);
  const dump = JSON.parse(require('zlib').gunzipSync(Buffer.from(await dl.arrayBuffer())).toString());
  assert.ok(dump.tabelas.contas_pagar.length > 0 && dump.tabelas.usuarios.length === 1, 'backup contém os dados');
  assert.equal((await fetch(base + '/api/admin/backups/..%2Fteste.db', { headers: { Cookie: cookie } })).status, 404);
  // zerar
  assert.equal((await req('POST', '/api/admin/zerar', { modo: 'lancamentos', confirmacao: 'x' })).status, 400);
  const z = await req('POST', '/api/admin/zerar', { modo: 'lancamentos', confirmacao: 'ZERAR' });
  assert.equal(z.status, 200);
  assert.ok(/\.json\.gz$/.test(z.body.backup));
  const st = await req('GET', '/api/admin/estatisticas');
  assert.equal(st.body.contas_pagar + st.body.contas_receber, 0);
  assert.ok(st.body.fornecedores > 0, 'cadastros mantidos');
  const novo = await req('POST', '/api/pagar', { data_emissao: '2031-01-01', data_vencimento: '2031-01-01', tipo_ambiente: 'EMPRESA', fornecedor_id: ids.forn, categoria_id: ids.catDespEmp, valor_centavos: 100 });
  assert.equal(novo.body.nro_documento, 1, 'numeração reiniciada');
  await req('POST', '/api/admin/zerar', { modo: 'tudo', confirmacao: 'ZERAR' });
  assert.equal((await req('GET', '/api/admin/estatisticas')).body.fornecedores, 0);
});


