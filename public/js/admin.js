/* =====================================================================
   Importar Planilha (Contas a Pagar) e Manutenção do Banco (ADMIN)
   ===================================================================== */
'use strict';

const Importar = {
  dados: null,
  tipo: 'pagar',

  async render(el) {
    const colabs = await Cache.get('colaboradores').catch(() => []);
    el.innerHTML = `
      <div class="card">
        <div class="card-h"><div><h3>Importar lançamentos de planilha</h3>
          <p>Arquivo <b>.xlsx</b> ou <b>.csv</b>. O cabeçalho define as colunas; fornecedores/clientes, categorias, centros de custo e colaboradores que não existirem são cadastrados automaticamente.</p></div>
          <div class="seg" id="im-tipo"><button type="button" data-t="pagar">Contas a Pagar</button><button type="button" data-t="receber">Contas a Receber</button></div></div>
        <div class="card-b">
          <form id="im-form" class="form-grid" style="align-items:end">
            <div class="f s4"><label>Planilha</label><input class="input" type="file" name="arquivo" accept=".xlsx,.csv" required></div>
            <div class="f s2"><label>Aba</label><select class="input" name="aba" disabled><option value="">Automática</option></select></div>
            <div class="f s2"><label>Data de emissão</label>
              <select class="input" name="emissao"><option value="inicio_mes">1º dia do mês do vencimento</option><option value="vencimento">Igual ao vencimento</option></select>
              <span class="hint">Usada quando a planilha não tem coluna Emissão</span></div>
            <div class="f s2"><label>Ambiente padrão</label>
              <select class="input" name="ambientePadrao"><option value="EMPRESA">Empresa</option><option value="PESSOAL">Pessoal</option></select>
              <span class="hint">Usado se não houver coluna Tipo</span></div>
            <div class="f s2" id="im-colab"><label>Colaborador responsável</label>
              <input class="input" name="colaboradorPadrao" list="im-colabs" placeholder="Ex.: Marcelo Rafael">
              <datalist id="im-colabs">${colabs.map((c) => `<option value="${esc(c.nome)}">`).join('')}</datalist>
              <span class="hint">Obrigatório em Receber (usado se não houver coluna)</span></div>
            <div class="f s12" style="flex-direction:row;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
              <span class="hint">Colunas reconhecidas: <b>Fornecedor</b> ou <b>Cliente</b> (ou duas colunas <b>Descrição</b>: a 1ª é o nome), <b>Descrição</b>, <b>Tipo</b> (P = Pessoal, E = Empresa), <b>Vencimento</b>, <b>Valor</b>, <b>Categoria</b>, <b>Centro de Custo</b> (Pagar)
                e, opcionalmente, Emissão, Pagamento, Colaborador, Forma de Pagamento e Conta Bancária.</span>
              <button class="btn primary" type="submit">${I.search}Analisar planilha</button>
            </div>
          </form>
        </div>
      </div>
      <div id="im-res" class="mt"></div>`;
    const setTipo = (t) => {
      this.tipo = t;
      $$('#im-tipo button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
      $('#im-colab').style.display = t === 'receber' ? '' : 'none';
      $('#im-res').innerHTML = '';
      const F = $('#im-form'); F.aba.innerHTML = '<option value="">Automática</option>'; F.aba.disabled = true;
    };
    $$('#im-tipo button').forEach((b) => b.addEventListener('click', () => setTipo(b.dataset.t)));
    setTipo(this.tipo);
    $('#im-form').arquivo.addEventListener('change', () => { const F = $('#im-form'); F.aba.innerHTML = '<option value="">Automática</option>'; F.aba.disabled = true; });
    $('#im-form').aba.addEventListener('change', () => this.analisar());
    $('#im-form').addEventListener('submit', (e) => { e.preventDefault(); this.analisar(); });
  },

  lerArquivo(file) {
    return new Promise((ok, erro) => {
      const fr = new FileReader();
      fr.onload = () => { const b = new Uint8Array(fr.result); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); ok(btoa(s)); };
      fr.onerror = () => erro(new Error('Não foi possível ler o arquivo.'));
      fr.readAsArrayBuffer(file);
    });
  },

  async analisar() {
    const F = $('#im-form');
    const file = F.arquivo.files[0];
    if (!file) return toast('Selecione a planilha.', 'err');
    try {
      const arquivo = await this.lerArquivo(file);
      if (this.tipo === 'receber' && !F.colaboradorPadrao.value.trim()) toast('Informe o colaborador responsável padrão (obrigatório em Contas a Receber).', 'err');
      const d = await api(`/api/importacao/${this.tipo}/preview`, { method: 'POST', body: { arquivo, nome: file.name,
        opcoes: { emissao: F.emissao.value, ambientePadrao: F.ambientePadrao.value, aba: F.aba.value, colaboradorPadrao: F.colaboradorPadrao.value } } });
      d.linhas.forEach((l) => { l.sel = !l.erros.length; });
      F.aba.innerHTML = d.abas.map((a) => `<option value="${esc(a.nome)}" ${a.nome === d.aba ? 'selected' : ''} ${a.valida ? '' : 'disabled'}>${esc(a.nome)} (${a.linhas})</option>`).join('');
      F.aba.disabled = d.abas.length < 2;
      this.dados = d;
      this.desenhar();
    } catch (err) { toast(err.message, 'err'); }
  },

  validar(l) {
    l.erros = [];
    if (!l.parte) l.erros.push(this.tipo === 'receber' ? 'sem cliente' : 'sem fornecedor');
    if (this.tipo === 'receber' && !l.colaborador) l.erros.push('sem colaborador');
    if (!['PESSOAL', 'EMPRESA'].includes(l.tipo_ambiente)) l.erros.push('tipo inválido');
    if (!l.vencimento) l.erros.push('sem vencimento');
    if (!l.valor_centavos || l.valor_centavos <= 0) l.erros.push('sem valor');
    return !l.erros.length;
  },

  desenhar() {
    const d = this.dados, L = d.linhas, rec = d.tipo === 'receber';
    const rotParte = rec ? 'Cliente' : 'Fornecedor';
    const pend = L.filter((l) => l.erros.length).length;
    const uni = [...d.unificados.categorias.map((u) => ({ ...u, t: 'Categoria' })), ...d.unificados.centros.map((u) => ({ ...u, t: 'Centro de custo' }))];
    $('#im-res').innerHTML = `
      <div class="summary">
        <div class="s"><small>Linhas lidas</small><b class="num">${L.length}</b></div>
        <div class="s"><small>Prontas</small><b class="num pos">${L.length - pend}</b></div>
        <div class="s"><small>Com pendência</small><b class="num ${pend ? 'neg' : ''}">${pend}</b></div>
        <div class="s"><small>Novos ${rec ? 'clientes' : 'fornecedores'}</small><b class="num">${d.novos.partes.length}</b></div>
        <div class="s"><small>Novas categorias</small><b class="num">${d.novos.categorias.length}</b></div>
        ${rec ? `<div class="s"><small>Novos colaboradores</small><b class="num">${d.novos.colaboradores.length}</b></div>`
    : `<div class="s"><small>Novos centros de custo</small><b class="num">${d.novos.centros.length}</b></div>`}
      </div>
      ${uni.length || d.novos.categorias.length ? `<div class="card card-b" style="margin-bottom:14px">
        ${uni.length ? `<p style="margin:0 0 8px"><b>Nomes unificados</b> <span class="muted">(parecidos na planilha, gravados com um só nome)</span>:</p>
          <div class="legend" style="margin-bottom:12px">${uni.map((u) => `<span>${u.t}: <s class="muted">${u.de.map(esc).join(', ')}</s>&nbsp;→&nbsp;<b>${esc(u.para)}</b></span>`).join('')}</div>` : ''}
        ${d.novos.categorias.length ? `<p style="margin:0 0 8px"><b>Categorias que serão criadas</b> <span class="muted">(natureza pelos tipos P/E das linhas)</span>:</p>
          <div class="legend">${d.novos.categorias.map((c) => `<span>${esc(c.nome)} ${badgeAmb(c.natureza, true)}</span>`).join('')}</div>` : ''}
      </div>` : ''}
      <div class="card">
        <div class="card-h"><div><h3>Revisão — ${rec ? 'Contas a Receber' : 'Contas a Pagar'} · ${esc(d.arquivo)} · aba “${esc(d.aba)}”</h3>
          <p>${pend ? `<span style="color:var(--warn)">${pend} linha(s) com pendência vieram desmarcadas; corrija o valor/vencimento aqui para incluí-las.</span>` : 'Todas as linhas estão prontas.'}</p></div></div>
        <div class="table-wrap"><table>
          <thead><tr><th style="width:36px"><input type="checkbox" id="im-all" aria-label="Selecionar todas"></th><th>Linha</th><th>${rotParte} / Descrição</th><th>Tipo</th>
            <th>Vencimento</th><th class="r">Valor</th><th>${rec ? 'Categoria / Colaborador' : 'Categoria / C. Custo'}</th><th>Pendência</th></tr></thead>
          <tbody>${L.map((l, i) => `<tr data-i="${i}">
            <td><input type="checkbox" data-sel ${l.sel ? 'checked' : ''}></td>
            <td class="num muted">${l.linha}</td>
            <td class="wrap"><b>${esc(l.parte)}</b>${l.descricao && l.descricao !== l.parte ? `<br><small class="muted">${esc(l.descricao)}</small>` : ''}</td>
            <td><select class="input" data-tipo style="width:auto;padding:5px 8px"><option value="EMPRESA" ${l.tipo_ambiente === 'EMPRESA' ? 'selected' : ''}>Empresa</option>
              <option value="PESSOAL" ${l.tipo_ambiente === 'PESSOAL' ? 'selected' : ''}>Pessoal</option>${l.tipo_ambiente ? '' : '<option value="" selected>?</option>'}</select></td>
            <td><input class="input" type="date" data-venc value="${l.vencimento || ''}" style="width:150px;padding:5px 8px"></td>
            <td class="r"><input class="input num" data-val inputmode="decimal" value="${moedaInput(l.valor_centavos)}" placeholder="0,00" style="width:120px;text-align:right;padding:5px 8px"></td>
            <td class="wrap-sm">${esc(l.categoria)}${l.centro ? `<br><small class="muted">CC: ${esc(l.centro)}</small>` : ''}${rec && l.colaborador ? `<br><small class="muted">Resp.: ${esc(l.colaborador)}</small>` : ''}</td>
            <td data-err>${l.erros.map((e) => `<span class="badge b-crit xs" style="margin:0 4px 0 0">${esc(e)}</span>`).join('')}</td>
          </tr>`).join('')}</tbody>
        </table></div>
        <div class="modal-f" style="justify-content:space-between;flex-wrap:wrap;border-radius:0 0 12px 12px">
          <div class="legend" id="im-sum"></div>
          <button class="btn primary" id="im-go">${I.check}Importar</button>
        </div>
      </div>`;

    const atualizar = () => {
      const sel = L.filter((l) => l.sel);
      const emp = sel.filter((l) => l.tipo_ambiente === 'EMPRESA'), pes = sel.filter((l) => l.tipo_ambiente === 'PESSOAL');
      const soma = (a) => a.reduce((s, l) => s + (l.valor_centavos || 0), 0);
      $('#im-sum').innerHTML = `<span><b>${sel.length}</b>&nbsp;selecionada(s)</span><span>Empresa: <b class="num">&nbsp;${moeda(soma(emp))}</b></span>
        <span>Pessoal: <b class="num">&nbsp;${moeda(soma(pes))}</b></span><span class="${rec ? 'pos' : 'neg'}">Total a ${rec ? 'receber' : 'pagar'}: <b class="num">&nbsp;${moeda(soma(sel))}</b></span>`;
      $('#im-go').disabled = !sel.length;
      $('#im-go').innerHTML = `${I.check}Importar ${sel.length} lançamento(s)`;
      $('#im-all').checked = sel.length === L.length;
    };
    $$('#im-res tr[data-i]').forEach((tr) => {
      const l = L[Number(tr.dataset.i)];
      const revalidar = () => {
        const eraOk = !l.erros.length, ok = this.validar(l);
        $('[data-err]', tr).innerHTML = l.erros.map((e) => `<span class="badge b-crit xs" style="margin:0 4px 0 0">${esc(e)}</span>`).join('');
        if (ok && !eraOk) { l.sel = true; $('[data-sel]', tr).checked = true; }
        if (!ok) { l.sel = false; $('[data-sel]', tr).checked = false; }
        atualizar();
      };
      $('[data-sel]', tr).addEventListener('change', (e) => {
        if (e.target.checked && !this.validar(l)) { e.target.checked = false; return toast('Corrija a pendência da linha antes de marcá-la.', 'err'); }
        l.sel = e.target.checked; atualizar();
      });
      $('[data-tipo]', tr).addEventListener('change', (e) => { l.tipo_ambiente = e.target.value || null; revalidar(); });
      $('[data-venc]', tr).addEventListener('change', (e) => {
        l.vencimento = e.target.value || null;
        if (l.vencimento) l.emissao = !l.emissao || l.emissao > l.vencimento ? l.vencimento.slice(0, 8) + '01' : l.emissao;
        revalidar();
      });
      const inp = $('[data-val]', tr);
      inp.addEventListener('input', () => { l.valor_centavos = parseMoeda(inp.value); revalidar(); });
      inp.addEventListener('blur', () => { if (l.valor_centavos) inp.value = moedaInput(l.valor_centavos); });
    });
    $('#im-all').addEventListener('change', (e) => {
      L.forEach((l) => { l.sel = e.target.checked && this.validar(l); });
      $$('#im-res tr[data-i]').forEach((tr) => { $('[data-sel]', tr).checked = L[Number(tr.dataset.i)].sel; });
      atualizar();
    });
    $('#im-go').addEventListener('click', () => this.importar());
    atualizar();
  },

  async importar() {
    const sel = this.dados.linhas.filter((l) => l.sel);
    const tipo = this.dados.tipo, rotulo = tipo === 'receber' ? 'Contas a Receber' : 'Contas a Pagar';
    if (!(await confirmar(`Importar <b>${sel.length}</b> lançamento(s) para ${rotulo}?`, { ok: 'Importar' }))) return;
    try {
      const r = await api(`/api/importacao/${tipo}/executar`, { method: 'POST', body: { linhas: sel } });
      Cache.limpar();
      const vencs = sel.map((l) => l.vencimento).sort();
      const de = vencs[0].slice(0, 8) + '01';
      const u = vencs[vencs.length - 1];
      const ate = isoDate(new Date(Number(u.slice(0, 4)), Number(u.slice(5, 7)), 0));
      $('#im-res').innerHTML = `<div class="card card-b">
        <h3 class="pos" style="margin:0 0 6px;font-size:15px">Importação concluída</h3>
        <p class="muted" style="margin:0 0 14px">${r.titulos} lançamento(s) criados em ${rotulo}, total de <b>${moeda(r.valor)}</b>.</p>
        <div class="summary">
          <div class="s"><small>${tipo === 'receber' ? 'Clientes' : 'Fornecedores'} criados</small><b>${r.partes}</b></div>
          <div class="s"><small>Categorias criadas</small><b>${r.categorias}</b></div>
          ${tipo === 'receber' ? `<div class="s"><small>Colaboradores criados</small><b>${r.colaboradores}</b></div>` : `<div class="s"><small>Centros de custo criados</small><b>${r.centros}</b></div>`}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn primary" data-ir="${tipo}">Ver ${rotulo}</button><button class="btn" data-ir="dashboard">Ver Dashboard</button>
          ${tipo === 'receber' ? '<button class="btn" data-ir="colaboradores">Resumo por Colaborador</button>' : '<button class="btn" data-ir="centros">Resumo por Centro de Custo</button>'}
        </div></div>`;
      $$('#im-res [data-ir]').forEach((b) => b.addEventListener('click', () => {
        Object.assign(Estado.filtros, { de, ate, preset: null, ambiente: 'TODAS' });
        Estado.salvarFiltros(); App.sincronizarFiltros();
        location.hash = '#/' + b.dataset.ir;
      }));
      toast('Planilha importada com sucesso.');
    } catch (err) { toast(err.message, 'err'); }
  },
};

const Manutencao = {
  ROT: {
    contas_receber: 'Contas a Receber', contas_pagar: 'Contas a Pagar', contas_receber_colaboradores: 'Rateios (Receber)', contas_pagar_colaboradores: 'Rateios (Pagar)',
    categorias: 'Categorias', clientes: 'Clientes', fornecedores: 'Fornecedores', colaboradores: 'Colaboradores', centros_custo: 'Centros de Custo',
    contas_bancarias: 'Contas Bancárias', formas_pagamento: 'Formas de Pagamento', usuarios: 'Usuários',
  },

  async render(el) {
    const s = await api('/api/admin/estatisticas');
    const linha = (t) => `<tr><td>${this.ROT[t]}</td><td class="r num">${s[t]}</td></tr>`;
    el.innerHTML = `
      <section class="grid g-2">
        <div class="card">
          <div class="card-h"><div><h3>Registros no banco</h3><p>Situação atual</p></div></div>
          <div class="table-wrap"><table><tbody>
            ${['contas_receber', 'contas_pagar', 'contas_receber_colaboradores', 'contas_pagar_colaboradores'].map(linha).join('')}
            ${['categorias', 'clientes', 'fornecedores', 'colaboradores', 'centros_custo', 'contas_bancarias', 'formas_pagamento', 'usuarios'].map(linha).join('')}
          </tbody></table></div>
        </div>
        <div class="card">
          <div class="card-h"><div><h3>Zerar banco de dados</h3><p>Ação exclusiva de administradores. Um backup automático é salvo no próprio banco de dados (veja a seção Backup abaixo) antes de apagar.</p></div></div>
          <div class="card-b" style="display:grid;gap:14px">
            <div class="rateio-info"><b>Zerar lançamentos</b><br><span class="muted">Apaga todas as Contas a Receber e a Pagar (e rateios). Mantém cadastros e usuários. A numeração volta ao nº 1.</span>
              <div style="margin-top:10px"><button class="btn danger" data-z="lancamentos">${I.trash}Zerar lançamentos</button></div></div>
            <div class="rateio-info"><b>Zerar lançamentos e cadastros</b><br><span class="muted">Apaga também categorias, clientes, fornecedores, colaboradores, centros de custo e contas bancárias. Mantém usuários e formas de pagamento.</span>
              <div style="margin-top:10px"><button class="btn danger" data-z="tudo">${I.trash}Zerar lançamentos e cadastros</button></div></div>
          </div>
        </div>
      </section>
      <section class="card mt">
        <div class="card-h"><div><h3>Backup do banco de dados</h3>
          <p>Gera uma cópia completa (lançamentos, cadastros, usuários e configurações), pode ser feita com o sistema aberto. A cópia (arquivo <code>.json.gz</code>) fica guardada no banco de dados (as 30 mais recentes) e é baixada pelo navegador — guarde-a também fora do sistema (Google Drive, OneDrive).</p></div>
          <button class="btn primary" id="bk-novo">${I.download}Fazer backup agora</button></div>
        <div class="table-wrap" id="bk-lista"><p class="muted" style="padding:14px 22px;margin:0">Carregando...</p></div>
        <div class="card-b"><p class="hint" style="margin:0">Para restaurar um backup: no computador, na pasta do sistema, rode <code>npm run db:restaurar -- caminho\\do\\backup.json.gz --confirmar</code>. Para voltar a um instante qualquer dos últimos dias, use também o recurso <b>Restore</b> do painel do Neon.</p></div>
      </section>`;
    $$('[data-z]', el).forEach((b) => b.addEventListener('click', () => this.zerar(b.dataset.z, el)));
    $('#bk-novo', el).addEventListener('click', () => this.fazerBackup());
    this.listarBackups();
  },

  baixar(nome) {
    const a = document.createElement('a');
    a.href = '/api/admin/backups/' + encodeURIComponent(nome); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
  },

  async fazerBackup() {
    const b = $('#bk-novo');
    b.disabled = true;
    try {
      const r = await api('/api/admin/backup', { method: 'POST' });
      this.baixar(r.nome);
      toast(`Backup criado: ${r.nome}`);
      this.listarBackups();
    } catch (err) { toast(err.message, 'err'); } finally { b.disabled = false; }
  },

  async listarBackups() {
    const el = $('#bk-lista');
    if (!el) return;
    try {
      const { backups } = await api('/api/admin/backups');
      const tam = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
      el.innerHTML = backups.length ? `<table><thead><tr><th>Arquivo</th><th>Data</th><th class="r">Tamanho</th><th></th></tr></thead><tbody>
        ${backups.slice(0, 15).map((x) => `<tr><td>${esc(x.nome)}</td><td>${new Date(x.data).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</td>
          <td class="r num">${tam(x.bytes)}</td><td class="r"><button class="btn" data-bk="${esc(x.nome)}">${I.download}Baixar</button></td></tr>`).join('')}
        </tbody></table>${backups.length > 15 ? `<p class="muted" style="padding:8px 22px;margin:0">Mostrando os 15 mais recentes de ${backups.length}.</p>` : ''}`
        : '<p class="muted" style="padding:14px 22px;margin:0">Nenhum backup ainda.</p>';
      $$('[data-bk]', el).forEach((b) => b.addEventListener('click', () => this.baixar(b.dataset.bk)));
    } catch (err) { el.innerHTML = `<p class="neg" style="padding:14px 22px;margin:0">${esc(err.message)}</p>`; }
  },

  zerar(modo, el) {
    const m = modal({
      titulo: 'Confirmar exclusão', tamanho: 'sm',
      corpo: `<form id="zf" class="form-grid">
        <div class="f s12"><p style="margin:0">Esta ação apaga ${modo === 'tudo' ? '<b>todos os lançamentos e cadastros</b>' : '<b>todos os lançamentos</b>'} do banco.
          Um backup será gravado antes. Para confirmar, digite <b>ZERAR</b>:</p></div>
        <div class="f s12"><input class="input" name="c" autocomplete="off" placeholder="ZERAR" required></div></form>`,
      rodape: `<button class="btn" data-close>Cancelar</button><button class="btn danger" form="zf">${I.trash}Zerar</button>`,
    });
    $('#zf', m.el).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('/api/admin/zerar', { method: 'POST', body: { modo, confirmacao: e.target.c.value.trim().toUpperCase() } });
        m.fechar(); Cache.limpar();
        toast(`Banco zerado. Backup salvo em ${r.backup}`);
        this.render(el);
      } catch (err) { toast(err.message, 'err'); }
    });
  },
};

/* =====================================================================
   Alertas por E-mail (ADMIN): resumo diário das contas a pagar
   ===================================================================== */
const Alertas = {
  async render(el) {
    const { config: c, estado: st } = await api('/api/admin/alerta');
    const S = c.smtp;
    const chk = (n, v, t) => `<label style="display:flex;gap:8px;align-items:center;font-size:13.5px"><input type="checkbox" name="${n}" ${v ? 'checked' : ''}> ${t}</label>`;
    el.innerHTML = `
      <section class="grid g-main">
        <div class="card">
          <div class="card-h"><div><h3>Resumo diário por e-mail</h3><p>Todos os dias, no horário escolhido, o sistema envia o que vence no dia, o que está em atraso e os próximos vencimentos.</p></div></div>
          <div class="card-b">
            <form id="al-form" class="form-grid">
              <div class="f s12">${chk('ativo', c.ativo, '<b>Alerta ativo</b>')}</div>
              <div class="f s8"><label>Enviar para <span class="req">*</span></label><input class="input" name="destinatarios" value="${esc(c.destinatarios)}" placeholder="email@exemplo.com, outro@exemplo.com"></div>
              <div class="f s4"><label>Horário</label><input class="input" type="time" name="horario" value="${esc(c.horario)}"></div>
              <div class="f s4"><label>Mostrar também os próximos</label>
                <select class="input" name="diasAFrente">${[0, 1, 2, 3, 5, 7, 10, 15].map((n) => `<option value="${n}" ${Number(c.diasAFrente) === n ? 'selected' : ''}>${n ? `${n} dia(s)` : 'Não mostrar'}</option>`).join('')}</select></div>
              <div class="f s8" style="gap:8px;padding-top:4px">
                ${chk('incluirAtrasados', c.incluirAtrasados, 'Incluir contas em atraso')}
                ${chk('incluirReceber', c.incluirReceber, 'Incluir o que há para receber no dia')}
                ${chk('fimDeSemanaNaSexta', c.fimDeSemanaNaSexta, 'Na sexta-feira, incluir os vencimentos de sábado e domingo')}
                ${chk('enviarSemVencimentos', c.enviarSemVencimentos, 'Enviar mesmo quando nada vencer no dia')}
              </div>
              <div class="section-t"><b>Servidor de e-mail (SMTP)</b><span class="hint">Gmail: smtp.gmail.com · porta 465 · SSL</span></div>
              <div class="f s4"><label>Servidor</label><input class="input" name="host" value="${esc(S.host)}"></div>
              <div class="f s2"><label>Porta</label><input class="input" name="porta" inputmode="numeric" value="${esc(S.porta)}"></div>
              <div class="f s2"><label>Segurança</label><select class="input" name="seguranca">
                ${[['ssl', 'SSL/TLS'], ['starttls', 'STARTTLS'], ['nenhuma', 'Nenhuma']].map(([v, t]) => `<option value="${v}" ${S.seguranca === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
              <div class="f s4"><label>Nome do remetente</label><input class="input" name="remetenteNome" value="${esc(S.remetenteNome)}"></div>
              <div class="f s6"><label>Usuário (e-mail da conta que envia)</label><input class="input" name="usuario" value="${esc(S.usuario)}" placeholder="ex.: marcelo.opw@gmail.com" autocomplete="off"></div>
              <div class="f s6"><label>Senha de app ${S.temSenha ? '<span class="badge b-ok xs">salva</span>' : ''}</label>
                <input class="input" type="password" name="senha" placeholder="${S.temSenha ? 'deixe em branco para manter' : '16 letras geradas pelo Google'}" autocomplete="new-password">
                <span class="hint">No Gmail, use uma <b>senha de app</b> (não a senha normal): Conta Google › Segurança › Verificação em duas etapas › Senhas de app.</span></div>
              <div class="f s12">${chk('ignorarCertificado', S.ignorarCertificado, 'Aceitar certificado do antivírus/firewall')}
                <span class="hint">Marque só se o envio falhar com erro de certificado (“certificate chain”) por causa de antivírus que inspeciona e-mails (Avast, AVG, Kaspersky, ESET…). A conexão continua criptografada, mas o certificado do servidor não é conferido.</span></div>
            </form>
          </div>
          <div class="modal-f" style="border-radius:0 0 12px 12px;flex-wrap:wrap">
            <button class="btn" id="al-previa">${I.search}Ver prévia do e-mail</button>
            <button class="btn" id="al-teste">${I.upload}Salvar e enviar agora</button>
            <button class="btn primary" id="al-salvar">${I.check}Salvar</button>
          </div>
        </div>

        <div class="grid" style="align-content:start">
          <div class="card">
            <div class="card-h"><div><h3>Agendamento no Windows</h3><p>A tarefa roda mesmo com o sistema fechado; o computador precisa estar ligado.</p></div></div>
            <div class="card-b" id="al-agenda"><span class="muted">Verificando…</span></div>
          </div>
          <div class="card">
            <div class="card-h"><div><h3>Último envio</h3></div></div>
            <div class="card-b" style="font-size:13.5px">
              ${st.ultimaVerificacao ? `<div class="muted">Verificado em ${new Date(st.ultimaVerificacao).toLocaleString('pt-BR')}</div>
                <div style="margin-top:6px" class="${String(st.ultimoResultado || '').startsWith('ERRO') ? 'neg' : ''}">${esc(st.ultimoResultado || '')}</div>` : '<span class="muted">Nenhum envio ainda.</span>'}
              <p class="muted" style="margin:12px 0 0;font-size:12px">Histórico completo: <code>data\\logs\\alerta-email.log</code></p>
            </div>
          </div>
        </div>
      </section>`;

    const F = $('#al-form');
    const corpo = () => ({
      ativo: F.ativo.checked, destinatarios: F.destinatarios.value, horario: F.horario.value, diasAFrente: Number(F.diasAFrente.value),
      incluirAtrasados: F.incluirAtrasados.checked, incluirReceber: F.incluirReceber.checked,
      fimDeSemanaNaSexta: F.fimDeSemanaNaSexta.checked, enviarSemVencimentos: F.enviarSemVencimentos.checked,
      smtp: { host: F.host.value, porta: F.porta.value, seguranca: F.seguranca.value, usuario: F.usuario.value, senha: F.senha.value, remetenteNome: F.remetenteNome.value, ignorarCertificado: F.ignorarCertificado.checked },
    });
    const salvar = async () => { await api('/api/admin/alerta', { method: 'PUT', body: corpo() }); F.senha.value = ''; };
    $('#al-salvar').addEventListener('click', async () => {
      try { await salvar(); toast('Configuração salva.'); this.render(el); } catch (err) { toast(err.message, 'err'); }
    });
    $('#al-previa').addEventListener('click', async () => {
      try {
        await salvar();
        const r = await api('/api/admin/alerta/previa');
        const m = modal({ titulo: `Prévia · ${esc(r.assunto)}`, tamanho: 'lg', corpo: '<iframe id="al-if" style="width:100%;height:70vh;border:0;border-radius:8px;background:#eef1f6"></iframe>' });
        $('#al-if', m.el).srcdoc = r.html;
      } catch (err) { toast(err.message, 'err'); }
    });
    $('#al-teste').addEventListener('click', async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await salvar(); const r = await api('/api/admin/alerta/enviar', { method: 'POST', body: {} }); toast(`E-mail enviado para ${r.para.join(', ')}.`); this.render(el); } catch (err) { toast(err.message, 'err'); } finally { b.disabled = false; }
    });
    this.agenda(c);
  },

  async agenda(c) {
    const box = $('#al-agenda');
    try {
      const a = await api('/api/admin/alerta/agendamento');
      if (a.nuvem) { box.innerHTML = `<div><span class="badge b-ok">${I.check}Automático (Netlify)</span></div><p class="muted" style="font-size:13px;margin-top:10px">O servidor verifica a cada 30 minutos e envia o resumo do dia a partir das <b>${esc(a.horario)}</b> (horário de Brasília), uma vez por dia, enquanto "Alerta ativo" estiver marcado.</p>`; return; }
      if (!a.suportado) { box.innerHTML = '<span class="muted">Disponível quando o sistema roda no Windows. Use o arquivo <b>agendar-alerta.bat</b> na pasta do sistema.</span>'; return; }
      box.innerHTML = a.agendado
        ? `<div><span class="badge b-ok">${I.check}Agendado</span></div>
           <div style="margin-top:10px;font-size:13.5px">Próximo envio: <b>${esc(a.proxima)}</b>${a.ultima ? `<br><span class="muted">Última execução: ${esc(a.ultima)}</span>` : ''}</div>
           <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn sm" data-ag="criar">Atualizar para ${esc(c.horario)}</button><button class="btn sm danger" data-ag="remover">Remover agendamento</button></div>`
        : `<div><span class="badge b-warn">${I.clock}Não agendado</span></div>
           <p class="muted" style="font-size:13px">Salve as configurações e clique abaixo para criar a tarefa diária às <b>${esc(c.horario)}</b>.</p>
           <button class="btn primary sm" data-ag="criar">${I.clock}Agendar envio diário</button>`;
      $$('[data-ag]', box).forEach((b) => b.addEventListener('click', async () => {
        try {
          if (b.dataset.ag === 'criar') { await api('/api/admin/alerta/agendamento', { method: 'POST', body: {} }); toast('Envio diário agendado.'); }
          else { await api('/api/admin/alerta/agendamento', { method: 'DELETE' }); toast('Agendamento removido.'); }
          this.agenda(c);
        } catch (err) { toast(err.message, 'err'); }
      }));
    } catch (err) { box.textContent = err.message; }
  },
};
