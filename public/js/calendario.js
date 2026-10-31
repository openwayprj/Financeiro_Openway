/* =====================================================================
   Calendário Financeiro (estilo Outlook): visões Dia / Semana / Mês
   com totais de Contas a Receber e Contas a Pagar por dia, semana e período
   ===================================================================== */
'use strict';

const Calendario = {
  visao: 'mes',              // dia | semana | mes
  ref: null,                 // data de referência (ISO)
  mostrar: { receber: true, pagar: true, pagos: true },
  itens: [],                 // títulos carregados do período visível
  el: null,

  DIAS_CURTO: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
  DIAS: ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'],
  MESES: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],

  d(iso) { return new Date(iso + 'T00:00:00'); },
  add(iso, n) { const x = this.d(iso); x.setDate(x.getDate() + n); return isoDate(x); },
  inicioSemana(iso) { const x = this.d(iso); x.setDate(x.getDate() - x.getDay()); return isoDate(x); },

  /** Intervalo visível conforme a visão */
  intervalo() {
    const r = this.ref;
    if (this.visao === 'dia') return { de: r, ate: r };
    if (this.visao === 'semana') { const de = this.inicioSemana(r); return { de, ate: this.add(de, 6) }; }
    const x = this.d(r);
    const ini = isoDate(new Date(x.getFullYear(), x.getMonth(), 1));
    const fim = isoDate(new Date(x.getFullYear(), x.getMonth() + 1, 0));
    // grade completa (semanas inteiras), como no Outlook
    return { de: this.inicioSemana(ini), ate: this.add(this.inicioSemana(fim), 6), mesIni: ini, mesFim: fim };
  },

  titulo() {
    const x = this.d(this.ref);
    if (this.visao === 'dia') return `${this.DIAS[x.getDay()]}, ${x.getDate()} de ${this.MESES[x.getMonth()]} de ${x.getFullYear()}`;
    if (this.visao === 'mes') return `${this.MESES[x.getMonth()][0].toUpperCase()}${this.MESES[x.getMonth()].slice(1)} de ${x.getFullYear()}`;
    const { de, ate } = this.intervalo(), a = this.d(de), b = this.d(ate);
    return a.getMonth() === b.getMonth()
      ? `${a.getDate()} – ${b.getDate()} de ${this.MESES[b.getMonth()]} de ${b.getFullYear()}`
      : `${a.getDate()} de ${this.MESES[a.getMonth()].slice(0, 3)} – ${b.getDate()} de ${this.MESES[b.getMonth()].slice(0, 3)} de ${b.getFullYear()}`;
  },

  navegar(passo) {
    if (passo === 0) this.ref = hojeISO();
    else if (this.visao === 'dia') this.ref = this.add(this.ref, passo);
    else if (this.visao === 'semana') this.ref = this.add(this.ref, 7 * passo);
    else { const x = this.d(this.ref); this.ref = isoDate(new Date(x.getFullYear(), x.getMonth() + passo, 1)); }
    this.carregar();
  },

  async render(el) {
    this.el = el;
    if (!this.ref) this.ref = hojeISO();
    Lancamentos.aoAlterar = () => this.carregar();
    el.innerHTML = `
      <div class="cal-toolbar">
        <div class="cal-nav">
          <button class="btn sm" data-nav="0">Hoje</button>
          <button class="btn sm icon" data-nav="-1" aria-label="Anterior">‹</button>
          <button class="btn sm icon" data-nav="1" aria-label="Próximo">›</button>
          <h2 id="cal-titulo"></h2>
        </div>
        <div class="cal-opts">
          <div class="seg" id="cal-visao"><button data-v="dia">Dia</button><button data-v="semana">Semana</button><button data-v="mes">Mês</button></div>
          <div class="seg" id="cal-amb"><button data-a="TODAS">Todas</button><button data-a="PESSOAL">Pessoal</button><button data-a="EMPRESA">Empresa</button></div>
          <label class="cal-chk rec"><input type="checkbox" data-m="receber" ${this.mostrar.receber ? 'checked' : ''}> A receber</label>
          <label class="cal-chk pag"><input type="checkbox" data-m="pagar" ${this.mostrar.pagar ? 'checked' : ''}> A pagar</label>
          <label class="cal-chk"><input type="checkbox" data-m="pagos" ${this.mostrar.pagos ? 'checked' : ''}> Mostrar quitados</label>
        </div>
      </div>
      <div class="summary" id="cal-sum"></div>
      <div id="cal-corpo"></div>`;
    $$('[data-nav]', el).forEach((b) => b.addEventListener('click', () => this.navegar(Number(b.dataset.nav))));
    $$('#cal-visao button', el).forEach((b) => b.addEventListener('click', () => { this.visao = b.dataset.v; this.carregar(); }));
    $$('#cal-amb button', el).forEach((b) => b.addEventListener('click', () => {
      Estado.filtros.ambiente = b.dataset.a; Estado.salvarFiltros(); this.carregar();
    }));
    $$('[data-m]', el).forEach((c) => c.addEventListener('change', () => { this.mostrar[c.dataset.m] = c.checked; this.desenhar(); }));
    // Atalhos de teclado: ← → navegam, T = hoje, D/S/M = visão
    this._tecla && document.removeEventListener('keydown', this._tecla);
    this._tecla = (e) => {
      if (!document.body.contains(this.el) || !$('#cal-corpo') || e.target.closest('input,select,textarea,.modal-bg')) return;
      const k = e.key.toLowerCase();
      if (k === 'arrowleft') this.navegar(-1); else if (k === 'arrowright') this.navegar(1);
      else if (k === 't') this.navegar(0);
      else if ({ d: 'dia', s: 'semana', m: 'mes' }[k]) { this.visao = { d: 'dia', s: 'semana', m: 'mes' }[k]; this.carregar(); }
    };
    document.addEventListener('keydown', this._tecla);
    await this.carregar();
  },

  async carregar() {
    if (!$('#cal-corpo')) return; // tela não está aberta
    const { de, ate } = this.intervalo();
    const amb = Estado.filtros.ambiente;
    $('#cal-titulo').textContent = this.titulo();
    $$('#cal-visao button').forEach((b) => b.classList.toggle('on', b.dataset.v === this.visao));
    $$('#cal-amb button').forEach((b) => b.classList.toggle('on', b.dataset.a === amb));
    const p = qs({ de, ate, base: 'vencimento', ambiente: amb === 'TODAS' ? '' : amb });
    $('#cal-corpo').classList.add('loading');
    try {
      const [r, g] = await Promise.all([api('/api/receber?' + p), api('/api/pagar?' + p)]);
      this.itens = [
        ...r.itens.map((x) => ({ ...x, tipo: 'receber' })),
        ...g.itens.map((x) => ({ ...x, tipo: 'pagar' })),
      ];
      this.desenhar();
    } catch (err) { toast(err.message, 'err'); } finally { $('#cal-corpo')?.classList.remove('loading'); }
  },

  /** Itens visíveis conforme os filtros de exibição */
  visiveis() {
    return this.itens.filter((x) => this.mostrar[x.tipo] && (this.mostrar.pagos || x.status !== 'REALIZADO'));
  },

  /** Totais de um conjunto de itens */
  totais(lista) {
    const t = { rec: 0, pag: 0, recAb: 0, pagAb: 0, recOk: 0, pagOk: 0, atraso: 0, qtd: lista.length };
    for (const x of lista) {
      const v = x.valor_centavos, ok = x.status === 'REALIZADO';
      if (x.tipo === 'receber') { t.rec += v; ok ? (t.recOk += v) : (t.recAb += v); } else { t.pag += v; ok ? (t.pagOk += v) : (t.pagAb += v); }
      if (x.status === 'ATRASADO') t.atraso++;
    }
    t.saldo = t.rec - t.pag;
    return t;
  },

  porDia() {
    const m = {};
    for (const x of this.visiveis()) (m[x.data_vencimento] = m[x.data_vencimento] || []).push(x);
    for (const k in m) m[k].sort((a, b) => (a.tipo === b.tipo ? b.valor_centavos - a.valor_centavos : a.tipo === 'receber' ? -1 : 1));
    return m;
  },

  desenhar() {
    const { de, ate, mesIni, mesFim } = this.intervalo();
    // Totais do período "real" (no mês, só os dias do mês — não a grade inteira)
    const ini = mesIni || de, fim = mesFim || ate;
    const T = this.totais(this.visiveis().filter((x) => x.data_vencimento >= ini && x.data_vencimento <= fim));
    const rot = { dia: 'do dia', semana: 'da semana', mes: 'do mês' }[this.visao];
    $('#cal-sum').innerHTML = `
      ${this.mostrar.receber ? `<div class="s"><small>A receber ${rot}</small><b class="num pos">${moeda(T.rec)}</b>
        <span class="cal-sub">Recebido ${moeda(T.recOk)} · Em aberto ${moeda(T.recAb)}</span></div>` : ''}
      ${this.mostrar.pagar ? `<div class="s"><small>A pagar ${rot}</small><b class="num neg">${moeda(T.pag)}</b>
        <span class="cal-sub">Pago ${moeda(T.pagOk)} · Em aberto ${moeda(T.pagAb)}</span></div>` : ''}
      ${this.mostrar.receber && this.mostrar.pagar ? `<div class="s"><small>Saldo ${rot}</small><b class="num ${T.saldo >= 0 ? 'pos' : 'neg'}">${moeda(T.saldo)}</b>
        <span class="cal-sub">Em aberto: ${moeda(T.recAb - T.pagAb)}</span></div>` : ''}
      <div class="s"><small>Títulos</small><b class="num">${T.qtd}</b><span class="cal-sub">${T.atraso ? `<span class="neg">${T.atraso} em atraso</span>` : 'nenhum em atraso'}</span></div>`;
    const corpo = $('#cal-corpo');
    corpo.innerHTML = this.visao === 'mes' ? this.htmlMes() : this.visao === 'semana' ? this.htmlSemana() : this.htmlDia();
    this.ligarEventos(corpo);
  },

  /* ---------- peças ---------- */
  chip(x, completo = false) {
    const cls = `cal-ev ${x.tipo === 'receber' ? 'rec' : 'pag'} ${x.status === 'REALIZADO' ? 'ok' : ''} ${x.status === 'ATRASADO' ? 'late' : ''}`;
    const tit = `${x.tipo === 'receber' ? 'Receber de' : 'Pagar a'} ${x.parte_nome} · ${moeda(x.valor_centavos)} · ${STATUS[x.status].txt}${x.observacoes ? ' · ' + x.observacoes : ''}`;
    if (!completo) {
      return `<button class="${cls}" data-ev="${x.tipo}:${x.nro_documento}" title="${esc(tit)}">
        <span class="nm">${esc(x.parte_nome)}</span><span class="vl num">${moedaCurtaN(x.valor_centavos)}</span></button>`;
    }
    return `<button class="${cls} full" data-ev="${x.tipo}:${x.nro_documento}" title="${esc(tit)}">
      <span class="ln1"><span class="nm">${esc(x.parte_nome)}</span><span class="vl num">${moeda(x.valor_centavos)}</span></span>
      <span class="ln2">${esc(x.observacoes && x.observacoes !== x.parte_nome ? x.observacoes : x.categoria_nome)}${x.centro_custo_nome ? ' · ' + esc(x.centro_custo_nome) : ''}</span>
      <span class="ln3">${badgeStatus(x.status)}${badgeAmb(x.tipo_ambiente, true)}</span></button>`;
  },

  totaisDiaHtml(lista) {
    const t = this.totais(lista);
    if (!lista.length) return '';
    return `<div class="cal-tot">
      ${this.mostrar.receber && t.rec ? `<span class="pos" title="A receber">+${moedaCurtaN(t.rec)}</span>` : ''}
      ${this.mostrar.pagar && t.pag ? `<span class="neg" title="A pagar">−${moedaCurtaN(t.pag)}</span>` : ''}</div>`;
  },

  htmlMes() {
    const { de, mesIni, mesFim } = this.intervalo();
    const dias = this.porDia(), hoje = hojeISO();
    const MAX = 3;
    let html = `<div class="cal-mes"><div class="cal-head">${this.DIAS_CURTO.map((d) => `<div>${d}</div>`).join('')}<div class="cal-wk-h">Semana</div></div>`;
    for (let w = 0; w < 6; w++) {
      const ini = this.add(de, w * 7);
      if (ini > mesFim) break;
      html += '<div class="cal-row">';
      const semana = [];
      for (let i = 0; i < 7; i++) {
        const dia = this.add(ini, i), lista = dias[dia] || [];
        if (dia >= mesIni && dia <= mesFim) semana.push(...lista);
        const fora = dia < mesIni || dia > mesFim;
        html += `<div class="cal-cell ${fora ? 'fora' : ''} ${dia === hoje ? 'hoje' : ''} ${i === 0 || i === 6 ? 'fds' : ''}" data-dia="${dia}">
          <div class="cal-cell-h"><button class="cal-num" data-ir-dia="${dia}" title="Abrir o dia">${this.d(dia).getDate()}</button>${this.totaisDiaHtml(lista)}</div>
          <div class="cal-evs">${lista.slice(0, MAX).map((x) => this.chip(x)).join('')}
            ${lista.length > MAX ? `<button class="cal-mais" data-ir-dia="${dia}">+${lista.length - MAX} mais</button>` : ''}</div>
          <button class="cal-add" data-novo="${dia}" title="Novo lançamento neste dia" aria-label="Novo lançamento">+</button>
        </div>`;
      }
      const t = this.totais(semana);
      html += `<div class="cal-wk">
        ${this.mostrar.receber ? `<div><small>Receber</small><b class="pos num">${moedaCurtaN(t.rec)}</b></div>` : ''}
        ${this.mostrar.pagar ? `<div><small>Pagar</small><b class="neg num">${moedaCurtaN(t.pag)}</b></div>` : ''}
        ${this.mostrar.receber && this.mostrar.pagar ? `<div class="sd"><small>Saldo</small><b class="num ${t.saldo >= 0 ? 'pos' : 'neg'}">${moedaCurtaN(t.saldo)}</b></div>` : ''}
      </div></div>`;
    }
    return html + '</div>';
  },

  htmlSemana() {
    const { de } = this.intervalo();
    const dias = this.porDia(), hoje = hojeISO();
    let html = '<div class="cal-semana">';
    for (let i = 0; i < 7; i++) {
      const dia = this.add(de, i), lista = dias[dia] || [], t = this.totais(lista), x = this.d(dia);
      html += `<div class="cal-col ${dia === hoje ? 'hoje' : ''} ${i === 0 || i === 6 ? 'fds' : ''}">
        <div class="cal-col-h"><button class="cal-col-dia" data-ir-dia="${dia}"><span>${this.DIAS_CURTO[i]}</span><b>${x.getDate()}</b></button>
          <div class="cal-col-tot">
            ${this.mostrar.receber ? `<div class="pos">+ ${moeda(t.rec)}</div>` : ''}
            ${this.mostrar.pagar ? `<div class="neg">− ${moeda(t.pag)}</div>` : ''}
          </div></div>
        <div class="cal-col-b">${lista.map((e) => this.chip(e, true)).join('') || '<div class="cal-vazio">—</div>'}
          <button class="cal-add-col" data-novo="${dia}">+ Novo</button></div>
      </div>`;
    }
    return html + '</div>';
  },

  htmlDia() {
    const dia = this.ref, lista = this.porDia()[dia] || [];
    const rec = lista.filter((x) => x.tipo === 'receber'), pag = lista.filter((x) => x.tipo === 'pagar');
    const bloco = (titulo, l, tipo, cor) => `
      <div class="card">
        <div class="card-h"><div><h3 class="${cor}">${titulo}</h3><p>${l.length} título(s) · em aberto ${moeda(this.totais(l)[tipo === 'receber' ? 'recAb' : 'pagAb'])}</p></div>
          <div style="display:flex;gap:10px;align-items:center"><b class="num ${cor}" style="font-size:18px">${moeda(l.reduce((s, x) => s + x.valor_centavos, 0))}</b>
          <button class="btn sm" data-novo-tipo="${tipo}">${I.plus}Novo</button></div></div>
        <div class="card-b cal-dia-lista">${l.map((x) => this.chip(x, true)).join('') || '<div class="empty" style="padding:20px">Nada neste dia.</div>'}</div>
      </div>`;
    return `<div class="grid g-2">
      ${this.mostrar.receber ? bloco('Contas a receber', rec, 'receber', 'pos') : ''}
      ${this.mostrar.pagar ? bloco('Contas a pagar', pag, 'pagar', 'neg') : ''}
    </div>`;
  },

  ligarEventos(corpo) {
    $$('[data-ev]', corpo).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.detalhe(b.dataset.ev); }));
    $$('[data-ir-dia]', corpo).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.ref = b.dataset.irDia; this.visao = 'dia'; this.carregar(); }));
    $$('[data-novo]', corpo).forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); this.novo(b.dataset.novo); }));
    $$('[data-novo-tipo]', corpo).forEach((b) => b.addEventListener('click', () => this.abrirForm(b.dataset.novoTipo, this.ref)));
    // Duplo clique no dia (mês) abre a visão do dia, como no Outlook
    $$('.cal-cell', corpo).forEach((c) => c.addEventListener('dblclick', () => { this.ref = c.dataset.dia; this.visao = 'dia'; this.carregar(); }));
  },

  novo(dia) {
    const m = modal({
      titulo: `Novo lançamento · ${dataBR(dia)}`, tamanho: 'sm',
      corpo: `<div style="display:grid;gap:10px">
        <button class="btn" data-t="receber" style="justify-content:flex-start">${I.in}<span class="pos">Conta a receber</span></button>
        <button class="btn" data-t="pagar" style="justify-content:flex-start">${I.out}<span class="neg">Conta a pagar</span></button></div>`,
    });
    $$('[data-t]', m.el).forEach((b) => b.addEventListener('click', () => { m.fechar(); this.abrirForm(b.dataset.t, dia); }));
  },

  abrirForm(tipo, dia) {
    const h = hojeISO();
    Lancamentos.form(tipo, null, { data_vencimento: dia, data_emissao: dia < h ? dia : h });
  },

  async detalhe(chave) {
    const [tipo, nro] = chave.split(':');
    const x = this.itens.find((i) => i.tipo === tipo && String(i.nro_documento) === nro);
    if (!x) return;
    const c = Lancamentos.cfg[tipo];
    const linha = (r, v) => (v ? `<div class="cal-dl"><span>${r}</span><b>${v}</b></div>` : '');
    const m = modal({
      titulo: `${tipo === 'receber' ? 'Conta a receber' : 'Conta a pagar'} Nº ${String(x.nro_documento).padStart(6, '0')}`, tamanho: 'sm',
      corpo: `<div class="cal-det ${tipo === 'receber' ? 'rec' : 'pag'}">
          <div class="cal-det-v num ${tipo === 'receber' ? 'pos' : 'neg'}">${moeda(x.valor_centavos)}</div>
          <div>${badgeStatus(x.status)} ${badgeAmb(x.tipo_ambiente)}</div></div>
        ${linha(c.parteRot, esc(x.parte_nome))}
        ${linha('Descrição', esc(x.observacoes || ''))}
        ${linha('Categoria', esc(x.categoria_nome))}
        ${linha('Centro de custo', esc(x.centro_custo_nome || ''))}
        ${linha('Colaborador', esc(x.colaborador_nome || ''))}
        ${linha('Emissão', dataBR(x.data_emissao))}
        ${linha('Vencimento', dataBR(x.data_vencimento))}
        ${linha(c.pagoRot, x.data_pagamento ? dataBR(x.data_pagamento) : '')}
        ${linha('Forma de pagamento', esc(x.forma_pagamento_nome || ''))}
        ${linha('Conta bancária', esc(x.conta_bancaria_nome || ''))}
        ${x.rateio.length ? linha('Rateio', x.rateio.map((r) => `${esc(r.colaborador_nome)}: ${moeda(r.valor_centavos)}`).join('<br>')) : ''}`,
      rodape: `<button class="btn danger sm" data-a="excluir">${I.trash}Excluir</button><span style="flex:1"></span>
        ${x.data_pagamento ? `<button class="btn sm" data-a="estorno">${I.undo}Estornar</button>` : `<button class="btn primary sm" data-a="baixa">${I.check}${tipo === 'receber' ? 'Receber' : 'Pagar'}</button>`}
        <button class="btn sm" data-a="editar">${I.edit}Editar</button>`,
    });
    $$('[data-a]', m.el).forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.a;
      try {
        if (a === 'baixa') { m.fechar(); return Lancamentos.baixa(tipo, x); }
        if (a === 'editar') { m.fechar(); return Lancamentos.form(tipo, await api(`${c.api}/${x.nro_documento}`)); }
        if (a === 'estorno') {
          if (!(await confirmar(`Estornar a baixa do título <b>${x.nro_documento}</b>?`, { ok: 'Estornar' }))) return;
          await api(`${c.api}/${x.nro_documento}/estorno`, { method: 'PATCH', body: {} });
          toast('Baixa estornada.');
        }
        if (a === 'excluir') {
          if (!(await confirmar(`Excluir definitivamente o título <b>${x.nro_documento}</b> de ${moeda(x.valor_centavos)}?`, { ok: 'Excluir', perigo: true }))) return;
          await api(`${c.api}/${x.nro_documento}`, { method: 'DELETE' });
          toast('Título excluído.');
        }
        m.fechar(); this.carregar();
      } catch (err) { toast(err.message, 'err'); }
    }));
  },
};

/** Valor compacto sem "R$" para caber nas células (ex.: 1,2 mil) */
function moedaCurtaN(c) {
  const v = (c || 0) / 100;
  if (Math.abs(v) < 10000) return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return fmtCompact.format(v);
}
