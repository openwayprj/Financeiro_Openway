'use strict';
/**
 * Gerador mínimo de planilhas .xlsx (sem dependências externas).
 *
 * gerarXlsx([{ nome, colunas: [{ titulo, largura, tipo: 'texto'|'data'|'valor' }], linhas: [[...]],
 *              validacoes: [{ coluna: 'B', lista: ['Pagar','Receber'] } | { coluna: 'I', origem: "Categorias!$A$2:$A$1000" }],
 *              congelar: true, filtro: true, linhasVazias: 1000 }]) -> Buffer
 *
 * Datas: string ISO 'AAAA-MM-DD' ou Date → gravadas como data do Excel (dd/mm/aaaa).
 * Valores: número (reais) → formato #,##0.00.
 */
const zlib = require('zlib');

const TAB_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buf) >>> 0;
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TAB_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Monta um arquivo ZIP (deflate) a partir de [{ nome, dados }] */
function zip(arquivos) {
  const locais = [], central = [];
  let off = 0;
  for (const a of arquivos) {
    const dados = Buffer.isBuffer(a.dados) ? a.dados : Buffer.from(a.dados, 'utf8');
    const comp = zlib.deflateRawSync(dados);
    const nome = Buffer.from(a.nome, 'utf8');
    const crc = crc32(dados);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(dados.length, 22); h.writeUInt16LE(nome.length, 26); h.writeUInt16LE(0, 28);
    locais.push(h, nome, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(dados.length, 24); c.writeUInt16LE(nome.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nome);
    off += 30 + nome.length + comp.length;
  }
  const tamCentral = central.reduce((s, b) => s + b.length, 0);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arquivos.length, 8); fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(tamCentral, 12); fim.writeUInt32LE(off, 16);
  return Buffer.concat([...locais, ...central, fim]);
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
const letra = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };

function serialData(v) {
  let y, m, d;
  if (v instanceof Date) { y = v.getFullYear(); m = v.getMonth() + 1; d = v.getDate(); } else {
    const r = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!r) return null;
    [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  }
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

// Estilos (índices de cellXfs)
const S = { normal: 0, cab: 1, data: 2, valor: 3, texto: 4, titulo: 5, nota: 6 };
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>
<fonts count="4">
<font><sz val="10"/><name val="Arial"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
<font><b/><sz val="13"/><color rgb="FF0F2A4A"/><name val="Arial"/></font>
<font><i/><sz val="9"/><color rgb="FF5F6B7A"/><name val="Arial"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0F2A4A"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="thin"><color rgb="FF8FA3BF"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function gerarXlsx(abas) {
  const strings = [], idxStr = new Map();
  const str = (s) => { s = String(s); if (!idxStr.has(s)) { idxStr.set(s, strings.length); strings.push(s); } return idxStr.get(s); };

  const sheets = abas.map((aba) => {
    const cols = aba.colunas || [];
    const estiloCol = cols.map((c) => (c.tipo === 'data' ? S.data : c.tipo === 'valor' ? S.valor : c.tipo === 'nota' ? S.nota : c.tipo === 'textoLongo' ? S.texto : S.normal));
    const cel = (v, ref, estilo) => {
      if (v == null || v === '') return estilo ? `<c r="${ref}" s="${estilo}"/>` : '';
      if (typeof v === 'object' && !(v instanceof Date) && 'v' in v) { estilo = v.s ?? estilo; v = v.v; }
      if (estilo === S.data && (v instanceof Date || /^\d{4}-\d{2}-\d{2}/.test(String(v)))) {
        const n = serialData(v); if (n != null) return `<c r="${ref}" s="${estilo}"><v>${n}</v></c>`;
      }
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${estilo ? ` s="${estilo}"` : ''}><v>${v}</v></c>`;
      return `<c r="${ref}" t="s"${estilo ? ` s="${estilo}"` : ''}><v>${str(v)}</v></c>`;
    };
    const rows = [];
    let r = 1;
    if (cols.length && !aba.semCabecalho) {
      rows.push(`<row r="1" ht="22" customHeight="1">${cols.map((c, i) => cel(c.titulo, `${letra(i)}1`, S.cab)).join('')}</row>`);
      r = 2;
    }
    for (const l of aba.linhas || []) {
      const est = Array.isArray(l) ? null : l.estilo;
      const vals = Array.isArray(l) ? l : l.valores;
      rows.push(`<row r="${r}">${vals.map((v, i) => cel(v, `${letra(i)}${r}`, est != null ? est : estiloCol[i])).join('')}</row>`);
      r++;
    }
    const ultima = Math.max(r - 1, 1);
    const colsXml = cols.length ? `<cols>${cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura || 14}"${estiloCol[i] ? ` style="${estiloCol[i]}"` : ''} customWidth="1"/>`).join('')}</cols>` : '';
    const vazias = aba.linhasVazias || 1000;
    const dv = (aba.validacoes || []).map((v) => {
      const sq = `${v.coluna}2:${v.coluna}${vazias + 1}`;
      const f = v.lista ? `"${v.lista.join(',')}"` : v.origem;
      return `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorStyle="warning" errorTitle="Valor fora da lista" error="${xml(v.erro || 'Valor não está na lista de cadastros. Ele será cadastrado automaticamente na importação.')}" sqref="${sq}"><formula1>${xml(f)}</formula1></dataValidation>`;
    });
    const view = aba.congelar && cols.length
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const filtro = aba.filtro && cols.length ? `<autoFilter ref="A1:${letra(cols.length - 1)}${ultima}"/>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<dimension ref="A1:${letra(Math.max(cols.length, 1) - 1)}${ultima}"/>${view}<sheetFormatPr defaultRowHeight="15"/>${colsXml}
<sheetData>${rows.join('')}</sheetData>${filtro}${dv.length ? `<dataValidations count="${dv.length}">${dv.join('')}</dataValidations>` : ''}
<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
  });

  const nomes = abas.map((a) => a.nome.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  const definidos = abas.map((a, i) => (a.filtro && a.colunas?.length
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(nomes[i])}'!$A$1:$${letra(a.colunas.length - 1)}$${Math.max((a.linhas || []).length + 1, 1)}</definedName>` : '')).join('');
  const arquivos = [
    { nome: '[Content_Types].xml', dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
    { nome: '_rels/.rels', dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
    { nome: 'docProps/core.xml', dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>Openway Financeiro - Modelo de Importação</dc:title><dc:creator>Openway Financeiro</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>` },
    { nome: 'xl/workbook.xml', dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews><sheets>${nomes.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
${definidos ? `<definedNames>${definidos}</definedNames>` : ''}</workbook>` },
    { nome: 'xl/_rels/workbook.xml.rels', dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId${sheets.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>` },
    { nome: 'xl/styles.xml', dados: STYLES },
    ...sheets.map((s, i) => ({ nome: `xl/worksheets/sheet${i + 1}.xml`, dados: s })),
  ];
  arquivos.push({ nome: 'xl/sharedStrings.xml', dados: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${xml(s)}</t></si>`).join('')}</sst>` });
  return zip(arquivos);
}

module.exports = { gerarXlsx, ESTILO: S };
