/* =====================================================================
   Despesas por Centro de Custo (Contas a Pagar)
   ===================================================================== */
'use strict';

const CentrosCusto = {
  chart: null,
  dados: null,
  centro: '',        // '' = todos | 'SEM' | id
  visao: 'previsto', // previsto | realizado
  // Paleta categórica validada (tema escuro) + neutros para "Sem centro" e "Outros"
  PALETA: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'],
  COR_SEM: '#8b9ab5',
  COR_OUTROS: '#4f5d78',

  async render(el) {
    const f = Estado.filtros;
    const cadastro = await Cache.get('centros-custo');
    el.classList.add('loading');
    const d = await api('/api/resumo-centros-custo?' + qs({ de: f.de, ate: f.ate, ambiente: f.ambiente, centro_custo_id: this.centro }));
    el.classList.remove('loading');
    this.dados = d;
    this.cadastro = cadastro;
    this.rankMap = new Map(d.centros.filter((c) => c.id !== null).map((c, i) => [c.id, i]));
    const k = d.kpis;
    const exec = pct(k.realizado, k.previsto);

    el.innerHTML = `
      <div class="toolbar">
        <select class="input" id="cc-sel" title="Centro de custo">
          <option value="">Todos os centros de custo</option>
          <option value="SEM" ${this.centro === 'SEM' ? 'selected' : ''}>Sem centro de custo</option>
          ${opts(cadastro, this.centro, rotuloCC, null)}
        </select>
        <span class="grow"></span>
        <a class="btn" href="#/cad/centros-custo">${I.target}Cadastrar centros</a>
        <button class="btn" id="cc-csv">${I.download}Exportar CSV</button>
      </div>

      <div class="summary">
        <div class="s"><small>Despesa prevista</small><b class="num">${moeda(k.previsto)}</b></div>
        <div class="s"><small>Despesa realizada</small><b class="num">${moeda(k.realizado)}</b> <span class="muted" style="font-size:12px">${exec}% executado</span></div>
        <div class="s"><small>Em aberto</small><b class="num" style="color:var(--warn)">${moeda(k.em_aberto)}</b></div>
        <div class="s"><small>Em atraso</small><b class="num neg">${moeda(k.em_atraso)}</b></div>
        <div class="s" title="Despesas previstas no período que não têm centro de custo informado"><small>Sem centro de custo</small><b class="num">${moeda(k.sem_centro)}</b>
          ${k.previsto ? `<span class="muted" style="font-size:12px"> ${pct(k.sem_centro, k.previsto)}%</span>` : ''}</div>
      </div>

      <section class="grid g-main">
        <div class="card">
          <div class="card-h">
            <div><h3>Evolução das despesas por centro de custo</h3>
              <p>${this.visao === 'previsto' ? 'Previsto (por vencimento)' : 'Realizado (por pagamento)'} · por ${d.serie.granularidade === 'dia' ? 'dia' : 'mês'} · 5 maiores centros + Outros</p></div>
            <div class="seg" id="cc-visao"><button data-v="previsto">Previsto</button><button data-v="realizado">Realizado</button></div>
          </div>
          <div class="card-b">
            <div class="legend" id="cc-leg" style="margin-bottom:10px"></div>
            <div class="chart-box"><canvas id="cc-chart" role="img" aria-label="Evolução das despesas por centro de custo"></canvas></div>
          </div>
        </div>
        <div class="card">
          <div class="card-h"><div><h3>Participação por centro de custo</h3><p>% da despesa prevista no período</p></div></div>
          <div class="card-b">${this.participacao(d.centros, k.previsto)}</div>
        </div>
      </section>

      <section class="grid mt">
        <div class="card">
          <div class="card-h"><div><h3>Demonstrativo por centro de custo</h3><p>Clique em uma linha para ver os títulos</p></div></div>
          <div class="table-wrap">${this.tabela(d.centros, k)}</div>
        </div>
      </section>

      <section class="grid g-2 mt">
        <div class="card">
          <div class="card-h"><div><h3>Categorias de despesa</h3><p>${this.centro ? 'Dentro do centro de custo selecionado' : 'Todos os centros de custo'} · top 10</p></div>
            <div class="legend"><span><i class="sw prev-d"></i>Previsto</span><span><i class="sw real-d"></i>Realizado</span></div></div>
          <div class="card-b">${Dashboard.ranking(d.categorias, 'despesa', true)}</div>
        </div>
        <div class="card">
          <div class="card-h"><div><h3>Principais fornecedores</h3><p>${this.centro ? 'Dentro do centro de custo selecionado' : 'Todos os centros de custo'} · top 10</p></div>
            <div class="legend"><span><i class="sw prev-d"></i>Previsto</span><span><i class="sw real-d"></i>Realizado</span></div></div>
          <div class="card-b">${Dashboard.ranking(d.fornecedores, 'despesa', true)}</div>
        </div>
      </section>`;

    $('#cc-sel').addEventListener('change', (e) => { this.centro = e.target.value; this.render(el); });
    $$('#cc-visao button').forEach((b) => b.addEventListener('click', () => { this.visao = b.dataset.v; this.render(el); }));
    $('#cc-csv').addEventListener('click', () => this.exportar());
    $$('tr[data-cc]', el).forEach((tr) => tr.addEventListener('click', () => this.titulos(tr.dataset.cc, tr.dataset.nome)));
    this.grafico();
  },

  /** Cor fixa por centro: segue a entidade (ordem do cadastro) quando há até 5 centros; senão, pela posição no ranking */
  cor(id) {
    if (id === null) return this.COR_SEM;
    if (id === 'OUTROS') return this.COR_OUTROS;
    if (this.cadastro.length <= this.PALETA.length) {
      const i = this.cadastro.findIndex((c) => c.id === id);
      if (i >= 0) return this.PALETA[i];
    }
    const r = this.rankMap.get(id) ?? 0;
    return r < this.PALETA.length ? this.PALETA[r] : this.COR_OUTROS;
  },

  grafico() {
    $$('#cc-visao button').forEach((b) => b.classList.toggle('on', b.dataset.v === this.visao));
    const s = this.dados.serie;
    const grupos = s.grupos.map((g) => ({ ...g, cor: this.cor(g.id) }));
    $('#cc-leg').innerHTML = grupos.length
      ? grupos.map((g) => `<span><i class="sw" style="background:${g.cor}"></i>${esc(g.nome)}</span>`).join('')
      : '<span class="muted">Sem despesas no período.</span>';
    if (this.chart) this.chart.destroy();
    this.chart = new Chart($('#cc-chart'), {
      type: 'bar',
      data: {
        labels: s.rotulos.map(rotuloBalde),
        datasets: grupos.map((g) => ({
          label: g.nome, data: g[this.visao].map((c) => c / 100), backgroundColor: g.cor,
          borderColor: COR.surface, borderWidth: { top: 2 }, borderSkipped: 'bottom', maxBarThickness: 34,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12 } },
          y: { stacked: true, beginAtZero: true, border: { display: false }, ticks: { callback: (v) => moedaCurta(v * 100), maxTicksLimit: 6 } },
        },
        plugins: {
          tooltip: {
            filter: (c) => c.raw > 0,
            itemSort: (a, b) => b.raw - a.raw,
            callbacks: {
              label: (c) => ` ${c.dataset.label}: ${fmtBRL.format(c.raw)}`,
              footer: (items) => `Total: ${fmtBRL.format(items.reduce((t, i) => t + i.raw, 0))}`,
            },
            footerColor: '#e8edf6',
          },
        },
      },
    });
  },

  participacao(lista, total) {
    const itens = lista.filter((x) => x.previsto > 0);
    if (!itens.length) return '<div class="empty">Sem despesas previstas no período.</div>';
    const max = Math.max(...itens.map((x) => x.previsto), 1);
    return `<div class="rank">${itens.slice(0, 10).map((x) => {
      const cor = this.cor(x.id);
      return `<div class="r">
        <span class="pos-n"><i class="dot" style="background:${cor};width:10px;height:10px"></i></span>
        <span class="nm">${esc(x.codigo ? `${x.codigo} · ${x.nome}` : x.nome)}</span>
        <span class="vl num">${pct(x.previsto, total)}%</span>
        <div class="track"><i style="width:${(x.previsto / max) * 100}%;background:${cor}"></i></div>
        <div class="meta"><span>${moeda(x.previsto)}</span><span>${x.qtd} título(s)</span></div>
      </div>`;
    }).join('')}</div>`;
  },

  tabela(lista, k) {
    if (!lista.length) return '<div class="empty">Sem despesas no período.</div>';
    return `<table>
      <thead><tr><th>Centro de custo</th><th class="r">Títulos</th><th class="r">% do total</th><th class="r">Previsto</th><th class="r">Realizado</th><th class="r">% executado</th><th class="r">Em aberto</th><th class="r">Em atraso</th></tr></thead>
      <tbody>${lista.map((x) => `<tr class="click" data-cc="${x.id === null ? 'SEM' : x.id}" data-nome="${esc(x.nome)}">
        <td><i class="dot" style="background:${this.cor(x.id)};margin-right:8px"></i>${x.codigo ? `<small class="muted">${esc(x.codigo)}</small> ` : ''}<b>${esc(x.nome)}</b>${x.ativo === 0 ? ' <span class="badge b-neutral xs">Inativo</span>' : ''}</td>
        <td class="r num">${x.qtd}</td><td class="r num">${pct(x.previsto, k.previsto)}%</td>
        <td class="r num">${moeda(x.previsto)}</td><td class="r num">${moeda(x.realizado)}</td><td class="r num">${pct(x.realizado, x.previsto)}%</td>
        <td class="r num">${moeda(x.em_aberto)}</td><td class="r num ${x.em_atraso ? 'neg' : ''}">${moeda(x.em_atraso)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="r num">${k.qtd}</td><td class="r num">100%</td><td class="r num">${moeda(k.previsto)}</td><td class="r num">${moeda(k.realizado)}</td>
        <td class="r num">${pct(k.realizado, k.previsto)}%</td><td class="r num">${moeda(k.em_aberto)}</td><td class="r num">${moeda(k.em_atraso)}</td></tr></tfoot>
    </table>`;
  },

  async titulos(cc, nome) {
    const f = Estado.filtros;
    try {
      const d = await api('/api/pagar?' + qs({ de: f.de, ate: f.ate, ambiente: f.ambiente === 'TODAS' ? '' : f.ambiente, centro_custo_id: cc, base: 'vencimento' }));
      const tab = !d.itens.length ? '<div class="empty">Nenhum título com vencimento no período.</div>' : `<table>
        <thead><tr><th>Nº</th><th>Vencimento</th><th>Pagamento</th><th>Fornecedor</th><th>Categoria</th><th>Colaborador</th><th class="r">Valor</th><th>Status</th></tr></thead>
        <tbody>${d.itens.map((x) => `<tr><td class="num">${x.nro_documento}${badgeAmb(x.tipo_ambiente, true)}</td><td class="num">${dataBR(x.data_vencimento)}</td>
          <td class="num">${dataBR(x.data_pagamento)}</td><td class="wrap">${esc(x.parte_nome)}${x.observacoes ? `<br><small class="muted">${esc(x.observacoes)}</small>` : ''}</td>
          <td>${esc(x.categoria_nome)}</td><td>${esc(x.colaborador_nome || '—')}</td><td class="r num"><b>${moeda(x.valor_centavos)}</b></td><td>${badgeStatus(x.status)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="6">Total</td><td class="r num">${moeda(d.totais.total)}</td><td></td></tr></tfoot></table>`;
      modal({
        titulo: `${esc(nome)} <small class="muted" style="font-weight:400;font-size:13px">${dataBR(f.de)} a ${dataBR(f.ate)} · por vencimento</small>`, tamanho: 'lg',
        corpo: `<div class="table-wrap">${tab}</div>`,
      });
    } catch (err) { toast(err.message, 'err'); }
  },

  exportar() {
    const f = Estado.filtros;
    baixarCSV(`despesas_centro_custo_${f.de}_${f.ate}.csv`,
      ['Código', 'Centro de Custo', 'Títulos', 'Previsto', 'Realizado', 'Em aberto', 'Em atraso'],
      this.dados.centros.map((x) => [x.codigo || '', x.nome, x.qtd, centavosCSV(x.previsto), centavosCSV(x.realizado), centavosCSV(x.em_aberto), centavosCSV(x.em_atraso)]));
  },
};
