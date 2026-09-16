'use strict';

const db = require('../db');
const { normalizarDominio } = require('./dominio');
const { etiquetaDocumento, TIPOS_DOCUMENTO } = require('./documentos');
const { noEncontrado } = require('./errores');

const SELECT_VENTA_LISTA = `
  SELECT v.id, v.fecha_venta, v.estado, v.precio_venta, v.moneda, v.forma_pago,
         v.cliente_nombre, v.cliente_telefono, v.fecha_entrega_estimada, v.fecha_entrega_real,
         v.detalles, v.creado_en,
         u.id AS vendedor_id, u.nombre AS vendedor_nombre,
         ve.id AS vehiculo_id, ve.dominio, ve.marca, ve.modelo, ve.version, ve.anio,
         ve.color, ve.kilometraje, ve.tenencia, ve.consignante_nombre, ve.descripcion,
         (SELECT COUNT(*) FROM permutas p WHERE p.venta_id = v.id) AS cantidad_permutas,
         (SELECT COUNT(*) FROM documentos d WHERE d.venta_id = v.id) AS documentos_total,
         (SELECT COUNT(*) FROM documentos d
            WHERE d.venta_id = v.id AND d.estado IN ('ok', 'no_aplica')) AS documentos_listos
  FROM ventas v
  JOIN usuarios u ON u.id = v.vendedor_id
  JOIN vehiculos ve ON ve.id = v.vehiculo_id
`;

function armarFiltros({ q, estado, vendedor_id, tenencia, desde, hasta, entrega_vencida }) {
  const condiciones = [];
  const parametros = {};

  if (q && String(q).trim()) {
    const texto = String(q).trim();
    condiciones.push(`(
      UPPER(ve.dominio) LIKE UPPER(@q_dominio)
      OR UPPER(ve.marca) LIKE UPPER(@q)
      OR UPPER(ve.modelo) LIKE UPPER(@q)
      OR UPPER(ve.descripcion) LIKE UPPER(@q)
      OR UPPER(v.cliente_nombre) LIKE UPPER(@q)
      OR UPPER(v.cliente_documento) LIKE UPPER(@q)
      OR UPPER(u.nombre) LIKE UPPER(@q)
      OR EXISTS (SELECT 1 FROM permutas p JOIN vehiculos vp ON vp.id = p.vehiculo_id
                 WHERE p.venta_id = v.id AND UPPER(vp.dominio) LIKE UPPER(@q_dominio))
    )`);
    parametros.q = `%${texto}%`;
    parametros.q_dominio = `%${normalizarDominio(texto) || texto}%`;
  }

  if (estado) {
    condiciones.push('v.estado = @estado');
    parametros.estado = estado;
  }
  if (vendedor_id) {
    condiciones.push('v.vendedor_id = @vendedor_id');
    parametros.vendedor_id = Number(vendedor_id);
  }
  if (tenencia) {
    condiciones.push('ve.tenencia = @tenencia');
    parametros.tenencia = tenencia;
  }
  if (desde) {
    condiciones.push('v.fecha_venta >= @desde');
    parametros.desde = desde;
  }
  if (hasta) {
    condiciones.push('v.fecha_venta <= @hasta');
    parametros.hasta = hasta;
  }
  if (entrega_vencida === 'true' || entrega_vencida === true) {
    condiciones.push(`(v.fecha_entrega_estimada IS NOT NULL
      AND v.fecha_entrega_estimada < date('now')
      AND v.estado NOT IN ('entregado', 'cancelado'))`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  return { where, parametros };
}

function listarVentas(filtros = {}) {
  const { where, parametros } = armarFiltros(filtros);
  const limite = Math.min(Number(filtros.limite) || 50, 500);
  const pagina = Math.max(Number(filtros.pagina) || 1, 1);
  const offset = (pagina - 1) * limite;

  const total = db
    .prepare(
      `SELECT COUNT(*) AS n FROM ventas v
       JOIN usuarios u ON u.id = v.vendedor_id
       JOIN vehiculos ve ON ve.id = v.vehiculo_id ${where}`
    )
    .get(parametros).n;

  const filas = db
    .prepare(
      `${SELECT_VENTA_LISTA} ${where}
       ORDER BY v.fecha_venta DESC, v.id DESC
       LIMIT @limite OFFSET @offset`
    )
    .all({ ...parametros, limite, offset });

  return { total, pagina, limite, paginas: Math.max(Math.ceil(total / limite), 1), ventas: filas };
}

// Todas las ventas que cumplen el filtro, sin paginar (se usa para exportar).
function listarVentasCompleto(filtros = {}) {
  const { where, parametros } = armarFiltros(filtros);
  return db
    .prepare(`${SELECT_VENTA_LISTA} ${where} ORDER BY v.fecha_venta DESC, v.id DESC`)
    .all(parametros);
}

const archivosDeDocumento = db.prepare(`
  SELECT a.id, a.nombre_original, a.mime, a.tamano, a.subido_en,
         u.nombre AS subido_por_nombre
  FROM archivos a
  LEFT JOIN usuarios u ON u.id = a.subido_por
  WHERE a.documento_id = ?
  ORDER BY a.subido_en DESC, a.id DESC
`);

function documentosDeVenta(ventaId) {
  const filas = db
    .prepare(
      `SELECT d.id, d.venta_id, d.vehiculo_id, d.rol, d.tipo, d.estado, d.observaciones,
              d.actualizado_en, u.nombre AS actualizado_por_nombre,
              ve.dominio, ve.marca, ve.modelo, ve.anio, ve.descripcion, ve.tenencia
       FROM documentos d
       JOIN vehiculos ve ON ve.id = d.vehiculo_id
       LEFT JOIN usuarios u ON u.id = d.actualizado_por
       WHERE d.venta_id = ?`
    )
    .all(ventaId);

  const orden = new Map(TIPOS_DOCUMENTO.map((d, i) => [d.tipo, i]));
  const grupos = new Map();

  for (const fila of filas) {
    if (!grupos.has(fila.vehiculo_id)) {
      grupos.set(fila.vehiculo_id, {
        vehiculo_id: fila.vehiculo_id,
        dominio: fila.dominio,
        rol: fila.rol,
        tenencia: fila.tenencia,
        descripcion: [fila.marca, fila.modelo, fila.anio].filter(Boolean).join(' ') || fila.descripcion,
        items: []
      });
    }
    grupos.get(fila.vehiculo_id).items.push({
      ...fila,
      etiqueta: etiquetaDocumento(fila.tipo),
      archivos: archivosDeDocumento.all(fila.id)
    });
  }

  const resultado = [...grupos.values()];
  for (const grupo of resultado) {
    grupo.items.sort((a, b) => (orden.get(a.tipo) ?? 99) - (orden.get(b.tipo) ?? 99));
    grupo.listos = grupo.items.filter((i) => i.estado === 'ok' || i.estado === 'no_aplica').length;
    grupo.total = grupo.items.length;
  }
  // El auto vendido siempre va primero, despues las permutas.
  resultado.sort((a, b) => (a.rol === b.rol ? 0 : a.rol === 'venta' ? -1 : 1));
  return resultado;
}

function obtenerVenta(id) {
  const venta = db
    .prepare(
      `SELECT v.*, u.nombre AS vendedor_nombre, u.email AS vendedor_email,
              c.nombre AS creado_por_nombre
       FROM ventas v
       JOIN usuarios u ON u.id = v.vendedor_id
       LEFT JOIN usuarios c ON c.id = v.creado_por
       WHERE v.id = ?`
    )
    .get(id);

  if (!venta) throw noEncontrado('No se encontro la venta.');

  venta.vehiculo = db.prepare('SELECT * FROM vehiculos WHERE id = ?').get(venta.vehiculo_id);

  venta.permutas = db
    .prepare(
      `SELECT p.id, p.valor_tomado, p.moneda, p.observaciones, p.creado_en,
              ve.id AS vehiculo_id, ve.dominio, ve.marca, ve.modelo, ve.version, ve.anio,
              ve.color, ve.kilometraje, ve.descripcion, ve.nro_chasis, ve.nro_motor
       FROM permutas p
       JOIN vehiculos ve ON ve.id = p.vehiculo_id
       WHERE p.venta_id = ?
       ORDER BY p.id`
    )
    .all(id);

  venta.notas = db
    .prepare(
      `SELECT n.id, n.texto, n.creado_en, u.nombre AS autor
       FROM notas n
       LEFT JOIN usuarios u ON u.id = n.usuario_id
       WHERE n.venta_id = ?
       ORDER BY n.creado_en DESC, n.id DESC`
    )
    .all(id);

  venta.documentacion = documentosDeVenta(id);
  return venta;
}

// Busqueda directa por dominio: devuelve el auto y todas las operaciones donde aparece.
function buscarPorDominio(dominioBuscado) {
  const dominio = normalizarDominio(dominioBuscado);
  const vehiculo = db.prepare('SELECT * FROM vehiculos WHERE dominio = ?').get(dominio);
  if (!vehiculo) return null;

  const ventas = db
    .prepare(
      `SELECT v.id, v.fecha_venta, v.estado, v.cliente_nombre, v.fecha_entrega_estimada,
              u.nombre AS vendedor_nombre, 'venta' AS rol
       FROM ventas v JOIN usuarios u ON u.id = v.vendedor_id
       WHERE v.vehiculo_id = ?
       UNION ALL
       SELECT v.id, v.fecha_venta, v.estado, v.cliente_nombre, v.fecha_entrega_estimada,
              u.nombre AS vendedor_nombre, 'permuta' AS rol
       FROM permutas p
       JOIN ventas v ON v.id = p.venta_id
       JOIN usuarios u ON u.id = v.vendedor_id
       WHERE p.vehiculo_id = ?
       ORDER BY fecha_venta DESC`
    )
    .all(vehiculo.id, vehiculo.id);

  const documentos = db
    .prepare(
      `SELECT d.id, d.venta_id, d.rol, d.tipo, d.estado, d.observaciones, d.actualizado_en
       FROM documentos d WHERE d.vehiculo_id = ?`
    )
    .all(vehiculo.id)
    .map((d) => ({ ...d, etiqueta: etiquetaDocumento(d.tipo), archivos: archivosDeDocumento.all(d.id) }));

  const orden = new Map(TIPOS_DOCUMENTO.map((d, i) => [d.tipo, i]));
  documentos.sort(
    (a, b) => a.venta_id - b.venta_id || (orden.get(a.tipo) ?? 99) - (orden.get(b.tipo) ?? 99)
  );

  return { vehiculo, ventas, documentos };
}

// Panel de documentacion: una fila por auto involucrado en una operacion activa.
function panelDocumentacion({ soloPendientes = true, q = '' } = {}) {
  const filas = db
    .prepare(
      `SELECT d.venta_id, d.vehiculo_id, d.rol,
              ve.dominio, ve.marca, ve.modelo, ve.anio, ve.tenencia, ve.descripcion,
              v.estado AS estado_venta, v.fecha_venta, v.fecha_entrega_estimada,
              v.cliente_nombre, u.nombre AS vendedor_nombre,
              COUNT(*) AS total,
              SUM(CASE WHEN d.estado IN ('ok', 'no_aplica') THEN 1 ELSE 0 END) AS listos,
              SUM(CASE WHEN d.estado = 'pendiente' THEN 1 ELSE 0 END) AS pendientes,
              SUM(CASE WHEN d.estado = 'en_tramite' THEN 1 ELSE 0 END) AS en_tramite,
              (SELECT COUNT(*) FROM archivos a
                 JOIN documentos d2 ON d2.id = a.documento_id
                 WHERE d2.venta_id = d.venta_id AND d2.vehiculo_id = d.vehiculo_id) AS archivos
       FROM documentos d
       JOIN vehiculos ve ON ve.id = d.vehiculo_id
       JOIN ventas v ON v.id = d.venta_id
       JOIN usuarios u ON u.id = v.vendedor_id
       WHERE v.estado != 'cancelado'
       GROUP BY d.venta_id, d.vehiculo_id
       ORDER BY
         CASE WHEN v.fecha_entrega_estimada IS NULL THEN 1 ELSE 0 END,
         v.fecha_entrega_estimada ASC,
         v.id DESC`
    )
    .all();

  const termino = normalizarDominio(q);
  const texto = String(q || '').trim().toUpperCase();

  return filas.filter((fila) => {
    if (soloPendientes && fila.listos === fila.total) return false;
    if (!texto) return true;
    const enDominio = termino && fila.dominio.includes(termino);
    const enDescripcion = `${fila.marca} ${fila.modelo} ${fila.descripcion} ${fila.cliente_nombre}`
      .toUpperCase()
      .includes(texto);
    return enDominio || enDescripcion;
  });
}

function estadisticas() {
  const base = db
    .prepare(
      `SELECT
         COUNT(*) AS ventas_totales,
         SUM(CASE WHEN estado = 'entregado' THEN 1 ELSE 0 END) AS entregadas,
         SUM(CASE WHEN estado NOT IN ('entregado', 'cancelado') THEN 1 ELSE 0 END) AS activas,
         SUM(CASE WHEN fecha_entrega_estimada IS NOT NULL
                   AND fecha_entrega_estimada < date('now')
                   AND estado NOT IN ('entregado', 'cancelado') THEN 1 ELSE 0 END) AS entregas_vencidas,
         SUM(CASE WHEN fecha_venta >= date('now', 'start of month') THEN 1 ELSE 0 END) AS ventas_del_mes
       FROM ventas`
    )
    .get();

  const documentacion = db
    .prepare(
      `SELECT COUNT(*) AS pendientes FROM documentos d
       JOIN ventas v ON v.id = d.venta_id
       WHERE d.estado = 'pendiente' AND v.estado != 'cancelado'`
    )
    .get();

  const porTenencia = db
    .prepare(
      `SELECT ve.tenencia, COUNT(*) AS cantidad
       FROM ventas v JOIN vehiculos ve ON ve.id = v.vehiculo_id
       WHERE v.estado != 'cancelado'
       GROUP BY ve.tenencia`
    )
    .all();

  // A proposito no se devuelve nada por vendedor: la web muestra quien vendio
  // cada auto, pero no lleva un contador por persona.
  return { ...base, documentos_pendientes: documentacion.pendientes, porTenencia };
}

module.exports = {
  listarVentas,
  listarVentasCompleto,
  obtenerVenta,
  documentosDeVenta,
  buscarPorDominio,
  panelDocumentacion,
  estadisticas
};
