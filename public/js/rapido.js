/* =====================================================================
   Lançamento rápido de Contas a Pagar por voz (celular)
   Fluxo: falar (ou digitar) -> o sistema interpreta -> conferir/corrigir -> Confirmar.
   ===================================================================== */
'use strict';

const Rapido = {
  cat: null,
  rec: null,
  ouvindo: false,
  origem: {},        // campo -> 'falado' | 'historico' | 'categoria' | 'assumido' | 'novo' | null
  salvando: false,

  EXEMPLO: 'Vence dia 15, a vencer, empresa, fornecedor Claro, categoria celular, valor 189,90, centro de custo Openway, forma de pagamento boleto, observação plano de novembro',

  async render(el) {
    el.innerHTML = '<div class="rp"><div class="empty">Carregando cadastros…</div></div>';
    this.cat = await api('/api/rapido/catalogo');
    this.montar(el);
  },

  sair() { this.parar(); },

  /* ------------------------------ Estrutura da tela ------------------------------ */
  montar(el) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    this.suporte = !!SR;
    el.innerHTML = `<div class="rp">
      <section class="rp-voz">
        <button class="rp-mic" id="rp-mic" type="button" aria-label="Falar">${I.mic}</button>
        <div class="rp-status" id="rp-status" aria-live="polite">${this.suporte ? 'Toque no microfone e fale o lançamento' : 'Digite ou use o microfone do teclado'}</div>
        <textarea class="input" id="rp-texto" rows="3" inputmode="text" placeholder="O que você falar aparece aqui. Também dá para digitar ou ditar pelo teclado."></textarea>
        <div class="rp-acoes">
          <button class="btn" id="rp-limpar" type="button">${I.x}<span>Limpar</span></button>
          <button class="btn primary" id="rp-interpretar" type="button">${I.sparkle}<span>Interpretar</span></button>
        </div>
        <details class="rp-dica">
          <summary>Como falar</summary>
          <p>Diga na ordem que quiser: <b>vencimento</b>, se está <b>pago</b> ou <b>a vencer</b>, <b>empresa</b> ou <b>pessoal</b>, <b>fornecedor</b>, <b>categoria</b>, <b>valor</b>, <b>centro de custo</b>, <b>forma de pagamento</b> e <b>observação</b>.</p>
          <p class="rp-ex">“${esc(this.EXEMPLO)}”</p>
          <p>Dicas: dizer <i>“fornecedor …”</i>, <i>“categoria …”</i>, <i>“centro de custo …”</i> e <i>“observação …”</i> deixa tudo mais preciso. Se faltar algo, é só completar na tela. Fornecedor, categoria e centro de custo que você já usou antes são sugeridos automaticamente.</p>
          ${this.suporte ? '' : '<p class="rp-aviso">Este navegador não libera o reconhecimento de voz dentro do app. No iPhone, toque no microfone do teclado para ditar.</p>'}
        </details>
      </section>
      <section class="rp-resultado hidden" id="rp-res"></section>
    </div>`;
    $('#rp-mic', el).addEventListener('click', () => this.alternar());
    $('#rp-limpar', el).addEventListener('click', () => this.limpar());
    $('#rp-interpretar', el).addEventListener('click', () => this.interpretar());
    $('#rp-texto', el).addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) this.interpretar(); });
  },

  limpar() {
    this.parar();
    $('#rp-texto').value = '';
    $('#rp-res').classList.add('hidden');
    $('#rp-res').innerHTML = '';
    this.status(this.suporte ? 'Toque no microfone e fale o lançamento' : 'Digite ou use o microfone do teclado');
  },

  status(txt, tipo = '') {
    const s = $('#rp-status'); if (!s) return;
    s.textContent = txt; s.className = `rp-status ${tipo}`;
  },

  /* ------------------------------ Voz ------------------------------ */
  alternar() { if (this.ouvindo) this.parar(); else this.ouvir(); },

  ouvir() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const ta = $('#rp-texto');
    if (!SR) { this.status('Reconhecimento de voz indisponível aqui. Use o microfone do teclado ou digite.', 'err'); ta.focus(); return; }
    const base = ta.value.trim() ? ta.value.trim() + ' ' : '';
    const rec = new SR();
    rec.lang = 'pt-BR'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    let teveTexto = false, erro = null;
    rec.onstart = () => { this.ouvindo = true; $('#rp-mic').classList.add('on'); this.status('Ouvindo… fale agora', 'on'); };
    rec.onresult = (e) => {
      const txt = Array.from(e.results).map((r) => r[0].transcript).join(' ').trim();
      if (txt) { teveTexto = true; ta.value = base + txt; }
    };
    rec.onerror = (e) => { erro = e.error; };
    rec.onend = () => {
      this.ouvindo = false; this.rec = null;
      const mic = $('#rp-mic'); if (mic) mic.classList.remove('on');
      if (erro && erro !== 'aborted') {
        const msg = {
          'not-allowed': 'Microfone bloqueado. Libere o acesso ao microfone para este site nas configurações do navegador.',
          'service-not-allowed': 'Microfone bloqueado. Libere o acesso ao microfone para este site nas configurações do navegador.',
          'no-speech': 'Não ouvi nada. Toque no microfone e tente de novo.',
          'audio-capture': 'Não encontrei um microfone disponível.',
          network: 'Sem conexão com o serviço de voz. Verifique a internet.',
        }[erro] || `Não foi possível ouvir (${erro}).`;
        this.status(msg, 'err');
        return;
      }
      if (teveTexto) { this.status('Pronto! Confira abaixo. Toque no microfone para complementar.'); this.interpretar(); }
      else this.status('Não ouvi nada. Toque no microfone e tente de novo.', 'err');
    };
    try { rec.start(); this.rec = rec; } catch (_) { this.status('Não foi possível iniciar o microfone.', 'err'); }
  },

  parar() { if (this.rec) { try { this.rec.stop(); } catch (_) { /* ignore */ } } },

  /* ------------------------------ Interpretação ------------------------------ */
  interpretar() {
    const txt = $('#rp-texto').value.trim();
    if (!txt) { toast('Fale ou digite o lançamento primeiro.', 'err'); return; }
    const r = RapidoParser.interpretar(txt, this.cat, this.cat.hoje);
    this.origem = {
      vencimento: r.vencimento_origem, situacao: r.situacao_origem, ambiente: r.ambiente_origem, fornecedor: r.fornecedor_origem,
      categoria: r.categoria_origem, centro: r.centro_origem, forma: r.forma_origem,
      valor: r.valor_centavos ? 'falado' : null, obs: r.observacoes ? 'falado' : null,
    };
    this.desenhar(r);
    const res = $('#rp-res');
    res.classList.remove('hidden');
    setTimeout(() => res.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  },

  /* ------------------------------ Formulário de conferência ------------------------------ */
  chip(campo, vazio = false) {
    const o = this.origem[campo];
    if (vazio || !o) return '<span class="rp-chip falta">preencher</span>';
    if (o === 'falado') return '<span class="rp-chip ok">entendi</span>';
    if (o === 'historico') return '<span class="rp-chip sug">sugerido pelo histórico</span>';
    if (o === 'categoria') return '<span class="rp-chip sug">deduzido da categoria</span>';
    if (o === 'novo') return '<span class="rp-chip novo">novo cadastro</span>';
    if (o === 'assumido') return '<span class="rp-chip sug">confira</span>';
    return '';
  },

  compat(c, amb) { return !amb || c.natureza === 'AMBOS' || c.natureza === amb; },

  desenhar(r) {
    const C = this.cat;
    const optCats = (amb, sel) => '<option value="">— selecione —</option>' + C.categorias.filter((c) => this.compat(c, amb) || c.id === sel)
      .map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nome)}${c.natureza === 'AMBOS' ? '' : ' (' + (c.natureza === 'EMPRESA' ? 'empresa' : 'pessoal') + ')'}</option>`).join('');
    const fornSel = r.fornecedor_novo ? 'novo' : (r.fornecedor_id || '');
    const cand = r.fornecedor_candidatos.map((id) => C.fornecedores.find((f) => f.id === id)).filter(Boolean);
    const res = $('#rp-res');
    res.innerHTML = `<form id="rp-form" class="rp-form" autocomplete="off" novalidate>
      <h2>Confira os dados</h2>

      <div class="rp-c" data-c="vencimento"><label>Vencimento ${this.chip('vencimento')}</label>
        <input class="input" type="date" name="vencimento" value="${r.vencimento || ''}"></div>

      <div class="rp-c" data-c="situacao"><label>Situação ${this.chip('situacao')}</label>
        <div class="rp-seg" data-nome="situacao">
          <button type="button" data-v="ABERTO" class="${r.pago ? '' : 'on'}">A vencer</button>
          <button type="button" data-v="PAGO" class="${r.pago ? 'on' : ''}">Pago</button>
        </div>
        <div class="rp-pgto ${r.pago ? '' : 'hidden'}" id="rp-pgto"><label>Data do pagamento</label>
          <input class="input" type="date" name="data_pagamento" value="${r.data_pagamento || this.cat.hoje}"></div>
      </div>

      <div class="rp-c" data-c="ambiente"><label>Empresa ou pessoal ${this.chip('ambiente', !r.ambiente)}</label>
        <div class="rp-seg" data-nome="ambiente">
          <button type="button" data-v="EMPRESA" class="${r.ambiente === 'EMPRESA' ? 'on' : ''}">Empresa</button>
          <button type="button" data-v="PESSOAL" class="${r.ambiente === 'PESSOAL' ? 'on' : ''}">Pessoal</button>
        </div></div>

      <div class="rp-c" data-c="fornecedor"><label>Fornecedor ${this.chip('fornecedor', !r.fornecedor_id && !r.fornecedor_novo)}</label>
        <select class="input" name="fornecedor">
          <option value="">— selecione —</option>
          ${C.fornecedores.map((f) => `<option value="${f.id}" ${String(f.id) === String(fornSel) ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}
          <option value="novo" ${fornSel === 'novo' ? 'selected' : ''}>➕ Cadastrar novo fornecedor…</option>
        </select>
        <input class="input ${fornSel === 'novo' ? '' : 'hidden'}" name="fornecedor_novo" placeholder="Nome do novo fornecedor" value="${esc(r.fornecedor_novo || '')}">
        ${cand.length ? `<div class="rp-cands"><span>Pode ser também:</span>${cand.map((f) => `<button type="button" data-forn="${f.id}">${esc(f.nome)}</button>`).join('')}</div>` : ''}
      </div>

      <div class="rp-c" data-c="categoria"><label>Categoria ${this.chip('categoria', !r.categoria_id)}</label>
        <select class="input" name="categoria">${optCats(r.ambiente, r.categoria_id)}</select></div>

      <div class="rp-c" data-c="valor"><label>Valor ${this.chip('valor', !r.valor_centavos)}</label>
        <div class="rp-valor"><span>R$</span><input class="input" name="valor" inputmode="decimal" placeholder="0,00" value="${r.valor_centavos ? moedaInput(r.valor_centavos) : ''}"></div></div>

      <div class="rp-c" data-c="centro"><label>Centro de custo ${this.chip('centro', !r.centro_custo_id)}</label>
        <select class="input" name="centro"><option value="">— nenhum —</option>${C.centros.map((c) => `<option value="${c.id}" ${c.id === r.centro_custo_id ? 'selected' : ''}>${esc(rotuloCC(c))}</option>`).join('')}</select></div>

      <div class="rp-c" data-c="forma"><label>Forma de pagamento ${this.chip('forma', !r.forma_pagamento_id)}</label>
        <select class="input" name="forma"><option value="">— não informada —</option>${C.formas.map((f) => `<option value="${f.id}" ${f.id === r.forma_pagamento_id ? 'selected' : ''}>${esc(f.nome)}</option>`).join('')}</select></div>

      <div class="rp-c" data-c="obs"><label>Observações</label>
        <textarea class="input" name="obs" rows="2" placeholder="Opcional">${esc(r.observacoes)}</textarea>
        ${r.nao_entendido ? `<div class="rp-resto">Não entendi: <b>${esc(r.nao_entendido)}</b> <button type="button" id="rp-add-obs">usar como observação</button></div>` : ''}
      </div>

      <div class="rp-barra">
        <button class="btn primary rp-ok" id="rp-ok" type="submit">${I.check}<span>Confirmar e lançar</span></button>
      </div>
    </form>`;
    this.ligarForm(r);
  },

  ligarForm(r) {
    const f = $('#rp-form');
    const lim = (campo) => { const c = $(`[data-c="${campo}"]`, f); if (c) { c.classList.remove('erro'); const ch = $('.rp-chip', c); if (ch) { ch.className = 'rp-chip ok'; ch.textContent = 'ok'; } } };
    // Campos simples: ao mexer, o aviso some
    $$('input[name="vencimento"], input[name="valor"], select[name="centro"], select[name="forma"], textarea[name="obs"]', f).forEach((el) => {
      el.addEventListener('input', () => lim(el.closest('.rp-c').dataset.c));
    });
    // Valor: formata ao sair do campo
    const valor = $('input[name="valor"]', f);
    valor.addEventListener('blur', () => { const c = parseMoeda(valor.value); if (c) valor.value = moedaInput(c); });
    // Situação
    $$('[data-nome="situacao"] button', f).forEach((b) => b.addEventListener('click', () => {
      $$('[data-nome="situacao"] button', f).forEach((x) => x.classList.toggle('on', x === b));
      $('#rp-pgto').classList.toggle('hidden', b.dataset.v !== 'PAGO');
      lim('situacao');
    }));
    // Ambiente: refiltra categorias
    $$('[data-nome="ambiente"] button', f).forEach((b) => b.addEventListener('click', () => {
      $$('[data-nome="ambiente"] button', f).forEach((x) => x.classList.toggle('on', x === b));
      lim('ambiente');
      const sel = $('select[name="categoria"]', f);
      const atual = this.cat.categorias.find((c) => String(c.id) === sel.value);
      let novoId = atual && this.compat(atual, b.dataset.v) ? atual.id : null;
      if (atual && !novoId) { // procura a categoria de mesmo nome compatível com o novo ambiente
        const alt = this.cat.categorias.find((c) => c.nome.toLowerCase() === atual.nome.toLowerCase() && this.compat(c, b.dataset.v));
        if (alt) novoId = alt.id;
      }
      sel.innerHTML = '<option value="">— selecione —</option>' + this.cat.categorias.filter((c) => this.compat(c, b.dataset.v))
        .map((c) => `<option value="${c.id}" ${c.id === novoId ? 'selected' : ''}>${esc(c.nome)}${c.natureza === 'AMBOS' ? '' : ' (' + (c.natureza === 'EMPRESA' ? 'empresa' : 'pessoal') + ')'}</option>`).join('');
      if (!novoId) { const ch = $('[data-c="categoria"] .rp-chip', f); if (ch) { ch.className = 'rp-chip falta'; ch.textContent = 'preencher'; } }
    }));
    // Fornecedor
    const fs = $('select[name="fornecedor"]', f), fn = $('input[name="fornecedor_novo"]', f);
    fs.addEventListener('change', () => {
      fn.classList.toggle('hidden', fs.value !== 'novo');
      if (fs.value === 'novo') fn.focus();
      lim('fornecedor');
      this.sugerirDoHistorico(f, fs.value);
    });
    fn.addEventListener('input', () => lim('fornecedor'));
    $$('[data-forn]', f).forEach((b) => b.addEventListener('click', () => { fs.value = b.dataset.forn; fs.dispatchEvent(new Event('change')); }));
    $('select[name="categoria"]', f).addEventListener('change', (e) => {
      lim('categoria');
      const c = this.cat.categorias.find((x) => String(x.id) === e.target.value);
      if (c && c.natureza !== 'AMBOS' && !$('[data-nome="ambiente"] .on', f)) $(`[data-nome="ambiente"] [data-v="${c.natureza}"]`, f).click();
    });
    const add = $('#rp-add-obs', f);
    if (add) add.addEventListener('click', () => {
      const ta = $('textarea[name="obs"]', f);
      ta.value = (ta.value ? ta.value + ' ' : '') + r.nao_entendido;
      add.closest('.rp-resto').remove();
    });
    f.addEventListener('submit', (e) => { e.preventDefault(); this.confirmar(f); });
  },

  /** Quando o usuário troca o fornecedor na tela, sugere categoria/centro/forma do último lançamento dele (só onde está vazio) */
  sugerirDoHistorico(f, fornId) {
    const forn = this.cat.fornecedores.find((x) => String(x.id) === String(fornId));
    const u = forn && forn.ultimo;
    if (!u) return;
    const amb = ($('[data-nome="ambiente"] .on', f) || {}).dataset?.v;
    const sug = (nome, id, campo, ok = true) => {
      const sel = $(`select[name="${nome}"]`, f);
      if (id && ok && !sel.value && [...sel.options].some((o) => o.value === String(id))) {
        sel.value = String(id);
        const ch = $(`[data-c="${campo}"] .rp-chip`, f); if (ch) { ch.className = 'rp-chip sug'; ch.textContent = 'sugerido pelo histórico'; }
      }
    };
    const cat = this.cat.categorias.find((c) => c.id === u.categoria_id);
    sug('categoria', u.categoria_id, 'categoria', !!cat && this.compat(cat, amb));
    sug('centro', u.centro_custo_id, 'centro', !amb || !u.tipo_ambiente || u.tipo_ambiente === amb);
    sug('forma', u.forma_pagamento_id, 'forma');
    if (!amb && u.tipo_ambiente) $(`[data-nome="ambiente"] [data-v="${u.tipo_ambiente}"]`, f).click();
  },

  /* ------------------------------ Confirmar ------------------------------ */
  coletar(f) {
    const v = (n) => $(`[name="${n}"]`, f).value.trim();
    const pago = ($('[data-nome="situacao"] .on', f) || {}).dataset?.v === 'PAGO';
    const forn = v('fornecedor');
    return {
      data_vencimento: v('vencimento'),
      pago,
      data_pagamento: pago ? v('data_pagamento') || this.cat.hoje : null,
      tipo_ambiente: ($('[data-nome="ambiente"] .on', f) || {}).dataset?.v || '',
      fornecedor_id: forn && forn !== 'novo' ? Number(forn) : null,
      fornecedor_novo: forn === 'novo' ? v('fornecedor_novo') : null,
      categoria_id: v('categoria') ? Number(v('categoria')) : null,
      valor_centavos: parseMoeda(v('valor')),
      centro_custo_id: v('centro') ? Number(v('centro')) : null,
      forma_pagamento_id: v('forma') ? Number(v('forma')) : null,
      observacoes: v('obs') || null,
    };
  },

  validar(d) {
    const erros = [];
    if (!d.data_vencimento) erros.push(['vencimento', 'Informe o vencimento.']);
    if (!d.tipo_ambiente) erros.push(['ambiente', 'Escolha empresa ou pessoal.']);
    if (!d.fornecedor_id && !d.fornecedor_novo) erros.push(['fornecedor', 'Escolha o fornecedor.']);
    if (!d.categoria_id) erros.push(['categoria', 'Escolha a categoria.']);
    if (!d.valor_centavos || d.valor_centavos <= 0) erros.push(['valor', 'Informe o valor.']);
    return erros;
  },

  async confirmar(f) {
    if (this.salvando) return;
    const d = this.coletar(f);
    $$('.rp-c.erro', f).forEach((c) => c.classList.remove('erro'));
    const erros = this.validar(d);
    if (erros.length) {
      erros.forEach(([c]) => { const el = $(`[data-c="${c}"]`, f); if (el) el.classList.add('erro'); });
      const primeiro = $(`[data-c="${erros[0][0]}"]`, f);
      if (primeiro) primeiro.scrollIntoView({ behavior: 'smooth', block: 'center' });
      toast(erros.map((e) => e[1]).join('\n'), 'err');
      return;
    }
    const btn = $('#rp-ok', f);
    this.salvando = true; btn.disabled = true;
    try {
      const t = await api('/api/rapido/confirmar', { method: 'POST', body: d });
      if (d.fornecedor_novo) Cache.limpar();
      this.sucesso(t);
    } catch (e) {
      toast(e.message, 'err');
    } finally { this.salvando = false; btn.disabled = false; }
  },

  sucesso(t) {
    const res = $('#rp-res');
    res.innerHTML = `<div class="rp-ok-card">
      <div class="rp-ok-ic">${I.check}</div>
      <h2>Lançamento nº ${t.nro_documento} gravado</h2>
      <p><b>${esc(t.fornecedor_nome)}</b> · ${esc(t.categoria_nome)}</p>
      <p class="rp-ok-v">${moeda(t.valor_centavos)}</p>
      <p class="muted">${t.tipo_ambiente === 'EMPRESA' ? 'Empresa' : 'Pessoal'} · vence em ${dataBR(t.data_vencimento)} · ${t.data_pagamento ? 'pago em ' + dataBR(t.data_pagamento) : 'a vencer'}</p>
      <div class="rp-ok-acoes">
        <button class="btn primary" id="rp-outro">${I.mic}<span>Lançar outro</span></button>
        <button class="btn" id="rp-hoje">${I.sun}<span>Ver contas de hoje</span></button>
      </div></div>`;
    $('#rp-outro').addEventListener('click', () => { this.limpar(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    $('#rp-hoje').addEventListener('click', () => { Hoje.dia = null; location.hash = '#/hoje'; });
    // novo fornecedor / histórico mudaram: recarrega o catálogo
    api('/api/rapido/catalogo').then((c) => { this.cat = c; }).catch(() => {});
    toast('Lançamento gravado!');
    res.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
};
