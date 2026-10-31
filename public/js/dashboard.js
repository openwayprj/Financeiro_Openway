/* =====================================================================
   Dashboard Executivo Analítico
   ===================================================================== */
'use strict';

const Dashboard = {
  charts: [],
  dados: null,
  visaoStatus: 'geral',

  destruir() { this.charts.forEach((c) => c.destroy()); this.charts = []; },

  async render(el) {
    const f = Estado.filtros;
    el.classList.add('loading');
    const d = await api('/api/dashboard?' + qs({ de: f.de, ate: f.ate, ambiente: f.ambiente }));
    el.classList.remove('loading');
    this.dados = d;
    this.destruir();
    const k = d.kpis;
    const recPct = pct(k.receitas_realizadas, k.receitas_previstas);
    const despPct = pct(k.despesas_realizadas, k.despesas_previstas);
    const sinal = (v) => (v >= 0 ? 'pos' : 'neg');

    el.innerHTML = `
    <section class="grid g-kpi" aria-label="Indicadores">
      <div class="card kpi" style="--accent:var(--primary)">
        <div class="lbl">Total Previsto <span title="Títulos com vencimento no período (pagos ou não)">ⓘ</span></div>
        <div class="pair">
          <div><small><i class="dot" style="background:var(--receita)"></i>Receitas</small><b class="num">${moeda(k.receitas_previstas)}</b></div>
          <div><small><i class="dot" style="background:var(--despesa)"></i>Despesas</small><b class="num">${moeda(k.despesas_previstas)}</b></div>
        </div>
        <div class="sub" style="margin-top:10px">Em aberto: <b class="num">${moeda(k.receber_em_aberto)}</b> a receber · <b class="num">${moeda(k.pagar_em_aberto)}</b> a pagar</div>
      </div>
      <div class="card kpi" style="--accent:var(--silver)">
        <div class="lbl">Total Realizado <span title="Títulos com data de pagamento no período (caixa)">ⓘ</span></div>
        <div class="pair">
          <div><small><i class="dot" style="background:var(--receita)"></i>Recebido</small><b class="num">${moeda(k.receitas_realizadas)}</b></div>
          <div><small><i class="dot" style="background:var(--despesa)"></i>Pago</small><b class="num">${moeda(k.despesas_realizadas)}</b></div>
        </div>
        <div class="sub" style="margin-top:10px">${recPct}% das receitas e ${despPct}% das despesas previstas</div>
      </div>
      <div class="card kpi" style="--accent:${k.resultado_previsto >= 0 ? 'var(--ok)' : 'var(--crit)'}">
        <div class="lbl">Resultado Final Previsto</div>
        <div class="big num ${sinal(k.resultado_previsto)}">${moeda(k.resultado_previsto)}</div>
        <div class="sub">Receitas previstas − Despesas previstas</div>
        <div class="sub">Margem prevista: <b>${k.receitas_previstas ? Math.round((k.resultado_previsto / k.receitas_previstas) * 100) + '%' : '—'}</b></div>
      </div>
      <div class="card kpi" style="--accent:${k.resultado_realizado >= 0 ? 'var(--ok)' : 'var(--crit)'}">
        <div class="lbl">Resultado Final Realizado</div>
        <div class="big num ${sinal(k.resultado_realizado)}">${moeda(k.resultado_realizado)}</div>
        <div class="sub">Receitas realizadas − Despesas realizadas</div>
        <div class="sub">Em atraso: <b class="neg num">${moeda(k.receber_em_atraso)}</b> a receber · <b class="neg num">${moeda(k.pagar_em_atraso)}</b> a pagar</div>
      </div>
    </section>

    <section class="grid g-main mt">
      <div class="card">
        <div class="card-h">
          <div><h3>Contas a Receber vs. Contas a Pagar</h3><p>Previsto (vencimento) x Realizado (pagamento) · por ${d.serie.granularidade === 'dia' ? 'dia' : 'mês'}</p></div>
          <div class="legend">
            <span><i class="sw prev-r"></i>Receita prevista</span><span><i class="sw real-r"></i>Receita realizada</span>
            <span><i class="sw prev-d"></i>Despesa prevista</span><span><i class="sw real-d"></i>Despesa realizada</span>
          </div>
        </div>
        <div class="card-b"><div class="chart-box"><canvas id="ch-serie" aria-label="Gráfico de receitas e despesas no tempo" role="img"></canvas></div></div>
      </div>
      <div class="card">
        <div class="card-h">
          <div><h3>Status dos Títulos</h3><p>Vencimento no período · % por quantidade</p></div>
          <div class="seg" id="st-seg">
            <button data-v="geral">Todos</button><button data-v="receber">Receber</button><button data-v="pagar">Pagar</button>
          </div>
        </div>
        <div class="card-b"><div class="donut-wrap">
          <div class="chart-box"><canvas id="ch-status" aria-label="Gráfico de status dos títulos" role="img"></canvas></div>
          <div class="status-list" id="st-list"></div>
        </div></div>
      </div>
    </section>

    <section class="grid g-2 mt">
      <div class="card">
        <div class="card-h"><div><h3>Ranking de Receitas por Colaborador</h3><p>Contas a Receber · considera rateio entre colaboradores</p></div>
          <div class="legend"><span><i class="sw prev-r"></i>Previsto</span><span><i class="sw real-r"></i>Realizado</span></div></div>
        <div class="card-b">${this.ranking(d.colaboradores.receitas, 'receita')}</div>
      </div>
      <div class="card">
        <div class="card-h"><div><h3>Despesas Atreladas a Colaboradores</h3><p>Contas a Pagar com colaborador vinculado ou rateado</p></div>
          <a class="btn sm" href="#/colaboradores">Receita x Despesa →</a></div>
        <div class="card-b">${this.tabelaDespColab(d.colaboradores.despesas)}</div>
      </div>
    </section>

    <section class="grid g-2 mt">
      <div class="card">
        <div class="card-h"><div><h3>Despesas por Centro de Custo</h3><p>Top 8 por valor previsto no período</p></div>
          <a class="btn sm" href="#/centros">Detalhar →</a></div>
        <div class="card-b">${this.ranking(d.centros_custo, 'despesa', true)}</div>
      </div>
      <div class="card">
        <div class="card-h"><div><h3>Principais Categorias</h3><p>Top 8 por valor previsto no período</p></div>
          <div class="seg" id="cat-seg"><button data-v="receitas" class="on">Receitas</button><button data-v="despesas">Despesas</button></div></div>
        <div class="card-b" id="cat-box"></div>
      </div>
    </section>

    <section class="grid mt">
      <div class="card">
        <div class="card-h"><div><h3>Próximos Vencimentos e Atrasos</h3><p>Títulos em aberto mais antigos primeiro</p></div></div>
        <div class="card-b table-wrap">${this.tabelaProximos(d.proximos)}</div>
      </div>
    </section>`;

    this.graficoSerie(d.serie);
    this.graficoStatus();
    $$('#st-seg button').forEach((b) => b.addEventListener('click', () => { this.visaoStatus = b.dataset.v; this.graficoStatus(); }));
    const renderCat = (v) => {
      $$('#cat-seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
      $('#cat-box').innerHTML = this.ranking(d.categorias[v], v === 'receitas' ? 'receita' : 'despesa', true);
    };
    $$('#cat-seg button').forEach((b) => b.addEventListener('click', () => renderCat(b.dataset.v)));
    renderCat('receitas');
  },

  graficoSerie(s) {
    const ctx = $('#ch-serie');
    const ds = (label, data, cor, soft, prev) => ({
      label, data: data.map((c) => c / 100),
      backgroundColor: prev ? soft : cor, borderColor: cor, borderWidth: prev ? 1.5 : 0,
      borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 22, categoryPercentage: 0.72, barPercentage: 0.9,
    });
    this.charts.push(new Chart(ctx, {
      type: 'bar',
      data: {
        labels: s.rotulos.map(rotuloBalde),
        datasets: [
          ds('Receita prevista', s.receitas_previstas, COR.receita, COR.receitaSoft, true),
          ds('Receita realizada', s.receitas_realizadas, COR.receita, null, false),
          ds('Despesa prevista', s.despesas_previstas, COR.despesa, COR.despesaSoft, true),
          ds('Despesa realizada', s.despesas_realizadas, COR.despesa, null, false),
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12 } },
          y: { beginAtZero: true, border: { display: false }, ticks: { callback: (v) => moedaCurta(v * 100), maxTicksLimit: 6 } },
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (c) => ` ${c.dataset.label}: ${fmtBRL.format(c.raw)}`,
              footer: (items) => {
                const v = (i) => items.find((x) => x.datasetIndex === i)?.raw || 0;
                return `Resultado previsto: ${fmtBRL.format(v(0) - v(2))}\nResultado realizado: ${fmtBRL.format(v(1) - v(3))}`;
              },
            },
            footerColor: '#e8edf6', footerFont: { weight: '500' },
          },
        },
      },
    }));
  },

  graficoStatus() {
    const v = this.visaoStatus;
    $$('#st-seg button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
    const st = this.dados.status[v];
    const ordem = ['REALIZADO', 'PENDENTE', 'ATRASADO'];
    const cores = [COR.ok, COR.warn, COR.crit];
    const total = ordem.reduce((s, k) => s + st[k].qtd, 0);
    const old = this.charts.find((c) => c.canvas.id === 'ch-status');
    if (old) { old.destroy(); this.charts = this.charts.filter((c) => c !== old); }
    this.charts.push(new Chart($('#ch-status'), {
      type: 'doughnut',
      data: { labels: ordem.map((k) => STATUS[k].txt), datasets: [{ data: total ? ordem.map((k) => st[k].qtd) : [1], backgroundColor: total ? cores : ['#1c2a47'], borderColor: COR.surface, borderWidth: 2, hoverOffset: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '68%',
        plugins: { tooltip: { enabled: !!total, callbacks: { label: (c) => ` ${c.label}: ${c.raw} título(s) · ${pct(c.raw, total)}%` } } },
      },
      plugins: [{
        id: 'centro',
        afterDraw(ch) {
          const { ctx, chartArea: a } = ch;
          ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = '#e8edf6';
          ctx.font = '700 22px Inter, system-ui'; ctx.fillText(total, (a.left + a.right) / 2, (a.top + a.bottom) / 2 + 4);
          ctx.font = '500 11px Inter, system-ui'; ctx.fillStyle = COR.axis; ctx.fillText('títulos', (a.left + a.right) / 2, (a.top + a.bottom) / 2 + 20);
          ctx.restore();
        },
      }],
    }));
    $('#st-list').innerHTML = ordem.map((k) => `
      <div class="it">${badgeStatus(k)}<small class="num">${st[k].qtd} título(s) · ${moeda(st[k].valor)}</small><b class="num">${pct(st[k].qtd, total)}%</b></div>`).join('');
  },

  ranking(lista, tipo, categoria = false) {
    if (!lista.length) return '<div class="empty">Sem lançamentos no período.</div>';
    const max = Math.max(...lista.map((x) => Math.max(x.previsto, x.realizado)), 1);
    const cor = tipo === 'receita' ? 'var(--receita)' : 'var(--despesa)';
    return `<div class="rank">${lista.slice(0, 8).map((x, i) => `
      <div class="r" title="Previsto ${moeda(x.previsto)} · Realizado ${moeda(x.realizado)}">
        <span class="pos-n">${i + 1}º</span>
        <span class="nm">${esc(x.nome)}${!categoria && x.cargo ? `<small>${esc(x.cargo)}</small>` : ''}</span>
        <span class="vl num">${moeda(x.previsto)}</span>
        <div class="track"><i class="p" style="width:${(x.previsto / max) * 100}%;background:${cor}"></i><i style="width:${(x.realizado / max) * 100}%;background:${cor}"></i></div>
        <div class="meta"><span>Realizado ${moeda(x.realizado)} (${pct(x.realizado, x.previsto)}%)</span>${x.qtd_titulos ? `<span>${x.qtd_titulos} título(s)</span>` : ''}</div>
      </div>`).join('')}</div>`;
  },

  tabelaDespColab(lista) {
    if (!lista.length) return '<div class="empty">Nenhuma despesa vinculada a colaboradores no período.</div>';
    const tot = lista.reduce((t, x) => ({ p: t.p + x.previsto, r: t.r + x.realizado, q: t.q + x.qtd_titulos }), { p: 0, r: 0, q: 0 });
    return `<div class="table-wrap"><table>
      <thead><tr><th>Colaborador</th><th class="r">Previsto</th><th class="r">Realizado</th><th class="r">%</th></tr></thead>
      <tbody>${lista.map((x) => `<tr><td><b>${esc(x.nome)}</b><br><small class="muted">${esc(x.cargo || '')}${x.cargo ? ' · ' : ''}${x.qtd_titulos} título(s)</small></td>
        <td class="r num">${moeda(x.previsto)}</td><td class="r num">${moeda(x.realizado)}</td>
        <td class="r num">${pct(x.previsto, tot.p)}%</td></tr>`).join('')}</tbody>
      <tfoot><tr><td>Total <small class="muted">· ${tot.q} título(s)</small></td><td class="r num">${moeda(tot.p)}</td><td class="r num">${moeda(tot.r)}</td><td class="r">100%</td></tr></tfoot>
    </table></div>`;
  },

  tabelaProximos(lista) {
    if (!lista.length) return '<div class="empty">Nenhum título em aberto.</div>';
    return `<table><thead><tr><th>Tipo</th><th>Nº</th><th>Vencimento</th><th>Cliente / Fornecedor</th><th class="r">Valor</th><th>Status</th></tr></thead>
      <tbody>${lista.map((x) => `<tr class="click" data-go="${x.tipo === 'RECEBER' ? 'receber' : 'pagar'}">
        <td>${x.tipo === 'RECEBER' ? `<span class="pos">${I.in.replace('<svg', '<svg width="14" height="14"')} Receber</span>` : `<span class="neg">${I.out.replace('<svg', '<svg width="14" height="14"')} Pagar</span>`}</td>
        <td class="num">${x.nro_documento}</td><td class="num">${dataBR(x.data_vencimento)}</td>
        <td class="wrap">${esc(x.parte_nome)}<br><small class="muted">${x.tipo_ambiente === 'EMPRESA' ? 'Empresa' : 'Pessoal'}</small></td><td class="r num">${moeda(x.valor_centavos)}</td><td>${badgeStatus(x.status)}</td></tr>`).join('')}</tbody></table>`;
  },
};

document.addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-go]');
  if (tr) location.hash = '#/' + tr.dataset.go;
});
