/* =====================================================================
   Projeção de Mês: copia lançamentos de um mês para outro (sem pagamento)
   ===================================================================== */
'use strict';

const Projecao = {
  origem: null,
  destino: null,
  tipo: 'ambos',
  ambiente: '',
  itens: [],

  mesAtual() { return hojeISO().slice(0, 7); },
  somaMes(m, n) { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 + n, 1); return isoDate(d).slice(0, 7); },
  nomeMes(m) { const [y, mm] = m.split('-').map(Number); return `${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][mm - 1]}/${y}`; },

  /** Abre a tela já configurada (usado pelos botões das telas de Receber/Pagar) */
  abrir(tipo) {
    this.tipo = tipo || 'ambos';
    this.origem = (Estado.filtros.de || hojeISO()).slice(0, 7);
    this.destino = this.somaMes(this.origem, 1);
    this.itens = [];
    location.hash = '#/projecao';
  },

  async render(el) {
    if (!this.origem) { this.origem = this.mesAtual(); this.destino = this.somaMes(this.origem, 1); }
    el.innerHTML = `
      <div class="card">
        <div class="card-h"><div><h3>Projetar lançamentos para um novo mês</h3>
          <p>Copia os títulos de um mês para outro <b>sem data de pagamento</b> (ficam pendentes). Emissão e vencimento avançam mantendo o dia.</p></div></div>
        <div class="card-b">
          <form id="pj-form" class="form-grid" style="align-items:end">
            <div class="f s3"><label>Mês de origem</label><input class="input" type="month" name="origem" value="${this.origem}" required></div>
            <div class="f s3"><label>Mês de destino</label><input class="input" type="month" name="destino" value="${this.destino}" required></div>
            <div class="f s3"><label>Lançamentos</label>
              <select class="input" name="tipo">
                <option value="ambos">Receber e Pagar</option><option value="receber">Somente Contas a Receber</option><option value="pagar">Somente Contas a Pagar</option>
              </select></div>
            <div class="f s3"><label>Ambiente</label>
              <select class="input" name="ambiente"><option value="">Pessoal e Empresa</option><option value="EMPRESA">Somente Empresa</option><option value="PESSOAL">Somente Pessoal</option></select></div>
            <div class="f s12" style="flex-direction:row;justify-content:flex-end;gap:10px">
              <button class="btn primary" type="submit">${I.search}Carregar lançamentos do mês de origem</button>
            </div>
          </form>
        </div>
      </div>
      <div id="pj-res" class="mt"></div>`;
    const F = $('#pj-form');
    F.tipo.value = this.tipo; F.ambiente.value = this.ambiente;
    // Ao mudar a origem, sugere o mês seguinte como destino
    F.origem.addEventListener('change', () => { if (F.origem.value) F.destino.value = this.somaMes(F.origem.value, 1); });
    F.addEventListener('submit', (e) => { e.preventDefault(); this.carregar(); });
    if (this.itens.length) this.desenhar(); else if (location.hash.includes('projecao')) this.carregar();
  },

  async carregar() {
    const F = $('#pj-form');
    Object.assign(this, { origem: F.origem.value, destino: F.destino.value, tipo: F.tipo.value, ambiente: F.ambiente.value });
    if (!this.origem || !this.destino) return toast('Informe os meses de origem e destino.', 'err');
    if (this.origem === this.destino) return toast('O mês de destino deve ser diferente do mês de origem.', 'err');
    try {
      const d = await api('/api/projecao/preview?' + qs({ origem: this.origem, destino: this.destino, tipo: this.tipo === 'ambos' ? '' : this.tipo, ambiente: this.ambiente }));
      this.itens = d.itens.map((x) => ({ ...x, sel: !x.ja_projetado, valor: x.valor_centavos }));
      this.meses = d.meses;
      this.desenhar();
    } catch (err) { toast(err.message, 'err'); }
  },

  desenhar() {
    const box = $('#pj-res');
    if (!this.itens.length) {
      box.innerHTML = `<div class="card card-b empty">Nenhum lançamento com vencimento em ${this.nomeMes(this.origem)} para os filtros escolhidos.</div>`;
      return;
    }
    const jaProj = this.itens.filter((x) => x.ja_projetado).length;
    box.innerHTML = `
      <div class="card">
        <div class="card-h">
          <div><h3>${this.itens.length} lançamento(s) de ${this.nomeMes(this.origem)} → ${this.nomeMes(this.destino)}</h3>
            <p>Desmarque o que não se repete e ajuste os valores que mudam (ex.: contas de consumo).
            ${jaProj ? `<span style="color:var(--warn)"> ${jaProj} já foram projetados para ${this.nomeMes(this.destino)} e vieram desmarcados.</span>` : ''}</p></div>
          <div style="display:flex;gap:8px">
            <button class="btn sm" id="pj-todos">Marcar todos</button><button class="btn sm" id="pj-nenhum">Desmarcar todos</button>
          </div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th style="width:36px"><input type="checkbox" id="pj-all" aria-label="Selecionar todos"></th><th>Tipo</th><th>Nº origem</th><th>Cliente / Fornecedor</th><th>Categoria</th>
            <th>Vencimento</th><th class="r">Valor no novo mês</th><th>Observação</th></tr></thead>
          <tbody>${this.itens.map((x, i) => `<tr data-i="${i}" class="${x.sel ? '' : 'muted'}">
            <td><input type="checkbox" data-sel ${x.sel ? 'checked' : ''} aria-label="Projetar título ${x.nro_documento}"></td>
            <td>${x.tipo === 'receber' ? '<span class="pos">Receber</span>' : '<span class="neg">Pagar</span>'}${badgeAmb(x.tipo_ambiente, true)}</td>
            <td class="num">${x.nro_documento}${x.data_pagamento ? '' : ' <small class="muted" title="Título de origem ainda em aberto">(em aberto)</small>'}</td>
            <td class="wrap">${esc(x.parte_nome)}${x.observacoes ? `<br><small class="muted">${esc(x.observacoes)}</small>` : ''}</td>
            <td class="wrap-sm">${esc(x.categoria_nome)}${x.centro_custo_nome ? `<br><small class="muted">CC: ${esc(x.centro_custo_nome)}</small>` : ''}${x.qtd_rateio ? `<br><span class="chip-rateio">+ rateio (${x.qtd_rateio})</span>` : ''}</td>
            <td class="num"><small class="muted">${dataBR(x.data_vencimento)} →</small><br><b>${dataBR(x.novo_vencimento)}</b></td>
            <td class="r"><input class="input num" data-val inputmode="decimal" value="${moedaInput(x.valor)}" style="width:130px;text-align:right;padding:6px 9px"></td>
            <td class="wrap-sm">${x.ja_projetado ? `<span class="badge b-warn xs" style="margin:0">Já projetado: nº ${x.ja_projetado}</span>` : ''}
              ${x.inativos.length ? `<span class="badge b-neutral xs" style="margin:0" title="Cadastro inativo">${x.inativos.join(' e ')} inativo</span>` : ''}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="modal-f" style="justify-content:space-between;flex-wrap:wrap;border-radius:0 0 12px 12px">
          <div class="legend" id="pj-sum"></div>
          <button class="btn primary" id="pj-go">${I.check}Gerar lançamentos</button>
        </div>
      </div>`;

    const atualizar = () => {
      const sel = this.itens.filter((x) => x.sel);
      const t = (tp) => sel.filter((x) => x.tipo === tp);
      const soma = (l) => l.reduce((s, x) => s + (x.valor || 0), 0);
      $('#pj-sum').innerHTML = `<span><b>${sel.length}</b>&nbsp;selecionado(s)</span>
        <span class="pos">A receber: <b class="num">&nbsp;${moeda(soma(t('receber')))}</b>&nbsp;(${t('receber').length})</span>
        <span class="neg">A pagar: <b class="num">&nbsp;${moeda(soma(t('pagar')))}</b>&nbsp;(${t('pagar').length})</span>
        <span>Resultado previsto: <b class="num">&nbsp;${moeda(soma(t('receber')) - soma(t('pagar')))}</b></span>`;
      $('#pj-go').disabled = !sel.length;
      $('#pj-go').innerHTML = `${I.check}Gerar ${sel.length} lançamento(s) em ${this.nomeMes(this.destino)}`;
      $('#pj-all').checked = sel.length === this.itens.length;
    };
    $$('#pj-res tr[data-i]').forEach((tr) => {
      const x = this.itens[Number(tr.dataset.i)];
      $('[data-sel]', tr).addEventListener('change', (e) => { x.sel = e.target.checked; tr.classList.toggle('muted', !x.sel); atualizar(); });
      const inp = $('[data-val]', tr);
      inp.addEventListener('input', () => { x.valor = parseMoeda(inp.value); atualizar(); });
      inp.addEventListener('blur', () => { if (x.valor) inp.value = moedaInput(x.valor); });
    });
    const marcar = (v) => { this.itens.forEach((x) => { x.sel = v; }); this.desenhar(); };
    $('#pj-todos').addEventListener('click', () => marcar(true));
    $('#pj-nenhum').addEventListener('click', () => marcar(false));
    $('#pj-all').addEventListener('change', (e) => marcar(e.target.checked));
    $('#pj-go').addEventListener('click', () => this.executar());
    atualizar();
  },

  async executar() {
    const sel = this.itens.filter((x) => x.sel);
    if (sel.some((x) => !x.valor || x.valor <= 0)) return toast('Há lançamentos selecionados com valor inválido.', 'err');
    const dup = sel.filter((x) => x.ja_projetado).length;
    const ok = await confirmar(`Gerar <b>${sel.length}</b> lançamento(s) pendentes em <b>${this.nomeMes(this.destino)}</b>?`
      + (dup ? `<br><br><span style="color:var(--warn)">Atenção: ${dup} deles já foram projetados para esse mês e ficarão duplicados.</span>` : ''), { ok: 'Gerar lançamentos' });
    if (!ok) return;
    try {
      const r = await api('/api/projecao/executar', { method: 'POST', body: {
        origem: this.origem, destino: this.destino,
        itens: sel.map((x) => ({ tipo: x.tipo, nro_documento: x.nro_documento, valor_centavos: x.valor })),
      } });
      const R = r.resumo;
      const [de, ate] = [`${this.destino}-01`, isoDate(new Date(Number(this.destino.slice(0, 4)), Number(this.destino.slice(5, 7)), 0))];
      $('#pj-res').innerHTML = `<div class="card card-b">
        <h3 style="margin:0 0 6px;font-size:15px" class="pos">${I.check.replace('<svg', '<svg width="16" height="16" style="vertical-align:-3px"')} Projeção concluída para ${this.nomeMes(this.destino)}</h3>
        <p class="muted" style="margin:0 0 14px">Os títulos foram criados como <b>pendentes</b> (sem data de pagamento).</p>
        <div class="summary">
          <div class="s"><small>Contas a Receber criadas</small><b class="num pos">${R.receber.qtd} · ${moeda(R.receber.valor)}</b></div>
          <div class="s"><small>Contas a Pagar criadas</small><b class="num neg">${R.pagar.qtd} · ${moeda(R.pagar.valor)}</b></div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${R.receber.qtd ? '<button class="btn" data-ir="receber">Ver Contas a Receber do mês</button>' : ''}
          ${R.pagar.qtd ? '<button class="btn" data-ir="pagar">Ver Contas a Pagar do mês</button>' : ''}
          <button class="btn" data-ir="dashboard">Ver Dashboard do mês</button>
          <button class="btn ghost" id="pj-nova">Nova projeção</button>
        </div></div>`;
      $$('#pj-res [data-ir]').forEach((b) => b.addEventListener('click', () => {
        Object.assign(Estado.filtros, { de, ate, preset: null });
        Estado.salvarFiltros();
        App.sincronizarFiltros();
        location.hash = '#/' + b.dataset.ir;
      }));
      $('#pj-nova').addEventListener('click', () => { this.itens = []; this.origem = this.destino; this.destino = this.somaMes(this.destino, 1); this.render($('#view')); });
      this.itens = [];
      toast(`${r.criados.length} lançamento(s) gerados em ${this.nomeMes(this.destino)}.`);
    } catch (err) { toast(err.message, 'err'); }
  },
};
