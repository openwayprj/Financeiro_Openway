/* Service worker do Openway Financeiro: permite instalar o app e abrir rápido.
   A API (/api/*) NUNCA é guardada em cache (dados financeiros sempre vêm do servidor). */
'use strict';
const VERSAO = 'ow-v1';
const CASCA = ['/', '/index.html', '/css/app.css', '/js/core.js', '/js/app.js', '/img/icon-192.png', '/img/favicon.png', '/img/logo.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(CASCA)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

/** Rede primeiro (com limite de tempo); se falhar, usa o que estiver guardado */
function redePrimeiro(req, fallbackUrl) {
  return new Promise((resolve) => {
    let respondeu = false;
    const doCache = () => caches.match(req).then((r) => r || (fallbackUrl ? caches.match(fallbackUrl) : undefined));
    const timer = setTimeout(() => { doCache().then((r) => { if (r && !respondeu) { respondeu = true; resolve(r); } }); }, 5000);
    fetch(req).then((resp) => {
      clearTimeout(timer);
      if (resp && resp.ok && req.method === 'GET') { const copia = resp.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); }
      if (!respondeu) { respondeu = true; resolve(resp); }
    }).catch(() => {
      clearTimeout(timer);
      doCache().then((r) => { if (!respondeu) { respondeu = true; resolve(r || Response.error()); } });
    });
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // fontes do Google etc.: navegador cuida
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return; // sempre rede
  if (req.mode === 'navigate') { e.respondWith(redePrimeiro(req, '/index.html')); return; }
  if (/\.(png|jpg|jpeg|svg|ico|woff2?)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((resp) => { const c = resp.clone(); caches.open(VERSAO).then((x) => x.put(req, c)); return resp; })));
    return;
  }
  e.respondWith(redePrimeiro(req));
});
