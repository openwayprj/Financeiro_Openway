'use strict';
/**
 * Download HTTPS simples (segue redirecionamentos) usando os certificados do Node + os do Windows,
 * para funcionar mesmo com antivírus/firewall que inspeciona SSL.
 */
const https = require('https');
const tls = require('tls');

let _ca;
function certificados() {
  if (_ca !== undefined) return _ca;
  try {
    _ca = typeof tls.getCACertificates === 'function'
      ? [...new Set([...tls.getCACertificates('default'), ...tls.getCACertificates('system')])]
      : null;
  } catch (_) { _ca = null; }
  return _ca;
}

function ehErroCertificado(e) {
  return /certificate|self[- ]signed|unable to (get|verify)|CERT_|DEPTH_ZERO/i.test(e.message || '') || /CERT|SELF_SIGNED/.test(e.code || '');
}

/**
 * @returns {Promise<{ status, tipo, corpo: Buffer, url }>}
 */
function baixar(url, { ignorarCertificado = false, limite = 20 * 1024 * 1024, timeout = 30000, saltos = 6 } = {}) {
  return new Promise((ok, erro) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') return erro(new Error('Use um endereço https://'));
    const opts = { method: 'GET', headers: { 'User-Agent': 'OpenwayFinanceiro/1.0', Accept: '*/*' }, rejectUnauthorized: !ignorarCertificado };
    const ca = certificados();
    if (ca && ca.length) opts.ca = ca;
    const req = https.request(u, opts, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (saltos <= 0) return erro(new Error('Muitos redirecionamentos.'));
        return baixar(new URL(res.headers.location, u).toString(), { ignorarCertificado, limite, timeout, saltos: saltos - 1 }).then(ok, erro);
      }
      const partes = []; let tam = 0;
      res.on('data', (d) => {
        tam += d.length;
        if (tam > limite) { req.destroy(new Error('Arquivo muito grande.')); return; }
        partes.push(d);
      });
      res.on('end', () => ok({ status: res.statusCode, tipo: String(res.headers['content-type'] || ''), corpo: Buffer.concat(partes), url: u.toString() }));
      res.on('error', erro);
    });
    req.setTimeout(timeout, () => req.destroy(new Error('Tempo esgotado ao baixar a planilha.')));
    req.on('error', (e) => {
      if (ehErroCertificado(e)) {
        return erro(new Error(`${e.message}. Um antivírus/firewall está inspecionando a conexão. Marque a opção "Aceitar certificado do antivírus/firewall" e tente de novo.`));
      }
      erro(e);
    });
    req.end();
  });
}

module.exports = { baixar, certificados };
