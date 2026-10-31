'use strict';
/* Testes do interpretador de voz (não precisam de banco de dados). */
const test = require('node:test');
const assert = require('node:assert');
const P = require('../public/js/rapido-parser.js');

const HOJE = '2026-10-31'; // sábado
const cat = {
  fornecedores: [
    { id: 1, nome: 'Claro', ultimo: { categoria_id: 12, centro_custo_id: 21, forma_pagamento_id: 31, tipo_ambiente: 'EMPRESA' } },
    { id: 2, nome: 'Cartão Nubank', ultimo: { categoria_id: 14, centro_custo_id: null, forma_pagamento_id: null, tipo_ambiente: 'PESSOAL' } },
    { id: 3, nome: 'Cartão Porto 110', ultimo: null },
    { id: 4, nome: 'Cartão Itaú Black 4514', ultimo: null },
    { id: 5, nome: 'Combustível', ultimo: { categoria_id: 13, centro_custo_id: 22, forma_pagamento_id: null, tipo_ambiente: 'EMPRESA' } },
    { id: 6, nome: 'Bradesco', ultimo: null },
  ],
  categorias: [
    { id: 11, nome: 'Internet', natureza: 'EMPRESA' },
    { id: 12, nome: 'Celular', natureza: 'AMBOS' },
    { id: 13, nome: 'Combustível', natureza: 'AMBOS' },
    { id: 14, nome: 'Despesas', natureza: 'AMBOS' },
    { id: 15, nome: 'Energia', natureza: 'AMBOS' },
    { id: 16, nome: 'Juros', natureza: 'PESSOAL' },
    { id: 17, nome: 'Juros', natureza: 'AMBOS' },
    { id: 18, nome: 'Aluguel', natureza: 'EMPRESA' },
  ],
  centros: [{ id: 21, codigo: null, nome: 'Openway' }, { id: 22, codigo: null, nome: 'Combustivel' }, { id: 23, codigo: '1.01', nome: 'Escritório Osasco' }],
  formas: [{ id: 31, nome: 'Boleto' }, { id: 32, nome: 'Pix' }, { id: 33, nome: 'Cartão de Crédito' }, { id: 34, nome: 'Cartão de Débito' }, { id: 35, nome: 'Débito Automático' }, { id: 36, nome: 'Dinheiro' }],
};
const ler = (t) => P.interpretar(t, cat, HOJE);

test('frase completa com marcadores', () => {
  const r = ler('vencimento dia 15 a vencer empresa fornecedor Claro categoria celular valor 189,90 centro de custo Openway observação plano móvel de novembro forma de pagamento boleto');
  assert.equal(r.vencimento, '2026-11-15');
  assert.equal(r.pago, false);
  assert.equal(r.data_pagamento, null);
  assert.equal(r.ambiente, 'EMPRESA');
  assert.equal(r.fornecedor_id, 1);
  assert.equal(r.categoria_id, 12);
  assert.equal(r.valor_centavos, 18990);
  assert.equal(r.centro_custo_id, 21);
  assert.equal(r.forma_pagamento_id, 31);
  assert.equal(r.observacoes, 'Plano móvel de novembro');
  assert.deepEqual(r.faltando, []);
});

test('pago preenche a data de pagamento com o dia de hoje', () => {
  const r = ler('hoje pago pessoal bradesco 150 reais no pix categoria despesas');
  assert.equal(r.pago, true);
  assert.equal(r.data_pagamento, HOJE);
  assert.equal(r.vencimento, HOJE);
  assert.equal(r.forma_pagamento_id, 32);
  assert.equal(r.valor_centavos, 15000);
});

test('"a vencer" e "ainda não paguei" deixam sem data de pagamento', () => {
  assert.equal(ler('amanhã empresa claro 99 a vencer').data_pagamento, null);
  assert.equal(ler('amanhã empresa claro 99 ainda não paguei').pago, false);
  assert.equal(ler('amanhã empresa claro 99 não pago').pago, false);
});

test('datas: relativas, por extenso e numéricas', () => {
  assert.equal(ler('amanhã claro 10').vencimento, '2026-11-01');
  assert.equal(ler('depois de amanhã claro 10').vencimento, '2026-11-02');
  assert.equal(ler('dia 3 claro 10').vencimento, '2026-11-03', 'dia já passado no mês -> mês seguinte');
  assert.equal(ler('dia 31 claro 10').vencimento, '2026-10-31');
  assert.equal(ler('dia vinte e cinco claro 10').vencimento, '2026-11-25');
  assert.equal(ler('quinze de novembro claro 10').vencimento, '2026-11-15');
  assert.equal(ler('15/11 claro 10').vencimento, '2026-11-15');
  assert.equal(ler('20/12/2026 claro 10').vencimento, '2026-12-20');
  assert.equal(ler('vence sexta-feira claro 10').vencimento, '2026-11-06');
  assert.equal(ler('vence segunda claro 10').vencimento, '2026-11-02');
  assert.equal(ler('dia 5 do mês que vem claro 10').vencimento, '2026-11-05');
  assert.equal(ler('fim do mês claro 10').vencimento, '2026-10-31');
  assert.equal(ler('em 3 dias claro 10').vencimento, '2026-11-03');
});

test('sem data: assume hoje e marca como "assumido"', () => {
  const r = ler('empresa claro 10');
  assert.equal(r.vencimento, HOJE);
  assert.equal(r.vencimento_origem, 'assumido');
});

test('valores: dígitos, por extenso, milhar e centavos', () => {
  assert.equal(ler('claro R$ 1.234,56').valor_centavos, 123456);
  assert.equal(ler('claro r$150').valor_centavos, 15000);
  assert.equal(ler('claro 150,5').valor_centavos, 15050);
  assert.equal(ler('claro 1.500').valor_centavos, 150000);
  assert.equal(ler('claro 2 mil').valor_centavos, 200000);
  assert.equal(ler('claro cento e cinquenta reais').valor_centavos, 15000);
  assert.equal(ler('claro mil e duzentos reais').valor_centavos, 120000);
  assert.equal(ler('claro dois mil e quinhentos reais').valor_centavos, 250000);
  assert.equal(ler('claro 350 reais e 75 centavos').valor_centavos, 35075);
  assert.equal(ler('claro cento e cinquenta vírgula cinquenta').valor_centavos, 15050);
});

test('o número do dia não vira valor e o número do fornecedor não vira valor', () => {
  const a = ler('vence dia 15 claro 189,90');
  assert.equal(a.valor_centavos, 18990);
  const b = ler('cartão porto 110 pessoal 350 reais');
  assert.equal(b.fornecedor_id, 3);
  assert.equal(b.valor_centavos, 35000);
  const c = ler('cartão itaú black 4514 pessoal 80,00');
  assert.equal(c.fornecedor_id, 4);
  assert.equal(c.valor_centavos, 8000);
});

test('fornecedor com pequena diferença de grafia (voz) é reconhecido', () => {
  assert.equal(ler('empresa bradesco 10').fornecedor_id, 6);
  assert.equal(ler('empresa bradescu 10').fornecedor_id, 6);
  assert.equal(ler('pessoal cartao nubank 10').fornecedor_id, 2);
});

test('fornecedor desconhecido com marcador vira "novo"', () => {
  const r = ler('empresa fornecedor Padaria do Zé categoria despesas valor 45,50');
  assert.equal(r.fornecedor_id, null);
  assert.equal(r.fornecedor_novo, 'Padaria do Zé');
  assert.equal(r.categoria_id, 14);
  assert.equal(r.valor_centavos, 4550);
  assert.deepEqual(r.faltando, []);
});

test('histórico do fornecedor completa categoria, centro, forma e ambiente', () => {
  const r = ler('dia 20 claro 99,90');
  assert.equal(r.categoria_id, 12);
  assert.equal(r.categoria_origem, 'historico');
  assert.equal(r.centro_custo_id, 21);
  assert.equal(r.forma_pagamento_id, 31);
  assert.equal(r.ambiente, 'EMPRESA');
  assert.equal(r.ambiente_origem, 'historico');
});

test('ambiente falado diferente do histórico: não usa categoria/centro do histórico', () => {
  const r = ler('dia 20 pessoal claro 99,90');
  assert.equal(r.ambiente, 'PESSOAL');
  assert.equal(r.centro_custo_id, null);
});

test('categoria respeita o ambiente (homônimas) e deduz o ambiente pela natureza', () => {
  const emp = ler('empresa juros 10');
  assert.equal(emp.categoria_id, 17, 'empresa: só a de natureza AMBOS serve');
  const pes = ler('pessoal juros 10');
  assert.ok([16, 17].includes(pes.categoria_id));
  const dedu = ler('aluguel 2000 reais');
  assert.equal(dedu.categoria_id, 18);
  assert.equal(dedu.ambiente, 'EMPRESA');
  assert.equal(dedu.ambiente_origem, 'categoria');
});

test('sinônimos de categoria', () => {
  assert.equal(ler('empresa conta de luz 230 reais').categoria_id, 15);
  assert.equal(ler('empresa gasolina 100 reais').categoria_id, 13);
});

test('formas de pagamento por apelido', () => {
  assert.equal(ler('claro 10 no pix').forma_pagamento_id, 32);
  assert.equal(ler('claro 10 cartão de crédito').forma_pagamento_id, 33);
  assert.equal(ler('claro 10 no débito').forma_pagamento_id, 34);
  assert.equal(ler('claro 10 débito automático').forma_pagamento_id, 35);
  assert.equal(ler('claro 10 em dinheiro').forma_pagamento_id, 36);
});

test('observação vai até o próximo campo marcado', () => {
  const r = ler('claro 10 observação parcela 2 de 5 forma de pagamento pix');
  assert.equal(r.observacoes, 'Parcela 2 de 5');
  assert.equal(r.forma_pagamento_id, 32);
  assert.equal(r.valor_centavos, 1000);
});

test('campos que faltam e texto não entendido', () => {
  const r = ler('hoje xpto');
  assert.ok(r.faltando.includes('fornecedor') && r.faltando.includes('valor') && r.faltando.includes('categoria') && r.faltando.includes('ambiente'));
  assert.equal(r.nao_entendido, 'xpto');
  assert.deepEqual(ler('').faltando.includes('valor'), true);
});

test('utilitários', () => {
  assert.equal(P.numeroParaCentavos('1.234,56'), 123456);
  assert.equal(P.numeroParaCentavos('150.50'), 15050);
  assert.equal(P.numeroParaCentavos('1.500'), 150000);
  assert.equal(P.levenshtein('bradesco', 'bradescu'), 1);
});
