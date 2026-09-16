'use strict';

const db = require('../db');

// Cada cambio queda registrado con el antes y el despues. Es la red de
// seguridad: aunque alguien pise un dato, el valor anterior sigue estando.

const insertar = db.prepare(`
  INSERT INTO auditoria (entidad, entidad_id, venta_id, accion, resumen, antes, despues,
                         usuario_id, usuario_nombre, origen)
  VALUES (@entidad, @entidad_id, @venta_id, @accion, @resumen, @antes, @despues,
          @usuario_id, @usuario_nombre, @origen)
`);

const subirVersion = db.prepare(
  `UPDATE estado_datos
   SET version = version + 1, cambio_en = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
   WHERE id = 1`
);

function aTexto(valor) {
  if (valor === undefined || valor === null) return null;
  try {
    return JSON.stringify(valor);
  } catch {
    return String(valor);
  }
}

/**
 * Deja constancia de un cambio y adelanta el contador global de datos.
 * Nunca tira error: registrar el historial no puede hacer fallar una carga.
 */
function registrar({ entidad, entidadId = null, ventaId = null, accion, resumen = '', antes, despues, usuario, origen = '' }) {
  try {
    insertar.run({
      entidad,
      entidad_id: entidadId,
      venta_id: ventaId,
      accion,
      resumen: String(resumen).slice(0, 500),
      antes: aTexto(antes),
      despues: aTexto(despues),
      usuario_id: usuario ? usuario.id : null,
      usuario_nombre: usuario ? usuario.nombre : '',
      origen: String(origen || '').slice(0, 120)
    });
    subirVersion.run();
  } catch (error) {
    console.error('[engel] no se pudo registrar el historial:', error.message);
  }
}

// Compara dos versiones de un registro y describe en castellano que cambio.
function describirCambios(antes = {}, despues = {}, etiquetas = {}) {
  const partes = [];
  for (const campo of Object.keys(despues)) {
    const valorAntes = antes[campo];
    const valorDespues = despues[campo];
    if (String(valorAntes ?? '') === String(valorDespues ?? '')) continue;
    const nombre = etiquetas[campo] || campo;
    partes.push(`${nombre}: "${valorAntes ?? ''}" → "${valorDespues ?? ''}"`);
  }
  return partes.join('; ');
}

function historialDeVenta(ventaId, limite = 200) {
  return db
    .prepare(
      `SELECT id, entidad, entidad_id, accion, resumen, usuario_nombre, creado_en
       FROM auditoria
       WHERE venta_id = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(ventaId, limite);
}

function historialGeneral({ limite = 200, desdeId = 0 } = {}) {
  return db
    .prepare(
      `SELECT id, entidad, entidad_id, venta_id, accion, resumen, usuario_nombre, creado_en
       FROM auditoria
       WHERE id > ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(Number(desdeId) || 0, Math.min(Number(limite) || 200, 1000));
}

function versionDatos() {
  return db.prepare('SELECT version, cambio_en FROM estado_datos WHERE id = 1').get();
}

module.exports = { registrar, describirCambios, historialDeVenta, historialGeneral, versionDatos };
