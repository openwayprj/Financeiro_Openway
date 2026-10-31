/* =====================================================================
   Shell da aplicação: login, navegação (hash router) e filtros globais
   ===================================================================== */
'use strict';

const Rotas = {
  hoje:                { titulo: 'Contas de Hoje', icone: 'sun', render: (el) => Hoje.render(el) },
  rapido:              { titulo: 'Lançar por Voz', icone: 'mic', render: (el) => Rapido.render(el), sair: () => Rapido.sair() },
  dashboard:           { titulo: 'Dashboard Executivo', icone: 'dash', filtros: true, render: (el) => Dashboard.render(el) },
  receber:             { titulo: 'Contas a Receber', icone: 'in', filtros: true, render: (el) => Lancamentos.render(el, 'receber') },
  pagar:               { titulo: 'Contas a Pagar', icone: 'out', filtros: true, render: (el) => Lancamentos.render(el, 'pagar') },
  calendario:          { titulo: 'Calendário Financeiro', icone: 'cal', render: (el) => Calendario.render(el) },
  projecao:            { titulo: 'Projetar Mês', icone: 'copy', render: (el) => Projecao.render(el) },
  centros:             { titulo: 'Despesas por Centro de Custo', icone: 'target', filtros: true, render: (el) => CentrosCusto.render(el) },
  colaboradores:       { titulo: 'Resumo por Colaborador', icone: 'users', filtros: true, render: (el) => ResumoColab.render(el) },
  'cad/categorias':    { titulo: 'Categorias / Plano de Contas', icone: 'tag', render: (el) => Cadastros.render(el, 'categorias') },
  'cad/clientes':      { titulo: 'Clientes', icone: 'person', render: (el) => Cadastros.render(el, 'clientes') },
  'cad/fornecedores':  { titulo: 'Fornecedores', icone: 'truck', render: (el) => Cadastros.render(el, 'fornecedores') },
  'cad/colaboradores': { titulo: 'Colaboradores', icone: 'badge', render: (el) => Cadastros.render(el, 'colaboradores') },
  'cad/centros-custo': { titulo: 'Centros de Custo', icone: 'target', render: (el) => Cadastros.render(el, 'centros-custo') },
  'cad/formas-pagamento': { titulo: 'Formas de Pagamento', icone: 'card', render: (el) => Cadastros.render(el, 'formas-pagamento') },
  'cad/contas-bancarias': { titulo: 'Contas Bancárias', icone: 'bank', render: (el) => Cadastros.render(el, 'contas-bancarias') },
  importar:            { titulo: 'Importar Planilha', icone: 'upload', render: (el) => ImportarTela.render(el) },
  alertas:             { titulo: 'Alertas por E-mail', icone: 'mail', admin: true, render: (el) => Alertas.render(el) },
  manutencao:          { titulo: 'Manutenção do Banco', icone: 'db', admin: true, render: (el) => Manutencao.render(el) },
  usuarios:            { titulo: 'Usuários do Sistema', icone: 'shield', admin: true, render: (el) => Cadastros.render(el, 'usuarios') },
};

const MENU = [
  { h: 'Celular', itens: ['hoje', 'rapido'] },
  { h: 'Financeiro', itens: ['dashboard', 'calendario', 'receber', 'pagar', 'projecao', 'colaboradores', 'centros'] },
  { h: 'Cadastros', itens: ['cad/categorias', 'cad/clientes', 'cad/fornecedores', 'cad/colaboradores', 'cad/centros-custo', 'cad/formas-pagamento', 'cad/contas-bancarias'] },
  { h: 'Sistema', itens: ['importar', 'alertas', 'usuarios', 'manutencao'] },
];
const ROTULO_MENU = { hoje: 'Hoje (celular)', rapido: 'Lançar por voz',  calendario: 'Calendário', dashboard: 'Dashboard', colaboradores: 'Resumo por Colaborador', centros: 'Resumo por C. de Custo', 'cad/categorias': 'Categorias', usuarios: 'Usuários', importar: 'Importar Planilha' };

const App = {
  rotaAtual: null,

  async iniciar() {
    $('#btn-sair').innerHTML = I.logout;
    $('#btn-senha').innerHTML = I.key;
    $('#btn-menu').innerHTML = I.menu;
    Mobile.iniciar();
    this.ligarLogin();
    this.ligarFiltros();
    $('#btn-sair').addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); this.mostrarLogin(); });
    $('#btn-senha').addEventListener('click', () => this.alterarSenha());
    $('#btn-menu').addEventListener('click', () => document.body.classList.toggle('menu-open'));
    window.addEventListener('hashchange', () => this.navegar());
    try {
      Estado.usuario = await api('/api/auth/me');
      this.mostrarApp();
    } catch (_) { this.mostrarLogin(); }
  },

  /* ------------------------------ Login ------------------------------ */
  async mostrarLogin() {
    Estado.usuario = null;
    Cache.limpar();
    $('#app').classList.add('hidden');
    $('#tabbar').classList.add('hidden');
    $('#login').classList.remove('hidden');
    const st = await fetch('/api/auth/status').then((r) => r.json()).catch(() => ({}));
    this.modoSetup = !!st.precisaConfigurar;
    $('#f-nome').classList.toggle('hidden', !this.modoSetup);
    $('#l-nome').required = this.modoSetup;
    $('#login-titulo').textContent = this.modoSetup ? 'Primeiro acesso · Crie o usuário administrador' : 'Controle Financeiro · Acesso';
    $('#login-btn').textContent = this.modoSetup ? 'Criar administrador e entrar' : 'Entrar';
    $('#l-senha').autocomplete = this.modoSetup ? 'new-password' : 'current-password';
    setTimeout(() => $(this.modoSetup ? '#l-nome' : '#l-login').focus(), 50);
  },

  ligarLogin() {
    $('#login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = { nome: $('#l-nome').value, login: $('#l-login').value, senha: $('#l-senha').value };
      const btn = $('#login-btn');
      btn.disabled = true;
      try {
        await api(this.modoSetup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', body });
        Estado.usuario = await api('/api/auth/me');
        $('#l-senha').value = '';
        this.mostrarApp();
      } catch (err) { toast(err.message, 'err'); } finally { btn.disabled = false; }
    });
  },

  mostrarApp() {
    $('#login').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#tabbar').classList.remove('hidden');
    const u = Estado.usuario;
    $('#u-nome').textContent = u.nome;
    $('#u-perfil').textContent = u.perfil === 'ADMIN' ? 'Administrador' : 'Operador';
    $('#u-avatar').textContent = u.nome.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
    this.montarMenu();
    this.sincronizarFiltros();
    this.navegar();
  },

  alterarSenha() {
    const m = modal({
      titulo: 'Alterar minha senha', tamanho: 'sm',
      corpo: `<form id="fs" class="form-grid">
        <div class="f s12"><label>Senha atual</label><input class="input" type="password" name="senhaAtual" autocomplete="current-password" required></div>
        <div class="f s12"><label>Nova senha (mín. 6 caracteres)</label><input class="input" type="password" name="novaSenha" autocomplete="new-password" minlength="6" required></div>
        </form>`,
      rodape: '<button class="btn" data-close>Cancelar</button><button class="btn primary" form="fs">Salvar</button>',
    });
    $('#fs', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('/api/auth/senha', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
        toast('Senha alterada com sucesso.'); m.fechar();
      } catch (err) { toast(err.message, 'err'); }
    });
  },

  /* ------------------------------ Menu ------------------------------ */
  montarMenu() {
    const admin = Estado.usuario.perfil === 'ADMIN';
    $('#nav').innerHTML = MENU.map((g) => {
      const itens = g.itens.filter((r) => !Rotas[r].admin || admin);
      if (!itens.length) return '';
      return `<h6>${g.h}</h6>` + itens.map((r) =>
        `<a href="#/${r}" data-r="${r}">${I[Rotas[r].icone]}<span>${ROTULO_MENU[r] || Rotas[r].titulo}</span></a>`).join('');
    }).join('');
  },

  navegar() {
    if (!Estado.usuario) return;
    let r = location.hash.replace(/^#\/?/, '') || Mobile.rotaInicial();
    if (!Rotas[r] || (Rotas[r].admin && Estado.usuario.perfil !== 'ADMIN')) r = Mobile.rotaInicial();
    if (this.rotaAtual && Rotas[this.rotaAtual] && Rotas[this.rotaAtual].sair) Rotas[this.rotaAtual].sair();
    this.rotaAtual = r;
    Mobile.marcarAba(r);
    document.body.dataset.rota = r;
    const rota = Rotas[r];
    $$('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === r));
    $('#titulo').textContent = rota.titulo;
    $('#filtros').classList.toggle('hidden', !rota.filtros);
    document.title = `${rota.titulo} · Openway Financeiro`;
    document.body.classList.remove('menu-open');
    this.renderizar();
  },

  renderizar() {
    const el = $('#view');
    Promise.resolve(Rotas[this.rotaAtual].render(el)).catch((err) => {
      el.innerHTML = `<div class="card card-b empty">Não foi possível carregar: ${esc(err.message)}</div>`;
    });
  },

  /* ------------------------- Filtros globais ------------------------- */
  ligarFiltros() {
    $$('#presets button').forEach((b) => b.addEventListener('click', () => {
      const [de, ate] = preset(b.dataset.p);
      Object.assign(Estado.filtros, { de, ate, preset: b.dataset.p });
      this.aplicarFiltros();
    }));
    ['#f-de', '#f-ate'].forEach((s) => $(s).addEventListener('change', () => {
      const de = $('#f-de').value, ate = $('#f-ate').value;
      if (!de || !ate) return;
      if (de > ate) { toast('A data inicial deve ser menor ou igual à final.', 'err'); return; }
      Object.assign(Estado.filtros, { de, ate, preset: null });
      this.aplicarFiltros();
    }));
    $$('#f-amb button').forEach((b) => b.addEventListener('click', () => {
      Estado.filtros.ambiente = b.dataset.a;
      this.aplicarFiltros();
    }));
  },

  sincronizarFiltros() {
    const f = Estado.filtros;
    // Recalcula o preset relativo (ex.: "Este Mês" continua sendo o mês corrente em outro dia)
    if (f.preset) { const [de, ate] = preset(f.preset); f.de = de; f.ate = ate; }
    $('#f-de').value = f.de; $('#f-ate').value = f.ate;
    $$('#presets button').forEach((b) => b.classList.toggle('on', b.dataset.p === f.preset));
    $$('#f-amb button').forEach((b) => b.classList.toggle('on', b.dataset.a === f.ambiente));
  },

  aplicarFiltros() {
    Estado.salvarFiltros();
    this.sincronizarFiltros();
    if (Rotas[this.rotaAtual]?.filtros) this.renderizar();
  },
};

document.addEventListener('DOMContentLoaded', () => App.iniciar());
