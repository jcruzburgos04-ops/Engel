'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const db = require('../db');
const { guardarSesion, borrarSesion, requiereSesion } = require('../lib/auth');
const { asyncHandler, badRequest, noAutorizado } = require('../lib/errores');
const { limitador } = require('../lib/limites');

const router = express.Router();

const limiteLogin = limitador({
  intentos: 10,
  ventanaMs: 10 * 60 * 1000,
  mensaje: 'Demasiados intentos de ingreso. Esperá unos minutos y volvé a probar.'
});

router.post(
  '/login',
  limiteLogin,
  asyncHandler((req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) throw badRequest('Ingresa tu email y tu contrasena.');

    const usuario = db
      .prepare('SELECT * FROM usuarios WHERE email = ? COLLATE NOCASE')
      .get(email);

    // Se compara igual contra un hash ficticio para no delatar si el email existe.
    const hash = usuario ? usuario.password_hash : '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi';
    const coincide = bcrypt.compareSync(password, hash);

    if (!usuario || !coincide) throw noAutorizado('Email o contrasena incorrectos.');
    if (!usuario.activo) throw noAutorizado('Tu usuario esta dado de baja. Hablalo con un administrador.');

    limiteLogin.reiniciar(req);
    guardarSesion(res, usuario);
    res.json({
      usuario: { id: usuario.id, nombre: usuario.nombre, email: usuario.email, rol: usuario.rol }
    });
  })
);

router.post('/logout', (_req, res) => {
  borrarSesion(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  res.json({ usuario: req.usuario || null });
});

router.post(
  '/password',
  requiereSesion,
  asyncHandler((req, res) => {
    const actual = String(req.body.password_actual || '');
    const nueva = String(req.body.password_nueva || '');
    if (nueva.length < 8) throw badRequest('La contrasena nueva tiene que tener al menos 8 caracteres.');

    const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
    if (!bcrypt.compareSync(actual, usuario.password_hash)) {
      throw badRequest('La contrasena actual no es correcta.');
    }

    db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(
      bcrypt.hashSync(nueva, 10),
      usuario.id
    );
    res.json({ ok: true });
  })
);

module.exports = router;
