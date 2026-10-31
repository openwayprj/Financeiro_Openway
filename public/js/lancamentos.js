/* =====================================================================
   Contas a Receber / Contas a Pagar
   ===================================================================== */
'use strict';

const Lancamentos = {
  cfg: {
    receber: { api: '/api/receber', parte: 'cliente_id', parteEnt: 'clientes', parteRot: 'Cliente', tipoCat: 'RECEITA', colabObrig: true,
      novo: 'Nova Conta a Receber', verbo: 'Receber', pagoRot: 'Recebido em', cor: 'receita' },
    pagar: { api: '/api/pagar', parte: 'fornecedor_id', parteEnt: 'fornecedores', parteRot: 'Fornecedor', tipoCat: 'DESPESA', colabObrig: false,
      novo: 'Nova Conta a Pagar', verbo: 'Pagar', pagoRot: 'Pago em', cor: 'despesa' },
  },
  local: { receber: { base: 'vencimento', status: '', q: '', parte_id: '', categoria_id: '', colaborador_id: '' }, pagar: { base: 'vencimento', status: '', q: '', parte_id: '', categoria_id: '', colaborador_id: '', centro_custo_id: '' } },
  itens: [],

  async render(el, tipo) {
    const c = this.cfg[tipo], L = this.local[tipo];
    const [cats, colabs, ccs, partes] = await Promise.all([Cache.get('categorias'), Cache.get('colaboradores'), tipo === 'pagar' ? Cache.get('centros-custo') : [], Cache.get(c.parteEnt)]);
    const partesOrd = [...partes].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
    if (L.parte_id && !partes.some((x) => String(x.id) === String(L.parte_id))) L.parte_id = '';
    const catsTipo = cats.filter((x) => x.tipo === c.tipoCat);

    el.innerHTML = `
      <div class="toolbar">
        <div class="search"><span>${I.search}</span><input class="input" id="lc-q" placeholder="Buscar nº, ${c.parteRot.toLowerCase()}, categoria, observação..." value="${esc(L.q)}"></div>
        <select class="input" id="lc-base" title="Data de referência do período">
          <option value="vencimento">Período por Vencimento</option><option value="pagamento">Período por Pagamento</option><option value="emissao">Período por Emissão</option>
        </select>
        <select class="input" id="lc-status"><option value="">Todos os status</option><option value="ABERTO">Em aberto (pendente + atraso)</option>
          <option value="PENDENTE">Pendente</option><option value="ATRASADO">Em Atraso</option><option value="REALIZADO">Realizado</option></select>
        <select class="input" id="lc-parte" title="Filtrar por ${c.parteRot.toLowerCase()}">${opts(partesOrd, L.parte_id, (x) => x.nome + (x.ativo === 0 ? ' (inativo)' : ''), tipo === 'pagar' ? 'Todos os fornecedores' : 'Todos os clientes')}</select>
        <select class="input" id="lc-cat">${opts(catsTipo, L.categoria_id, (x) => `${x.nome} (${NAT_CURTA[x.natureza]})`, 'Todas as categorias')}</select>
        <select class="input" id="lc-col">${opts(colabs, L.colaborador_id, (x) => x.nome, 'Todos os colaboradores')}</select>
        ${tipo === 'pagar' ? `<select class="input" id="lc-cc"><option value="">Todos os centros de custo</option>
          <option value="SEM" ${L.centro_custo_id === 'SEM' ? 'selected' : ''}>Sem centro de custo</option>
          ${opts(ccs, L.centro_custo_id, rotuloCC, null)}</select>` : ''}
        <span class="grow"></span>
        <button class="btn" id="lc-proj" title="Copiar os lançamentos de um mês para outro, sem data de pagamento">${I.copy}Projetar mês</button>
        <button class="btn" id="lc-csv">${I.download}Exportar CSV</button>
        <button class="btn primary" id="lc-novo">${I.plus}${c.novo}</button>
      </div>
      <div class="summary" id="lc-sum"></div>
      <div class="card"><div class="table-wrap" id="lc-tab"></div></div>`;

    $('#lc-base').value = L.base; $('#lc-status').value = L.status;
    let t;
    $('#lc-q').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { L.q = e.target.value; this.carregar(tipo); }, 250); });
    [['#lc-base', 'base'], ['#lc-status', 'status'], ['#lc-parte', 'parte_id'], ['#lc-cat', 'categoria_id'], ['#lc-col', 'colaborador_id'], ['#lc-cc', 'centro_custo_id']].forEach(([s, k]) =>
      $(s)?.addEventListener('change', (e) => { L[k] = e.target.value; this.carregar(tipo); }));
    $('#lc-novo').addEventListener('click', () => this.form(tipo));
    $('#lc-csv').addEventListener('click', () => this.exportar(tipo));
    $('#lc-proj').addEventListener('click', () => Projecao.abrir(tipo));
    await this.carregar(tipo);
  },

  /** Chamado após salvar/baixar quando a ação veio de outra tela (ex.: Calendário) */
  aoAlterar: null,

  async carregar(tipo) {
    if (!$('#lc-tab')) { if (this.aoAlterar) this.aoAlterar(); return; }
    const c = this.cfg[tipo], L = this.local[tipo], f = Estado.filtros;
    const d = await api(c.api + '?' + qs({ de: f.de, ate: f.ate, ambiente: f.ambiente === 'TODAS' ? '' : f.ambiente, ...L }));
    this.itens = d.itens;
    const T = d.totais;
    $('#lc-sum').innerHTML = `
      <div class="s"><small>Títulos</small><b class="num">${d.itens.length}</b></div>
      <div class="s"><small>Total</small><b class="num">${moeda(T.total)}</b></div>
      <div class="s"><small>${tipo === 'receber' ? 'Recebido' : 'Pago'}</small><b class="num pos">${moeda(T.realizado)}</b></div>
      <div class="s"><small>Pendente</small><b class="num" style="color:var(--warn)">${moeda(T.pendente)}</b></div>
      <div class="s"><small>Em atraso</small><b class="num neg">${moeda(T.atrasado)}</b></div>`;

    if (!d.itens.length) { $('#lc-tab').innerHTML = '<div class="empty">Nenhum título encontrado para os filtros selecionados.</div>'; return; }
    $('#lc-tab').innerHTML = `<table>
      <thead><tr><th>Nº Doc / Emissão</th><th>Vencimento</th><th>Pagamento</th><th>${c.parteRot}</th><th>${tipo === 'pagar' ? 'Categoria / C. Custo' : 'Categoria'}</th>
        <th>Colaborador</th><th class="r">Valor</th><th>Status</th><th class="r">Ações</th></tr></thead>
      <tbody>${d.itens.map((x) => `<tr>
        <td class="num"><b>${String(x.nro_documento).padStart(6, '0')}</b>${badgeAmb(x.tipo_ambiente, true)}<br><small class="muted">Emissão ${dataBR(x.data_emissao)}</small>${x.projetado_de ? `<br><small class="muted" title="Gerado pela Projeção de Mês">↻ projetado do nº ${x.projetado_de}</small>` : ''}</td>
        <td class="num">${dataBR(x.data_vencimento)}</td><td class="num">${dataBR(x.data_pagamento)}</td>
        <td class="wrap">${esc(x.parte_nome)}${x.observacoes ? `<br><small class="muted">${esc(x.observacoes)}</small>` : ''}</td>
        <td class="wrap-sm">${esc(x.categoria_nome)}${tipo === 'pagar' ? `<br><small class="muted" title="Centro de custo">${x.centro_custo_nome ? 'CC: ' + esc(rotuloCC({ codigo: x.centro_custo_codigo, nome: x.centro_custo_nome })) : 'Sem centro de custo'}</small>` : ''}</td>
        <td class="wrap-sm">${esc(x.colaborador_nome || '—')}${x.rateio.length ? `<br><span class="chip-rateio" title="${esc(x.rateio.map((r) => `${r.colaborador_nome}: ${moeda(r.valor_centavos)}`).join('\n'))}">+ rateio (${x.rateio.length})</span>` : ''}</td>
        <td class="r num"><b>${moeda(x.valor_centavos)}</b></td>
        <td>${badgeStatus(x.status)}</td>
        <td><div class="actions">
          ${x.data_pagamento
            ? `<button class="btn sm ghost" data-a="estorno" data-n="${x.nro_documento}" title="Estornar baixa">${I.undo}</button>`
            : `<button class="btn sm" data-a="baixa" data-n="${x.nro_documento}" title="Baixar: registrar ${tipo === 'receber' ? 'recebimento' : 'pagamento'}">${I.check}</button>`}
          <button class="btn sm ghost" data-a="editar" data-n="${x.nro_documento}" title="Editar">${I.edit}</button>
          <button class="btn sm ghost" data-a="excluir" data-n="${x.nro_documento}" title="Excluir">${I.trash}</button>
        </div></td></tr>`).join('')}</tbody></table>`;

    $$('#lc-tab [data-a]').forEach((b) => b.addEventListener('click', () => this.acao(tipo, b.dataset.a, Number(b.dataset.n))));
  },

  async acao(tipo, a, nro) {
    const c = this.cfg[tipo];
    const item = this.itens.find((x) => x.nro_documento === nro);
    try {
      if (a === 'editar') return this.form(tipo, await api(`${c.api}/${nro}`));
      if (a === 'baixa') return this.baixa(tipo, item);
      if (a === 'estorno') {
        if (!(await confirmar(`Estornar a baixa do título <b>${nro}</b>? Ele voltará a ficar em aberto.`, { ok: 'Estornar' }))) return;
        await api(`${c.api}/${nro}/estorno`, { method: 'PATCH', body: {} });
        toast('Baixa estornada.');
      }
      if (a === 'excluir') {
        if (!(await confirmar(`Excluir definitivamente o título <b>${nro}</b> de ${moeda(item.valor_centavos)}?`, { ok: 'Excluir', perigo: true }))) return;
        await api(`${c.api}/${nro}`, { method: 'DELETE' });
        toast('Título excluído.');
      }
      this.carregar(tipo);
    } catch (err) { toast(err.message, 'err'); }
  },

  async baixa(tipo, item) {
    const c = this.cfg[tipo];
    const [fps, cbs] = await Promise.all([Cache.get('formas-pagamento'), Cache.get('contas-bancarias')]);
    const m = modal({
      titulo: `Baixar título ${item.nro_documento}`, tamanho: 'sm',
      corpo: `<form id="fb" class="form-grid">
        <div class="f s12"><div class="rateio-info">${esc(item.parte_nome)} · <b>${moeda(item.valor_centavos)}</b> · venc. ${dataBR(item.data_vencimento)}</div></div>
        <div class="f s12"><label>${c.pagoRot} <span class="req">*</span></label><input class="input" type="date" name="data_pagamento" value="${hojeISO()}" required></div>
        <div class="f s12"><label>Forma de pagamento</label><select class="input" name="forma_pagamento_id">${opts(fps.filter((x) => x.ativo), item.forma_pagamento_id)}</select></div>
        <div class="f s12"><label>Conta bancária</label><select class="input" name="conta_bancaria_id">${opts(cbs.filter((x) => x.ativo), item.conta_bancaria_id)}</select></div>
      </form>`,
      rodape: `<button class="btn" data-close>Cancelar</button><button class="btn primary" form="fb">${I.check}Confirmar baixa</button>`,
    });
    $('#fb', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api(`${c.api}/${item.nro_documento}/baixa`, { method: 'PATCH', body: Object.fromEntries(new FormData(e.target)) });
        toast('Baixa registrada.'); m.fechar(); this.carregar(tipo);
      } catch (err) { toast(err.message, 'err'); }
    });
  },

  async form(tipo, reg = null, padrao = {}) {
    const c = this.cfg[tipo];
    const [cats, partes, colabs, fps, cbs, ccs] = await Promise.all([
      Cache.get('categorias'), Cache.get(c.parteEnt), Cache.get('colaboradores'), Cache.get('formas-pagamento'), Cache.get('contas-bancarias'),
      tipo === 'pagar' ? Cache.get('centros-custo') : []]);
    const r = reg || {
      data_emissao: hojeISO(), data_vencimento: hojeISO(), data_pagamento: null,
      tipo_ambiente: Estado.filtros.ambiente === 'PESSOAL' ? 'PESSOAL' : 'EMPRESA', rateio: [], ...padrao,
    };
    const ativosOu = (lista, id, campo = 'ativo') => lista.filter((x) => (campo === 'status' ? x.status === 'ATIVO' : x.ativo) || String(x.id) === String(id));
    const colabsAtivos = (id) => ativosOu(colabs, id, 'status');

    const m = modal({
      titulo: reg ? `Editar título Nº ${String(reg.nro_documento).padStart(6, '0')}` : c.novo, tamanho: 'lg',
      corpo: `<form id="fl" class="form-grid" novalidate>
        <div class="f s3"><label>Nº Documento</label><input class="input" value="${reg ? String(reg.nro_documento).padStart(6, '0') : 'Automático'}" disabled></div>
        <div class="f s3"><label>Data de emissão <span class="req">*</span></label><input class="input" type="date" name="data_emissao" value="${r.data_emissao}" required></div>
        <div class="f s3"><label>Data de vencimento <span class="req">*</span></label><input class="input" type="date" name="data_vencimento" value="${r.data_vencimento}" required></div>
        <div class="f s3"><label>Data de pagamento</label><input class="input" type="date" name="data_pagamento" value="${r.data_pagamento || ''}">
          <span class="hint">Preenchida = ${tipo === 'receber' ? 'recebido' : 'liquidado'}</span></div>

        <div class="f s4"><label>Ambiente <span class="req">*</span></label>
          <div class="seg" id="fl-amb"><button type="button" data-a="EMPRESA">Empresa</button><button type="button" data-a="PESSOAL">Pessoal</button></div>
          <input type="hidden" name="tipo_ambiente" value="${r.tipo_ambiente}"></div>
        <div class="f s4"><label>${c.parteRot} <span class="req">*</span></label><select class="input" name="${c.parte}" required>${opts(ativosOu(partes, r[c.parte]), r[c.parte])}</select></div>
        <div class="f s4"><label>Categoria <span class="req">*</span></label><select class="input" name="categoria_id" required></select>
          <span class="hint">Somente categorias de ${c.tipoCat.toLowerCase()} do ambiente selecionado</span></div>

        <div class="f s4"><label>Valor (R$) <span class="req">*</span></label><input class="input num" name="valor" inputmode="decimal" placeholder="0,00" value="${moedaInput(r.valor_centavos)}" required></div>
        ${tipo === 'pagar' ? `<div class="f s4"><label>Centro de custo</label><select class="input" name="centro_custo_id">${opts(ativosOu(ccs, r.centro_custo_id), r.centro_custo_id, rotuloCC, 'Não informado')}</select></div>` : ''}
        <div class="f s4"><label>Colaborador ${c.colabObrig ? 'responsável <span class="req">*</span>' : '(opcional)'}</label>
          <select class="input" name="colaborador_id">${opts(colabsAtivos(r.colaborador_id), r.colaborador_id, (x) => x.nome, c.colabObrig ? 'Selecione...' : 'Nenhum')}</select></div>
        <div class="f s4"><label>Forma de pagamento</label><select class="input" name="forma_pagamento_id">${opts(ativosOu(fps, r.forma_pagamento_id), r.forma_pagamento_id, (x) => x.nome, 'Não informada')}</select></div>
        <div class="f s4"><label>Conta bancária</label><select class="input" name="conta_bancaria_id">${opts(ativosOu(cbs, r.conta_bancaria_id), r.conta_bancaria_id, (x) => `${x.nome}${x.banco ? ' · ' + x.banco : ''}`, 'Não informada')}</select></div>
        <div class="f ${tipo === 'pagar' ? 's4' : 's8'}"><label>Observações</label><input class="input" name="observacoes" value="${esc(r.observacoes || '')}" maxlength="500"></div>

        <div class="section-t"><div><b>${I.split.replace('<svg', '<svg width="15" height="15" style="vertical-align:-3px"')} Participação de colaboradores (opcional)</b>
          <div class="hint muted" style="font-size:12px">${tipo === 'receber' ? 'Informe um ou mais colaboradores que trouxeram esta receita e quanto cada um gerou.' : 'Informe um ou mais colaboradores que geraram esta despesa e o valor de cada um.'}</div></div>
          <button type="button" class="btn sm" id="fl-add">${I.plus}Adicionar colaborador</button></div>
        <div id="fl-rateio" style="grid-column: span 12; display:grid; gap:10px"></div>
        <div class="rateio-info" id="fl-rinfo"></div>
      </form>`,
      rodape: `<button class="btn" data-close>Cancelar</button><button class="btn primary" form="fl">${I.check}${reg ? 'Salvar alterações' : 'Lançar título'}</button>`,
    });
    const F = $('#fl', m.el);

    // Ambiente -> filtra categorias pela natureza (Princípio da Entidade)
    const setAmb = (amb) => {
      F.tipo_ambiente.value = amb;
      $$('#fl-amb button', m.el).forEach((b) => b.classList.toggle('on', b.dataset.a === amb));
      const atual = F.categoria_id.value || r.categoria_id;
      const lista = cats.filter((x) => x.tipo === c.tipoCat && (x.natureza === amb || x.natureza === 'AMBOS') && (x.ativo || String(x.id) === String(atual)));
      F.categoria_id.innerHTML = opts(lista, atual);
    };
    $$('#fl-amb button', m.el).forEach((b) => b.addEventListener('click', () => setAmb(b.dataset.a)));
    setAmb(r.tipo_ambiente);

    // Rateio
    const addLinha = (lin = {}) => {
      const div = document.createElement('div');
      div.className = 'rateio-row';
      div.innerHTML = `<select class="input" data-r="col">${opts(colabsAtivos(lin.colaborador_id), lin.colaborador_id)}</select>
        <input class="input num" data-r="val" inputmode="decimal" placeholder="Valor R$" value="${moedaInput(lin.valor_centavos)}">
        <button type="button" class="btn ghost icon" title="Remover" aria-label="Remover">${I.trash}</button>`;
      $('button', div).addEventListener('click', () => { div.remove(); infoRateio(); });
      $$('select, input', div).forEach((i) => i.addEventListener('input', infoRateio));
      $('#fl-rateio', m.el).appendChild(div);
    };
    const lerRateio = () => $$('.rateio-row', m.el).map((d) => ({ colaborador_id: $('[data-r=col]', d).value, valor_centavos: parseMoeda($('[data-r=val]', d).value) }))
      .filter((x) => x.colaborador_id || x.valor_centavos);
    const infoRateio = () => {
      const tot = parseMoeda(F.valor.value) || 0;
      const rat = lerRateio().reduce((s, x) => s + (x.valor_centavos || 0), 0);
      const resp = F.colaborador_id.selectedOptions[0];
      const respNome = F.colaborador_id.value ? resp.textContent : null;
      const saldo = tot - rat;
      let msg = `Valor do título: <b>${moeda(tot)}</b> · Rateado: <b>${moeda(rat)}</b> · Saldo: <b class="${saldo < 0 ? 'neg' : ''}">${moeda(saldo)}</b>`;
      if (saldo < 0) msg += ' — <span class="neg">o rateio ultrapassa o valor do título</span>';
      else if (saldo > 0) msg += respNome ? ` — atribuído a <b>${esc(respNome)}</b> (responsável)` : ' — sem colaborador (despesa geral)';
      $('#fl-rinfo', m.el).innerHTML = msg;
    };
    (r.rateio || []).forEach(addLinha);
    $('#fl-add', m.el).addEventListener('click', () => { addLinha(); infoRateio(); });
    F.valor.addEventListener('input', infoRateio);
    F.colaborador_id.addEventListener('change', infoRateio);
    F.valor.addEventListener('blur', () => { const v = parseMoeda(F.valor.value); if (v) F.valor.value = moedaInput(v); });
    infoRateio();

    F.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(F));
      body.valor_centavos = parseMoeda(body.valor);
      delete body.valor;
      body.rateio = lerRateio();
      try {
        const res = await api(reg ? `${c.api}/${reg.nro_documento}` : c.api, { method: reg ? 'PUT' : 'POST', body });
        toast(reg ? 'Título atualizado.' : `Título Nº ${String(res.nro_documento).padStart(6, '0')} lançado.`);
        m.fechar();
        this.carregar(tipo);
      } catch (err) { toast(err.message, 'err'); }
    });
  },

  exportar(tipo) {
    const c = this.cfg[tipo];
    baixarCSV(`contas_a_${tipo}_${Estado.filtros.de}_${Estado.filtros.ate}.csv`,
      ['Nº Documento', 'Emissão', 'Vencimento', 'Pagamento', 'Ambiente', c.parteRot, 'Categoria', ...(tipo === 'pagar' ? ['Centro de Custo'] : []), 'Colaborador', 'Rateio', 'Valor', 'Status', 'Forma Pgto', 'Conta', 'Observações'],
      this.itens.map((x) => [x.nro_documento, dataBR(x.data_emissao), dataBR(x.data_vencimento), x.data_pagamento ? dataBR(x.data_pagamento) : '',
        x.tipo_ambiente, x.parte_nome, x.categoria_nome, ...(tipo === 'pagar' ? [x.centro_custo_nome ? rotuloCC({ codigo: x.centro_custo_codigo, nome: x.centro_custo_nome }) : ''] : []), x.colaborador_nome || '',
        x.rateio.map((r) => `${r.colaborador_nome}: ${centavosCSV(r.valor_centavos)}`).join(' | '),
        centavosCSV(x.valor_centavos), STATUS[x.status].txt, x.forma_pagamento_nome || '', x.conta_bancaria_nome || '', x.observacoes || '']));
  },
};
