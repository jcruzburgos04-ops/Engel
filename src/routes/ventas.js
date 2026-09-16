'use strict';

const express = require('express');

const db = require('../db');
const auditoria = require('../lib/auditoria');
const consultas = require('../lib/consultas');
const ventasRepo = require('../lib/ventas');
const { requiereSesion, requiereAdmin } = require('../lib/auth');
const { borrarArchivos } = require('../lib/almacenamiento');
const { asyncHandler, badRequest, noEncontrado } = require('../lib/errores');
const v = require('../lib/validacion');

const router = express.Router();

router.use(requiereSesion);

router.get(
  '/',
  asyncHandler((req, res) => {
    res.json(consultas.listarVentas(req.query));
  })
);

router.post(
  '/',
  asyncHandler((req, res) => {
    const id = ventasRepo.crear(req.body, req.usuario);
    res.status(201).json({ venta: consultas.obtenerVenta(id) });
  })
);

router.get(
  '/:id',
  asyncHandler((req, res) => {
    const id = v.idRequerido(req.params.id, 'venta');
    res.json({ venta: consultas.obtenerVenta(id) });
  })
);

router.patch(
  '/:id',
  asyncHandler((req, res) => {
    const id = v.idRequerido(req.params.id, 'venta');
    ventasRepo.actualizar(id, req.body, req.usuario, req.get('x-origen-cambio') || '');
    res.json({ venta: consultas.obtenerVenta(id) });
  })
);

router.delete(
  '/:id',
  requiereAdmin,
  asyncHandler((req, res) => {
    const id = v.idRequerido(req.params.id, 'venta');
    const archivos = ventasRepo.eliminar(id, req.usuario);
    borrarArchivos(archivos);
    res.json({ ok: true });
  })
);

// --- Permutas vinculadas a la venta ---------------------------------------

router.post(
  '/:id/permutas',
  asyncHandler((req, res) => {
    const id = v.idRequerido(req.params.id, 'venta');
    ventasRepo.agregarPermuta(id, req.body, req.usuario);
    res.status(201).json({ venta: consultas.obtenerVenta(id) });
  })
);

router.delete(
  '/:id/permutas/:permutaId',
  asyncHandler((req, res) => {
    const id = v.idRequerido(req.params.id, 'venta');
    const permutaId = v.idRequerido(req.params.permutaId, 'permuta');

    const permuta = db.prepare('SELECT venta_id FROM permutas WHERE id = ?').get(permutaId);
    if (!permuta || permuta.venta_id !== id) throw noEncontrado('No se encontro la permuta.');

    const archivos = ventasRepo.quitarPermuta(permutaId, req.usuario);
    borrarArchivos(archivos);
    res.json({ venta: consultas.obtenerVenta(id) });
  })
);

// --- Detalles extras de la operacion --------------------------------------

router.post(
  '/:id/notas',
  asyncHandler((req, res) => {
    const id = v.idRequerido(req.params.id, 'venta');
    const texto = v.textoRequerido(req.body.texto, 'nota', 2000);

    const venta = db.prepare('SELECT id FROM ventas WHERE id = ?').get(id);
    if (!venta) throw noEncontrado('No se encontro la venta.');

    db.transaction(() => {
      const info = db
        .prepare('INSERT INTO notas (venta_id, usuario_id, texto) VALUES (?, ?, ?)')
        .run(id, req.usuario.id, texto);
      auditoria.registrar({
        entidad: 'nota',
        entidadId: Number(info.lastInsertRowid),
        ventaId: id,
        accion: 'crear',
        resumen: `Agrego un detalle: ${texto.slice(0, 160)}`,
        despues: { texto },
        usuario: req.usuario
      });
    })();
    res.status(201).json({ venta: consultas.obtenerVenta(id) });
  })
);

router.delete(
  '/:id/notas/:notaId',
  asyncHandler((req, res) => {
    const id = v.idRequerido(req.params.id, 'venta');
    const notaId = v.idRequerido(req.params.notaId, 'nota');

    const nota = db.prepare('SELECT * FROM notas WHERE id = ?').get(notaId);
    if (!nota || nota.venta_id !== id) throw noEncontrado('No se encontro la nota.');
    if (nota.usuario_id !== req.usuario.id && req.usuario.rol !== 'admin') {
      throw badRequest('Solo podes borrar tus propias notas.');
    }

    db.transaction(() => {
      db.prepare('DELETE FROM notas WHERE id = ?').run(notaId);
      auditoria.registrar({
        entidad: 'nota',
        entidadId: notaId,
        ventaId: id,
        accion: 'borrar',
        resumen: `Borro un detalle: ${nota.texto.slice(0, 160)}`,
        antes: nota,
        usuario: req.usuario
      });
    })();
    res.json({ venta: consultas.obtenerVenta(id) });
  })
);

// --- Historial de la operacion -------------------------------------------

router.get(
  '/:id/historial',
  asyncHandler((req, res) => {
    const id = v.idRequerido(req.params.id, 'venta');
    res.json({ historial: auditoria.historialDeVenta(id) });
  })
);

module.exports = router;
