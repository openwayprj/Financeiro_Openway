/* =====================================================================
   Núcleo do front-end: API, formatação, estado global, modal, toasts
   ===================================================================== */
'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/* ------------------------------ API ------------------------------ */
async function api(url, opts = {}) {
  const o = { method: 'GET', headers: {}, credentials: 'same-origin', ...opts };
  if (o.body && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); o.headers['Content-Type'] = 'application/json'; }
  const r = await fetch(url, o);
  let data = null;
  try { data = await r.json(); } catch (_) { /* sem corpo */ }
  if (r.status === 401 && !url.startsWith('/api/auth/login')) { App.mostrarLogin(); throw new Error(data?.erro || 'Sessão expirada.'); }
  if (!r.ok) throw new Error(data?.erro || `Erro ${r.status}`);
  return data;
}
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

/* --------------------------- Formatação --------------------------- */
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCompact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const moeda = (c) => fmtBRL.format((c || 0) / 100);
const moedaCurta = (c) => 'R$ ' + fmtCompact.format((c || 0) / 100);
const dataBR = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

/** Converte texto digitado ("1.234,56", "1234.56", "1234") em centavos */
function parseMoeda(txt) {
  let s = String(txt || '').replace(/[^\d,.-]/g, '').trim();
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
const moedaInput = (c) => (c ? (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '');

function fmtDoc(d) {
  if (!d) return '';
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
}

/* ------------------------------ Datas ------------------------------ */
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hojeISO = () => isoDate(new Date());
function preset(p) {
  const h = new Date(), y = h.getFullYear(), m = h.getMonth();
  const mes = (yy, mm) => [isoDate(new Date(yy, mm, 1)), isoDate(new Date(yy, mm + 1, 0))];
  return { mes: mes(y, m), anterior: mes(y, m - 1), proximo: mes(y, m + 1), ano: [`${y}-01-01`, `${y}-12-31`] }[p];
}
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloBalde = (k) => (k.length === 7 ? `${MESES[Number(k.slice(5, 7)) - 1]}/${k.slice(2, 4)}` : `${k.slice(8, 10)}/${k.slice(5, 7)}`);

/* ------------------------- Estado global ------------------------- */
const Estado = {
  usuario: null,
  filtros: (() => {
    let f = null;
    try { f = JSON.parse(localStorage.getItem('ow_filtros') || 'null'); } catch (_) { /* ignore */ }
    const [de, ate] = preset('mes');
    return f && f.de && f.ate ? f : { de, ate, ambiente: 'TODAS', preset: 'mes' };
  })(),
  salvarFiltros() { try { localStorage.setItem('ow_filtros', JSON.stringify(this.filtros)); } catch (_) { /* ignore */ } },
};

/* ------------------------------ Ícones ------------------------------ */
const I = (() => {
  const s = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  return {
    dash: s('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
    in: s('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>'),
    out: s('<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>'),
    users: s('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    tag: s('<path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/>'),
    person: s('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>'),
    truck: s('<rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 3v5h-7"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'),
    badge: s('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M15 10h3M15 14h3M6 17c.6-1.6 1.8-2.5 3-2.5s2.4.9 3 2.5"/>'),
    card: s('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'),
    bank: s('<path d="M3 21h18M4 10h16M5 10v8M9 10v8M15 10v8M19 10v8M12 3l9 5H3z"/>'),
    shield: s('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'),
    plus: s('<path d="M12 5v14M5 12h14"/>'),
    edit: s('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    trash: s('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
    check: s('<path d="M20 6 9 17l-5-5"/>'),
    undo: s('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>'),
    x: s('<path d="M18 6 6 18M6 6l12 12"/>'),
    search: s('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
    logout: s('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>'),
    key: s('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.3-9.3M17 6l3 3M14 9l2 2"/>'),
    menu: s('<path d="M3 6h18M3 12h18M3 18h18"/>'),
    download: s('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>'),
    clock: s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    alert: s('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>'),
    cal: s('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h2M14 14h2M8 18h2"/>'),
    mail: s('<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>'),
    upload: s('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>'),
    db: s('<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>'),
    copy: s('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>'),
    target: s('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'),
    split: s('<path d="M16 3h5v5M8 3H3v5M21 3l-7 7M3 3l7 7M12 22v-8"/>'),
  };
})();

/* ---------------------------- Badges ---------------------------- */
const STATUS = {
  REALIZADO: { cls: 'b-ok', txt: 'Realizado', ic: 'check' },
  PENDENTE: { cls: 'b-warn', txt: 'Pendente', ic: 'clock' },
  ATRASADO: { cls: 'b-crit', txt: 'Em Atraso', ic: 'alert' },
};
const badgeStatus = (s) => `<span class="badge ${STATUS[s].cls}">${I[STATUS[s].ic]}${STATUS[s].txt}</span>`;
const badgeAmb = (a, xs = false) => (a === 'EMPRESA' ? `<span class="badge b-emp${xs ? ' xs' : ''}">Empresa</span>`
  : a === 'AMBOS' ? `<span class="badge b-amb${xs ? ' xs' : ''}">Empresa e Pessoal</span>`
  : `<span class="badge b-pes${xs ? ' xs' : ''}">Pessoal</span>`);
const rotuloCC = (x) => (x.codigo ? `${x.codigo} · ${x.nome}` : x.nome);
const NAT_CURTA = { EMPRESA: 'Emp', PESSOAL: 'Pes', AMBOS: 'Emp+Pes' };

/* ------------------------------ Toast ------------------------------ */
function toast(msg, tipo = 'ok') {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), tipo === 'err' ? 6500 : 3200);
}

/* ------------------------------ Modal ------------------------------ */
function modal({ titulo, corpo, rodape, tamanho = '' }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${tamanho}" role="dialog" aria-modal="true">
      <div class="modal-h"><h2>${titulo}</h2><button class="btn ghost icon" data-close aria-label="Fechar">${I.x}</button></div>
      <div class="modal-b">${corpo}</div>
      ${rodape ? `<div class="modal-f">${rodape}</div>` : ''}
    </div>`;
  const fechar = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') fechar(); };
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) fechar(); });
  $$('[data-close]', bg).forEach((b) => b.addEventListener('click', fechar));
  document.addEventListener('keydown', onKey);
  document.body.appendChild(bg);
  const first = $('input:not([type=hidden]), select, textarea', bg);
  if (first) setTimeout(() => { if (!bg.contains(document.activeElement)) first.focus(); }, 30);
  return { el: bg, fechar };
}

function confirmar(msg, { ok = 'Confirmar', perigo = false } = {}) {
  return new Promise((resolve) => {
    const m = modal({
      titulo: 'Confirmação', tamanho: 'sm', corpo: `<p style="margin:0">${msg}</p>`,
      rodape: `<button class="btn" data-close>Cancelar</button><button class="btn ${perigo ? 'danger' : 'primary'}" id="cf-ok">${ok}</button>`,
    });
    let res = false;
    $('#cf-ok', m.el).addEventListener('click', () => { res = true; m.fechar(); });
    new MutationObserver((_, obs) => { if (!document.body.contains(m.el)) { obs.disconnect(); resolve(res); } })
      .observe(document.body, { childList: true });
  });
}

/* --------------------- Cache de cadastros p/ selects --------------------- */
const Cache = {
  _d: {},
  async get(ent, force = false) {
    if (force || !this._d[ent]) this._d[ent] = await api(`/api/cadastros/${ent}`);
    return this._d[ent];
  },
  limpar(ent) { if (ent) delete this._d[ent]; else this._d = {}; },
};
const opts = (lista, sel, rot = (x) => x.nome, vazio = 'Selecione...') =>
  (vazio !== null ? `<option value="">${vazio}</option>` : '') +
  lista.map((x) => `<option value="${x.id}" ${String(x.id) === String(sel) ? 'selected' : ''}>${esc(rot(x))}</option>`).join('');

/* --------------------------- Exportação CSV --------------------------- */
function baixarCSV(nome, cabecalho, linhas) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [cabecalho, ...linhas].map((l) => l.map(q).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const centavosCSV = (c) => ((c || 0) / 100).toFixed(2).replace('.', ',');

/* --------------------------- Chart.js tema --------------------------- */
const COR = {
  receita: '#199e70', receitaSoft: 'rgba(25,158,112,.30)',
  despesa: '#e66767', despesaSoft: 'rgba(230,103,103,.30)',
  ok: '#0ca30c', warn: '#fab219', crit: '#d03b3b',
  grid: '#1f2b44', axis: '#7d8ba5', text: '#b7c2d6', surface: '#111a2b',
};
if (window.Chart) {
  Chart.defaults.color = COR.axis;
  Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font');
  Chart.defaults.font.size = 12;
  Chart.defaults.borderColor = COR.grid;
  Chart.defaults.plugins.legend.display = false;
  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: '#0d1422', borderColor: '#2c3e63', borderWidth: 1, padding: 10, titleColor: '#e8edf6', bodyColor: '#b7c2d6',
    boxPadding: 4, usePointStyle: true, titleFont: { weight: '600' },
  });
  Chart.defaults.animation.duration = 350;
}
