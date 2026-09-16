'use strict';

const express = require('express');

const db = require('../db');
const auditoria = require('../lib/auditoria');
const consultas = require('../lib/consultas');
const { ESTADOS_DOCUMENTO, TIPOS_DOCUMENTO, etiquetaDocumento } = require('../lib/documentos');
const { requiereSesion, requiereAdmin } = require('../lib/auth');
const { subida, rutaAbsoluta, borrarArchivo, nombreRelativo } = require('../lib/almacenamiento');
const { asyncHandler, badRequest, noEncontrado } = require('../lib/errores');
const v = require('../lib/validacion');

const router = express.Router();

router.use(requiereSesion);

router.get('/tipos', (_req, res) => {
  res.json({ tipos: TIPOS_DOCUMENTO, estados: ESTADOS_DOCUMENTO });
});

// Panel con los autos que todavia tienen documentacion por completar.
router.get(
  '/panel',
  asyncHandler((req, res) => {
    const soloPendientes = req.query.todos !== 'true';
    res.json({ filas: consultas.panelDocumentacion({ soloPendientes, q: req.query.q || '' }) });
  })
);

const buscarDocumento = db.prepare('SELECT * FROM documentos WHERE id = ?');

router.patch(
  '/:id',
  asyncHandler((req, res) => {
    const id = v.idRequerido(req.params.id, 'documento');
    const documento = buscarDocumento.get(id);
    if (!documento) throw noEncontrado('No se encontro el item de documentacion.');

    const cambios = {};
    if (req.body.estado !== undefined) {
      cambios.estado = v.unoDe(req.body.estado, ESTADOS_DOCUMENTO, 'estado');
    }
    if (req.body.observaciones !== undefined) {
      cambios.observaciones = v.textoOpcional(req.body.observaciones, 500);
    }

    const campos = Object.keys(cambios);
    if (!campos.length) throw badRequest('No hay cambios para guardar.');

    const vehiculo = db.prepare('SELECT dominio FROM vehiculos WHERE id = ?').get(documento.vehiculo_id);

    db.transaction(() => {
      db.prepare(
        `UPDATE documentos SET ${campos.map((c) => `${c} = @${c}`).join(', ')},
           actualizado_en = datetime('now'), actualizado_por = @usuario
         WHERE id = @id`
      ).run({ ...cambios, id, usuario: req.usuario.id });

      const detalle = auditoria.describirCambios(documento, cambios, {
        estado: 'estado',
        observaciones: 'observaciones'
      });
      auditoria.registrar({
        entidad: 'documento',
        entidadId: id,
        ventaId: documento.venta_id,
        accion: 'editar',
        resumen: `${etiquetaDocumento(documento.tipo)} de ${vehiculo.dominio} — ${detalle}`,
        antes: { estado: documento.estado, observaciones: documento.observaciones },
        despues: cambios,
        usuario: req.usuario
      });
    })();

    res.json({ documentacion: consultas.documentosDeVenta(documento.venta_id) });
  })
);

// Carga de uno o varios archivos para un item del checklist.
router.post(
  '/:id/archivos',
  subida.array('archivos', 10),
  asyncHandler((req, res) => {
    const id = v.idRequerido(req.params.id, 'documento');
    const documento = buscarDocumento.get(id);

    if (!documento) {
      for (const archivo of req.files || []) borrarArchivo(nombreRelativo(archivo));
      throw noEncontrado('No se encontro el item de documentacion.');
    }
    if (!req.files || !req.files.length) throw badRequest('No se recibio ningun archivo.');

    const insertar = db.prepare(`
      INSERT INTO archivos (documento_id, nombre_original, nombre_archivo, mime, tamano, subido_por)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const vehiculo = db.prepare('SELECT dominio FROM vehiculos WHERE id = ?').get(documento.vehiculo_id);

    db.transaction(() => {
      const cargados = [];
      for (const archivo of req.files) {
        const nombre = archivo.originalname.slice(0, 200);
        insertar.run(id, nombre, nombreRelativo(archivo), archivo.mimetype, archivo.size, req.usuario.id);
        cargados.push({ nombre, tamano: archivo.size });
      }
      // Al subir documentacion el item pasa a estado "ok" si seguia pendiente.
      if (documento.estado === 'pendiente') {
        db.prepare(
          `UPDATE documentos SET estado = 'ok', actualizado_en = datetime('now'), actualizado_por = ?
           WHERE id = ?`
        ).run(req.usuario.id, id);
      }

      auditoria.registrar({
        entidad: 'archivo',
        entidadId: id,
        ventaId: documento.venta_id,
        accion: 'crear',
        resumen: `Subio ${cargados.length} archivo(s) a ${etiquetaDocumento(documento.tipo)} de ${vehiculo.dominio}: ${cargados.map((a) => a.nombre).join(', ')}`,
        despues: cargados,
        usuario: req.usuario
      });
    })();

    res.status(201).json({ documentacion: consultas.documentosDeVenta(documento.venta_id) });
  })
);

router.get(
  '/archivos/:archivoId',
  asyncHandler((req, res) => {
    const archivoId = v.idRequerido(req.params.archivoId, 'archivo');
    const archivo = db.prepare('SELECT * FROM archivos WHERE id = ?').get(archivoId);
    if (!archivo) throw noEncontrado('No se encontro el archivo.');

    res.download(rutaAbsoluta(archivo.nombre_archivo), archivo.nombre_original);
  })
);

router.delete(
  '/archivos/:archivoId',
  asyncHandler((req, res) => {
    const archivoId = v.idRequerido(req.params.archivoId, 'archivo');
    const archivo = db.prepare('SELECT * FROM archivos WHERE id = ?').get(archivoId);
    if (!archivo) throw noEncontrado('No se encontro el archivo.');

    if (archivo.subido_por !== req.usuario.id && req.usuario.rol !== 'admin') {
      throw badRequest('Solo podes borrar los archivos que subiste vos.');
    }

    const documento = buscarDocumento.get(archivo.documento_id);
    db.transaction(() => {
      db.prepare('DELETE FROM archivos WHERE id = ?').run(archivoId);
      auditoria.registrar({
        entidad: 'archivo',
        entidadId: archivoId,
        ventaId: documento.venta_id,
        accion: 'borrar',
        resumen: `Borro el archivo "${archivo.nombre_original}" de ${etiquetaDocumento(documento.tipo)}`,
        antes: archivo,
        usuario: req.usuario
      });
    })();
    borrarArchivo(archivo.nombre_archivo);

    res.json({ documentacion: consultas.documentosDeVenta(documento.venta_id) });
  })
);

module.exports = router;
