'use strict';

const fs = require('fs');
const express = require('express');
const archiver = require('archiver');

const db = require('../db');
const config = require('../config');
const consultas = require('../lib/consultas');
const { etiquetaDocumento } = require('../lib/documentos');
const { normalizarDominio } = require('../lib/dominio');
const { requiereSesion, requiereAdmin } = require('../lib/auth');
const { rutaAbsoluta } = require('../lib/almacenamiento');
const { asyncHandler, badRequest, noEncontrado } = require('../lib/errores');

const router = express.Router();

router.use(requiereSesion);

function celdaCsv(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor).replace(/"/g, '""');
  return /[";\n\r]/.test(texto) ? `"${texto}"` : texto;
}

function aCsv(encabezados, filas) {
  const lineas = [encabezados.map(celdaCsv).join(';')];
  for (const fila of filas) lineas.push(fila.map(celdaCsv).join(';'));
  // BOM para que Excel abra bien los acentos.
  return '﻿' + lineas.join('\r\n');
}

const ETIQUETA_ESTADO = {
  pendiente: 'Pendiente',
  en_preparacion: 'En preparacion',
  listo_entrega: 'Listo para entrega',
  entregado: 'Entregado',
  cancelado: 'Cancelado'
};

// Planilla de ventas, con las mismas condiciones de filtro que el listado.
router.get(
  '/ventas.csv',
  asyncHandler((req, res) => {
    const ventas = consultas.listarVentasCompleto(req.query);

    const permutasPorVenta = new Map();
    for (const fila of db
      .prepare(
        `SELECT p.venta_id, ve.dominio, ve.marca, ve.modelo, ve.anio, p.valor_tomado, p.moneda
         FROM permutas p JOIN vehiculos ve ON ve.id = p.vehiculo_id
         ORDER BY p.id`
      )
      .all()) {
      const lista = permutasPorVenta.get(fila.venta_id) || [];
      const detalle = [fila.dominio, [fila.marca, fila.modelo, fila.anio].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(' - ');
      const valor = fila.valor_tomado ? ` (${fila.moneda} ${fila.valor_tomado})` : '';
      lista.push(detalle + valor);
      permutasPorVenta.set(fila.venta_id, lista);
    }

    const encabezados = [
      'Venta', 'Fecha', 'Vendedor', 'Estado', 'Dominio', 'Marca', 'Modelo', 'Version', 'Anio',
      'Color', 'Kilometraje', 'Tenencia', 'Consignante', 'Descripcion', 'Cliente', 'Telefono',
      'Precio', 'Moneda', 'Forma de pago', 'Permutas', 'Entrega estimada', 'Entrega real',
      'Documentacion', 'Detalles'
    ];

    const filas = ventas.map((v) => [
      v.id,
      v.fecha_venta,
      v.vendedor_nombre,
      ETIQUETA_ESTADO[v.estado] || v.estado,
      v.dominio,
      v.marca,
      v.modelo,
      v.version,
      v.anio,
      v.color,
      v.kilometraje,
      v.tenencia === 'consigna' ? 'Consigna' : 'Propio',
      v.consignante_nombre,
      v.descripcion,
      v.cliente_nombre,
      v.cliente_telefono,
      v.precio_venta,
      v.moneda,
      v.forma_pago,
      (permutasPorVenta.get(v.id) || []).join(' | '),
      v.fecha_entrega_estimada || '',
      v.fecha_entrega_real || '',
      `${v.documentos_listos}/${v.documentos_total}`,
      v.detalles
    ]);

    const nombre = `ventas-engel-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(aCsv(encabezados, filas));
  })
);

// Detalle de documentacion de todas las operaciones activas.
router.get(
  '/documentacion.csv',
  asyncHandler((req, res) => {
    const filas = db
      .prepare(
        `SELECT d.venta_id, ve.dominio, d.rol, d.tipo, d.estado, d.observaciones, d.actualizado_en,
                v.fecha_entrega_estimada, u.nombre AS vendedor,
                (SELECT COUNT(*) FROM archivos a WHERE a.documento_id = d.id) AS archivos
         FROM documentos d
         JOIN vehiculos ve ON ve.id = d.vehiculo_id
         JOIN ventas v ON v.id = d.venta_id
         JOIN usuarios u ON u.id = v.vendedor_id
         ORDER BY d.venta_id DESC, ve.dominio, d.id`
      )
      .all();

    const csv = aCsv(
      ['Venta', 'Dominio', 'Rol', 'Documento', 'Estado', 'Archivos', 'Observaciones', 'Entrega estimada', 'Vendedor', 'Actualizado'],
      filas.map((f) => [
        f.venta_id,
        f.dominio,
        f.rol === 'permuta' ? 'Permuta' : 'Venta',
        etiquetaDocumento(f.tipo),
        f.estado,
        f.archivos,
        f.observaciones,
        f.fecha_entrega_estimada || '',
        f.vendedor,
        f.actualizado_en
      ])
    );

    const nombre = `documentacion-engel-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(csv);
  })
);

// Toda la documentacion de un dominio en un ZIP.
router.get(
  '/dominio/:dominio/documentacion.zip',
  asyncHandler((req, res) => {
    const dominio = normalizarDominio(req.params.dominio);
    if (!dominio) throw badRequest('Ingresa un dominio.');

    const vehiculo = db.prepare('SELECT * FROM vehiculos WHERE dominio = ?').get(dominio);
    if (!vehiculo) throw noEncontrado(`No hay ningun auto cargado con el dominio ${dominio}.`);

    const archivos = db
      .prepare(
        `SELECT a.nombre_archivo, a.nombre_original, d.tipo, d.venta_id, d.rol
         FROM archivos a
         JOIN documentos d ON d.id = a.documento_id
         WHERE d.vehiculo_id = ?
         ORDER BY d.venta_id, d.tipo, a.id`
      )
      .all(vehiculo.id);

    if (!archivos.length) {
      throw noEncontrado(`El dominio ${dominio} todavia no tiene documentacion cargada.`);
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="documentacion-${dominio}.zip"`);

    const zip = archiver('zip', { zlib: { level: 9 } });
    zip.on('warning', (err) => console.warn('[engel] zip:', err.message));
    zip.on('error', (err) => {
      console.error('[engel] error armando el zip:', err.message);
      res.destroy(err);
    });
    zip.pipe(res);

    const usados = new Set();
    for (const archivo of archivos) {
      const ruta = rutaAbsoluta(archivo.nombre_archivo);
      if (!fs.existsSync(ruta)) continue;

      const carpeta = `venta-${archivo.venta_id}/${etiquetaDocumento(archivo.tipo)}`;
      let nombre = `${carpeta}/${archivo.nombre_original}`;
      let sufijo = 2;
      while (usados.has(nombre)) {
        nombre = `${carpeta}/(${sufijo++}) ${archivo.nombre_original}`;
      }
      usados.add(nombre);
      zip.file(ruta, { name: nombre });
    }

    zip.finalize();
  })
);

// Copia de seguridad de la base completa (solo administradores).
router.get(
  '/backup.db',
  requiereAdmin,
  asyncHandler(async (req, res) => {
    const destino = `${config.dbPath}.backup-${Date.now()}`;
    await db.backup(destino);
    const nombre = `engel-backup-${new Date().toISOString().slice(0, 10)}.db`;
    res.download(destino, nombre, () => fs.unlink(destino, () => {}));
  })
);

module.exports = router;
