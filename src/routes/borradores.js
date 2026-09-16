'use strict';

const express = require('express');

const db = require('../db');
const { requiereSesion } = require('../lib/auth');
const { asyncHandler, badRequest } = require('../lib/errores');

const router = express.Router();

router.use(requiereSesion);

// Un borrador es un formulario a medio completar. Se guarda solo mientras la
// persona escribe, asi no se pierde nada si cierra el navegador sin guardar.
// Cada usuario ve unicamente sus propios borradores.

const MAX_CONTENIDO = 200 * 1024;

function limpiarClave(valor) {
  const clave = String(valor || '').trim();
  if (!clave || clave.length > 120 || !/^[a-zA-Z0-9:_-]+$/.test(clave)) {
    throw badRequest('Clave de borrador invalida.');
  }
  return clave;
}

router.get(
  '/',
  asyncHandler((req, res) => {
    const borradores = db
      .prepare(
        'SELECT clave, contenido, actualizado_en FROM borradores WHERE usuario_id = ? ORDER BY actualizado_en DESC'
      )
      .all(req.usuario.id);
    res.json({ borradores });
  })
);

router.get(
  '/:clave',
  asyncHandler((req, res) => {
    const clave = limpiarClave(req.params.clave);
    const borrador = db
      .prepare('SELECT clave, contenido, actualizado_en FROM borradores WHERE usuario_id = ? AND clave = ?')
      .get(req.usuario.id, clave);
    res.json({ borrador: borrador || null });
  })
);

// PUT desde la web, POST desde navigator.sendBeacon al cerrar la pestana.
router.put(['/:clave'], guardarBorrador());
router.post(['/:clave'], guardarBorrador());

function guardarBorrador() {
  return asyncHandler((req, res) => {
    const clave = limpiarClave(req.params.clave);
    const contenido = JSON.stringify(req.body && req.body.contenido !== undefined ? req.body.contenido : req.body);

    if (contenido.length > MAX_CONTENIDO) {
      throw badRequest('El borrador es demasiado grande para guardarse.');
    }

    db.prepare(
      `INSERT INTO borradores (usuario_id, clave, contenido)
       VALUES (@usuario_id, @clave, @contenido)
       ON CONFLICT (usuario_id, clave)
       DO UPDATE SET contenido = @contenido,
                     actualizado_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`
    ).run({ usuario_id: req.usuario.id, clave, contenido });

    const guardado = db
      .prepare('SELECT actualizado_en FROM borradores WHERE usuario_id = ? AND clave = ?')
      .get(req.usuario.id, clave);

    res.json({ ok: true, actualizado_en: guardado.actualizado_en });
  });
}

router.delete(
  '/:clave',
  asyncHandler((req, res) => {
    const clave = limpiarClave(req.params.clave);
    db.prepare('DELETE FROM borradores WHERE usuario_id = ? AND clave = ?').run(req.usuario.id, clave);
    res.json({ ok: true });
  })
);

module.exports = router;
