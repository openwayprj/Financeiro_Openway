/* =====================================================================
   Resumo por Colaborador: Receita trazida x Despesa gerada
   ===================================================================== */
'use strict';

const ResumoColab = {
  chart: null,
  visao: 'previsto',
  inativos: false,
  dados: null,

  async render(el) {
    const f = Estado.filtros;
    el.classList.add('loading');
    const d = await api('/api/resumo-colaboradores?' + qs({ de: f.de, ate: f.ate, ambiente: f.ambiente, inativos: this.inativos ? 1 : '' }));
    el.classList.remove('loading');
    this.dados = d;
    const T = d.totais;
    el.innerHTML = `
      <div class="summary">
        <div class="s"><small>Receita prevista atribuída</small><b class="num pos">${moeda(T.receita_prevista)}</b></div>
        <div class="s"><small>Despesa prevista atribuída</small><b class="num neg">${moeda(T.despesa_prevista)}</b></div>
        <div class="s"><small>Saldo previsto</small><b class="num ${T.saldo_previsto >= 0 ? 'pos' : 'neg'}">${moeda(T.saldo_previsto)}</b></div>
        <div class="s"><small>Receita realizada</small><b class="num">${moeda(T.receita_realizada)}</b></div>
        <div class="s"><small>Despesa realizada</small><b class="num">${moeda(T.despesa_realizada)}</b></div>
        <div class="s"><small>Saldo realizado</small><b class="num ${T.saldo_realizado >= 0 ? 'pos' : 'neg'}">${moeda(T.saldo_realizado)}</b></div>
      </div>

      <div class="card">
        <div class="card-h">
          <div><h3>Receita trazida x Despesa gerada</h3><p>Atribuição: rateio informado no título; o saldo não rateado vai para o colaborador responsável</p></div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <div class="legend"><span><i class="sw real-r"></i>Receita</span><span><i class="sw real-d"></i>Despesa</span></div>
            <div class="seg" id="rc-visao"><button data-v="previsto">Previsto</button><button data-v="realizado">Realizado</button></div>
          </div>
        </div>
        <div class="card-b"><div class="chart-box" id="rc-box"><canvas id="rc-chart" role="img" aria-label="Receita e despesa por colaborador"></canvas></div></div>
      </div>

      <div class="card mt">
        <div class="card-h"><div><h3>Demonstrativo por colaborador</h3><p>Clique em uma linha para ver o extrato de títulos</p></div>
          <div style="display:flex;gap:10px;align-items:center">
            <label class="muted" style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="rc-inat" ${this.inativos ? 'checked' : ''}> Incluir inativos sem movimento</label>
            <button class="btn sm" id="rc-csv">${I.download}CSV</button>
          </div></div>
        <div class="table-wrap">${this.tabela(d)}</div>
      </div>`;

    $$('#rc-visao button').forEach((b) => b.addEventListener('click', () => { this.visao = b.dataset.v; this.grafico(); }));
    $('#rc-inat').addEventListener('change', (e) => { this.inativos = e.target.checked; this.render(el); });
    $('#rc-csv').addEventListener('click', () => this.exportar());
    $$('tr[data-col]', el).forEach((tr) => tr.addEventListener('click', () => this.extrato(Number(tr.dataset.col))));
    this.grafico();
  },

  grafico() {
    $$('#rc-visao button').forEach((b) => b.classList.toggle('on', b.dataset.v === this.visao));
    const v = this.visao === 'previsto' ? 'prevista' : 'realizada';
    const itens = this.dados.itens.filter((x) => x.receita_prevista || x.despesa_prevista || x.receita_realizada || x.despesa_realizada);
    $('#rc-box').style.height = Math.max(220, itens.length * 46 + 60) + 'px';
    if (this.chart) this.chart.destroy();
    this.chart = new Chart($('#rc-chart'), {
      type: 'bar',
      data: {
        labels: itens.map((x) => x.nome),
        datasets: [
          { label: 'Receita', data: itens.map((x) => x['receita_' + v] / 100), backgroundColor: COR.receita, borderRadius: 4, borderSkipped: 'left', maxBarThickness: 16, categoryPercentage: 0.7, barPercentage: 0.9 },
          { label: 'Despesa', data: itens.map((x) => x['despesa_' + v] / 100), backgroundColor: COR.despesa, borderRadius: 4, borderSkipped: 'left', maxBarThickness: 16, categoryPercentage: 0.7, barPercentage: 0.9 },
        ],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { beginAtZero: true, border: { display: false }, ticks: { callback: (val) => moedaCurta(val * 100), maxTicksLimit: 6 } },
          y: { grid: { display: false }, ticks: { color: COR.text } },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) => ` ${c.dataset.label}: ${fmtBRL.format(c.raw)}`,
              footer: (items) => `Saldo: ${fmtBRL.format((items[0]?.raw || 0) - (items[1]?.raw || 0))}`,
            },
          },
        },
      },
    });
  },

  tabela(d) {
    if (!d.itens.length) return '<div class="empty">Nenhum colaborador com movimento no período.</div>';
    const roi = (x) => (x.roi_previsto == null ? '—' : x.roi_previsto.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + 'x');
    const T = d.totais;
    return `<table>
      <thead><tr><th>Colaborador</th><th class="r">Títulos (R/P)</th><th class="r">Receita prevista</th><th class="r">Receita realizada</th>
        <th class="r">Despesa prevista</th><th class="r">Despesa realizada</th><th class="r">Saldo previsto</th><th class="r">Saldo realizado</th>
        <th class="r" title="Receita prevista ÷ despesa prevista">Receita/Despesa</th></tr></thead>
      <tbody>${d.itens.map((x) => `<tr class="click" data-col="${x.id}">
        <td><b>${esc(x.nome)}</b> ${x.status === 'INATIVO' ? '<span class="badge b-neutral">Inativo</span>' : ''}<br><small class="muted">${esc(x.cargo || '')}</small></td>
        <td class="r num">${x.qtd_receber} / ${x.qtd_pagar}</td>
        <td class="r num">${moeda(x.receita_prevista)}</td><td class="r num">${moeda(x.receita_realizada)}</td>
        <td class="r num">${moeda(x.despesa_prevista)}</td><td class="r num">${moeda(x.despesa_realizada)}</td>
        <td class="r num"><b class="${x.saldo_previsto >= 0 ? 'pos' : 'neg'}">${moeda(x.saldo_previsto)}</b></td>
        <td class="r num"><b class="${x.saldo_realizado >= 0 ? 'pos' : 'neg'}">${moeda(x.saldo_realizado)}</b></td>
        <td class="r num">${roi(x)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total</td><td></td><td class="r num">${moeda(T.receita_prevista)}</td><td class="r num">${moeda(T.receita_realizada)}</td>
        <td class="r num">${moeda(T.despesa_prevista)}</td><td class="r num">${moeda(T.despesa_realizada)}</td>
        <td class="r num">${moeda(T.saldo_previsto)}</td><td class="r num">${moeda(T.saldo_realizado)}</td><td></td></tr></tfoot>
    </table>`;
  },

  async extrato(id) {
    const f = Estado.filtros;
    try {
      const d = await api(`/api/resumo-colaboradores/${id}?` + qs({ de: f.de, ate: f.ate, ambiente: f.ambiente }));
      const rec = d.itens.filter((x) => x.natureza_titulo === 'RECEBER'), desp = d.itens.filter((x) => x.natureza_titulo === 'PAGAR');
      const tab = (lista, rot) => (!lista.length ? `<div class="empty">Sem ${rot.toLowerCase()} no período.</div>` : `<table>
        <thead><tr><th>Nº</th><th>Vencimento</th><th>Pagamento</th><th>${rot === 'Receitas' ? 'Cliente' : 'Fornecedor'}</th><th>Categoria</th>
          <th class="r">Valor título</th><th class="r">Atribuído</th><th>Status</th></tr></thead>
        <tbody>${lista.map((x) => `<tr><td class="num">${x.nro_documento}${badgeAmb(x.tipo_ambiente, true)}</td><td class="num">${dataBR(x.data_vencimento)}</td><td class="num">${dataBR(x.data_pagamento)}</td><td>${esc(x.parte_nome)}</td><td>${esc(x.categoria_nome)}</td>
          <td class="r num">${moeda(x.valor_titulo)}</td><td class="r num"><b>${moeda(x.valor_atribuido)}</b></td><td>${badgeStatus(x.status)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="6">Total atribuído</td><td class="r num">${moeda(lista.reduce((s, x) => s + x.valor_atribuido, 0))}</td><td></td></tr></tfoot></table>`);
      modal({
        titulo: `Extrato · ${esc(d.colaborador.nome)} <small class="muted" style="font-weight:400;font-size:13px">${dataBR(f.de)} a ${dataBR(f.ate)}</small>`, tamanho: 'lg',
        corpo: `<h3 class="pos" style="font-size:14px;margin:0 0 8px">Receitas trazidas</h3><div class="table-wrap">${tab(rec, 'Receitas')}</div>
                <h3 class="neg" style="font-size:14px;margin:22px 0 8px">Despesas geradas</h3><div class="table-wrap">${tab(desp, 'Despesas')}</div>`,
      });
    } catch (err) { toast(err.message, 'err'); }
  },

  exportar() {
    const f = Estado.filtros;
    baixarCSV(`resumo_colaboradores_${f.de}_${f.ate}.csv`,
      ['Colaborador', 'Cargo', 'Status', 'Receita prevista', 'Receita realizada', 'Despesa prevista', 'Despesa realizada', 'Saldo previsto', 'Saldo realizado'],
      this.dados.itens.map((x) => [x.nome, x.cargo || '', x.status, centavosCSV(x.receita_prevista), centavosCSV(x.receita_realizada),
        centavosCSV(x.despesa_prevista), centavosCSV(x.despesa_realizada), centavosCSV(x.saldo_previsto), centavosCSV(x.saldo_realizado)]));
  },
};
