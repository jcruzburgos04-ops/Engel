'use strict';

const db = require('../db');
const { normalizarDominio, dominioEsValido } = require('./dominio');
const { badRequest, noEncontrado } = require('./errores');
const v = require('./validacion');

const CAMPOS_VEHICULO = `id, dominio, marca, modelo, version, anio, color, kilometraje,
  nro_chasis, nro_motor, tenencia, consignante_nombre, consignante_contacto,
  descripcion, creado_en, actualizado_en`;

const porDominio = db.prepare(`SELECT ${CAMPOS_VEHICULO} FROM vehiculos WHERE dominio = ?`);
const porId = db.prepare(`SELECT ${CAMPOS_VEHICULO} FROM vehiculos WHERE id = ?`);

function obtenerPorId(id) {
  const vehiculo = porId.get(id);
  if (!vehiculo) throw noEncontrado('No se encontro el vehiculo.');
  return vehiculo;
}

function obtenerPorDominio(dominio) {
  return porDominio.get(normalizarDominio(dominio)) || null;
}

// Arma un objeto de vehiculo validado a partir de lo que manda el formulario.
function normalizarDatos(datos = {}, { exigirDominio = true } = {}) {
  const dominio = normalizarDominio(datos.dominio);
  if (exigirDominio && !dominio) throw badRequest('El dominio (patente) es obligatorio.');
  if (dominio && !dominioEsValido(dominio)) {
    throw badRequest(
      `El dominio "${datos.dominio}" no tiene un formato valido. Ejemplos: AAA123, AB123CD.`
    );
  }

  const tenencia = v.unoDe(datos.tenencia, ['propio', 'consigna'], 'tenencia', 'propio');
  const consignanteNombre = v.textoOpcional(datos.consignante_nombre, 150);
  if (tenencia === 'consigna' && !consignanteNombre) {
    throw badRequest('Si el auto esta en consigna tenes que indicar el nombre del consignante.');
  }

  return {
    dominio,
    marca: v.textoOpcional(datos.marca, 80),
    modelo: v.textoOpcional(datos.modelo, 80),
    version: v.textoOpcional(datos.version, 120),
    anio: v.enteroOpcional(datos.anio, 'anio', { min: 1900, max: new Date().getFullYear() + 2 }),
    color: v.textoOpcional(datos.color, 60),
    kilometraje: v.enteroOpcional(datos.kilometraje, 'kilometraje', { min: 0, max: 5000000 }),
    nro_chasis: v.textoOpcional(datos.nro_chasis, 60),
    nro_motor: v.textoOpcional(datos.nro_motor, 60),
    tenencia,
    consignante_nombre: tenencia === 'consigna' ? consignanteNombre : '',
    consignante_contacto: tenencia === 'consigna' ? v.textoOpcional(datos.consignante_contacto, 150) : '',
    descripcion: v.textoOpcional(datos.descripcion, 500)
  };
}

const insertar = db.prepare(`
  INSERT INTO vehiculos (dominio, marca, modelo, version, anio, color, kilometraje,
                         nro_chasis, nro_motor, tenencia, consignante_nombre,
                         consignante_contacto, descripcion)
  VALUES (@dominio, @marca, @modelo, @version, @anio, @color, @kilometraje,
          @nro_chasis, @nro_motor, @tenencia, @consignante_nombre,
          @consignante_contacto, @descripcion)
`);

const actualizar = db.prepare(`
  UPDATE vehiculos SET
    marca = @marca, modelo = @modelo, version = @version, anio = @anio, color = @color,
    kilometraje = @kilometraje, nro_chasis = @nro_chasis, nro_motor = @nro_motor,
    tenencia = @tenencia, consignante_nombre = @consignante_nombre,
    consignante_contacto = @consignante_contacto, descripcion = @descripcion,
    actualizado_en = datetime('now')
  WHERE id = @id
`);

// Crea el vehiculo si el dominio es nuevo; si ya existe, completa sus datos.
// Los campos que llegan vacios no pisan informacion ya cargada.
function guardarPorDominio(datos) {
  const limpio = normalizarDatos(datos);
  const existente = porDominio.get(limpio.dominio);

  if (!existente) {
    const info = insertar.run(limpio);
    return porId.get(info.lastInsertRowid);
  }

  const fusionado = { ...existente };
  for (const [campo, valor] of Object.entries(limpio)) {
    if (campo === 'dominio') continue;
    const vacio = valor === null || valor === '';
    if (!vacio) fusionado[campo] = valor;
  }
  actualizar.run(fusionado);
  return porId.get(existente.id);
}

function actualizarPorId(id, datos) {
  const actual = obtenerPorId(id);
  const limpio = normalizarDatos({ ...datos, dominio: actual.dominio });
  actualizar.run({ ...limpio, id: actual.id });
  return porId.get(actual.id);
}

function listar({ q = '', limite = 50 } = {}) {
  const termino = `%${String(q).trim().toUpperCase()}%`;
  return db
    .prepare(
      `SELECT ${CAMPOS_VEHICULO} FROM vehiculos
       WHERE (? = '%%' OR UPPER(dominio) LIKE ? OR UPPER(marca) LIKE ?
              OR UPPER(modelo) LIKE ? OR UPPER(descripcion) LIKE ?)
       ORDER BY actualizado_en DESC
       LIMIT ?`
    )
    .all(termino, termino, termino, termino, termino, Math.min(Number(limite) || 50, 200));
}

module.exports = {
  CAMPOS_VEHICULO,
  obtenerPorId,
  obtenerPorDominio,
  normalizarDatos,
  guardarPorDominio,
  actualizarPorId,
  listar
};
