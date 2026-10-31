'use strict';
require('./tz');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Data de hoje no fuso local do servidor, formato YYYY-MM-DD */
function hoje() {
  const d = new Date();
  return fmtData(d);
}
function fmtData(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function isData(v) {
  if (typeof v !== 'string' || !RE_DATA.test(v)) return false;
  const d = new Date(v + 'T00:00:00');
  return !isNaN(d) && fmtData(d) === v;
}

function soDigitos(v) { return v == null ? null : String(v).replace(/\D/g, '') || null; }

function vazio(v) { return v === undefined || v === null || (typeof v === 'string' && v.trim() === ''); }

function texto(v) { return vazio(v) ? null : String(v).trim(); }

function inteiroPositivo(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Valida CPF (11) ou CNPJ (14) pelos dígitos verificadores */
function cpfCnpjValido(doc) {
  if (!doc) return true;
  if (/^(\d)\1+$/.test(doc)) return false;
  if (doc.length === 11) {
    const calc = (len) => {
      let s = 0;
      for (let i = 0; i < len; i++) s += Number(doc[i]) * (len + 1 - i);
      const r = (s * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return calc(9) === Number(doc[9]) && calc(10) === Number(doc[10]);
  }
  if (doc.length === 14) {
    const calc = (len) => {
      const pesos = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      let s = 0;
      for (let i = 0; i < len; i++) s += Number(doc[i]) * pesos[i];
      const r = s % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === Number(doc[12]) && calc(13) === Number(doc[13]);
  }
  return false;
}

/** Soma N meses a uma data ISO mantendo o dia (limitado ao último dia do mês: 31/01 + 1 = 28/02) */
function addMeses(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const alvo = new Date(y, m - 1 + n, 1);
  const ultimo = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  return fmtData(new Date(alvo.getFullYear(), alvo.getMonth(), Math.min(d, ultimo)));
}

/** Normaliza filtros de período/âmbito vindos da querystring */
function filtroPeriodo(q) {
  const de = q.de, ate = q.ate;
  if (!isData(de) || !isData(ate)) throw new HttpError(400, 'Informe o período (de/ate) no formato AAAA-MM-DD.');
  if (de > ate) throw new HttpError(400, 'A data inicial deve ser menor ou igual à data final.');
  const amb = String(q.ambiente || 'TODAS').toUpperCase();
  if (!['TODAS', 'PESSOAL', 'EMPRESA'].includes(amb)) throw new HttpError(400, 'Âmbito inválido.');
  return { de, ate, ambiente: amb };
}

/** Expressão SQL do status derivado. Recebe o alias da tabela e usa o parâmetro @hoje */
function sqlStatus(a) {
  return `CASE WHEN ${a}.data_pagamento IS NOT NULL THEN 'REALIZADO'
               WHEN ${a}.data_vencimento < @hoje THEN 'ATRASADO'
               ELSE 'PENDENTE' END`;
}

module.exports = { HttpError, hoje, fmtData, isData, soDigitos, vazio, texto, inteiroPositivo, cpfCnpjValido, filtroPeriodo, sqlStatus, addMeses };
