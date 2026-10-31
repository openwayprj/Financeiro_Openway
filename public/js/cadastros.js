/* =====================================================================
   Cadastros base (CRUD genérico dirigido por configuração)
   ===================================================================== */
'use strict';

const simNao = (v) => (v ? '<span class="badge b-ok">Ativo</span>' : '<span class="badge b-neutral">Inativo</span>');
const naturezaBadge = (v) => badgeAmb(v);

const CAD = {
  categorias: {
    singular: 'Categoria', fem: true,
    colunas: [
      ['nome', 'Nome'],
      ['tipo', 'Tipo', (v) => (v === 'RECEITA' ? '<span class="pos">Receita</span>' : '<span class="neg">Despesa</span>')],
      ['natureza', 'Natureza', naturezaBadge],
      ['ativo', 'Situação', simNao],
    ],
    campos: [
      { n: 'nome', r: 'Nome', req: true, s: 's12' },
      { n: 'tipo', r: 'Tipo', t: 'select', req: true, op: [['RECEITA', 'Receita'], ['DESPESA', 'Despesa']], s: 's4' },
      { n: 'natureza', r: 'Natureza', t: 'select', req: true, op: [['AMBOS', 'Empresa e Pessoal'], ['EMPRESA', 'Somente Empresa'], ['PESSOAL', 'Somente Pessoal']], s: 's4',
        hint: '"Empresa e Pessoal" permite usar a mesma categoria nos dois ambientes.' },
      { n: 'ativo', r: 'Situação', t: 'select', op: [['1', 'Ativo'], ['0', 'Inativo']], s: 's4' },
    ],
    filtro: { campo: 'tipo', op: [['', 'Todos os tipos'], ['RECEITA', 'Receitas'], ['DESPESA', 'Despesas']] },
    filtro2: { campo: 'natureza', op: [['', 'Todas as naturezas'], ['AMBOS', 'Empresa e Pessoal'], ['EMPRESA', 'Somente Empresa'], ['PESSOAL', 'Somente Pessoal']] },
  },
  clientes: {
    singular: 'Cliente',
    colunas: [['nome', 'Nome / Razão Social'], ['cpf_cnpj', 'CPF/CNPJ', fmtDoc], ['contato', 'Contato'], ['email', 'E-mail'], ['telefone', 'Telefone'], ['ativo', 'Situação', simNao]],
    campos: null, // definido abaixo (mesmo de fornecedores)
  },
  fornecedores: {
    singular: 'Fornecedor',
    colunas: [['nome', 'Nome / Razão Social'], ['cpf_cnpj', 'CPF/CNPJ', fmtDoc], ['contato', 'Contato'], ['email', 'E-mail'], ['telefone', 'Telefone'], ['ativo', 'Situação', simNao]],
  },
  colaboradores: {
    singular: 'Colaborador',
    colunas: [['nome', 'Nome'], ['cargo', 'Cargo'], ['status', 'Status', (v) => simNao(v === 'ATIVO')]],
    campos: [
      { n: 'nome', r: 'Nome', req: true, s: 's12' },
      { n: 'cargo', r: 'Cargo', s: 's8' },
      { n: 'status', r: 'Status', t: 'select', op: [['ATIVO', 'Ativo'], ['INATIVO', 'Inativo']], s: 's4' },
    ],
    filtro: { campo: 'status', op: [['', 'Todos'], ['ATIVO', 'Ativos'], ['INATIVO', 'Inativos']] },
  },
  'centros-custo': {
    singular: 'Centro de Custo',
    colunas: [['codigo', 'Código'], ['nome', 'Nome'], ['descricao', 'Descrição'], ['ativo', 'Situação', simNao]],
    campos: [
      { n: 'codigo', r: 'Código', s: 's3', ph: 'Ex.: 1.01' },
      { n: 'nome', r: 'Nome', req: true, s: 's6', ph: 'Ex.: Comercial' },
      { n: 'ativo', r: 'Situação', t: 'select', op: [['1', 'Ativo'], ['0', 'Inativo']], s: 's3' },
      { n: 'descricao', r: 'Descrição', s: 's12' },
    ],
  },
  'formas-pagamento': {
    singular: 'Forma de Pagamento', fem: true,
    colunas: [['nome', 'Nome'], ['ativo', 'Situação', simNao]],
    campos: [{ n: 'nome', r: 'Nome', req: true, s: 's8' }, { n: 'ativo', r: 'Situação', t: 'select', op: [['1', 'Ativo'], ['0', 'Inativo']], s: 's4' }],
  },
  'contas-bancarias': {
    singular: 'Conta Bancária', fem: true,
    colunas: [['nome', 'Nome'], ['banco', 'Banco'], ['agencia', 'Agência'], ['conta', 'Conta'], ['natureza', 'Natureza', naturezaBadge], ['ativo', 'Situação', simNao]],
    campos: [
      { n: 'nome', r: 'Nome de identificação', req: true, s: 's8', ph: 'Ex.: Itaú PJ' },
      { n: 'natureza', r: 'Natureza', t: 'select', op: [['EMPRESA', 'Empresa'], ['PESSOAL', 'Pessoal']], s: 's4' },
      { n: 'banco', r: 'Banco', s: 's4' }, { n: 'agencia', r: 'Agência', s: 's4' }, { n: 'conta', r: 'Conta', s: 's4' },
      { n: 'ativo', r: 'Situação', t: 'select', op: [['1', 'Ativo'], ['0', 'Inativo']], s: 's4' },
    ],
  },
  usuarios: {
    singular: 'Usuário', api: '/api/usuarios',
    colunas: [['nome', 'Nome'], ['login', 'Login'], ['perfil', 'Perfil', (v) => (v === 'ADMIN' ? 'Administrador' : 'Operador')], ['ativo', 'Situação', simNao]],
    campos: [
      { n: 'nome', r: 'Nome', req: true, s: 's12' },
      { n: 'login', r: 'Login', req: true, s: 's6' },
      { n: 'senha', r: 'Senha', t: 'password', s: 's6', hint: 'Na edição, deixe em branco para manter a senha atual.' },
      { n: 'perfil', r: 'Perfil', t: 'select', op: [['ADMIN', 'Administrador'], ['OPERADOR', 'Operador']], s: 's6' },
      { n: 'ativo', r: 'Situação', t: 'select', op: [['1', 'Ativo'], ['0', 'Inativo']], s: 's6' },
    ],
  },
};
CAD.clientes.campos = CAD.fornecedores.campos = [
  { n: 'nome', r: 'Nome / Razão Social', req: true, s: 's8' },
  { n: 'cpf_cnpj', r: 'CPF / CNPJ', s: 's4', ph: 'Somente números ou formatado' },
  { n: 'contato', r: 'Pessoa de contato', s: 's4' },
  { n: 'email', r: 'E-mail', t: 'email', s: 's4' },
  { n: 'telefone', r: 'Telefone', s: 's4' },
  { n: 'ativo', r: 'Situação', t: 'select', op: [['1', 'Ativo'], ['0', 'Inativo']], s: 's4' },
];
CAD.clientes.filtro = CAD.fornecedores.filtro = CAD['centros-custo'].filtro = CAD['formas-pagamento'].filtro = CAD['contas-bancarias'].filtro =
  { campo: 'ativo', op: [['', 'Todos'], ['1', 'Ativos'], ['0', 'Inativos']] };

const Cadastros = {
  estado: {},

  url(ent) { return CAD[ent].api || `/api/cadastros/${ent}`; },

  async render(el, ent) {
    const cfg = CAD[ent];
    const st = this.estado[ent] || (this.estado[ent] = { q: '', f: '', f2: '' });
    el.innerHTML = `
      <div class="toolbar">
        ${ent !== 'usuarios' ? `<div class="search"><span>${I.search}</span><input class="input" id="cd-q" placeholder="Buscar..." value="${esc(st.q)}"></div>` : ''}
        ${cfg.filtro ? `<select class="input" id="cd-f">${cfg.filtro.op.map(([v, t]) => `<option value="${v}" ${v === st.f ? 'selected' : ''}>${t}</option>`).join('')}</select>` : ''}
        ${cfg.filtro2 ? `<select class="input" id="cd-f2">${cfg.filtro2.op.map(([v, t]) => `<option value="${v}" ${v === st.f2 ? 'selected' : ''}>${t}</option>`).join('')}</select>` : ''}
        <span class="grow"></span>
        <button class="btn primary" id="cd-novo">${I.plus}${cfg.fem ? 'Nova' : 'Novo'} ${cfg.singular.toLowerCase()}</button>
      </div>
      <div class="card"><div class="table-wrap" id="cd-tab"></div></div>`;
    let t;
    $('#cd-q')?.addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value; this.carregar(ent); }, 250); });
    $('#cd-f')?.addEventListener('change', (e) => { st.f = e.target.value; this.carregar(ent); });
    $('#cd-f2')?.addEventListener('change', (e) => { st.f2 = e.target.value; this.carregar(ent); });
    $('#cd-novo').addEventListener('click', () => this.form(ent));
    await this.carregar(ent);
  },

  async carregar(ent) {
    const cfg = CAD[ent], st = this.estado[ent];
    const p = { q: st.q };
    if (cfg.filtro && st.f !== '') p[cfg.filtro.campo] = st.f;
    if (cfg.filtro2 && st.f2) p[cfg.filtro2.campo] = st.f2;
    let lista = await api(this.url(ent) + '?' + qs(p));
    if (ent === 'usuarios' && st.f !== '' && cfg.filtro) lista = lista.filter((x) => String(x[cfg.filtro.campo]) === st.f);
    this.lista = lista;
    if (!lista.length) { $('#cd-tab').innerHTML = '<div class="empty">Nenhum registro encontrado.</div>'; return; }
    $('#cd-tab').innerHTML = `<table>
      <thead><tr>${cfg.colunas.map(([, r]) => `<th>${r}</th>`).join('')}<th class="r">Ações</th></tr></thead>
      <tbody>${lista.map((x) => `<tr>${cfg.colunas.map(([c, , fn], i) => `<td>${i === 0 ? '<b>' : ''}${fn ? fn(x[c]) : esc(x[c] ?? '—')}${i === 0 ? '</b>' : ''}</td>`).join('')}
        <td><div class="actions">
          <button class="btn sm ghost" data-a="editar" data-id="${x.id}" title="Editar">${I.edit}</button>
          <button class="btn sm ghost" data-a="excluir" data-id="${x.id}" title="Excluir">${I.trash}</button>
        </div></td></tr>`).join('')}</tbody></table>`;
    $$('#cd-tab [data-a]').forEach((b) => b.addEventListener('click', async () => {
      const reg = this.lista.find((x) => x.id === Number(b.dataset.id));
      if (b.dataset.a === 'editar') return this.form(ent, reg);
      if (!(await confirmar(`Excluir <b>${esc(reg.nome)}</b>? Se o registro estiver em uso, prefira inativá-lo.`, { ok: 'Excluir', perigo: true }))) return;
      try { await api(`${this.url(ent)}/${reg.id}`, { method: 'DELETE' }); toast('Registro excluído.'); Cache.limpar(ent); this.carregar(ent); } catch (err) { toast(err.message, 'err'); }
    }));
  },

  form(ent, reg = null) {
    const cfg = CAD[ent];
    const val = (c) => {
      if (!reg) return c.t === 'select' ? (c.op[0][0]) : '';
      if (c.n === 'senha') return '';
      if (c.n === 'cpf_cnpj') return fmtDoc(reg.cpf_cnpj);
      return reg[c.n] ?? '';
    };
    const m = modal({
      titulo: `${reg ? 'Editar' : cfg.fem ? 'Nova' : 'Novo'} ${cfg.singular.toLowerCase()}`, tamanho: '',
      corpo: `<form id="fc" class="form-grid">${cfg.campos.map((c) => `
        <div class="f ${c.s || ''}"><label>${c.r}${c.req || (c.n === 'senha' && !reg) ? ' <span class="req">*</span>' : ''}</label>
        ${c.t === 'select'
          ? `<select class="input" name="${c.n}">${c.op.map(([v, t]) => `<option value="${v}" ${String(val(c)) === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`
          : `<input class="input" name="${c.n}" type="${c.t || 'text'}" value="${esc(val(c))}" ${c.req || (c.n === 'senha' && !reg) ? 'required' : ''} ${c.ph ? `placeholder="${c.ph}"` : ''} ${c.t === 'password' ? 'autocomplete="new-password"' : ''}>`}
        ${c.hint && (reg || c.n !== 'senha') ? `<span class="hint">${c.hint}</span>` : ''}</div>`).join('')}</form>`,
      rodape: `<button class="btn" data-close>Cancelar</button><button class="btn primary" form="fc">${I.check}Salvar</button>`,
    });
    $('#fc', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      if ('ativo' in body) body.ativo = Number(body.ativo);
      try {
        await api(reg ? `${this.url(ent)}/${reg.id}` : this.url(ent), { method: reg ? 'PUT' : 'POST', body });
        toast('Registro salvo.'); m.fechar(); Cache.limpar(ent); this.carregar(ent);
      } catch (err) { toast(err.message, 'err'); }
    });
  },
};
