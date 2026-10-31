'use strict';
/**
 * Cliente SMTP mínimo (sem dependências) para envio de e-mails HTML.
 * Segurança: 'ssl' (SMTPS, porta 465 — ex.: Gmail), 'starttls' (porta 587) ou 'nenhuma' (testes/rede interna).
 * Autenticação: AUTH LOGIN (usuário + senha / senha de app).
 */
const net = require('net');
const tls = require('tls');
const os = require('os');

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
const quebrar = (s) => s.replace(/.{1,76}/g, '$&\r\n');
const cabecalhoUtf8 = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`);

/**
 * Certificados confiáveis: os do Node + os instalados no Windows (repositório do sistema).
 * Necessário quando um antivírus/firewall inspeciona conexões SSL (Avast, AVG, Kaspersky, ESET...)
 * e reassina o certificado com uma autoridade própria instalada no Windows.
 */
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
function opcoesTls(smtp) {
  const o = { servername: smtp.host, rejectUnauthorized: !smtp.ignorarCertificado };
  const ca = certificados();
  if (ca && ca.length) o.ca = ca;
  return o;
}

/** Traduz erros de certificado para uma mensagem útil */
function explicar(e) {
  if (/certificate|self[- ]signed|unable to (get|verify)|CERT_|DEPTH_ZERO/i.test(e.message || '') || /CERT|SELF_SIGNED/.test(e.code || '')) {
    return new Error(`${e.message}. O certificado apresentado não é confiável — normalmente um antivírus ou firewall está inspecionando o e-mail (ex.: Avast, AVG, Kaspersky, ESET). `
      + 'Soluções: desative a "verificação de e-mail/SSL" do antivírus, ou marque na tela a opção "Aceitar certificado do antivírus/firewall".');
  }
  return e;
}

function conectar({ host, porta, seguranca, tlsOpts = {}, timeout = 20000 }) {
  return new Promise((ok, erro) => {
    const opts = { ...tlsOpts, host, port: porta, servername: host };
    const sock = seguranca === 'ssl' ? tls.connect(opts) : net.connect({ host, port: porta });
    sock.setTimeout(timeout, () => sock.destroy(new Error('Tempo esgotado ao conectar no servidor SMTP.')));
    sock.once(seguranca === 'ssl' ? 'secureConnect' : 'connect', () => ok(sock));
    sock.once('error', (e) => erro(explicar(e)));
  });
}

/** Lê respostas SMTP (inclusive multilinha "250-...") */
function leitor(sockRef) {
  let buffer = '';
  let linhas = [];
  const fila = [];
  let espera = null;
  const onData = (d) => {
    buffer += d.toString('utf8');
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const linha = buffer.slice(0, i).replace(/\r$/, '');
      buffer = buffer.slice(i + 1);
      const m = linha.match(/^(\d{3})([ -]?)(.*)$/);
      if (!m) continue;
      linhas.push(m[3]);
      if (m[2] !== '-') {
        const resp = { codigo: Number(m[1]), texto: linhas.join('\n') };
        linhas = [];
        if (espera) { const e = espera; espera = null; e(resp); } else fila.push(resp);
      }
    }
  };
  let rejeitar = null;
  const onClose = () => { if (espera) { espera = null; const r = rejeitar; rejeitar = null; r(new Error('O servidor SMTP encerrou a conexão.')); } };
  const ligar = (s) => { s.on('data', onData); s.once('close', onClose); };
  ligar(sockRef.s);
  return {
    ligar,
    proxima: () => new Promise((ok, erro) => {
      if (fila.length) return ok(fila.shift());
      espera = ok; rejeitar = erro;
    }),
  };
}

/**
 * Envia um e-mail.
 * @param {object} smtp { host, porta, seguranca, usuario, senha, ignorarCertificado }
 * @param {object} msg  { de, deNome, para: [], assunto, html, texto }
 */
async function enviarEmail(smtp, msg) {
  const ref = { s: await conectar({ host: smtp.host, porta: Number(smtp.porta), seguranca: smtp.seguranca, tlsOpts: opcoesTls(smtp) }) };
  ref.s.on('error', () => {}); // erros tratados pelas respostas
  const L = leitor(ref);
  const cmd = async (linha, esperado) => {
    if (linha !== null) ref.s.write(linha + '\r\n');
    const r = await L.proxima();
    const ok = Array.isArray(esperado) ? esperado.includes(r.codigo) : r.codigo === esperado;
    if (!ok) {
      const oculto = /^AUTH|^[A-Za-z0-9+/=]+$/.test(linha || '') ? '(credenciais)' : linha;
      throw new Error(`SMTP ${r.codigo} em "${oculto}": ${r.texto}`);
    }
    return r;
  };
  try {
    await cmd(null, 220);
    const nome = os.hostname().replace(/[^A-Za-z0-9.-]/g, '') || 'localhost';
    await cmd(`EHLO ${nome}`, 250);
    if (smtp.seguranca === 'starttls') {
      await cmd('STARTTLS', 220);
      ref.s.removeAllListeners('data');
      ref.s.removeAllListeners('close');
      ref.s = await new Promise((ok, erro) => {
        const t = tls.connect({ ...opcoesTls(smtp), socket: ref.s }, () => ok(t));
        t.once('error', (e) => erro(explicar(e)));
      });
      ref.s.on('error', () => {});
      L.ligar(ref.s);
      await cmd(`EHLO ${nome}`, 250);
    }
    if (smtp.usuario) {
      await cmd('AUTH LOGIN', 334);
      await cmd(b64(smtp.usuario), 334);
      await cmd(b64(smtp.senha || ''), 235);
    }
    await cmd(`MAIL FROM:<${msg.de}>`, 250);
    for (const p of msg.para) await cmd(`RCPT TO:<${p}>`, [250, 251]);
    await cmd('DATA', 354);
    const limite = `=_ow_${Date.now().toString(36)}`;
    const corpo = [
      `From: ${cabecalhoUtf8(msg.deNome || 'Openway Financeiro')} <${msg.de}>`,
      `To: ${msg.para.join(', ')}`,
      `Subject: ${cabecalhoUtf8(msg.assunto)}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@openway-financeiro>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${limite}"`,
      '',
      `--${limite}`,
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      quebrar(b64(msg.texto || '')),
      `--${limite}`,
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      quebrar(b64(msg.html || '')),
      `--${limite}--`,
      '',
    ].join('\r\n');
    ref.s.write(corpo + '\r\n.\r\n');
    await cmd(null, 250);
    await cmd('QUIT', [221, 250]).catch(() => {});
  } catch (e) {
    throw explicar(e);
  } finally {
    ref.s.end();
  }
}

module.exports = { enviarEmail };
