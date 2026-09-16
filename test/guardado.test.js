'use strict';

// Pruebas de lo que no se puede perder: historial de cambios, borradores,
// guardado campo por campo y escrituras en simultaneo.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'engel-guardado-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.UPLOAD_DIR = path.join(carpeta, 'uploads');
process.env.SESSION_SECRET = 'clave-de-prueba-suficientemente-larga';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'admin1234';
process.env.RESPALDO_CADA_MINUTOS = '0';

const app = require('../src/server');

let servidor;
let base;
let cookie = '';

async function pedir(ruta, opciones = {}) {
  const headers = { ...(opciones.headers || {}) };
  if (cookie) headers.cookie = cookie;
  if (opciones.body !== undefined) {
    headers['content-type'] = 'application/json';
    opciones = { ...opciones, body: JSON.stringify(opciones.body) };
  }

  const respuesta = await fetch(base + ruta, { ...opciones, headers });
  const setCookie = respuesta.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];

  const tipo = respuesta.headers.get('content-type') || '';
  const cuerpo = tipo.includes('application/json') ? await respuesta.json() : await respuesta.text();
  return { status: respuesta.status, cuerpo };
}

let ventaId;

test.before(async () => {
  servidor = app.listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  base = `http://127.0.0.1:${servidor.address().port}`;

  await pedir('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@test.com', password: 'admin1234' }
  });

  const { cuerpo } = await pedir('/api/ventas', {
    method: 'POST',
    body: {
      fecha_venta: '2026-09-01',
      vendedor_id: 1,
      cliente_nombre: 'Cliente Inicial',
      precio_venta: 10000000,
      vehiculo: {
        dominio: 'AB123CD',
        marca: 'Toyota',
        modelo: 'Corolla',
        version: 'XEI',
        anio: 2021,
        color: 'Gris',
        kilometraje: 48000,
        descripcion: 'Corolla XEI gris'
      }
    }
  });
  ventaId = cuerpo.venta.id;
});

test.after(() => {
  servidor.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

// ---------- Guardado campo por campo ----------

test('guardar un solo campo no pisa el resto de la venta', async () => {
  const { cuerpo } = await pedir(`/api/ventas/${ventaId}`, {
    method: 'PATCH',
    body: { cliente_telefono: '11 5555 5555' }
  });

  assert.equal(cuerpo.venta.cliente_telefono, '11 5555 5555');
  assert.equal(cuerpo.venta.cliente_nombre, 'Cliente Inicial', 'el nombre sigue estando');
  assert.equal(cuerpo.venta.precio_venta, 10000000, 'el precio sigue estando');
});

test('guardar un solo campo del auto no borra los demas', async () => {
  const { cuerpo } = await pedir(`/api/ventas/${ventaId}`, {
    method: 'PATCH',
    body: { vehiculo: { color: 'Negro' } }
  });

  const v = cuerpo.venta.vehiculo;
  assert.equal(v.color, 'Negro');
  assert.equal(v.marca, 'Toyota', 'la marca sigue estando');
  assert.equal(v.modelo, 'Corolla', 'el modelo sigue estando');
  assert.equal(v.version, 'XEI', 'la version sigue estando');
  assert.equal(v.anio, 2021, 'el ano sigue estando');
  assert.equal(v.kilometraje, 48000, 'el kilometraje sigue estando');
  assert.equal(v.descripcion, 'Corolla XEI gris', 'la descripcion sigue estando');
});

test('se puede vaciar un campo a proposito', async () => {
  const { cuerpo } = await pedir(`/api/ventas/${ventaId}`, {
    method: 'PATCH',
    body: { vehiculo: { nro_chasis: 'ABC123' } }
  });
  assert.equal(cuerpo.venta.vehiculo.nro_chasis, 'ABC123');

  const vaciado = await pedir(`/api/ventas/${ventaId}`, {
    method: 'PATCH',
    body: { vehiculo: { nro_chasis: '' } }
  });
  assert.equal(vaciado.cuerpo.venta.vehiculo.nro_chasis, '');
  assert.equal(vaciado.cuerpo.venta.vehiculo.marca, 'Toyota', 'vaciar uno no vacia el resto');
});

// ---------- Historial ----------

test('el historial guarda quien cambio que cosa', async () => {
  const { status, cuerpo } = await pedir(`/api/ventas/${ventaId}/historial`);
  assert.equal(status, 200);
  assert.ok(cuerpo.historial.length >= 3, 'hay movimientos registrados');

  const creacion = cuerpo.historial.find((l) => l.accion === 'crear' && l.entidad === 'venta');
  assert.ok(creacion, 'quedo registrada la creacion');
  assert.equal(creacion.usuario_nombre, 'Administrador');

  const telefono = cuerpo.historial.find((l) => l.resumen.includes('telefono'));
  assert.ok(telefono, 'quedo registrado el cambio de telefono');
  assert.match(telefono.resumen, /11 5555 5555/);
});

test('el historial conserva el valor anterior de un dato pisado', async () => {
  await pedir(`/api/ventas/${ventaId}`, { method: 'PATCH', body: { cliente_nombre: 'Cliente Corregido' } });

  const { cuerpo } = await pedir(`/api/ventas/${ventaId}/historial`);
  const cambio = cuerpo.historial.find((l) => l.resumen.includes('Cliente Corregido'));
  assert.ok(cambio, 'aparece el cambio');
  assert.match(cambio.resumen, /Cliente Inicial/, 'el valor viejo sigue estando en el historial');
});

test('borrar una venta deja una copia completa en el historial', async () => {
  const creada = await pedir('/api/ventas', {
    method: 'POST',
    body: {
      fecha_venta: '2026-09-05',
      vendedor_id: 1,
      cliente_nombre: 'Se Va A Borrar',
      vehiculo: { dominio: 'ZZ999ZZ', marca: 'Fiat', modelo: 'Cronos' }
    }
  });
  const id = creada.cuerpo.venta.id;

  const borrada = await pedir(`/api/ventas/${id}`, { method: 'DELETE' });
  assert.equal(borrada.status, 200);

  const db = require('../src/db');
  const registro = db
    .prepare("SELECT antes, resumen FROM auditoria WHERE venta_id = ? AND accion = 'borrar' AND entidad = 'venta'")
    .get(id);

  assert.ok(registro, 'quedo el registro del borrado');
  const copia = JSON.parse(registro.antes);
  assert.equal(copia.venta.cliente_nombre, 'Se Va A Borrar');
  assert.equal(copia.vehiculo.dominio, 'ZZ999ZZ');
  assert.equal(copia.documentos.length, 8, 'tambien se guardo el checklist');
});

test('el contador de datos sube con cada cambio', async () => {
  const antes = await pedir('/api/estado-datos');
  await pedir(`/api/ventas/${ventaId}`, { method: 'PATCH', body: { forma_pago: 'Contado' } });
  const despues = await pedir('/api/estado-datos');

  assert.ok(despues.cuerpo.version > antes.cuerpo.version, 'la version avanza');
});

// ---------- Borradores ----------

test('guarda y recupera un borrador de formulario', async () => {
  const contenido = { cliente_nombre: 'A medio cargar', vehiculo: { dominio: 'AA111BB' } };

  const guardado = await pedir('/api/borradores/venta-nueva', { method: 'PUT', body: { contenido } });
  assert.equal(guardado.status, 200);

  const leido = await pedir('/api/borradores/venta-nueva');
  assert.deepEqual(JSON.parse(leido.cuerpo.borrador.contenido), contenido);
});

test('guardar el borrador de nuevo lo reemplaza, no lo duplica', async () => {
  await pedir('/api/borradores/venta-nueva', { method: 'PUT', body: { contenido: { cliente_nombre: 'Segunda version' } } });
  const leido = await pedir('/api/borradores/venta-nueva');
  assert.equal(JSON.parse(leido.cuerpo.borrador.contenido).cliente_nombre, 'Segunda version');

  const todos = await pedir('/api/borradores');
  assert.equal(todos.cuerpo.borradores.filter((b) => b.clave === 'venta-nueva').length, 1);
});

test('el borrador se puede descartar', async () => {
  await pedir('/api/borradores/venta-nueva', { method: 'DELETE' });
  const leido = await pedir('/api/borradores/venta-nueva');
  assert.equal(leido.cuerpo.borrador, null);
});

test('cada uno ve solo sus borradores', async () => {
  await pedir('/api/borradores/privado', { method: 'PUT', body: { contenido: { secreto: 1 } } });

  await pedir('/api/usuarios', {
    method: 'POST',
    body: { nombre: 'Otro', email: 'otro@test.com', password: 'clave12345', rol: 'vendedor' }
  });
  const cookieAdmin = cookie;
  await pedir('/api/auth/login', { method: 'POST', body: { email: 'otro@test.com', password: 'clave12345' } });

  const ajeno = await pedir('/api/borradores/privado');
  assert.equal(ajeno.cuerpo.borrador, null, 'no ve el borrador del otro');

  cookie = cookieAdmin;
});

test('rechaza claves de borrador raras', async () => {
  const { status } = await pedir('/api/borradores/..%2Fetc%2Fpasswd', { method: 'PUT', body: { contenido: {} } });
  assert.equal(status, 400);
});

// ---------- Uso en simultaneo ----------

test('no se pierde ningun cambio cuando varios escriben a la vez', async () => {
  const campos = [
    { forma_pago: 'Transferencia' },
    { sena: 500000 },
    { cliente_documento: '30111222' },
    { cliente_telefono: '11 1111 1111' },
    { detalles: 'Detalle escrito en simultaneo' },
    { fecha_entrega_estimada: '2026-10-01' },
    { estado: 'en_preparacion' },
    { vehiculo: { color: 'Azul' } },
    { vehiculo: { kilometraje: 51000 } },
    { moneda: 'USD' }
  ];

  const respuestas = await Promise.all(
    campos.map((cuerpo) => pedir(`/api/ventas/${ventaId}`, { method: 'PATCH', body: cuerpo }))
  );
  assert.ok(respuestas.every((r) => r.status === 200), 'todas las escrituras salieron bien');

  const { cuerpo } = await pedir(`/api/ventas/${ventaId}`);
  const venta = cuerpo.venta;

  assert.equal(venta.forma_pago, 'Transferencia');
  assert.equal(venta.sena, 500000);
  assert.equal(venta.cliente_documento, '30111222');
  assert.equal(venta.cliente_telefono, '11 1111 1111');
  assert.equal(venta.detalles, 'Detalle escrito en simultaneo');
  assert.equal(venta.fecha_entrega_estimada, '2026-10-01');
  assert.equal(venta.estado, 'en_preparacion');
  assert.equal(venta.moneda, 'USD');
  assert.equal(venta.vehiculo.color, 'Azul');
  assert.equal(venta.vehiculo.kilometraje, 51000);
});

test('varias cargas de ventas al mismo tiempo se guardan todas', async () => {
  const dominios = ['AA100AA', 'AA101AA', 'AA102AA', 'AA103AA', 'AA104AA', 'AA105AA', 'AA106AA', 'AA107AA'];

  const respuestas = await Promise.all(
    dominios.map((dominio, i) =>
      pedir('/api/ventas', {
        method: 'POST',
        body: {
          fecha_venta: '2026-09-10',
          vendedor_id: 1,
          cliente_nombre: `Cliente ${i}`,
          vehiculo: { dominio, marca: 'Marca', modelo: `Modelo ${i}` }
        }
      })
    )
  );

  assert.ok(respuestas.every((r) => r.status === 201), 'se crearon todas');

  const listado = await pedir('/api/ventas?limite=200');
  const cargados = listado.cuerpo.ventas.map((v) => v.dominio);
  for (const dominio of dominios) {
    assert.ok(cargados.includes(dominio), `${dominio} quedo guardado`);
  }

  // Y cada una con su checklist completo.
  for (const respuesta of respuestas) {
    assert.equal(respuesta.cuerpo.venta.documentacion[0].items.length, 8);
  }
});

test('dos personas subiendo documentos del mismo auto no se pisan', async () => {
  const { cuerpo } = await pedir(`/api/ventas/${ventaId}`);
  const items = cuerpo.venta.documentacion[0].items;

  const respuestas = await Promise.all(
    items.slice(0, 6).map((item, i) =>
      pedir(`/api/documentos/${item.id}`, {
        method: 'PATCH',
        body: { estado: i % 2 === 0 ? 'ok' : 'en_tramite', observaciones: `Cargado por la persona ${i}` }
      })
    )
  );
  assert.ok(respuestas.every((r) => r.status === 200));

  const final = await pedir(`/api/ventas/${ventaId}`);
  const finales = final.cuerpo.venta.documentacion[0].items;
  for (let i = 0; i < 6; i += 1) {
    assert.equal(finales[i].estado, i % 2 === 0 ? 'ok' : 'en_tramite', `documento ${i} guardado`);
    assert.equal(finales[i].observaciones, `Cargado por la persona ${i}`);
  }
});

// ---------- Respaldos ----------

test('genera un respaldo descargable de la base', async () => {
  const creado = await pedir('/api/exportar/respaldos', { method: 'POST' });
  assert.equal(creado.status, 201);

  const lista = await pedir('/api/exportar/respaldos');
  assert.ok(lista.cuerpo.respaldos.length >= 1);

  const nombre = lista.cuerpo.respaldos[0].nombre;
  const respuesta = await fetch(`${base}/api/exportar/respaldos/${nombre}`, { headers: { cookie } });
  assert.equal(respuesta.status, 200);

  const contenido = Buffer.from(await respuesta.arrayBuffer());
  assert.equal(contenido.subarray(0, 15).toString(), 'SQLite format 3', 'es una base SQLite valida');
});

test('un vendedor no puede bajar los respaldos', async () => {
  const cookieAdmin = cookie;
  await pedir('/api/auth/login', { method: 'POST', body: { email: 'otro@test.com', password: 'clave12345' } });

  const { status } = await pedir('/api/exportar/respaldos');
  assert.equal(status, 403);

  cookie = cookieAdmin;
});

// ---------- Las metricas por vendedor ya no existen ----------

test('las estadisticas no traen totales por vendedor', async () => {
  const { cuerpo } = await pedir('/api/buscar/estadisticas');
  assert.equal(cuerpo.porVendedor, undefined, 'no hay ranking de vendedores');
  assert.ok(typeof cuerpo.ventas_totales === 'number', 'los totales generales siguen');
});

test('el listado del equipo no cuenta las ventas de cada uno', async () => {
  const { cuerpo } = await pedir('/api/usuarios');
  assert.ok(cuerpo.usuarios.length > 0);
  for (const usuario of cuerpo.usuarios) {
    assert.equal(usuario.ventas, undefined, `${usuario.nombre} no trae contador de ventas`);
  }
});

test('pero cada venta sigue diciendo quien la vendio', async () => {
  const { cuerpo } = await pedir(`/api/ventas/${ventaId}`);
  assert.ok(cuerpo.venta.vendedor_nombre, 'la venta dice quien vendio');
});
