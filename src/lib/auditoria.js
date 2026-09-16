'use strict';

const fs = require('fs');
const path = require('path');

const db = require('../db');
const config = require('../config');

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

// Ningun campo puede quedar en NULL: el historial no se puede caer por un
// dato incompleto, porque es justamente la red de seguridad de todo lo demas.
function texto(valor, porDefecto = '') {
  if (valor === undefined || valor === null) return porDefecto;
  return String(valor);
}

function entero(valor) {
  const numero = Number(valor);
  return Number.isInteger(numero) ? numero : null;
}

// Si por lo que sea no se puede escribir en la base, la linea se guarda igual
// en un archivo aparte. Preferible un registro suelto que perder el dato.
function registrarEnArchivo(entrada, motivo) {
  try {
    const destino = path.join(path.dirname(config.dbPath), 'historial-de-emergencia.log');
    fs.appendFileSync(destino, `${JSON.stringify({ ...entrada, motivo, fecha: new Date().toISOString() })}\n`);
  } catch (error) {
    console.error('[engel] tampoco se pudo guardar el historial en archivo:', error.message);
  }
}

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
  const entrada = {
    entidad: texto(entidad, 'desconocido'),
    entidad_id: entero(entidadId),
    venta_id: entero(ventaId),
    accion: texto(accion, 'editar'),
    resumen: texto(resumen).slice(0, 500),
    antes: aTexto(antes),
    despues: aTexto(despues),
    usuario_id: usuario ? entero(usuario.id) : null,
    usuario_nombre: texto(usuario && usuario.nombre, 'Sistema').slice(0, 120),
    origen: texto(origen).slice(0, 120)
  };

  try {
    insertar.run(entrada);
    subirVersion.run();
  } catch (error) {
    console.error('[engel] no se pudo registrar el historial:', error.message);
    registrarEnArchivo(entrada, error.message);
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
