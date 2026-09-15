'use strict';

const db = require('../db');
const vehiculos = require('./vehiculos');
const { TIPOS_DOCUMENTO } = require('./documentos');
const { badRequest, conflicto, noEncontrado } = require('./errores');
const v = require('./validacion');

const ESTADOS_VENTA = ['pendiente', 'en_preparacion', 'listo_entrega', 'entregado', 'cancelado'];
const MONEDAS = ['ARS', 'USD'];

const insertarDocumento = db.prepare(`
  INSERT OR IGNORE INTO documentos (venta_id, vehiculo_id, rol, tipo)
  VALUES (?, ?, ?, ?)
`);

// Cada auto de la operacion (el vendido y cada permuta) arranca con el
// checklist completo de documentacion en estado pendiente.
function generarChecklist(ventaId, vehiculoId, rol) {
  for (const { tipo } of TIPOS_DOCUMENTO) {
    insertarDocumento.run(ventaId, vehiculoId, rol, tipo);
  }
}

function validarDatosVenta(datos = {}, { parcial = false } = {}) {
  const salida = {};
  const presente = (campo) => !parcial || datos[campo] !== undefined;

  if (presente('fecha_venta')) salida.fecha_venta = v.fechaRequerida(datos.fecha_venta, 'fecha de venta');
  if (presente('vendedor_id')) salida.vendedor_id = v.idRequerido(datos.vendedor_id, 'vendedor');
  if (presente('cliente_nombre')) salida.cliente_nombre = v.textoRequerido(datos.cliente_nombre, 'cliente', 150);
  if (presente('cliente_documento')) salida.cliente_documento = v.textoOpcional(datos.cliente_documento, 40);
  if (presente('cliente_telefono')) salida.cliente_telefono = v.textoOpcional(datos.cliente_telefono, 60);
  if (presente('cliente_email')) salida.cliente_email = v.emailOpcional(datos.cliente_email, 'email del cliente');
  if (presente('precio_venta')) salida.precio_venta = v.numeroOpcional(datos.precio_venta, 'precio de venta');
  if (presente('moneda')) salida.moneda = v.unoDe(datos.moneda, MONEDAS, 'moneda', 'ARS');
  if (presente('forma_pago')) salida.forma_pago = v.textoOpcional(datos.forma_pago, 120);
  if (presente('sena')) salida.sena = v.numeroOpcional(datos.sena, 'sena');
  if (presente('estado')) salida.estado = v.unoDe(datos.estado, ESTADOS_VENTA, 'estado', 'pendiente');
  if (presente('fecha_entrega_estimada')) {
    salida.fecha_entrega_estimada = v.fechaOpcional(datos.fecha_entrega_estimada, 'fecha de entrega estimada');
  }
  if (presente('fecha_entrega_real')) {
    salida.fecha_entrega_real = v.fechaOpcional(datos.fecha_entrega_real, 'fecha de entrega real');
  }
  if (presente('detalles')) salida.detalles = v.textoOpcional(datos.detalles, 4000);

  return salida;
}

function verificarVendedor(id) {
  const vendedor = db.prepare('SELECT id, activo FROM usuarios WHERE id = ?').get(id);
  if (!vendedor) throw badRequest('El vendedor seleccionado no existe.');
  if (!vendedor.activo) throw badRequest('El vendedor seleccionado esta dado de baja.');
}

function validarPermuta(entrada, dominioVendido) {
  const datosVehiculo = vehiculos.normalizarDatos(entrada || {});
  if (datosVehiculo.dominio === dominioVendido) {
    throw badRequest('La permuta no puede tener el mismo dominio que el auto vendido.');
  }
  return {
    vehiculo: entrada,
    valor_tomado: v.numeroOpcional(entrada.valor_tomado, 'valor de la permuta'),
    moneda: v.unoDe(entrada.moneda, MONEDAS, 'moneda de la permuta', 'ARS'),
    observaciones: v.textoOpcional(entrada.observaciones, 500)
  };
}

const insertarVenta = db.prepare(`
  INSERT INTO ventas (fecha_venta, vendedor_id, vehiculo_id, cliente_nombre, cliente_documento,
                      cliente_telefono, cliente_email, precio_venta, moneda, forma_pago, sena,
                      estado, fecha_entrega_estimada, fecha_entrega_real, detalles, creado_por)
  VALUES (@fecha_venta, @vendedor_id, @vehiculo_id, @cliente_nombre, @cliente_documento,
          @cliente_telefono, @cliente_email, @precio_venta, @moneda, @forma_pago, @sena,
          @estado, @fecha_entrega_estimada, @fecha_entrega_real, @detalles, @creado_por)
`);

const insertarPermuta = db.prepare(`
  INSERT INTO permutas (venta_id, vehiculo_id, valor_tomado, moneda, observaciones)
  VALUES (@venta_id, @vehiculo_id, @valor_tomado, @moneda, @observaciones)
`);

const crearVentaTx = db.transaction((datos, permutas, usuario) => {
  const vehiculo = vehiculos.guardarPorDominio(datos.vehiculo);

  const yaVendido = db
    .prepare(`SELECT id FROM ventas WHERE vehiculo_id = ? AND estado != 'cancelado'`)
    .get(vehiculo.id);
  if (yaVendido) {
    throw conflicto(
      `El dominio ${vehiculo.dominio} ya figura en la venta #${yaVendido.id}. ` +
        'Si es un error, cancela esa venta antes de cargar una nueva.',
      { venta_id: yaVendido.id }
    );
  }

  const info = insertarVenta.run({
    fecha_venta: datos.fecha_venta,
    vendedor_id: datos.vendedor_id,
    vehiculo_id: vehiculo.id,
    cliente_nombre: datos.cliente_nombre,
    cliente_documento: datos.cliente_documento || '',
    cliente_telefono: datos.cliente_telefono || '',
    cliente_email: datos.cliente_email || '',
    precio_venta: datos.precio_venta ?? null,
    moneda: datos.moneda || 'ARS',
    forma_pago: datos.forma_pago || '',
    sena: datos.sena ?? null,
    estado: datos.estado || 'pendiente',
    fecha_entrega_estimada: datos.fecha_entrega_estimada ?? null,
    fecha_entrega_real: datos.fecha_entrega_real ?? null,
    detalles: datos.detalles || '',
    creado_por: usuario.id
  });

  const ventaId = Number(info.lastInsertRowid);
  generarChecklist(ventaId, vehiculo.id, 'venta');

  for (const permuta of permutas) {
    const vehiculoPermuta = vehiculos.guardarPorDominio(permuta.vehiculo);
    insertarPermuta.run({
      venta_id: ventaId,
      vehiculo_id: vehiculoPermuta.id,
      valor_tomado: permuta.valor_tomado,
      moneda: permuta.moneda,
      observaciones: permuta.observaciones
    });
    generarChecklist(ventaId, vehiculoPermuta.id, 'permuta');
  }

  return ventaId;
});

function crear(cuerpo, usuario) {
  const datos = validarDatosVenta(cuerpo);
  verificarVendedor(datos.vendedor_id);

  const datosVehiculo = vehiculos.normalizarDatos(cuerpo.vehiculo || {});
  const entradas = Array.isArray(cuerpo.permutas) ? cuerpo.permutas : [];
  const permutas = entradas.map((p) => validarPermuta(p, datosVehiculo.dominio));

  const dominiosPermuta = permutas.map((p) => vehiculos.normalizarDatos(p.vehiculo).dominio);
  if (new Set(dominiosPermuta).size !== dominiosPermuta.length) {
    throw badRequest('Hay dos permutas con el mismo dominio en la misma venta.');
  }

  return crearVentaTx({ ...datos, vehiculo: cuerpo.vehiculo }, permutas, usuario);
}

const actualizarVentaTx = db.transaction((id, datos, vehiculoDatos) => {
  const venta = db.prepare('SELECT * FROM ventas WHERE id = ?').get(id);
  if (!venta) throw noEncontrado('No se encontro la venta.');

  const campos = Object.keys(datos);
  if (campos.length) {
    const asignaciones = campos.map((campo) => `${campo} = @${campo}`).join(', ');
    db.prepare(
      `UPDATE ventas SET ${asignaciones}, actualizado_en = datetime('now') WHERE id = @id`
    ).run({ ...datos, id });
  }

  if (vehiculoDatos) vehiculos.actualizarPorId(venta.vehiculo_id, vehiculoDatos);
  return id;
});

function actualizar(id, cuerpo) {
  const datos = validarDatosVenta(cuerpo, { parcial: true });
  if (datos.vendedor_id) verificarVendedor(datos.vendedor_id);
  return actualizarVentaTx(id, datos, cuerpo.vehiculo);
}

function agregarPermuta(ventaId, cuerpo) {
  const venta = db.prepare('SELECT id, vehiculo_id FROM ventas WHERE id = ?').get(ventaId);
  if (!venta) throw noEncontrado('No se encontro la venta.');

  const vendido = vehiculos.obtenerPorId(venta.vehiculo_id);
  const permuta = validarPermuta(cuerpo, vendido.dominio);

  return db.transaction(() => {
    const vehiculo = vehiculos.guardarPorDominio(permuta.vehiculo);
    const yaEsta = db
      .prepare('SELECT id FROM permutas WHERE venta_id = ? AND vehiculo_id = ?')
      .get(ventaId, vehiculo.id);
    if (yaEsta) throw conflicto('Esa permuta ya esta vinculada a esta venta.');

    insertarPermuta.run({
      venta_id: ventaId,
      vehiculo_id: vehiculo.id,
      valor_tomado: permuta.valor_tomado,
      moneda: permuta.moneda,
      observaciones: permuta.observaciones
    });
    generarChecklist(ventaId, vehiculo.id, 'permuta');
    return vehiculo;
  })();
}

// Al quitar una permuta se borra tambien su checklist y sus archivos de esa venta.
const quitarPermutaTx = db.transaction((permutaId) => {
  const permuta = db.prepare('SELECT * FROM permutas WHERE id = ?').get(permutaId);
  if (!permuta) throw noEncontrado('No se encontro la permuta.');

  const archivos = db
    .prepare(
      `SELECT a.nombre_archivo FROM archivos a
       JOIN documentos d ON d.id = a.documento_id
       WHERE d.venta_id = ? AND d.vehiculo_id = ?`
    )
    .all(permuta.venta_id, permuta.vehiculo_id);

  db.prepare('DELETE FROM documentos WHERE venta_id = ? AND vehiculo_id = ?').run(
    permuta.venta_id,
    permuta.vehiculo_id
  );
  db.prepare('DELETE FROM permutas WHERE id = ?').run(permutaId);
  return archivos.map((a) => a.nombre_archivo);
});

const eliminarVentaTx = db.transaction((id) => {
  const venta = db.prepare('SELECT id FROM ventas WHERE id = ?').get(id);
  if (!venta) throw noEncontrado('No se encontro la venta.');

  const archivos = db
    .prepare(
      `SELECT a.nombre_archivo FROM archivos a
       JOIN documentos d ON d.id = a.documento_id
       WHERE d.venta_id = ?`
    )
    .all(id);

  db.prepare('DELETE FROM ventas WHERE id = ?').run(id);
  return archivos.map((a) => a.nombre_archivo);
});

module.exports = {
  ESTADOS_VENTA,
  MONEDAS,
  generarChecklist,
  crear,
  actualizar,
  agregarPermuta,
  quitarPermuta: quitarPermutaTx,
  eliminar: eliminarVentaTx
};
