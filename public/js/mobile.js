/* =====================================================================
   Celular: instalação do app (PWA), barra de abas e tela "Hoje"
   (contas a pagar e a receber do dia).
   ===================================================================== */
'use strict';

Object.assign(I, (() => {
  const s = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  return {
    mic: s('<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/>'),
    sun: s('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    phone: s('<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>'),
    chevL: s('<path d="m15 18-6-6 6-6"/>'),
    chevR: s('<path d="m9 18 6-6-6-6"/>'),
    refresh: s('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
    share: s('<path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><path d="m16 6-4-4-4 4M12 2v14"/>'),
    sparkle: s('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>'),
  };
})());

/* --------------------------------------------------------------------
   Instalação (atalho na tela inicial)
   -------------------------------------------------------------------- */
const Instalar = {
  evento: null,
  jaInstalado: () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true,
  ehIOS: () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  ehAndroid: () => /android/i.test(navigator.userAgent),

  iniciar() {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.evento = e; this.atualizar(); });
    window.addEventListener('appinstalled', () => { this.evento = null; this.atualizar(); toast('App instalado! Procure o ícone "Financeiro" na tela inicial.'); });
    document.addEventListener('click', (e) => { if (e.target.closest('.js-instalar')) { e.preventDefault(); this.clicar(); } });
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
    }
    this.atualizar();
  },

  atualizar() {
    const esconder = this.jaInstalado();
    $$('.js-instalar').forEach((b) => b.classList.toggle('hidden', esconder));
  },

  async clicar() {
    if (this.evento) {
      this.evento.prompt();
      try { await this.evento.userChoice; } catch (_) { /* ignore */ }
      this.evento = null;
      this.atualizar();
      return;
    }
    this.instrucoes();
  },

  instrucoes() {
    const ios = `<h4>iPhone / iPad (Safari)</h4><ol>
      <li>Abra este endereço no <b>Safari</b> (não funciona por dentro de outros apps).</li>
      <li>Toque no botão <b>Compartilhar</b> <span class="ico-inline">${I.share}</span> (barra inferior).</li>
      <li>Role e toque em <b>Adicionar à Tela de Início</b>.</li>
      <li>Toque em <b>Adicionar</b>. O ícone "Financeiro" aparece na tela inicial.</li></ol>`;
    const and = `<h4>Android (Chrome)</h4><ol>
      <li>Toque nos <b>três pontinhos ⋮</b> no canto do Chrome.</li>
      <li>Toque em <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>).</li>
      <li>Confirme em <b>Instalar</b>. O ícone "Financeiro" aparece na tela inicial.</li></ol>`;
    const pc = `<h4>Computador (Chrome / Edge)</h4><ol>
      <li>Clique no ícone de <b>instalar</b> no final da barra de endereço.</li>
      <li>Confirme em <b>Instalar</b>.</li></ol>`;
    const ordem = this.ehIOS() ? [ios, and] : this.ehAndroid() ? [and, ios] : [pc, and, ios];
    modal({
      titulo: 'Colocar o app na tela inicial', tamanho: 'sm',
      corpo: `<div class="inst-ajuda">${ordem.join('')}<p class="muted">Depois de instalado, o app abre em tela cheia, sem a barra do navegador.</p></div>`,
      rodape: '<button class="btn primary" data-close>Entendi</button>',
    });
  },
};

/* --------------------------------------------------------------------
   Navegação mobile (barra inferior)
   -------------------------------------------------------------------- */
const Mobile = {
  telaPequena: () => window.matchMedia('(max-width: 900px)').matches,
  rotaInicial() { return this.telaPequena() ? 'hoje' : 'dashboard'; },

  iniciar() {
    const ic = { hoje: I.sun, pagar: I.out, rapido: I.mic, receber: I.in, menu: I.menu };
    $$('#tabbar [data-ic]').forEach((el) => { el.innerHTML = ic[el.dataset.ic] || ''; });
    $('#tab-menu').addEventListener('click', (e) => { e.stopPropagation(); document.body.classList.toggle('menu-open'); });
    // Toque fora do menu lateral fecha
    document.addEventListener('click', (e) => {
      if (document.body.classList.contains('menu-open') && !e.target.closest('.sidebar') && !e.target.closest('#btn-menu')) document.body.classList.remove('menu-open');
    });
    Instalar.iniciar();
  },

  marcarAba(rota) {
    $$('#tabbar [data-r]').forEach((a) => a.classList.toggle('active', a.dataset.r === rota));
  },
};

/* --------------------------------------------------------------------
   Tela "Hoje"
   -------------------------------------------------------------------- */
const Hoje = {
  dia: null,
  ambiente: 'TODAS',
  aba: 'pagar',
  dados: null,
  aberto: null,        // "tipo:nro" do cartão expandido
  _vis: null,

  guardar() { try { localStorage.setItem('ow_hoje', JSON.stringify({ ambiente: this.ambiente, aba: this.aba })); } catch (_) { /* ignore */ } },
  restaurar() {
    try { const o = JSON.parse(localStorage.getItem('ow_hoje') || 'null'); if (o) { this.ambiente = o.ambiente || 'TODAS'; this.aba = o.aba || 'pagar'; } } catch (_) { /* ignore */ }
  },

  somaDias(iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return isoDate(d); },
  rotuloDia(iso) {
    const d = new Date(iso + 'T12:00:00');
    const hoje = hojeISO();
    const base = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    const quando = iso === hoje ? 'Hoje' : iso === this.somaDias(hoje, 1) ? 'Amanhã' : iso === this.somaDias(hoje, -1) ? 'Ontem' : '';
    return { quando, base };
  },

  async render(el) {
    if (!this.dia) { this.restaurar(); this.dia = hojeISO(); }
    el.innerHTML = '<div class="hj"><div class="empty">Carregando…</div></div>';
    await this.carregar();
    this.desenhar(el);
    if (!this._vis) {
      this._vis = () => {
        if (document.visibilityState === 'visible' && App.rotaAtual === 'hoje' && Estado.usuario) { this.carregar().then(() => this.desenhar($('#view'))).catch(() => {}); }
      };
      document.addEventListener('visibilitychange', this._vis);
    }
  },

  async carregar() {
    const d = this.dia;
    const amb = this.ambiente === 'TODAS' ? undefined : this.ambiente;
    const eHoje = d === hojeISO();
    const q = (o) => qs({ ambiente: amb, ...o });
    const [pagar, receber, pagarAtr, receberAtr] = await Promise.all([
      api(`/api/pagar?${q({ de: d, ate: d })}`),
      api(`/api/receber?${q({ de: d, ate: d })}`),
      eHoje ? api(`/api/pagar?${q({ status: 'ATRASADO' })}`) : { itens: [] },
      eHoje ? api(`/api/receber?${q({ status: 'ATRASADO' })}`) : { itens: [] },
    ]);
    this.dados = { pagar: pagar.itens, receber: receber.itens, pagarAtr: pagarAtr.itens, receberAtr: receberAtr.itens };
  },

  soma(lista, pred = () => true) { return lista.filter(pred).reduce((s, x) => s + x.valor_centavos, 0); },

  desenhar(el) {
    if (!el || App.rotaAtual !== 'hoje') return;
    const D = this.dados;
    const { quando, base } = this.rotuloDia(this.dia);
    const aberto = (x) => !x.data_pagamento;
    const totPagar = this.soma(D.pagar), totReceber = this.soma(D.receber);
    const atrP = this.soma(D.pagarAtr), atrR = this.soma(D.receberAtr);
    const cartao = (rot, cls, tot, lista, atr, verbo) => `
      <div class="hj-card ${cls}">
        <span class="hj-card-l">${rot}</span>
        <b class="hj-card-v">${moeda(tot)}</b>
        <span class="hj-card-s"><i class="ok">${verbo} ${moeda(this.soma(lista, (x) => !aberto(x)))}</i><i>Falta ${moeda(this.soma(lista, aberto))}</i></span>
      </div>`;
    const saldo = totReceber - totPagar;
    const lista = this.aba === 'pagar' ? D.pagar : D.receber;
    const atrasados = this.aba === 'pagar' ? D.pagarAtr : D.receberAtr;
    const ehHoje = this.dia === hojeISO();

    el.innerHTML = `<div class="hj">
      <div class="hj-nav">
        <button class="btn icon" id="hj-ant" aria-label="Dia anterior">${I.chevL}</button>
        <label class="hj-data">
          ${quando ? `<em>${quando}</em>` : ''}<span>${esc(base)}</span>
          <input type="date" id="hj-dt" value="${this.dia}" aria-label="Escolher data">
        </label>
        <button class="btn icon" id="hj-prox" aria-label="Próximo dia">${I.chevR}</button>
        <button class="btn icon" id="hj-ref" aria-label="Atualizar">${I.refresh}</button>
      </div>
      <div class="hj-sub">
        <div class="seg" id="hj-amb">
          <button data-a="TODAS" class="${this.ambiente === 'TODAS' ? 'on' : ''}">Todos</button>
          <button data-a="EMPRESA" class="${this.ambiente === 'EMPRESA' ? 'on' : ''}">Empresa</button>
          <button data-a="PESSOAL" class="${this.ambiente === 'PESSOAL' ? 'on' : ''}">Pessoal</button>
        </div>
        ${ehHoje ? '' : '<button class="btn sm" id="hj-hoje">Voltar para hoje</button>'}
      </div>
      <div class="hj-resumo">
        ${cartao('A pagar', 'pag', totPagar, D.pagar, atrP, 'Pago')}
        ${cartao('A receber', 'rec', totReceber, D.receber, atrR, 'Recebido')}
      </div>
      <div class="hj-saldo ${saldo < 0 ? 'neg' : 'pos'}"><span>Saldo do dia (receber − pagar)</span><b>${moeda(saldo)}</b></div>
      ${(atrP + atrR) ? `<button class="hj-alerta" id="hj-atr">${I.alert}<span>Em atraso: <b>${D.pagarAtr.length}</b> a pagar (${moeda(atrP)}) · <b>${D.receberAtr.length}</b> a receber (${moeda(atrR)})</span></button>` : ''}
      <div class="hj-abas" role="tablist">
        <button role="tab" data-t="pagar" class="${this.aba === 'pagar' ? 'on' : ''}">A pagar <span>${D.pagar.length}</span></button>
        <button role="tab" data-t="receber" class="${this.aba === 'receber' ? 'on' : ''}">A receber <span>${D.receber.length}</span></button>
      </div>
      ${atrasados.length ? `<h3 class="hj-h crit">Em atraso <small>${moeda(this.soma(atrasados))}</small></h3><div class="hj-lista" id="hj-atrasados">${atrasados.map((x) => this.item(x)).join('')}</div>` : ''}
      <h3 class="hj-h">Vencem ${quando ? quando.toLowerCase() : 'neste dia'} <small>${moeda(this.soma(lista))}</small></h3>
      <div class="hj-lista">${lista.length ? lista.map((x) => this.item(x)).join('') : `<div class="hj-vazio">${I.check}<span>Nada ${this.aba === 'pagar' ? 'a pagar' : 'a receber'} neste dia.</span></div>`}</div>
      <button class="btn primary hj-lancar" id="hj-lancar">${I.mic}<span>Lançar conta a pagar por voz</span></button>
      <button class="btn hj-instalar js-instalar">${I.phone}<span>Colocar o app na tela inicial</span></button>
    </div>`;
    Instalar.atualizar();
    this.ligar(el);
  },

  item(x) {
    const tipo = this.aba;
    const id = `${tipo}:${x.nro_documento}`;
    const aberto = this.aberto === id;
    const sub = [x.categoria_nome, x.centro_custo_nome].filter(Boolean).map(esc).join(' · ');
    const venc = x.status === 'ATRASADO' ? `<span class="hj-venc">venceu ${dataBR(x.data_vencimento)}</span>` : '';
    return `<article class="hj-item ${tipo === 'pagar' ? 'pag' : 'rec'} st-${x.status}${aberto ? ' aberto' : ''}" data-id="${id}" data-nro="${x.nro_documento}">
      <button class="hj-i-cab" aria-expanded="${aberto}">
        <span class="hj-i-l1"><b>${esc(x.parte_nome)}</b><strong>${moeda(x.valor_centavos)}</strong></span>
        <span class="hj-i-l2">${sub || '&nbsp;'}</span>
        <span class="hj-i-l3">${badgeStatus(x.status)}${badgeAmb(x.tipo_ambiente, true)}${venc}</span>
      </button>
      ${aberto ? this.detalhe(x, tipo) : ''}
    </article>`;
  },

  detalhe(x, tipo) {
    const linhas = [
      ['Documento', `nº ${x.nro_documento}`],
      ['Vencimento', dataBR(x.data_vencimento)],
      x.data_pagamento ? [tipo === 'pagar' ? 'Pago em' : 'Recebido em', dataBR(x.data_pagamento)] : null,
      x.forma_pagamento_nome ? ['Forma', x.forma_pagamento_nome] : null,
      x.conta_bancaria_nome ? ['Conta', x.conta_bancaria_nome] : null,
      x.colaborador_nome ? ['Colaborador', x.colaborador_nome] : null,
      x.observacoes ? ['Obs.', x.observacoes] : null,
    ].filter(Boolean);
    const acao = x.data_pagamento
      ? `<button class="btn" data-acao="estorno">${I.undo}<span>Desfazer baixa</span></button>`
      : `<button class="btn primary" data-acao="baixa">${I.check}<span>${tipo === 'pagar' ? 'Marcar como pago' : 'Marcar como recebido'}</span></button>`;
    return `<div class="hj-det"><dl>${linhas.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><div class="hj-acoes">${acao}</div></div>`;
  },

  async recarregar() { await this.carregar(); this.desenhar($('#view')); },

  ligar(el) {
    const ir = (iso) => { this.dia = iso; this.aberto = null; this.recarregar().catch((e) => toast(e.message, 'err')); };
    $('#hj-ant', el).addEventListener('click', () => ir(this.somaDias(this.dia, -1)));
    $('#hj-prox', el).addEventListener('click', () => ir(this.somaDias(this.dia, 1)));
    $('#hj-dt', el).addEventListener('change', (e) => { if (e.target.value) ir(e.target.value); });
    $('#hj-ref', el).addEventListener('click', () => this.recarregar().then(() => toast('Atualizado.')).catch((e) => toast(e.message, 'err')));
    const h = $('#hj-hoje', el); if (h) h.addEventListener('click', () => ir(hojeISO()));
    $$('#hj-amb button', el).forEach((b) => b.addEventListener('click', () => { this.ambiente = b.dataset.a; this.guardar(); this.aberto = null; this.recarregar().catch((e) => toast(e.message, 'err')); }));
    $$('.hj-abas button', el).forEach((b) => b.addEventListener('click', () => { this.aba = b.dataset.t; this.guardar(); this.aberto = null; this.desenhar(el); }));
    const atr = $('#hj-atr', el);
    if (atr) atr.addEventListener('click', () => {
      // abre a aba que tem atrasados e rola até a lista
      this.aba = this.dados.pagarAtr.length ? 'pagar' : 'receber'; this.guardar(); this.desenhar(el);
      const alvo = $('#hj-atrasados', el); if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('#hj-lancar', el).addEventListener('click', () => { location.hash = '#/rapido'; });
    $$('.hj-item', el).forEach((card) => {
      $('.hj-i-cab', card).addEventListener('click', () => { this.aberto = this.aberto === card.dataset.id ? null : card.dataset.id; this.desenhar(el); });
      $$('[data-acao]', card).forEach((b) => b.addEventListener('click', () => this.acao(card, b.dataset.acao)));
    });
  },

  async acao(card, acao) {
    const [tipo, nro] = card.dataset.id.split(':');
    const fonte = tipo === 'pagar' ? [...this.dados.pagar, ...this.dados.pagarAtr] : [...this.dados.receber, ...this.dados.receberAtr];
    const x = fonte.find((i) => String(i.nro_documento) === nro);
    const nome = x ? `${x.parte_nome} — ${moeda(x.valor_centavos)}` : `nº ${nro}`;
    const msg = acao === 'baixa'
      ? `${tipo === 'pagar' ? 'Marcar como <b>pago</b> hoje' : 'Marcar como <b>recebido</b> hoje'}?<br><span class="muted">${esc(nome)}</span>`
      : `Desfazer a baixa de <b>${esc(nome)}</b>? Ele volta a ficar em aberto.`;
    if (!(await confirmar(msg, { ok: acao === 'baixa' ? 'Confirmar' : 'Desfazer' }))) return;
    try {
      await api(`/api/${tipo}/${nro}/${acao}`, { method: 'PATCH', body: {} });
      toast(acao === 'baixa' ? 'Baixa registrada.' : 'Baixa desfeita.');
      this.aberto = null;
      await this.recarregar();
    } catch (e) { toast(e.message, 'err'); }
  },
};
