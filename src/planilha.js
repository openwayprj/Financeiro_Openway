'use strict';
/**
 * Leitor mínimo de planilhas (.xlsx e .csv) sem dependências externas.
 * - .xlsx: descompacta o arquivo (formato ZIP) com zlib nativo e lê a 1ª aba
 * - .csv : separador ; ou , (detectado), com suporte a aspas
 * Retorna as abas [{ nome, linhas }], cada linha um array de valores string | number | null.
 */
const zlib = require('zlib');

function lerZip(buf) {
  // End of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Arquivo .xlsx inválido ou corrompido.');
  const qtd = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const arquivos = {};
  for (let n = 0; n < qtd; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const lenNome = buf.readUInt16LE(p + 28), lenExtra = buf.readUInt16LE(p + 30), lenCom = buf.readUInt16LE(p + 32);
    const offLocal = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + lenNome);
    const ini = offLocal + 30 + buf.readUInt16LE(offLocal + 26) + buf.readUInt16LE(offLocal + 28);
    const dados = buf.subarray(ini, ini + tamComp);
    arquivos[nome] = () => (metodo === 8 ? zlib.inflateRawSync(dados) : dados).toString('utf8');
    p += 46 + lenNome + lenExtra + lenCom;
  }
  return arquivos;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodificar = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));
const textos = (xml) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodificar(m[1])).join('');
const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

function lerAba(xml, shared) {
  const linhas = [];
  for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g)) {
    const attrs = rm[1] || rm[3] || '';
    const rnum = Number((attrs.match(/\br="(\d+)"/) || [])[1]) || linhas.length + 1;
    const linha = [];
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ca = cm[1], corpo = cm[2] || '';
      const ref = (ca.match(/\br="([A-Z]+)\d+"/) || [])[1];
      const t = (ca.match(/\bt="(\w+)"/) || [])[1];
      const v = (corpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = null;
      if (t === 's') val = v != null ? shared[Number(v)] ?? null : null;
      else if (t === 'inlineStr') val = textos(corpo);
      else if (t === 'str' || t === 'e') val = v != null ? decodificar(v) : null;
      else if (t === 'b') val = v === '1';
      else if (v != null && v !== '') val = Number(v);
      linha[ref ? colIdx(ref) : linha.length] = val;
    }
    linhas[rnum - 1] = Array.from(linha, (x) => (x === undefined ? null : x));
  }
  return Array.from(linhas, (l) => l || []);
}

/** Lê todas as abas do .xlsx, na ordem da pasta de trabalho: [{ nome, linhas }] */
function lerXlsx(buf) {
  const z = lerZip(buf);
  const shared = z['xl/sharedStrings.xml'] ? [...z['xl/sharedStrings.xml']().matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textos(m[1])) : [];
  const abas = [];
  if (z['xl/workbook.xml'] && z['xl/_rels/workbook.xml.rels']) {
    const wb = z['xl/workbook.xml']();
    const rels = [...z['xl/_rels/workbook.xml.rels']().matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]);
    for (const sm of wb.matchAll(/<sheet\b[^>]*>/g)) {
      const nome = decodificar((sm[0].match(/\bname="([^"]*)"/) || [])[1] || `Aba ${abas.length + 1}`);
      const rid = (sm[0].match(/\br:id="([^"]+)"/) || [])[1];
      const rel = rels.find((r) => r.includes(`Id="${rid}"`));
      const tgt = rel && (rel.match(/Target="([^"]+)"/) || [])[1];
      if (!tgt) continue;
      const arq = tgt.startsWith('/') ? tgt.slice(1) : 'xl/' + tgt.replace(/^\.\//, '');
      if (z[arq]) abas.push({ nome, linhas: lerAba(z[arq](), shared) });
    }
  }
  if (!abas.length && z['xl/worksheets/sheet1.xml']) abas.push({ nome: 'Planilha1', linhas: lerAba(z['xl/worksheets/sheet1.xml'](), shared) });
  if (!abas.length) throw new Error('Não encontrei abas na planilha.');
  return abas;
}

function lerCsv(txt) {
  txt = txt.replace(/^﻿/, '');
  const prim = txt.split(/\r?\n/)[0] || '';
  const sep = (prim.match(/;/g) || []).length >= (prim.match(/,/g) || []).length ? ';' : ',';
  const linhas = [];
  let linha = [], campo = '', aspas = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (aspas) {
      if (ch === '"' && txt[i + 1] === '"') { campo += '"'; i++; } else if (ch === '"') aspas = false; else campo += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { linha.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && txt[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += ch;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas.map((l) => l.map((c) => (c.trim() === '' ? null : c.trim())));
}

/** Detecta o formato pelo conteúdo/nome e devolve as abas: [{ nome, linhas }] */
function lerPlanilha(buf, nome = '') {
  if (buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50) return lerXlsx(buf);
  if (/\.xls$/i.test(nome)) throw new Error('Formato .xls antigo não suportado. Salve a planilha como .xlsx ou .csv.');
  return [{ nome: 'CSV', linhas: lerCsv(buf.toString('utf8')) }];
}

module.exports = { lerPlanilha };
