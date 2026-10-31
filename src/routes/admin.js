'use strict';
/**
 * Manutenção do banco (somente ADMIN).
 *  - GET  /api/admin/estatisticas  -> quantidade de registros por tabela
 *  - POST /api/admin/zerar         -> { modo: 'lancamentos' | 'tudo', confirmacao: 'ZERAR' }
 *      lancamentos: apaga Contas a Receber/Pagar e rateios (mantém cadastros e usuários)
 *      tudo       : também apaga categorias, clientes, fornecedores, colaboradores, centros de custo e
 *                   contas bancárias (mantém usuários e formas de pagamento)
 *    Antes de apagar, grava um backup automático (tabela `backups` do próprio banco).
 *  - POST /api/admin/backup         -> cria um backup lógico (JSON compactado) guardado no banco
 *  - GET  /api/admin/backups        -> lista os backups;  GET /api/admin/backups/:nome -> download
 *    (Além disso, o Neon mantém o histórico para restauração a um ponto no tempo — ver README.)
 */
const zlib = require('zlib');
const path = require('path');
const express = require('express');
const { db } = require('../db');
const { HttpError } = require('../util');
const { exigirAdmin } = require('../auth');

const router = express.Router();
router.use(exigirAdmin);

const LANC = ['contas_receber_colaboradores', 'contas_pagar_colaboradores', 'contas_receber', 'contas_pagar'];
const CAD = ['categorias', 'clientes', 'fornecedores', 'colaboradores', 'centros_custo', 'contas_bancarias'];
// Tabelas incluídas no backup, na ordem de restauração (respeita as chaves estrangeiras)
const TABELAS_BACKUP = ['usuarios', 'configuracoes', 'categorias', 'clientes', 'fornecedores', 'colaboradores', 'formas_pagamento',
  'contas_bancarias', 'centros_custo', 'contas_receber', 'contas_pagar', 'contas_receber_colaboradores', 'contas_pagar_colaboradores', 'importacao_registros'];
const MAX_BACKUPS = 30;

const contar = async () => {
  const nomes = [...LANC, ...CAD, 'formas_pagamento', 'usuarios'];
  const linhas = await Promise.all(nomes.map(async (t) => [t, (await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).n]));
  return Object.fromEntries(linhas);
};

async function backup(prefixo = 'backup') {
  const dump = await db.transaction(async () => {
    await db.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'); // cópia consistente
    const tabelas = {};
    for (const t of TABELAS_BACKUP) tabelas[t] = await db.prepare(`SELECT * FROM ${t}`).all();
    return { sistema: 'openway-financeiro', formato: 2, gerado_em: new Date().toISOString(), tabelas };
  })();
  const buf = zlib.gzipSync(JSON.stringify(dump));
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const base = `${prefixo}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  let nome = `${base}.json.gz`;
  for (let i = 2; await db.prepare('SELECT 1 FROM backups WHERE nome = ?').get(nome); i++) nome = `${base}-${i}.json.gz`;
  await db.prepare('INSERT INTO backups (nome, conteudo) VALUES (?, ?)').run(nome, buf);
  // mantém apenas os mais recentes
  await db.prepare('DELETE FROM backups WHERE id NOT IN (SELECT id FROM backups ORDER BY criado_em DESC, id DESC LIMIT ?)').run(MAX_BACKUPS);
  return { nome, bytes: buf.length };
}

router.get('/estatisticas', async (req, res) => res.json(await contar()));

// ---------------- Backup ----------------
const NOME_OK = /^[\w.-]+\.json\.gz$/;
router.post('/backup', async (req, res) => {
  res.status(201).json(await backup('backup'));
});
router.get('/backups', async (req, res) => {
  const lista = await db.prepare('SELECT nome, octet_length(conteudo) AS bytes, criado_em AS data FROM backups ORDER BY criado_em DESC, id DESC').all();
  res.json({ pasta: 'Banco de dados (tabela backups)', backups: lista });
});
router.get('/backups/:nome', async (req, res) => {
  const nome = req.params.nome;
  const row = NOME_OK.test(nome) ? await db.prepare('SELECT conteudo FROM backups WHERE nome = ?').get(nome) : null;
  if (!row) throw new HttpError(404, 'Backup não encontrado.');
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(row.conteudo);
});

router.post('/zerar', async (req, res) => {
  const { modo, confirmacao } = req.body || {};
  if (!['lancamentos', 'tudo'].includes(modo)) throw new HttpError(400, 'Modo inválido.');
  if (confirmacao !== 'ZERAR') throw new HttpError(400, 'Digite ZERAR para confirmar.');
  const antes = await contar();
  const bk = await backup('antes-de-zerar');
  const tabelas = modo === 'tudo' ? [...LANC, ...CAD] : LANC;
  await db.transaction(async () => {
    for (const t of tabelas) await db.exec(`DELETE FROM ${t}`);
    await db.exec('DELETE FROM importacao_registros'); // a numeração recomeça: o controle de duplicidade da importação diária perde o sentido
    // Reinicia a numeração (Nº Documento volta a 1)
    for (const t of tabelas) {
      const pk = t === 'contas_receber' || t === 'contas_pagar' ? 'nro_documento' : 'id';
      await db.prepare('SELECT setval(pg_get_serial_sequence(?, ?), 1, false)').get(t, pk);
    }
  })();
  res.json({ ok: true, modo, backup: bk.nome, apagados: Object.fromEntries(tabelas.map((t) => [t, antes[t]])) });
});

// ---------------- Alerta diário por e-mail ----------------
const alerta = require('../alerta');
const semSenha = (c) => ({ ...c, smtp: { ...c.smtp, senha: '', temSenha: !!c.smtp.senha } });

router.get('/alerta', async (req, res) => res.json({ config: semSenha(await alerta.lerConfig()), estado: await alerta.estado() }));

router.put('/alerta', async (req, res) => {
  const atual = await alerta.lerConfig();
  const b = req.body || {};
  const s = b.smtp || {};
  const para = String(b.destinatarios || '').split(/[;,\s]+/).filter(Boolean);
  if (!para.length || para.some((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) throw new HttpError(400, 'Informe e-mails de destino válidos (separados por vírgula).');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.horario || '')) throw new HttpError(400, 'Horário inválido (use HH:MM).');
  const cfg = {
    ativo: !!b.ativo, destinatarios: para.join(', '), horario: b.horario,
    diasAFrente: Math.max(0, Math.min(30, Number(b.diasAFrente) || 0)),
    incluirAtrasados: !!b.incluirAtrasados, incluirReceber: !!b.incluirReceber,
    fimDeSemanaNaSexta: !!b.fimDeSemanaNaSexta, enviarSemVencimentos: !!b.enviarSemVencimentos,
    smtp: {
      host: String(s.host || '').trim(), porta: Number(s.porta) || 465,
      seguranca: ['ssl', 'starttls', 'nenhuma'].includes(s.seguranca) ? s.seguranca : 'ssl',
      usuario: String(s.usuario || '').trim(),
      senha: s.senha ? String(s.senha).replace(/\s+/g, '') : atual.smtp.senha, // vazio = mantém a atual
      remetente: String(s.remetente || '').trim(), remetenteNome: String(s.remetenteNome || 'Openway Financeiro').trim(),
      ignorarCertificado: !!s.ignorarCertificado,
    },
  };
  await alerta.salvarConfig(cfg);
  res.json({ config: semSenha(cfg), estado: await alerta.estado() });
});

router.get('/alerta/previa', async (req, res) => {
  const r = await alerta.montarResumo(await alerta.lerConfig(), req.query.data);
  res.json({ assunto: r.assunto, html: r.html });
});

router.post('/alerta/enviar', async (req, res, next) => {
  try { res.json(await alerta.enviarResumo({ forcar: true })); } catch (e) { next(new HttpError(400, 'Falha no envio: ' + e.message)); }
});

// ---------------- Agendamento: Netlify (função agendada) ou Windows (Agendador de Tarefas) ----------------
const NUVEM = !!(process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
const { execFile } = require('child_process');
const TAREFA = 'Openway Financeiro - Alerta diario';
const RAIZ = path.join(__dirname, '..', '..');
const ps = (args) => new Promise((ok) => execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', ...args],
  { windowsHide: true, timeout: 30000 }, (err, stdout, stderr) => ok({ ok: !err, saida: String(stdout || '').trim(), erro: String(stderr || (err && err.message) || '').trim() })));

router.get('/alerta/agendamento', async (req, res) => {
  if (NUVEM) return res.json({ suportado: true, nuvem: true, horario: (await alerta.lerConfig()).horario });
  if (process.platform !== 'win32') return res.json({ suportado: false });
  const r = await ps(['-Command', `$t = Get-ScheduledTask -TaskName '${TAREFA}' -ErrorAction SilentlyContinue; if ($t) { $i = $t | Get-ScheduledTaskInfo; ` +
    `'{0}|{1}|{2}|{3}' -f $t.State, $i.NextRunTime.ToString('dd/MM/yyyy HH:mm'), $(if ($i.LastRunTime.Year -gt 2000) { $i.LastRunTime.ToString('dd/MM/yyyy HH:mm') } else { '' }), $i.LastTaskResult }`]);
  if (!r.saida) return res.json({ suportado: true, agendado: false });
  const [estadoT, proxima, ultima, resultado] = r.saida.split('|');
  res.json({ suportado: true, agendado: true, estado: estadoT, proxima, ultima, resultado });
});

router.post('/alerta/agendamento', async (req, res) => {
  if (NUVEM) return res.json({ ok: true, mensagem: 'No Netlify o envio é automático: basta salvar o horário.' });
  if (process.platform !== 'win32') throw new HttpError(400, 'O agendamento automático só funciona com o sistema rodando no Windows.');
  const hora = (await alerta.lerConfig()).horario;
  const r = await ps(['-File', path.join(RAIZ, 'agendar-alerta.ps1'), '-Hora', hora]);
  if (!r.ok) throw new HttpError(400, 'Não foi possível agendar: ' + (r.erro || r.saida) + ' — tente executar agendar-alerta.bat como Administrador.');
  res.json({ ok: true, mensagem: r.saida });
});

router.delete('/alerta/agendamento', async (req, res) => {
  if (NUVEM) throw new HttpError(400, 'No Netlify o envio automático é controlado pela opção "Alerta ativo" nas configurações.');
  if (process.platform !== 'win32') throw new HttpError(400, 'Disponível apenas no Windows.');
  await ps(['-Command', `Unregister-ScheduledTask -TaskName '${TAREFA}' -Confirm:$false -ErrorAction SilentlyContinue`]);
  res.json({ ok: true });
});

module.exports = router;
