/* =====================================================================
   Importação Diária (Google Sheets / planilha padrão) + abas da tela Importar
   ===================================================================== */
'use strict';

const ImportarTela = {
  aba: 'diaria',
  render(el) {
    el.innerHTML = `
      <div class="imp-topo">
        <div class="seg" id="imp-aba"><button type="button" data-a="diaria">Importação diária (Google Sheets)</button><button type="button" data-a="outros">Outros formatos de planilha</button></div>
        <a class="btn" id="imp-modelo" href="/api/importacao-diaria/modelo" download="modelo-importacao-openway.xlsx">${I.download}Gerar planilha modelo</a>
      </div>
      <div id="imp-corpo"></div>`;
    const ir = (a) => {
      this.aba = a;
      $$('#imp-aba button').forEach((b) => b.classList.toggle('on', b.dataset.a === a));
      const c = $('#imp-corpo');
      if (a === 'diaria') ImportDiaria.render(c); else Importar.render(c);
    };
    $$('#imp-aba button').forEach((b) => b.addEventListener('click', () => ir(b.dataset.a)));
    $('#imp-modelo').addEventListener('click', () => toast('Gerando a planilha modelo com os cadastros atuais...'));
    ir(this.aba);
  },
};

const ImportDiaria = {
  dados: null,
  cfg: null,
  origem: 'link',

  async render(el) {
    const [cfg, colabs] = await Promise.all([api('/api/importacao-diaria/config'), Cache.get('colaboradores').catch(() => [])]);
    this.cfg = cfg;
    const hj = hojeISO();
    const ult = cfg.ultima ? `Última importação: ${new Date(cfg.ultima.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} — ${cfg.ultima.titulos} lançamento(s)${cfg.ultima.baixas ? `, ${cfg.ultima.baixas} baixa(s)` : ''}` : '';
    el.innerHTML = `
      <div class="card">
        <div class="card-h"><div><h3>Importar lançamentos do dia</h3>
          <p>Lê a planilha padrão (aba <b>Lançamentos</b>) e lança Contas a Pagar e a Receber da data escolhida. Linhas já importadas são ignoradas.</p></div>
          <div class="seg" id="id-origem"><button type="button" data-o="link">Link do Google Sheets</button><button type="button" data-o="arquivo">Arquivo .xlsx/.csv</button></div></div>
        <div class="card-b">
          <form id="id-form" class="form-grid" style="align-items:end">
            <div class="f s8" data-o="link"><label>Link da planilha no Google Sheets</label>
              <input class="input" name="url" value="${esc(cfg.url)}" placeholder="https://docs.google.com/spreadsheets/d/...">
              <span class="hint">A planilha deve estar compartilhada como “Qualquer pessoa com o link — Leitor”. O link fica salvo.</span></div>
            <div class="f s8 hidden" data-o="arquivo"><label>Planilha</label><input class="input" type="file" name="arquivo" accept=".xlsx,.csv"></div>
            <div class="f s4"><label>Importar pela</label>
              <select class="input" name="base">
                <option value="emissao">Data de Emissão (lançamentos do dia)</option>
                <option value="vencimento">Data de Vencimento</option>
                <option value="pagamento">Data de Pagamento</option>
                <option value="todas">Todas as linhas da planilha</option>
              </select></div>
            <div class="f s2" data-d><label>Data</label><input class="input" type="date" name="de" value="${hj}"></div>
            <div class="f s2" data-d><label>Até <span class="muted">(opcional)</span></label><input class="input" type="date" name="ate"></div>
            <div class="f s3" data-d style="flex-direction:row;gap:6px;align-items:center">
              <div class="presets" id="id-atalhos"><button type="button" data-p="hoje">Hoje</button><button type="button" data-p="ontem">Ontem</button><button type="button" data-p="7d">Últimos 7 dias</button></div></div>
            <div class="f s2"><label>Ambiente padrão</label>
              <select class="input" name="ambientePadrao"><option value="EMPRESA">Empresa</option><option value="PESSOAL">Pessoal</option></select>
              <span class="hint">Se Pessoal/Empresa vier vazio</span></div>
            <div class="f s3"><label>Colaborador padrão (Receber)</label>
              <input class="input" name="colaboradorPadrao" list="id-colabs" value="${esc(cfg.colaboradorPadrao)}" placeholder="Ex.: Marcelo Rafael">
              <datalist id="id-colabs">${colabs.map((c) => `<option value="${esc(c.nome)}">`).join('')}</datalist>
              <span class="hint">Usado se a coluna Colaborador vier vazia</span></div>
            <div class="f s12" style="flex-direction:row;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
              <label class="hint" style="display:flex;gap:8px;align-items:center" data-o="link"><input type="checkbox" name="ignorarCertificado" ${cfg.ignorarCertificado ? 'checked' : ''}>
                Aceitar certificado do antivírus/firewall <span class="muted">(marque só se aparecer erro de certificado)</span></label>
              <span class="hint" id="id-ult">${esc(ult)}</span>
              <button class="btn primary" type="submit" id="id-ler">${I.search}Ler planilha</button>
            </div>
          </form>
        </div>
      </div>
      <details class="card card-b mt id-ajuda">
        <summary><b>Como preparar a planilha no Google Sheets</b> <span class="muted">(uma vez só)</span></summary>
        <ol>
          <li>Clique em <b>Gerar planilha modelo</b> (acima). Ela vem com a aba <b>Lançamentos</b> e abas com seus Fornecedores, Clientes, Categorias, Formas de Pagamento, Centros de Custo e Colaboradores (listas de seleção nas colunas).</li>
          <li>No Google Drive: <b>Novo › Upload de arquivo</b>, envie o modelo e abra com o <b>Google Planilhas</b> (em <i>Arquivo › Salvar como Planilhas Google</i>, se abrir como .xlsx).</li>
          <li>Clique em <b>Compartilhar</b> › <b>Acesso geral</b> › <b>Qualquer pessoa com o link</b> (perfil <b>Leitor</b>) e copie o link.</li>
          <li>Cole o link acima. Todo dia: escolha a data, clique em <b>Ler planilha</b>, confira a prévia e importe.</li>
        </ol>
        <p class="muted" style="margin:6px 0 0">Colunas: Data Emissão · Movimento (Pagar/Receber) · Pessoal/Empresa · Cliente/Fornecedor · Data Vencimento · Data Pagamento · Valor · Categoria · Centro de Custo · Forma de Pagamento · Colaborador · Observação · ID (opcional).
          Nomes que não existirem são cadastrados automaticamente. Se depois você preencher a Data Pagamento na planilha, a próxima leitura registra a baixa do título.</p>
      </details>
      <div id="id-res" class="mt"></div>`;

    const F = $('#id-form');
    F.base.value = cfg.base || 'emissao';
    F.ambientePadrao.value = cfg.ambientePadrao || 'EMPRESA';
    const setOrigem = (o) => {
      this.origem = o;
      $$('#id-origem button').forEach((b) => b.classList.toggle('on', b.dataset.o === o));
      $$('#id-form [data-o]').forEach((x) => x.classList.toggle('hidden', x.dataset.o !== o));
    };
    $$('#id-origem button').forEach((b) => b.addEventListener('click', () => setOrigem(b.dataset.o)));
    setOrigem(this.origem);
    const setBase = () => $$('#id-form [data-d]').forEach((x) => { x.style.visibility = F.base.value === 'todas' ? 'hidden' : ''; });
    F.base.addEventListener('change', setBase); setBase();
    $$('#id-atalhos button').forEach((b) => b.addEventListener('click', () => {
      const d = new Date();
      if (b.dataset.p === 'hoje') { F.de.value = hojeISO(); F.ate.value = ''; }
      if (b.dataset.p === 'ontem') { d.setDate(d.getDate() - 1); F.de.value = isoDate(d); F.ate.value = ''; }
      if (b.dataset.p === '7d') { F.ate.value = hojeISO(); d.setDate(d.getDate() - 6); F.de.value = isoDate(d); }
      this.ler();
    }));
    F.addEventListener('submit', (e) => { e.preventDefault(); this.ler(); });
  },

  async ler() {
    const F = $('#id-form');
    const body = {
      origem: this.origem, base: F.base.value, de: F.de.value, ate: F.ate.value || F.de.value,
      ambientePadrao: F.ambientePadrao.value, colaboradorPadrao: F.colaboradorPadrao.value, ignorarCertificado: F.ignorarCertificado.checked,
    };
    if (body.base !== 'todas' && !body.de) return toast('Informe a data.', 'err');
    if (body.ate < body.de) return toast('A data final é anterior à inicial.', 'err');
    if (this.origem === 'link') {
      body.url = F.url.value.trim();
      if (!body.url) return toast('Cole o link da planilha do Google Sheets.', 'err');
    } else {
      const file = F.arquivo.files[0];
      if (!file) return toast('Selecione o arquivo da planilha.', 'err');
      body.arquivo = await Importar.lerArquivo(file); body.nome = file.name;
    }
    const btn = $('#id-ler');
    btn.disabled = true; btn.innerHTML = `${I.clock}Lendo planilha...`;
    try {
      this.dados = await api('/api/importacao-diaria/preview', { method: 'POST', body });
      this.desenhar();
    } catch (err) {
      $('#id-res').innerHTML = `<div class="card card-b"><p style="margin:0;color:var(--crit-text)">${esc(err.message)}</p></div>`;
      toast(err.message, 'err');
    } finally { btn.disabled = false; btn.innerHTML = `${I.search}Ler planilha`; }
  },

  validar(l) {
    if (l.situacao === 'importado' || l.situacao === 'baixa') return true;
    l.erros = [];
    if (!l.tipo) l.erros.push('informe Pagar ou Receber');
    if (!l.parte) l.erros.push('sem cliente/fornecedor');
    if (!['PESSOAL', 'EMPRESA'].includes(l.tipo_ambiente)) l.erros.push('Pessoal/Empresa inválido');
    if (!l.vencimento) l.erros.push('sem vencimento');
    if (!l.valor_centavos || l.valor_centavos <= 0) l.erros.push('sem valor');
    if (l.tipo === 'receber' && !l.colaborador) l.erros.push('sem colaborador');
    return !l.erros.length;
  },

  badges(l) {
    const b = (cls, t) => `<span class="badge ${cls} xs" style="margin:0 4px 3px 0">${t}</span>`;
    let h = '';
    if (l.situacao === 'importado') h += b('b-neutral', `já importado · nº ${l.nro}`);
    if (l.situacao === 'baixa') h += b('b-ok', `baixa em ${dataBR(l.pagamento)} · nº ${l.nro}`);
    if (l.situacao === 'possivel') h += b('b-warn', `possível duplicado do nº ${l.nro}`);
    if (l.situacao === 'novo' && !l.erros.length) h += b('b-ok', 'novo');
    h += l.erros.map((e) => b('b-crit', esc(e))).join('');
    if (l.situacao === 'novo' || l.situacao === 'possivel') h += l.avisos.map((a) => `<small class="muted" style="display:block">${esc(a)}</small>`).join('');
    return h;
  },

  desenhar() {
    const d = this.dados, L = d.linhas;
    const cont = (s) => L.filter((l) => l.situacao === s).length;
    const pend = L.filter((l) => l.situacao !== 'importado' && l.situacao !== 'baixa' && l.erros.length).length;
    const f = d.filtro;
    const periodo = f.base === 'todas' ? 'todas as linhas' : `${({ emissao: 'emissão', vencimento: 'vencimento', pagamento: 'pagamento' })[f.base]} ${f.de === f.ate ? `em ${dataBR(f.de)}` : `de ${dataBR(f.de)} a ${dataBR(f.ate)}`}`;
    const nv = d.novos;
    const chips = (rot, arr) => (arr.length ? `<div style="margin-bottom:8px"><small class="muted">${rot}:</small> <span class="legend" style="display:inline-flex">${arr.map((x) => `<span>${esc(x.nome || x)}</span>`).join('')}</span></div>` : '');
    const uni = [...d.unificados.partes, ...d.unificados.categorias, ...d.unificados.centros, ...d.unificados.formas, ...d.unificados.colaboradores];
    const temNovos = nv.fornecedores.length + nv.clientes.length + nv.categorias.length + nv.centros.length + nv.formas.length + nv.colaboradores.length;

    $('#id-res').innerHTML = `
      <div class="summary">
        <div class="s"><small>Linhas no período</small><b class="num">${L.length}</b></div>
        <div class="s"><small>Novas</small><b class="num pos">${cont('novo')}</b></div>
        <div class="s"><small>Baixas a registrar</small><b class="num">${cont('baixa')}</b></div>
        <div class="s"><small>Já importadas</small><b class="num muted">${cont('importado')}</b></div>
        <div class="s"><small>Possíveis duplicadas</small><b class="num" style="${cont('possivel') ? 'color:var(--warn)' : ''}">${cont('possivel')}</b></div>
        <div class="s"><small>Com pendência</small><b class="num ${pend ? 'neg' : ''}">${pend}</b></div>
      </div>
      ${temNovos || uni.length ? `<div class="card card-b" style="margin-bottom:14px">
        ${temNovos ? `<p style="margin:0 0 8px"><b>Cadastros que serão criados</b> <span class="muted">(se as linhas forem importadas)</span></p>
          ${chips('Fornecedores', nv.fornecedores)}${chips('Clientes', nv.clientes)}
          ${nv.categorias.length ? `<div style="margin-bottom:8px"><small class="muted">Categorias:</small> <span class="legend" style="display:inline-flex">${nv.categorias.map((c) => `<span>${esc(c.nome)} <small class="muted">(${c.tipo === 'RECEITA' ? 'Receber' : 'Pagar'})</small> ${badgeAmb(c.natureza, true)}</span>`).join('')}</span></div>` : ''}
          ${chips('Centros de custo', nv.centros)}${chips('Formas de pagamento', nv.formas)}${chips('Colaboradores', nv.colaboradores)}` : ''}
        ${uni.length ? `<p style="margin:8px 0"><b>Nomes ajustados para o cadastro existente</b>:</p>
          <div class="legend">${uni.map((u) => `<span><s class="muted">${u.de.map(esc).join(', ')}</s>&nbsp;→&nbsp;<b>${esc(u.para)}</b></span>`).join('')}</div>` : ''}
      </div>` : ''}
      <div class="card">
        <div class="card-h"><div><h3>Prévia · ${esc(periodo)}</h3>
          <p>${d.fora ? `${d.fora} linha(s) da planilha fora do período foram desconsideradas. ` : ''}${L.length ? 'Confira e ajuste antes de importar. Linhas com pendência vêm desmarcadas.' : ''}
          <span class="muted">Aba “${esc(d.aba)}”${d.ignoradas.length ? ` · colunas ignoradas: ${d.ignoradas.map(esc).join(', ')}` : ''}</span></p></div></div>
        ${L.length ? `<div class="table-wrap"><table class="id-tab">
          <thead><tr><th style="width:34px"><input type="checkbox" id="id-all" aria-label="Selecionar todas"></th><th>Lin.</th><th>Movimento</th><th>Cliente / Fornecedor</th><th>Amb.</th>
            <th>Vencimento / Pagamento</th><th class="r">Valor</th><th>Categoria / C. Custo / Forma</th></tr></thead>
          <tbody>${L.map((l, i) => this.linhaHtml(l, i)).join('')}</tbody>
        </table></div>
        <div class="modal-f" style="justify-content:space-between;flex-wrap:wrap;border-radius:0 0 12px 12px">
          <div class="legend" id="id-sum"></div>
          <button class="btn primary" id="id-go">${I.check}Importar</button>
        </div>` : `<div class="card-b"><p class="muted" style="margin:0">Nenhum lançamento na planilha para ${esc(periodo)}.</p></div>`}
      </div>`;
    if (!L.length) return;

    const atualizar = () => {
      const sel = L.filter((l) => l.sel);
      const novos = sel.filter((l) => l.situacao !== 'baixa');
      const soma = (t) => novos.filter((l) => l.tipo === t).reduce((s, l) => s + (l.valor_centavos || 0), 0);
      const bx = sel.length - novos.length;
      $('#id-sum').innerHTML = `<span><b>${novos.length}</b>&nbsp;lançamento(s)${bx ? ` + <b>&nbsp;${bx}</b>&nbsp;baixa(s)` : ''}</span>
        <span class="pos">A receber: <b class="num">&nbsp;${moeda(soma('receber'))}</b></span><span class="neg">A pagar: <b class="num">&nbsp;${moeda(soma('pagar'))}</b></span>`;
      $('#id-go').disabled = !sel.length;
      $('#id-go').innerHTML = `${I.check}Importar ${sel.length ? `(${sel.length})` : ''}`;
      const selec = L.filter((l) => l.situacao !== 'importado');
      $('#id-all').checked = selec.length && selec.every((l) => l.sel);
    };
    $$('#id-res tr[data-i]').forEach((tr) => this.ligarLinha(tr, L[Number(tr.dataset.i)], atualizar));
    $('#id-all').addEventListener('change', (e) => {
      L.forEach((l) => { if (l.situacao !== 'importado') l.sel = e.target.checked && this.validar(l); });
      $$('#id-res tr[data-i]').forEach((tr) => { const c = $('[data-sel]', tr); if (c) c.checked = L[Number(tr.dataset.i)].sel; });
      atualizar();
    });
    $('#id-go').addEventListener('click', () => this.importar());
    atualizar();
  },

  linhaHtml(l, i) {
    const fixo = l.situacao === 'importado' || l.situacao === 'baixa';
    const dis = fixo ? 'disabled' : '';
    const sel = (campo, opcoes) => `<select class="input" data-f="${campo}" ${dis} style="width:auto;padding:5px 6px">${l[campo] ? '' : '<option value="" selected>?</option>'}${opcoes.map(([v, t]) => `<option value="${v}" ${l[campo] === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    return `<tr data-i="${i}" class="${fixo && l.situacao === 'importado' ? 'id-feito' : ''}">
      <td>${l.situacao === 'importado' ? '' : `<input type="checkbox" data-sel ${l.sel ? 'checked' : ''}>`}</td>
      <td class="num muted">${l.linha}</td>
      <td>${sel('tipo', [['pagar', 'Pagar'], ['receber', 'Receber']])}</td>
      <td class="wrap"><b>${esc(l.parte) || '<span class="muted">—</span>'}</b>${l.descricao ? `<br><small class="muted">${esc(l.descricao)}</small>` : ''}${l.colaborador ? `<br><small class="muted">Colab.: ${esc(l.colaborador)}</small>` : ''}
        <div data-st style="margin-top:5px">${this.badges(l)}</div></td>
      <td>${sel('tipo_ambiente', [['EMPRESA', 'Empresa'], ['PESSOAL', 'Pessoal']])}</td>
      <td><input class="input" type="date" data-f="vencimento" value="${l.vencimento || ''}" ${dis} style="width:140px;padding:5px 6px">
        <small class="muted" style="display:block;margin-top:4px">${l.pagamento ? `pago em ${dataBR(l.pagamento)}` : 'em aberto'}</small></td>
      <td class="r"><input class="input num" data-f="valor" inputmode="decimal" value="${moedaInput(l.valor_centavos)}" ${dis} placeholder="0,00" style="width:110px;text-align:right;padding:5px 6px"></td>
      <td class="wrap-sm">${esc(l.categoria || '—')}${l.centro ? `<br><small class="muted">CC: ${esc(l.centro)}</small>` : ''}${l.forma ? `<br><small class="muted">${esc(l.forma)}</small>` : ''}</td>
    </tr>`;
  },

  ligarLinha(tr, l, atualizar) {
    const ck = $('[data-sel]', tr);
    const revalidar = () => {
      const eraOk = !l.erros.length, ok = this.validar(l);
      $('[data-st]', tr).innerHTML = this.badges(l);
      if (ok && !eraOk && l.situacao === 'novo') { l.sel = true; if (ck) ck.checked = true; }
      if (!ok) { l.sel = false; if (ck) ck.checked = false; }
      atualizar();
    };
    if (ck) ck.addEventListener('change', (e) => {
      if (e.target.checked && !this.validar(l)) { e.target.checked = false; return toast('Corrija a pendência da linha antes de marcá-la.', 'err'); }
      l.sel = e.target.checked; atualizar();
    });
    $$('select[data-f]', tr).forEach((s) => s.addEventListener('change', () => {
      l[s.dataset.f] = s.value || null;
      if (s.dataset.f === 'tipo' && l.tipo === 'receber') { l.centro = null; if (!l.colaborador) l.colaborador = $('#id-form').colaboradorPadrao.value.trim() || null; }
      if (s.dataset.f === 'tipo' && l.tipo && (!l.categoria || /^Outras (Despesas|Receitas)$/.test(l.categoria))) l.categoria = l.tipo === 'receber' ? 'Outras Receitas' : 'Outras Despesas';
      revalidar();
    }));
    const v = $('input[data-f="vencimento"]', tr);
    v.addEventListener('change', () => {
      l.vencimento = v.value || null;
      if (l.vencimento && (!l.emissao || l.emissao > l.vencimento)) l.emissao = l.vencimento < hojeISO() ? l.vencimento : hojeISO();
      revalidar();
    });
    const inp = $('input[data-f="valor"]', tr);
    inp.addEventListener('input', () => { l.valor_centavos = parseMoeda(inp.value); revalidar(); });
    inp.addEventListener('blur', () => { if (l.valor_centavos) inp.value = moedaInput(l.valor_centavos); });
  },

  async importar() {
    const sel = this.dados.linhas.filter((l) => l.sel);
    const n = sel.filter((l) => l.situacao !== 'baixa').length, bx = sel.length - n;
    if (!(await confirmar(`Importar <b>${n}</b> lançamento(s)${bx ? ` e registrar <b>${bx}</b> baixa(s)` : ''}?`, { ok: 'Importar' }))) return;
    try {
      const r = await api('/api/importacao-diaria/executar', { method: 'POST', body: { linhas: sel } });
      Cache.limpar();
      const tot = r.pagar.titulos + r.receber.titulos;
      const criados = ['partes', 'categorias', 'centros', 'colaboradores', 'formas'].reduce((s, k) => s + r.pagar[k] + r.receber[k], 0);
      const datas = sel.map((l) => l.vencimento).filter(Boolean).sort();
      $('#id-res').innerHTML = `<div class="card card-b">
        <h3 class="pos" style="margin:0 0 6px;font-size:15px">Importação concluída</h3>
        <div class="summary" style="margin:12px 0">
          <div class="s"><small>Contas a Pagar</small><b class="num neg">${r.pagar.titulos} · ${moeda(r.pagar.valor)}</b></div>
          <div class="s"><small>Contas a Receber</small><b class="num pos">${r.receber.titulos} · ${moeda(r.receber.valor)}</b></div>
          <div class="s"><small>Baixas registradas</small><b class="num">${r.baixas}</b></div>
          <div class="s"><small>Cadastros criados</small><b class="num">${criados}</b></div>
          ${r.ignoradas ? `<div class="s"><small>Ignoradas (já existiam)</small><b class="num">${r.ignoradas}</b></div>` : ''}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn primary" data-ir="calendario">Ver no Calendário</button>
          ${r.pagar.titulos ? '<button class="btn" data-ir="pagar">Contas a Pagar</button>' : ''}${r.receber.titulos ? '<button class="btn" data-ir="receber">Contas a Receber</button>' : ''}
          <button class="btn" id="id-nova">Nova leitura</button>
        </div></div>`;
      $$('#id-res [data-ir]').forEach((b) => b.addEventListener('click', () => {
        if (datas.length && b.dataset.ir !== 'calendario') {
          const u = datas[datas.length - 1];
          Object.assign(Estado.filtros, { de: datas[0].slice(0, 8) + '01', ate: isoDate(new Date(Number(u.slice(0, 4)), Number(u.slice(5, 7)), 0)), preset: null });
          Estado.salvarFiltros(); App.sincronizarFiltros();
        }
        location.hash = '#/' + b.dataset.ir;
      }));
      $('#id-nova').addEventListener('click', () => this.ler());
      const c = await api('/api/importacao-diaria/config').catch(() => null);
      if (c && c.ultima && $('#id-ult')) $('#id-ult').textContent = `Última importação: ${new Date(c.ultima.em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} — ${c.ultima.titulos} lançamento(s)`;
      toast(`${tot} lançamento(s) importado(s)${r.baixas ? `, ${r.baixas} baixa(s)` : ''}.`);
    } catch (err) { toast(err.message, 'err'); }
  },
};
