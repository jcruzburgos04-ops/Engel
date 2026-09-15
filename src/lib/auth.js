'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { noAutorizado, prohibido } = require('./errores');

const COOKIE = 'engel_sesion';

function firmarToken(usuario) {
  return jwt.sign({ sub: usuario.id, rol: usuario.rol }, config.sessionSecret, {
    expiresIn: Math.floor(config.sessionMaxAgeMs / 1000)
  });
}

function guardarSesion(res, usuario) {
  res.cookie(COOKIE, firmarToken(usuario), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    maxAge: config.sessionMaxAgeMs
  });
}

function borrarSesion(res) {
  res.clearCookie(COOKIE, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies
  });
}

const buscarUsuario = db.prepare(
  'SELECT id, nombre, email, rol, activo FROM usuarios WHERE id = ?'
);

// Deja el usuario en req.usuario si la cookie es valida. Nunca corta el flujo.
function cargarUsuario(req, _res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.sessionSecret);
    const usuario = buscarUsuario.get(payload.sub);
    if (usuario && usuario.activo) req.usuario = usuario;
  } catch {
    // Token vencido o adulterado: sigue como visitante.
  }
  return next();
}

function requiereSesion(req, _res, next) {
  if (!req.usuario) return next(noAutorizado());
  return next();
}

function requiereAdmin(req, _res, next) {
  if (!req.usuario) return next(noAutorizado());
  if (req.usuario.rol !== 'admin') return next(prohibido());
  return next();
}

module.exports = { COOKIE, guardarSesion, borrarSesion, cargarUsuario, requiereSesion, requiereAdmin };
