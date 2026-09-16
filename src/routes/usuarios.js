'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');

const db = require('../db');
const auditoria = require('../lib/auditoria');
const { requiereSesion, requiereAdmin } = require('../lib/auth');
const { asyncHandler, badRequest, conflicto, noEncontrado } = require('../lib/errores');
const v = require('../lib/validacion');

const router = express.Router();

router.get(
  '/',
  requiereSesion,
  asyncHandler((req, res) => {
    const incluirInactivos = req.query.inactivos === 'true';
    const usuarios = db
      .prepare(
        `SELECT u.id, u.nombre, u.email, u.rol, u.activo, u.creado_en
         FROM usuarios u
         WHERE (@todos = 1 OR u.activo = 1)
         ORDER BY u.activo DESC, u.nombre`
      )
      .all({ todos: incluirInactivos ? 1 : 0 });
    res.json({ usuarios });
  })
);

router.post(
  '/',
  requiereAdmin,
  asyncHandler((req, res) => {
    const nombre = v.textoRequerido(req.body.nombre, 'nombre', 120);
    const email = v.emailOpcional(req.body.email, 'email');
    if (!email) throw badRequest('El email es obligatorio.');
    const password = String(req.body.password || '');
    if (password.length < 8) throw badRequest('La contrasena tiene que tener al menos 8 caracteres.');
    const rol = v.unoDe(req.body.rol, ['admin', 'vendedor'], 'rol', 'vendedor');

    const existente = db.prepare('SELECT id FROM usuarios WHERE email = ? COLLATE NOCASE').get(email);
    if (existente) throw conflicto('Ya existe un usuario con ese email.');

    const info = db.transaction(() => {
      const resultado = db
        .prepare(
          `INSERT INTO usuarios (nombre, email, password_hash, rol, activo, password_provisoria)
           VALUES (?, ?, ?, ?, 1, 1)`
        )
        .run(nombre, email, bcrypt.hashSync(password, 10), rol);
      auditoria.registrar({
        entidad: 'usuario',
        entidadId: Number(resultado.lastInsertRowid),
        accion: 'crear',
        resumen: `Alta de ${nombre} (${email}) como ${rol}`,
        despues: { nombre, email, rol },
        usuario: req.usuario
      });
      return resultado;
    })();

    res.status(201).json({
      usuario: db
        .prepare('SELECT id, nombre, email, rol, activo, creado_en FROM usuarios WHERE id = ?')
        .get(info.lastInsertRowid)
    });
  })
);

router.patch(
  '/:id',
  requiereAdmin,
  asyncHandler((req, res) => {
    const id = v.idRequerido(req.params.id, 'usuario');
    const usuario = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!usuario) throw noEncontrado('No se encontro el usuario.');

    const cambios = {};
    if (req.body.nombre !== undefined) cambios.nombre = v.textoRequerido(req.body.nombre, 'nombre', 120);
    if (req.body.rol !== undefined) cambios.rol = v.unoDe(req.body.rol, ['admin', 'vendedor'], 'rol');
    if (req.body.activo !== undefined) cambios.activo = req.body.activo ? 1 : 0;
    if (req.body.password) {
      const password = String(req.body.password);
      if (password.length < 8) throw badRequest('La contrasena tiene que tener al menos 8 caracteres.');
      cambios.password_hash = bcrypt.hashSync(password, 10);
      // La puso un administrador: la persona tiene que cambiarla al entrar.
      cambios.password_provisoria = 1;
    }

    // Siempre tiene que quedar al menos un administrador activo.
    const quedaSinAdmin =
      (cambios.rol === 'vendedor' || cambios.activo === 0) && usuario.rol === 'admin';
    if (quedaSinAdmin) {
      const otros = db
        .prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1 AND id != ?")
        .get(id).n;
      if (otros === 0) throw badRequest('Tiene que quedar al menos un administrador activo.');
    }

    const campos = Object.keys(cambios);
    if (!campos.length) throw badRequest('No hay cambios para guardar.');

    db.transaction(() => {
      db.prepare(
        `UPDATE usuarios SET ${campos.map((c) => `${c} = @${c}`).join(', ')} WHERE id = @id`
      ).run({ ...cambios, id });

      const visibles = { ...cambios };
      if (visibles.password_hash) visibles.password_hash = '(contrasena nueva)';
      const detalle = auditoria.describirCambios(usuario, visibles, {
        nombre: 'nombre', rol: 'rol', activo: 'activo', password_hash: 'contrasena'
      });
      auditoria.registrar({
        entidad: 'usuario',
        entidadId: id,
        accion: 'editar',
        resumen: `${usuario.nombre} — ${detalle}`,
        antes: { nombre: usuario.nombre, rol: usuario.rol, activo: usuario.activo },
        despues: visibles,
        usuario: req.usuario
      });
    })();

    res.json({
      usuario: db
        .prepare('SELECT id, nombre, email, rol, activo, creado_en FROM usuarios WHERE id = ?')
        .get(id)
    });
  })
);

module.exports = router;
