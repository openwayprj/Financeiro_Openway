'use strict';
/** Copia o Chart.js (node_modules) para public/vendor/chart.js, para o CDN do Netlify servir como arquivo estático. */
const fs = require('fs');
const path = require('path');
const origem = path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist');
const destino = path.join(__dirname, '..', 'public', 'vendor', 'chart.js');
fs.mkdirSync(destino, { recursive: true });
for (const arq of ['chart.umd.js', 'chart.umd.js.map']) {
  if (fs.existsSync(path.join(origem, arq))) fs.copyFileSync(path.join(origem, arq), path.join(destino, arq));
}
console.log('Chart.js copiado para public/vendor/chart.js');
