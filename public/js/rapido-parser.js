/* =====================================================================
   Interpretador de frases em português para o Lançamento Rápido (Contas a Pagar).
   Módulo "universal": roda no navegador (window.RapidoParser) e no Node (testes).

   interpretar(texto, catalogo, hojeISO) -> objeto com os campos entendidos.

   catalogo = {
     fornecedores: [{ id, nome, ultimo: { categoria_id, centro_custo_id, forma_pagamento_id, tipo_ambiente } | null }],
     categorias:   [{ id, nome, natureza }],           // somente DESPESA
     centros:      [{ id, codigo, nome }],
     formas:       [{ id, nome }]
   }
   ===================================================================== */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.RapidoParser = fabrica();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ------------------------------ Utilitários ------------------------------ */
  const semAcento = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9$%/.,\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const limpaToken = (s) => s.replace(/^[^a-z0-9$]+|[^a-z0-9$]+$/g, '');
  const p2 = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const deISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const somaDias = (s, n) => { const d = deISO(s); d.setDate(d.getDate() + n); return iso(d); };
  const ultimoDia = (y, m) => new Date(y, m, 0).getDate(); // m = 1..12
  const dataValida = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= ultimoDia(y, m);

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > 2) return 3;
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let diag = prev[0]; prev[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const t = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
        diag = t;
      }
    }
    return prev[b.length];
  }

  const titulo = (s) => s.toLowerCase().replace(/(^|\s)(\S+)/g, (m, a, w) => a + (['de', 'da', 'do', 'das', 'dos', 'e'].includes(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)));

  /* --------------------------- Números por extenso --------------------------- */
  const UNID = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
    dez: 10, onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19 };
  const DEZ = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };
  const CENT = { cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
    quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800,
    novecentos: 900, novecentas: 900 };
  const palavraNumero = (t) => t in UNID || t in DEZ || t in CENT || t === 'mil' || t === 'primeiro';

  /** Junta sequências de palavras numéricas ("dois mil e quinhentos") em um único token numérico */
  function colapsarNumeros(tokens) {
    const out = [];
    let i = 0;
    while (i < tokens.length) {
      const t = tokens[i];
      if (!palavraNumero(t.n)) { out.push(t); i++; continue; }
      let j = i, atual = 0, total = 0, usados = 0;
      const orig = [];
      while (j < tokens.length) {
        const w = tokens[j].n;
        if (palavraNumero(w)) {
          if (w === 'mil') { total += (atual || 1) * 1000; atual = 0; }
          else if (w === 'primeiro') atual += 1;
          else atual += UNID[w] ?? DEZ[w] ?? CENT[w];
          orig.push(tokens[j].o); usados++; j++;
        } else if (w === 'e' && j + 1 < tokens.length && palavraNumero(tokens[j + 1].n) && usados > 0) { orig.push(tokens[j].o); j++; }
        else break;
      }
      const valor = total + atual;
      // "um/uma" isolado costuma ser artigo ("um boleto"): não vira número
      if (usados === 1 && (t.n === 'um' || t.n === 'uma')) { out.push(t); i++; continue; }
      // "2 mil": o dígito anterior é multiplicado
      if (t.n === 'mil' && out.length && /^\d+$/.test(out[out.length - 1].n) && !out[out.length - 1].num) {
        const a = out.pop();
        out.push({ o: `${a.o} mil`, n: String(Number(a.n) * 1000 + (valor > 1000 ? valor - 1000 : 0)), num: true, usado: false });
        i = j; continue;
      }
      out.push({ o: orig.join(' '), n: String(valor), num: true, usado: false });
      i = j;
    }
    return out;
  }

  /* ------------------------------ Tokenização ------------------------------ */
  function tokenizar(texto) {
    const brutos = String(texto || '').trim().split(/\s+/).filter(Boolean);
    const tokens = brutos.map((o) => {
      let n = semAcento(o).toLowerCase();
      n = n.replace(/^r\$/, 'r$ ').trim();
      return { o, n: limpaToken(n.replace(/\s.*$/, '')) || n, usado: false, bruto: semAcento(o).toLowerCase() };
    });
    // "r$150" -> separa "r$" do número
    const out = [];
    for (const t of tokens) {
      const m = t.bruto.match(/^r\$\s*(\d.*)$/);
      if (m) { out.push({ o: 'R$', n: 'r$', usado: false }); out.push({ o: m[1], n: limpaToken(m[1]) || m[1], usado: false, bruto: m[1] }); }
      else out.push(t);
    }
    // normaliza "bruto" de volta (mantém pontuação interna de números: 1.234,56 e 15/11)
    for (const t of out) {
      if (t.bruto) { const b = t.bruto.replace(/^[^a-z0-9$]+|[.,;:!?]+$/g, ''); if (/\d/.test(b)) t.n = b; }
    }
    const col = colapsarNumeros(out);
    // "N vírgula M" -> "N,M"
    const res = [];
    for (let i = 0; i < col.length; i++) {
      if (col[i].n === 'virgula' && res.length && /^\d+$/.test(res[res.length - 1].n) && col[i + 1] && /^\d+$/.test(col[i + 1].n)) {
        const a = res.pop();
        res.push({ o: `${a.o} vírgula ${col[i + 1].o}`, n: `${a.n},${col[i + 1].n}`, num: true, usado: false });
        i++;
      } else res.push(col[i]);
    }
    return res.map((t, idx) => ({ ...t, idx }));
  }

  /** Procura sequência de palavras (normalizadas) entre tokens livres; retorna índice inicial ou -1 */
  function acharSeq(tokens, seq, ini = 0, fim = tokens.length) {
    for (let i = ini; i + seq.length <= fim; i++) {
      let ok = true;
      for (let k = 0; k < seq.length; k++) if (tokens[i + k].usado || tokens[i + k].n !== seq[k]) { ok = false; break; }
      if (ok) return i;
    }
    return -1;
  }
  const consumir = (tokens, i, n = 1) => { for (let k = 0; k < n; k++) if (tokens[i + k]) tokens[i + k].usado = true; };

  /* ------------------------------ Marcadores ------------------------------ */
  const MARCADORES = [
    { campo: 'fornecedor', seqs: [['fornecedor'], ['favorecido'], ['beneficiario']] },
    { campo: 'categoria', seqs: [['categoria']] },
    { campo: 'centro', seqs: [['centro', 'de', 'custo'], ['centro', 'custo'], ['centro', 'de', 'custos']] },
    { campo: 'forma', seqs: [['forma', 'de', 'pagamento'], ['forma', 'pagamento'], ['formas', 'de', 'pagamento']] },
    { campo: 'obs', seqs: [['observacao'], ['observacoes'], ['obs'], ['anotacao'], ['descricao'], ['comentario']] },
    { campo: 'valor', seqs: [['valor']] },
    { campo: 'venc', seqs: [['vencimento'], ['vence'], ['vencendo']] },
  ];
  const FORTES = new Set(['fornecedor', 'categoria', 'centro', 'forma']);

  function acharMarcadores(tokens) {
    const achados = [];
    for (let i = 0; i < tokens.length; i++) {
      for (const m of MARCADORES) {
        let len = 0;
        for (const s of m.seqs) {
          if (i + s.length <= tokens.length && s.every((w, k) => tokens[i + k].n === w) && s.length > len) len = s.length;
        }
        if (len) { achados.push({ campo: m.campo, ini: i, len }); i += len - 1; break; }
      }
    }
    return achados;
  }

  /* ------------------------------ Datas ------------------------------ */
  const MESES = { janeiro: 1, jan: 1, fevereiro: 2, fev: 2, marco: 3, mar: 3, abril: 4, abr: 4, maio: 5, mai: 5, junho: 6, jun: 6,
    julho: 7, jul: 7, agosto: 8, ago: 8, setembro: 9, set: 9, outubro: 10, out: 10, novembro: 11, nov: 11, dezembro: 12, dez: 12 };
  const DIAS_SEMANA = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
  const PAGAMENTO_PALAVRAS = new Set(['pago', 'paga', 'paguei', 'pagou', 'pagamento', 'quitado', 'quitei', 'liquidado', 'baixado', 'pagos']);

  /** Resolve "dia D" (sem mês): mês atual se ainda não passou; senão o próximo (exceto se for data de pagamento) */
  function resolverDia(d, hoje, papel) {
    const h = deISO(hoje);
    let y = h.getFullYear(), m = h.getMonth() + 1;
    if (d < h.getDate() && papel !== 'pagamento') { m++; if (m > 12) { m = 1; y++; } }
    if (!dataValida(y, m, d)) { // dia 31 em mês curto: usa o último dia
      if (d >= 1 && d <= 31) return `${y}-${p2(m)}-${p2(ultimoDia(y, m))}`;
      return null;
    }
    return `${y}-${p2(m)}-${p2(d)}`;
  }
  function resolverDiaMes(d, m, ano, hoje) {
    const h = deISO(hoje);
    let y = ano || h.getFullYear();
    if (y < 100) y += 2000;
    if (!dataValida(y, m, d)) return null;
    // sem ano e já passou há mais de ~6 meses: provavelmente o ano que vem
    if (!ano) { const cand = new Date(y, m - 1, d); if ((h - cand) / 86400000 > 180) y++; }
    return `${y}-${p2(m)}-${p2(d)}`;
  }

  /**
   * Extrai datas dos tokens livres. Retorna [{ data, papel: 'vencimento'|'pagamento', ini, len }]
   * e marca os tokens usados.
   */
  function extrairDatas(tokens, hoje) {
    const achadas = [];
    const livre = (i, n = 1) => { for (let k = 0; k < n; k++) if (!tokens[i + k] || tokens[i + k].usado) return false; return true; };
    const papelDe = (i) => {
      for (let k = 1; k <= 3; k++) { const t = tokens[i - k]; if (t && PAGAMENTO_PALAVRAS.has(t.n)) return 'pagamento'; if (t && t.usado === false && /^(vence|vencimento|vencendo|venc)$/.test(t.n)) return 'vencimento'; }
      return 'vencimento';
    };
    const registra = (data, ini, len) => {
      if (!data) return false;
      achadas.push({ data, papel: papelDe(ini), ini, len });
      consumir(tokens, ini, len);
      return true;
    };
    const dh = deISO(hoje);

    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].usado) continue;
      const t = tokens[i].n;
      let m;
      // 15/11, 15/11/2026, 15-11-26
      if ((m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/))) {
        if (registra(resolverDiaMes(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : 0, hoje), i, 1)) continue;
      }
      // 2026-11-15
      if ((m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/)) && dataValida(+m[1], +m[2], +m[3])) { registra(t, i, 1); continue; }
      // hoje / amanhã / ontem ...
      if (t === 'hoje') { registra(hoje, i, 1); continue; }
      if (t === 'amanha') { registra(somaDias(hoje, 1), i, 1); continue; }
      if (t === 'ontem') { registra(somaDias(hoje, -1), i, 1); continue; }
      if (t === 'anteontem') { registra(somaDias(hoje, -2), i, 1); continue; }
      if (t === 'depois' && tokens[i + 1] && tokens[i + 1].n === 'de' && livre(i, 3) && tokens[i + 2].n === 'amanha') { registra(somaDias(hoje, 2), i, 3); continue; }
      // em 3 dias
      if (t === 'em' && livre(i, 3) && /^\d+$/.test(tokens[i + 1].n) && /^dias?$/.test(tokens[i + 2].n)) { registra(somaDias(hoje, Number(tokens[i + 1].n)), i, 3); continue; }
      // fim do mês
      if (['fim', 'final'].includes(t) && livre(i, 3) && tokens[i + 1].n === 'do' && /^mes$/.test(tokens[i + 2].n)) {
        registra(`${dh.getFullYear()}-${p2(dh.getMonth() + 1)}-${p2(ultimoDia(dh.getFullYear(), dh.getMonth() + 1))}`, i, 3); continue;
      }
      if (t === 'ultimo' && livre(i, 4) && tokens[i + 1].n === 'dia' && tokens[i + 2].n === 'do' && tokens[i + 3].n === 'mes') {
        registra(`${dh.getFullYear()}-${p2(dh.getMonth() + 1)}-${p2(ultimoDia(dh.getFullYear(), dh.getMonth() + 1))}`, i, 4); continue;
      }
      // semana que vem / próxima semana
      if (t === 'semana' && livre(i, 3) && tokens[i + 1].n === 'que' && tokens[i + 2].n === 'vem') { registra(somaDias(hoje, 7), i, 3); continue; }
      if (['proxima', 'proximo'].includes(t) && livre(i, 2) && tokens[i + 1].n === 'semana') { registra(somaDias(hoje, 7), i, 2); continue; }
      // dia da semana (com "próxima"/"que vem" opcionais)
      const nomeDia = t.replace(/-feira$/, '');
      if (nomeDia in DIAS_SEMANA) {
        const alvo = DIAS_SEMANA[nomeDia];
        let ini = i, len = 1, forcaProx = false;
        if (tokens[i - 1] && !tokens[i - 1].usado && ['proxima', 'proximo'].includes(tokens[i - 1].n)) { ini = i - 1; len++; forcaProx = true; }
        if (tokens[i + 1] && !tokens[i + 1].usado && tokens[i + 1].n === 'feira') len++;
        if (tokens[i + len] && tokens[i + len + 1] && tokens[i + len].n === 'que' && tokens[i + len + 1].n === 'vem' && !tokens[i + len].usado) { len += 2; forcaProx = true; }
        let delta = (alvo - dh.getDay() + 7) % 7;
        if (forcaProx && delta === 0) delta = 7;
        registra(somaDias(hoje, delta), ini, len);
        continue;
      }
      // "dia 15 [de mês] [de ano]"  |  "15 de novembro [de 2026]"
      const mesDe = (k) => { const x = tokens[k]; return x && !x.usado ? MESES[x.n] : undefined; };
      if (t === 'dia' && tokens[i + 1] && !tokens[i + 1].usado && /^\d{1,2}$/.test(tokens[i + 1].n)) {
        const d = Number(tokens[i + 1].n);
        let len = 2, mes = null, ano = 0;
        let k = i + 2;
        if (tokens[k] && !tokens[k].usado && tokens[k].n === 'de' && mesDe(k + 1)) { mes = mesDe(k + 1); len += 2; k += 2; }
        else if (mesDe(k)) { mes = mesDe(k); len += 1; k += 1; }
        if (mes) {
          if (tokens[k] && !tokens[k].usado && tokens[k].n === 'de' && tokens[k + 1] && /^(\d{4}|\d{2})$/.test(tokens[k + 1].n)) { ano = Number(tokens[k + 1].n); len += 2; }
          if (registra(resolverDiaMes(d, mes, ano, hoje), i, len)) continue;
        } else {
          // "dia 5 do mês que vem" / "dia 5 do próximo mês"
          const seq = (...w) => w.every((x, q) => tokens[k + q] && !tokens[k + q].usado && tokens[k + q].n === x);
          if (seq('do', 'mes', 'que', 'vem') || seq('do', 'proximo', 'mes') || seq('do', 'mes', 'seguinte')) {
            const n = seq('do', 'proximo', 'mes') ? 3 : 4;
            const prox = new Date(dh.getFullYear(), dh.getMonth() + 1, 1);
            const y = prox.getFullYear(), mm = prox.getMonth() + 1;
            const dd = Math.min(d, ultimoDia(y, mm));
            registra(`${y}-${p2(mm)}-${p2(dd)}`, i, len + n); continue;
          }
          if (seq('deste', 'mes') || seq('desse', 'mes') || seq('do', 'mes')) {
            const y = dh.getFullYear(), mm = dh.getMonth() + 1;
            registra(`${y}-${p2(mm)}-${p2(Math.min(d, ultimoDia(y, mm)))}`, i, len + (seq('do', 'mes') ? 2 : 2)); continue;
          }
          if (registra(resolverDia(d, hoje, papelDe(i)), i, len)) continue;
        }
      }
      if (/^\d{1,2}$/.test(t) && tokens[i + 1] && !tokens[i + 1].usado) {
        let k = i + 1, len = 1;
        if (tokens[k].n === 'de') { k++; len++; }
        if (mesDe(k)) {
          const mes = mesDe(k); len++;
          let ano = 0;
          if (tokens[k + 1] && !tokens[k + 1].usado && tokens[k + 1].n === 'de' && tokens[k + 2] && /^(\d{4}|\d{2})$/.test(tokens[k + 2].n)) { ano = Number(tokens[k + 2].n); len += 2; }
          if (registra(resolverDiaMes(Number(t), mes, ano, hoje), i, len)) continue;
        }
      }
      // "mês que vem"/"próximo mês" sem dia -> mesmo dia do mês seguinte
    }
    return achadas;
  }

  /* ------------------------------ Situação / Ambiente ------------------------------ */
  function detectarSituacao(tokens) {
    const seqsAberto = [['a', 'vencer'], ['avencer'], ['nao', 'pago'], ['nao', 'paga'], ['nao', 'paguei'], ['ainda', 'nao', 'paguei'], ['ainda', 'nao', 'foi', 'pago'],
      ['em', 'aberto'], ['aberto'], ['pendente'], ['a', 'pagar'], ['vai', 'vencer'], ['por', 'pagar'], ['nao', 'quitado'], ['nao', 'quitada']];
    const seqsPago = [['ja', 'pago'], ['ja', 'paguei'], ['pago'], ['paga'], ['paguei'], ['pagou'], ['quitado'], ['quitada'], ['quitei'], ['liquidado'], ['baixado'], ['pagos']];
    let r = null;
    for (const s of seqsAberto.sort((a, b) => b.length - a.length)) {
      const i = acharSeq(tokens, s);
      if (i >= 0) { consumir(tokens, i, s.length); r = r || 'ABERTO'; }
    }
    if (!r) for (const s of seqsPago.sort((a, b) => b.length - a.length)) {
      const i = acharSeq(tokens, s);
      if (i >= 0) { consumir(tokens, i, s.length); r = 'PAGO'; }
    }
    return r;
  }

  function detectarAmbiente(tokens) {
    const emp = [['da', 'empresa'], ['empresarial'], ['empresa'], ['pj'], ['cnpj'], ['pessoa', 'juridica']];
    const pes = [['pessoal'], ['pessoa', 'fisica'], ['pf'], ['cpf'], ['particular'], ['da', 'casa']];
    let e = null;
    for (const [lista, valor] of [[emp, 'EMPRESA'], [pes, 'PESSOAL']]) {
      for (const s of lista.slice().sort((a, b) => b.length - a.length)) {
        const i = acharSeq(tokens, s);
        if (i >= 0) { consumir(tokens, i, s.length); e = e || valor; }
      }
    }
    return e;
  }

  /* ------------------------------ Casamento difuso de nomes ------------------------------ */
  const STOP_NOME = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'ltda', 'me', 'sa', 'eireli', 'epp', 'the', 'a', 'o']);
  const tokensNome = (nome) => norm(nome).split(' ').map(limpaToken).filter((w) => w && !STOP_NOME.has(w));

  function tokenCasa(palavra, alvo) {
    if (palavra === alvo) return 1;
    if (palavra.length >= 5 && alvo.length >= 5) {
      const d = levenshtein(palavra, alvo);
      if (d <= 1 || (palavra.length >= 9 && d <= 2)) return 0.85;
    }
    return 0;
  }

  /**
   * Procura, entre os tokens livres da janela [ini, fim), o melhor cadastro.
   * itens: [{ id, nomes: [string, ...] }]. Retorna { id, score, posicoes, candidatos }.
   */
  function casar(tokens, itens, ini, fim) {
    const livres = [];
    for (let i = ini; i < fim; i++) if (!tokens[i].usado && tokens[i].n && !/^(r\$)$/.test(tokens[i].n)) livres.push(i);
    const avaliacoes = [];
    for (const it of itens) {
      let melhor = null;
      for (const nome of it.nomes) {
        const alvo = tokensNome(nome);
        if (!alvo.length) continue;
        const obrig = alvo.filter((w) => !/^\d+$/.test(w));
        const numericos = alvo.filter((w) => /^\d+$/.test(w));
        const usados = new Set();
        const posicoes = [];
        let soma = 0, faltou = false;
        for (const w of obrig) {
          let bi = -1, bs = 0;
          for (const i of livres) {
            if (usados.has(i)) continue;
            const s = tokenCasa(tokens[i].n, w);
            if (s > bs) { bs = s; bi = i; if (s === 1) break; }
          }
          if (bi < 0) { faltou = true; break; }
          usados.add(bi); posicoes.push(bi); soma += w.length * bs;
        }
        if (faltou || !obrig.length) continue;
        for (const w of numericos) {
          const i = livres.find((x) => !usados.has(x) && tokens[x].n === w);
          if (i !== undefined) { usados.add(i); posicoes.push(i); soma += w.length * 1.2; } else soma -= 0.5;
        }
        // bônus: palavras na mesma ordem e adjacentes
        const ord = posicoes.slice().sort((a, b) => a - b);
        let adj = 0; for (let k = 1; k < ord.length; k++) if (ord[k] === ord[k - 1] + 1) adj++;
        soma += adj * 0.4;
        // penaliza nomes curtos demais (ex.: "Luz" casando por acaso)
        if (obrig.join('').length < 3) continue;
        if (!melhor || soma > melhor.score) melhor = { id: it.id, score: soma, posicoes: ord };
      }
      if (melhor) avaliacoes.push(melhor);
    }
    avaliacoes.sort((a, b) => b.score - a.score || a.posicoes.length - b.posicoes.length);
    if (!avaliacoes.length) return null;
    const topo = avaliacoes[0];
    const candidatos = avaliacoes.filter((x) => x.score >= topo.score * 0.7).slice(0, 4).map((x) => x.id);
    return { ...topo, candidatos };
  }

  /* ------------------------------ Valor ------------------------------ */
  /** Converte texto numérico ("1.234,56", "150,5", "150.50", "1500") em centavos */
  function numeroParaCentavos(s) {
    if (!/^\d[\d.,]*$/.test(s)) return null;
    let v = s;
    if (v.includes(',')) { // vírgula = decimal; pontos = milhar
      const [i, d] = v.split(',');
      if (v.split(',').length > 2) return null;
      return Number(i.replace(/\./g, '')) * 100 + Math.round(Number(('0.' + (d || '0'))) * 100);
    }
    if (v.includes('.')) {
      const partes = v.split('.');
      const ult = partes[partes.length - 1];
      if (partes.length === 2 && ult.length <= 2) return Number(partes[0]) * 100 + Math.round(Number('0.' + ult) * 100); // 150.50
      if (partes.slice(1).every((p) => p.length === 3)) return Number(partes.join('')) * 100;               // 1.500 | 1.234.567
      return null;
    }
    return Number(v) * 100;
  }

  function extrairValor(tokens, preferirJanela) {
    const cand = [];
    const ehNum = (t) => t && !t.usado && /^\d[\d.,]*$/.test(t.n);
    for (let i = 0; i < tokens.length; i++) {
      if (!ehNum(tokens[i])) continue;
      let cents = numeroParaCentavos(tokens[i].n);
      if (cents === null) continue;
      let len = 1, forte = 0;
      // "2 mil" / "1,5 mil"
      if (tokens[i + 1] && !tokens[i + 1].usado && tokens[i + 1].n === 'mil') { cents *= 1000; len++; }
      const antes = tokens[i - 1], depois = tokens[i + len];
      if (antes && !antes.usado && antes.n === 'r$') forte += 3;
      if (antes && !antes.usado && ['valor', 'de', 'total', 'custa', 'custou'].includes(antes.n) && tokens[i - 2] && !tokens[i - 2].usado && ['valor', 'total', 'custa'].includes(antes.n === 'de' ? tokens[i - 2].n : antes.n)) forte += 2;
      if (antes && !antes.usado && antes.n === 'valor') forte += 2;
      if (depois && !depois.usado && /^(reais|real|conto|contos|pila|pilas)$/.test(depois.n)) {
        forte += 3;
        // "e 50 centavos"
        let k = i + len + 1;
        if (tokens[k] && !tokens[k].usado && tokens[k].n === 'e') k++;
        if (tokens[k] && ehNum(tokens[k]) && tokens[k + 1] && /^centavos?$/.test(tokens[k + 1].n)) {
          cents += Number(tokens[k].n) % 100;
          cand.push({ i, len: k + 2 - i, cents, forte });
          continue;
        }
      }
      if (depois && !depois.usado && /^centavos?$/.test(depois.n)) { forte -= 1; }
      // números que parecem ano ou nº grandes sem pista são fracos
      cand.push({ i, len, cents, forte });
    }
    if (!cand.length) return null;
    cand.sort((a, b) => b.forte - a.forte || b.cents - a.cents);
    const c = cand[0];
    if (c.cents <= 0) return null;
    consumir(tokens, c.i, c.len);
    // consome o "reais"/"r$" colado
    const d = tokens[c.i + c.len];
    if (d && !d.usado && /^(reais|real|conto|contos|pila|pilas)$/.test(d.n)) d.usado = true;
    const a = tokens[c.i - 1];
    if (a && !a.usado && a.n === 'r$') a.usado = true;
    return { centavos: c.cents, forte: c.forte };
  }

  /* ------------------------------ Forma de pagamento ------------------------------ */
  function aliasesForma(nome) {
    const n = norm(nome);
    const a = [n];
    if (n.includes('pix')) a.push('pix', 'pics', 'picks');
    if (n.includes('boleto')) a.push('boleto', 'boletos');
    if (n.includes('credito')) a.push('cartao de credito', 'cartao credito', 'credito', 'no credito');
    if (n.includes('debito') && n.includes('cartao')) a.push('cartao de debito', 'cartao debito', 'no debito');
    if (n.includes('automatico')) a.push('debito automatico', 'debito em conta', 'automatico');
    if (n.includes('dinheiro')) a.push('dinheiro', 'especie', 'em maos');
    if (n.includes('transfer')) a.push('transferencia', 'ted', 'doc', 'tev');
    return [...new Set(a)];
  }

  function extrairForma(tokens, formas, ini, fim) {
    let melhor = null;
    for (const f of formas) {
      for (const alias of aliasesForma(f.nome)) {
        const seq = alias.split(' ');
        const i = acharSeq(tokens, seq, ini, fim);
        if (i >= 0 && (!melhor || seq.length > melhor.len)) melhor = { id: f.id, i, len: seq.length };
      }
    }
    if (melhor) { consumir(tokens, melhor.i, melhor.len); return melhor.id; }
    return null;
  }

  /* ------------------------------ Sinônimos de categoria ------------------------------ */
  const SINONIMOS_CATEGORIA = {
    energia: ['luz', 'eletrica', 'eletricidade', 'enel'],
    combustivel: ['gasolina', 'etanol', 'diesel', 'abastecimento', 'alcool'],
    celular: ['telefone', 'telefonia', 'chip'],
    impostos: ['imposto', 'tributo', 'tributos', 'darf', 'das', 'simples'],
    internet: ['wifi', 'banda', 'fibra'],
    contabilidade: ['contador', 'contabil'],
    condominio: ['condominio'],
    juros: ['juro', 'multa'],
  };
  const nomesCategoria = (c) => {
    const base = norm(c.nome);
    const extra = SINONIMOS_CATEGORIA[base] || [];
    return [c.nome, ...extra];
  };

  /* ------------------------------ Interpretador principal ------------------------------ */
  function interpretar(texto, catalogo, hoje) {
    const cat = { fornecedores: [], categorias: [], centros: [], formas: [], ...(catalogo || {}) };
    const tokens = tokenizar(texto);
    const r = {
      texto: String(texto || ''),
      vencimento: null, vencimento_origem: null,
      pago: false, situacao_origem: null, data_pagamento: null,
      ambiente: null, ambiente_origem: null,
      fornecedor_id: null, fornecedor_novo: null, fornecedor_candidatos: [], fornecedor_origem: null,
      categoria_id: null, categoria_origem: null,
      centro_custo_id: null, centro_origem: null,
      forma_pagamento_id: null, forma_origem: null,
      valor_centavos: null,
      observacoes: '',
      nao_entendido: '',
      faltando: [],
    };
    if (!tokens.length) { r.faltando = ['vencimento', 'ambiente', 'fornecedor', 'categoria', 'valor']; return r; }

    // 1) Marcadores explícitos ("fornecedor ...", "categoria ...", "observação ...")
    const marcas = acharMarcadores(tokens);
    const janela = {};   // campo -> { ini, fim }
    marcas.forEach((m, idx) => {
      consumir(tokens, m.ini, m.len);
      let fim = tokens.length;
      for (let k = idx + 1; k < marcas.length; k++) {
        // a observação só termina em outro marcador "forte"; os demais campos terminam em qualquer marcador
        if (m.campo !== 'obs' || FORTES.has(marcas[k].campo)) { fim = marcas[k].ini; break; }
      }
      janela[m.campo] = { ini: m.ini + m.len, fim };
    });

    // 2) Observações (consome o trecho todo; o original preserva acentuação e caixa)
    if (janela.obs) {
      const { ini, fim } = janela.obs;
      const partes = [];
      for (let i = ini; i < fim; i++) { partes.push(tokens[i].o); tokens[i].usado = true; tokens[i].obs = true; }
      r.observacoes = partes.join(' ').replace(/^[:,\-\s]+/, '').trim();
      if (r.observacoes) r.observacoes = r.observacoes.charAt(0).toUpperCase() + r.observacoes.slice(1);
    }

    // 3) Datas
    const datas = extrairDatas(tokens, hoje);
    const dv = datas.find((d) => d.papel === 'vencimento');
    const dp = datas.find((d) => d.papel === 'pagamento');
    if (dv) { r.vencimento = dv.data; r.vencimento_origem = 'falado'; }

    // 4) Situação e ambiente
    const sit = detectarSituacao(tokens);
    if (sit) { r.pago = sit === 'PAGO'; r.situacao_origem = 'falado'; }
    else if (dp) { r.pago = true; r.situacao_origem = 'falado'; }
    else r.situacao_origem = 'assumido';
    if (r.pago) r.data_pagamento = dp ? dp.data : hoje;
    if (!r.vencimento && dp) { r.vencimento = dp.data; r.vencimento_origem = 'falado'; }
    const amb = detectarAmbiente(tokens);
    if (amb) { r.ambiente = amb; r.ambiente_origem = 'falado'; }

    // 5) Forma de pagamento (antes dos nomes, para "cartão de crédito" não virar fornecedor)
    const jf = janela.forma || { ini: 0, fim: tokens.length };
    let formaId = extrairForma(tokens, cat.formas, jf.ini, jf.fim);
    if (formaId) { r.forma_pagamento_id = formaId; r.forma_origem = 'falado'; }

    // 6) Fornecedor
    const jfo = janela.fornecedor || { ini: 0, fim: tokens.length };
    let rf = casar(tokens, cat.fornecedores.map((f) => ({ id: f.id, nomes: [f.nome] })), jfo.ini, jfo.fim);
    if (rf) {
      r.fornecedor_id = rf.id; r.fornecedor_origem = 'falado';
      r.fornecedor_candidatos = rf.candidatos.filter((id) => id !== rf.id);
      for (const i of rf.posicoes) tokens[i].usado = true;
    } else if (janela.fornecedor) {
      const nome = [];
      for (let i = jfo.ini; i < jfo.fim; i++) if (!tokens[i].usado) { nome.push(tokens[i].o); tokens[i].usado = true; }
      const novo = nome.join(' ').replace(/[.,;:!?]+$/g, '').trim();
      if (novo) { r.fornecedor_novo = titulo(novo); r.fornecedor_origem = 'novo'; }
    }
    let histF = r.fornecedor_id ? (cat.fornecedores.find((f) => f.id === r.fornecedor_id) || {}).ultimo : null;
    // Ambiente falado diferente do histórico: o histórico de categoria/centro não vale
    const histMesmoAmb = !!histF && !(r.ambiente_origem === 'falado' && histF.tipo_ambiente && histF.tipo_ambiente !== r.ambiente);

    // 7) Categoria (respeita o ambiente quando já conhecido)
    const compat = (c, a) => !a || c.natureza === 'AMBOS' || c.natureza === a;
    const categoriasBase = () => cat.categorias.filter((c) => compat(c, r.ambiente));
    const jc = janela.categoria || { ini: 0, fim: tokens.length };
    const itensCat = (lista) => lista.map((c) => ({ id: c.id, nomes: nomesCategoria(c) }));
    let rc = casar(tokens, itensCat(categoriasBase()), jc.ini, jc.fim);
    if (!rc && r.ambiente) { /* se nada compatível, tenta qualquer uma (o ambiente pode estar errado) */
      rc = casar(tokens, itensCat(cat.categorias), jc.ini, jc.fim);
    }
    if (rc) {
      r.categoria_id = rc.id; r.categoria_origem = 'falado';
      for (const i of rc.posicoes) tokens[i].usado = true;
    }

    // 8) Centro de custo
    const jcc = janela.centro || { ini: 0, fim: tokens.length };
    const itensCC = cat.centros.map((c) => ({ id: c.id, nomes: [c.nome, ...(c.codigo ? [c.codigo + ' ' + c.nome] : [])] }));
    let rcc = casar(tokens, itensCC, jcc.ini, jcc.fim);
    if (rcc) {
      r.centro_custo_id = rcc.id; r.centro_origem = 'falado';
      for (const i of rcc.posicoes) tokens[i].usado = true;
    }

    // 9) Valor
    const jv = extrairValor(tokens);
    if (jv) r.valor_centavos = jv.centavos;
    else if (r.observacoes) { // último recurso: valor citado "em reais" dentro da observação
      const obsTok = tokens.filter((t) => t.obs).map((t) => ({ ...t, usado: false }));
      const v2 = extrairValor(obsTok);
      if (v2 && v2.forte >= 3) r.valor_centavos = v2.centavos;
    }

    // 10) Sugestões pelo histórico do fornecedor e pela natureza da categoria
    if (histF) {
      if (!r.categoria_id && histMesmoAmb && histF.categoria_id && cat.categorias.some((c) => c.id === histF.categoria_id && compat(c, r.ambiente))) { r.categoria_id = histF.categoria_id; r.categoria_origem = 'historico'; }
      if (!r.centro_custo_id && histMesmoAmb && histF.centro_custo_id && cat.centros.some((c) => c.id === histF.centro_custo_id)) { r.centro_custo_id = histF.centro_custo_id; r.centro_origem = 'historico'; }
      if (!r.forma_pagamento_id && histF.forma_pagamento_id && cat.formas.some((f) => f.id === histF.forma_pagamento_id)) { r.forma_pagamento_id = histF.forma_pagamento_id; r.forma_origem = 'historico'; }
      if (!r.ambiente && histF.tipo_ambiente) { r.ambiente = histF.tipo_ambiente; r.ambiente_origem = 'historico'; }
    }
    if (!r.ambiente && r.categoria_id) {
      const c = cat.categorias.find((x) => x.id === r.categoria_id);
      if (c && c.natureza !== 'AMBOS') { r.ambiente = c.natureza; r.ambiente_origem = 'categoria'; }
    }
    // Categoria escolhida incompatível com o ambiente: procura a homônima compatível
    if (r.categoria_id && r.ambiente) {
      const c = cat.categorias.find((x) => x.id === r.categoria_id);
      if (c && !compat(c, r.ambiente)) {
        const alt = cat.categorias.find((x) => norm(x.nome) === norm(c.nome) && compat(x, r.ambiente));
        if (alt) r.categoria_id = alt.id;
      }
    }

    // 11) Padrões: vencimento = hoje quando não dito
    if (!r.vencimento) { r.vencimento = hoje; r.vencimento_origem = 'assumido'; }

    // 12) O que sobrou
    const IGNORAR = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'e', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'para', 'pra', 'pro', 'por', 'com', 'que', 'e', 'eh',
      'conta', 'contas', 'lancamento', 'lancar', 'lance', 'novo', 'nova', 'despesa', 'pagar', 'vence', 'vencimento', 'vencendo', 'venc', 'valor', 'reais', 'real', 'r$', 'dia', 'foi', 'ser', 'esta', 'está', 'tem', 'ao', 'via', 'total', 'mes', 'ate', 'ja', 'ainda', 'nao', 'sim', 'ok', 'por favor', 'favor', 'tipo', 'sendo', 'seria', 'eu', 'minha', 'meu']);
    const resto = tokens.filter((t) => !t.usado && !IGNORAR.has(t.n) && t.n).map((t) => t.o);
    r.nao_entendido = resto.join(' ');

    // 13) Campos que ainda faltam para confirmar
    if (!r.ambiente) r.faltando.push('ambiente');
    if (!r.fornecedor_id && !r.fornecedor_novo) r.faltando.push('fornecedor');
    if (!r.categoria_id) r.faltando.push('categoria');
    if (!r.valor_centavos) r.faltando.push('valor');
    return r;
  }

  return { interpretar, tokenizar, numeroParaCentavos, norm, levenshtein };
}));
