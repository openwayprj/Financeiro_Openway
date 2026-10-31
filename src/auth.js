'use strict';
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const { db } = require('./db');
const { HttpError, texto } = require('./util');

const COOKIE = 'ow_sessao';
const HORAS_SESSAO = 12;

// Proteção simples contra força bruta (em memória): 5 tentativas / 15 min por login+IP
const tentativas = new Map();
function checarBloqueio(chave) {
  const t = tentativas.get(chave);
  if (t && t.qtd >= 5 && Date.now() - t.inicio < 15 * 60 * 1000) {
    throw new HttpError(429, 'Muitas tentativas. Aguarde 15 minutos e tente novamente.');
  }
}
function registrarFalha(chave) {
  const t = tentativas.get(chave);
  if (!t || Date.now() - t.inicio > 15 * 60 * 1000) tentativas.set(chave, { qtd: 1, inicio: Date.now() });
  else t.qtd++;
}

async function criarSessao(req, res, usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + HORAS_SESSAO * 3600 * 1000);
  await db.prepare('INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?, ?, ?)').run(token, usuarioId, expira.toISOString());
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', expires: expira, path: '/', secure: !!req.secure });
}

function validarSenha(s) {
  if (typeof s !== 'string' || s.length < 6) throw new HttpError(400, 'A senha deve ter ao menos 6 caracteres.');
}

/** Middleware: exige sessão válida em /api/* (exceto rotas públicas de auth) */
async function exigirLogin(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return next(new HttpError(401, 'Sessão expirada. Faça login novamente.'));
  const s = await db.prepare(`SELECT s.token, s.expira_em, u.id, u.nome, u.login, u.perfil, u.ativo
                          FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.token = ?`).get(token);
  if (!s || !s.ativo || new Date(s.expira_em) < new Date()) {
    if (s) await db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
    return next(new HttpError(401, 'Sessão expirada. Faça login novamente.'));
  }
  req.usuario = { id: s.id, nome: s.nome, login: s.login, perfil: s.perfil };
  next();
}

function exigirAdmin(req, res, next) {
  if (!req.usuario || req.usuario.perfil !== 'ADMIN') return next(new HttpError(403, 'Acesso restrito a administradores.'));
  next();
}

const router = express.Router();

router.get('/status', async (req, res) => {
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM usuarios').get()).n;
  res.json({ precisaConfigurar: n === 0 });
});

// Criação do primeiro administrador (só funciona com o banco sem usuários)
router.post('/setup', async (req, res) => {
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM usuarios').get()).n;
  if (n > 0) throw new HttpError(409, 'O sistema já foi configurado.');
  const nome = texto(req.body.nome), login = texto(req.body.login);
  if (!nome || !login) throw new HttpError(400, 'Informe nome e login.');
  validarSenha(req.body.senha);
  const r = await db.prepare('INSERT INTO usuarios (nome, login, senha_hash, perfil) VALUES (?, ?, ?, ?)')
    .run(nome, login, bcrypt.hashSync(req.body.senha, 10), 'ADMIN');
  await criarSessao(req, res, r.lastInsertRowid);
  res.status(201).json({ ok: true });
});

router.post('/login', async (req, res) => {
  const login = texto(req.body.login);
  const chave = `${login}|${req.ip}`;
  checarBloqueio(chave);
  const u = login && await db.prepare('SELECT * FROM usuarios WHERE login = ?').get(login);
  if (!u || !u.ativo || !bcrypt.compareSync(String(req.body.senha || ''), u.senha_hash)) {
    registrarFalha(chave);
    throw new HttpError(401, 'Login ou senha inválidos.');
  }
  tentativas.delete(chave);
  await db.prepare('DELETE FROM sessoes WHERE expira_em < ?').run(new Date().toISOString());
  await criarSessao(req, res, u.id);
  res.json({ id: u.id, nome: u.nome, login: u.login, perfil: u.perfil });
});

router.post('/logout', async (req, res) => {
  const token = req.cookies && req.cookies[COOKIE];
  if (token) await db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

router.get('/me', exigirLogin, (req, res) => res.json(req.usuario));

router.post('/senha', exigirLogin, async (req, res) => {
  const u = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!bcrypt.compareSync(String(req.body.senhaAtual || ''), u.senha_hash)) throw new HttpError(400, 'Senha atual incorreta.');
  validarSenha(req.body.novaSenha);
  await db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(bcrypt.hashSync(req.body.novaSenha, 10), u.id);
  res.json({ ok: true });
});

// ---------------- Gestão de usuários (ADMIN) ----------------
const usuarios = express.Router();
usuarios.use(exigirAdmin);

usuarios.get('/', async (req, res) => {
  res.json(await db.prepare('SELECT id, nome, login, perfil, ativo, criado_em FROM usuarios ORDER BY nome').all());
});

usuarios.post('/', async (req, res) => {
  const nome = texto(req.body.nome), login = texto(req.body.login);
  const perfil = req.body.perfil === 'OPERADOR' ? 'OPERADOR' : 'ADMIN';
  if (!nome || !login) throw new HttpError(400, 'Informe nome e login.');
  validarSenha(req.body.senha);
  if (await db.prepare('SELECT 1 FROM usuarios WHERE login = ?').get(login)) throw new HttpError(409, 'Já existe um usuário com este login.');
  const r = await db.prepare('INSERT INTO usuarios (nome, login, senha_hash, perfil, ativo) VALUES (?, ?, ?, ?, ?)')
    .run(nome, login, bcrypt.hashSync(req.body.senha, 10), perfil, req.body.ativo === false || req.body.ativo === 0 ? 0 : 1);
  res.status(201).json({ id: r.lastInsertRowid });
});

usuarios.put('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const u = await db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
  if (!u) throw new HttpError(404, 'Usuário não encontrado.');
  const nome = texto(req.body.nome), login = texto(req.body.login);
  if (!nome || !login) throw new HttpError(400, 'Informe nome e login.');
  const perfil = req.body.perfil === 'OPERADOR' ? 'OPERADOR' : 'ADMIN';
  const ativo = req.body.ativo === false || req.body.ativo === 0 || req.body.ativo === '0' ? 0 : 1;
  if (id === req.usuario.id && (ativo === 0 || perfil !== 'ADMIN')) throw new HttpError(400, 'Você não pode desativar ou rebaixar o seu próprio usuário.');
  if (await db.prepare('SELECT 1 FROM usuarios WHERE login = ? AND id <> ?').get(login, id)) throw new HttpError(409, 'Já existe um usuário com este login.');
  await db.prepare('UPDATE usuarios SET nome = ?, login = ?, perfil = ?, ativo = ? WHERE id = ?').run(nome, login, perfil, ativo, id);
  if (req.body.senha) {
    validarSenha(req.body.senha);
    await db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(bcrypt.hashSync(req.body.senha, 10), id);
  }
  if (!ativo) await db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(id);
  res.json({ ok: true });
});

usuarios.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.usuario.id) throw new HttpError(400, 'Você não pode excluir o seu próprio usuário.');
  const r = await db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
  if (!r.changes) throw new HttpError(404, 'Usuário não encontrado.');
  res.json({ ok: true });
});

module.exports = { router, usuarios, exigirLogin, exigirAdmin };
