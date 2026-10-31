'use strict';
/**
 * Netlify Function: executa o Express (toda a API /api/*) sem servidor fixo.
 * O front-end (public/) é servido diretamente pelo CDN do Netlify.
 */
const serverless = require('serverless-http');
const app = require('../../src/server');

const executar = serverless(app, {
  binary: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // modelo de importação (.xlsx)
    'application/gzip', // backup
    'application/octet-stream',
  ],
});

const PREFIXO = /^\/\.netlify\/functions\/api/;

exports.handler = async (event, context) => {
  // O Netlify pode entregar o caminho original (/api/...) ou o da função (/.netlify/functions/api/...)
  let p = String(event.path || '/').replace(PREFIXO, '') || '/';
  if (!p.startsWith('/api')) p = '/api' + (p.startsWith('/') ? p : '/' + p);
  return executar({ ...event, path: p }, context);
};
