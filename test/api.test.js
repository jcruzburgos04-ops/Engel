'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// La configuracion se lee al importar, asi que las variables van antes del require.
const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'engel-test-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.UPLOAD_DIR = path.join(carpeta, 'uploads');
process.env.SESSION_SECRET = 'clave-de-prueba-suficientemente-larga';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.ADMIN_PASSWORD = 'admin1234';

const app = require('../src/server');

let servidor;
let base;
let cookie = '';

async function pedir(ruta, opciones = {}) {
  const headers = { ...(opciones.headers || {}) };
  if (cookie) headers.cookie = cookie;
  if (opciones.body && !(opciones.body instanceof FormData)) {
    headers['content-type'] = 'application/json';
    opciones = { ...opciones, body: JSON.stringify(opciones.body) };
  }

  const respuesta = await fetch(base + ruta, { ...opciones, headers });
  const setCookie = respuesta.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];

  const tipo = respuesta.headers.get('content-type') || '';
  const cuerpo = tipo.includes('application/json')
    ? await respuesta.json()
    : await respuesta.text();
  return { status: respuesta.status, cuerpo };
}

test.before(async () => {
  servidor = app.listen(0);
  await new Promise((resolve) => servidor.once('listening', resolve));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

test.after(() => {
  servidor.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test('rechaza el acceso sin sesion', async () => {
  const { status } = await pedir('/api/ventas');
  assert.equal(status, 401);
});

test('rechaza credenciales incorrectas', async () => {
  const { status } = await pedir('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@test.com', password: 'equivocada' }
  });
  assert.equal(status, 401);
});

test('inicia sesion con el admin creado automaticamente', async () => {
  const { status, cuerpo } = await pedir('/api/auth/login', {
    method: 'POST',
    body: { email: 'admin@test.com', password: 'admin1234' }
  });
  assert.equal(status, 200);
  assert.equal(cuerpo.usuario.rol, 'admin');
});

test('crea un vendedor', async () => {
  const { status, cuerpo } = await pedir('/api/usuarios', {
    method: 'POST',
    body: { nombre: 'Juan Perez', email: 'juan@test.com', password: 'vendedor123', rol: 'vendedor' }
  });
  assert.equal(status, 201);
  assert.equal(cuerpo.usuario.nombre, 'Juan Perez');
});

test('valida el formato del dominio', async () => {
  const { status, cuerpo } = await pedir('/api/ventas', {
    method: 'POST',
    body: {
      fecha_venta: '2026-09-01',
      vendedor_id: 2,
      cliente_nombre: 'Cliente Test',
      vehiculo: { dominio: 'NO-ES-UN-DOMINIO' }
    }
  });
  assert.equal(status, 400);
  assert.match(cuerpo.error, /dominio/i);
});

let ventaId;

test('carga una venta con permuta y genera los dos checklists', async () => {
  const { status, cuerpo } = await pedir('/api/ventas', {
    method: 'POST',
    body: {
      fecha_venta: '2026-09-01',
      vendedor_id: 2,
      cliente_nombre: 'Maria Gomez',
      cliente_telefono: '11 5555 5555',
      precio_venta: 15000000,
      moneda: 'ARS',
      forma_pago: 'Transferencia + permuta',
      fecha_entrega_estimada: '2026-09-20',
      detalles: 'Entrega con service al dia.',
      vehiculo: {
        dominio: 'ab 123 cd',
        marca: 'Toyota',
        modelo: 'Corolla',
        anio: 2021,
        tenencia: 'consigna',
        consignante_nombre: 'Carlos Ruiz',
        descripcion: 'Corolla XEI CVT gris'
      },
      permutas: [
        {
          dominio: 'AAA111',
          marca: 'Volkswagen',
          modelo: 'Gol',
          anio: 2014,
          valor_tomado: 4000000,
          moneda: 'ARS',
          observaciones: 'Entra con la VTV vencida.'
        }
      ]
    }
  });

  assert.equal(status, 201);
  const venta = cuerpo.venta;
  ventaId = venta.id;

  assert.equal(venta.vehiculo.dominio, 'AB123CD', 'normaliza el dominio');
  assert.equal(venta.vehiculo.tenencia, 'consigna');
  assert.equal(venta.vendedor_nombre, 'Juan Perez');
  assert.equal(venta.permutas.length, 1);
  assert.equal(venta.permutas[0].dominio, 'AAA111');
  assert.equal(venta.documentacion.length, 2, 'un checklist por auto');
  assert.equal(venta.documentacion[0].rol, 'venta');
  assert.equal(venta.documentacion[0].items.length, 8, 'los 8 documentos');
  assert.equal(venta.documentacion[1].rol, 'permuta');

  const tipos = venta.documentacion[0].items.map((i) => i.tipo);
  assert.deepEqual(tipos, [
    'titulo', 'dominio', 'multas', 'patentes',
    'form_08', 'cedula', 'verificacion_policial', 'vtv'
  ]);
});

test('no permite cargar dos veces el mismo dominio vendido', async () => {
  const { status, cuerpo } = await pedir('/api/ventas', {
    method: 'POST',
    body: {
      fecha_venta: '2026-09-02',
      vendedor_id: 2,
      cliente_nombre: 'Otro Cliente',
      vehiculo: { dominio: 'AB123CD' }
    }
  });
  assert.equal(status, 409);
  assert.match(cuerpo.error, /ya figura en la venta/i);
});

test('rechaza una permuta con el mismo dominio que el auto vendido', async () => {
  const { status } = await pedir('/api/ventas', {
    method: 'POST',
    body: {
      fecha_venta: '2026-09-02',
      vendedor_id: 2,
      cliente_nombre: 'Cliente',
      vehiculo: { dominio: 'CD456EF' },
      permutas: [{ dominio: 'CD456EF' }]
    }
  });
  assert.equal(status, 400);
});

test('sube documentacion y la marca como cargada', async () => {
  const { cuerpo } = await pedir(`/api/ventas/${ventaId}`);
  const titulo = cuerpo.venta.documentacion[0].items.find((i) => i.tipo === 'titulo');
  assert.equal(titulo.estado, 'pendiente');

  const form = new FormData();
  form.append('archivos', new Blob(['contenido del titulo'], { type: 'application/pdf' }), 'titulo.pdf');

  const subida = await pedir(`/api/documentos/${titulo.id}/archivos`, { method: 'POST', body: form });
  assert.equal(subida.status, 201);

  const actualizado = subida.cuerpo.documentacion[0].items.find((i) => i.tipo === 'titulo');
  assert.equal(actualizado.estado, 'ok', 'al subir el archivo el item queda listo');
  assert.equal(actualizado.archivos.length, 1);
  assert.equal(actualizado.archivos[0].nombre_original, 'titulo.pdf');
});

test('rechaza archivos de tipos no permitidos', async () => {
  const { cuerpo } = await pedir(`/api/ventas/${ventaId}`);
  const vtv = cuerpo.venta.documentacion[0].items.find((i) => i.tipo === 'vtv');

  const form = new FormData();
  form.append('archivos', new Blob(['MZ'], { type: 'application/x-msdownload' }), 'virus.exe');

  const { status } = await pedir(`/api/documentos/${vtv.id}/archivos`, { method: 'POST', body: form });
  assert.equal(status, 400);
});

test('busca por dominio y devuelve la documentacion', async () => {
  const { status, cuerpo } = await pedir('/api/buscar/dominio/ab123cd');
  assert.equal(status, 200);
  assert.equal(cuerpo.vehiculo.dominio, 'AB123CD');
  assert.equal(cuerpo.ventas.length, 1);
  assert.equal(cuerpo.ventas[0].rol, 'venta');

  const conArchivo = cuerpo.documentos.filter((d) => d.archivos.length > 0);
  assert.equal(conArchivo.length, 1);
  assert.equal(conArchivo[0].tipo, 'titulo');
});

test('la permuta tambien se encuentra por su dominio', async () => {
  const { status, cuerpo } = await pedir('/api/buscar/dominio/AAA111');
  assert.equal(status, 200);
  assert.equal(cuerpo.ventas[0].rol, 'permuta');
  assert.equal(cuerpo.ventas[0].id, ventaId);
});

test('descarga el archivo cargado', async () => {
  const { cuerpo } = await pedir('/api/buscar/dominio/AB123CD');
  const archivo = cuerpo.documentos.find((d) => d.archivos.length).archivos[0];

  const respuesta = await fetch(`${base}/api/documentos/archivos/${archivo.id}`, {
    headers: { cookie }
  });
  assert.equal(respuesta.status, 200);
  assert.equal(await respuesta.text(), 'contenido del titulo');
});

test('descarga el zip con la documentacion del dominio', async () => {
  const respuesta = await fetch(`${base}/api/exportar/dominio/AB123CD/documentacion.zip`, {
    headers: { cookie }
  });
  assert.equal(respuesta.status, 200);
  assert.equal(respuesta.headers.get('content-type'), 'application/zip');

  const buffer = Buffer.from(await respuesta.arrayBuffer());
  assert.ok(buffer.length > 0);
  assert.equal(buffer.subarray(0, 2).toString(), 'PK', 'es un archivo zip valido');
});

test('actualiza el estado y la fecha de entrega de la venta', async () => {
  const { status, cuerpo } = await pedir(`/api/ventas/${ventaId}`, {
    method: 'PATCH',
    body: { estado: 'listo_entrega', fecha_entrega_estimada: '2026-09-25' }
  });
  assert.equal(status, 200);
  assert.equal(cuerpo.venta.estado, 'listo_entrega');
  assert.equal(cuerpo.venta.fecha_entrega_estimada, '2026-09-25');
});

test('agrega detalles extras a la operacion', async () => {
  const { status, cuerpo } = await pedir(`/api/ventas/${ventaId}/notas`, {
    method: 'POST',
    body: { texto: 'El cliente pidio la entrega por la tarde.' }
  });
  assert.equal(status, 201);
  assert.equal(cuerpo.venta.notas.length, 1);
  assert.equal(cuerpo.venta.notas[0].autor, 'Administrador');
});

test('filtra el listado por dominio de la permuta', async () => {
  const { cuerpo } = await pedir('/api/ventas?q=AAA111');
  assert.equal(cuerpo.total, 1);
  assert.equal(cuerpo.ventas[0].id, ventaId);
});

test('el panel de documentacion muestra lo que falta', async () => {
  const { cuerpo } = await pedir('/api/documentos/panel');
  assert.equal(cuerpo.filas.length, 2, 'el auto vendido y la permuta');

  const vendido = cuerpo.filas.find((f) => f.rol === 'venta');
  assert.equal(vendido.total, 8);
  assert.equal(vendido.listos, 1, 'solo el titulo esta cargado');
  assert.equal(vendido.archivos, 1);
});

test('exporta las ventas a csv', async () => {
  const respuesta = await fetch(`${base}/api/exportar/ventas.csv`, { headers: { cookie } });
  assert.equal(respuesta.status, 200);

  const texto = await respuesta.text();
  assert.match(texto, /Dominio/);
  assert.match(texto, /AB123CD/);
  assert.match(texto, /Juan Perez/);
  assert.match(texto, /AAA111/, 'la permuta aparece en la fila de la venta');
});

test('al quitar la permuta se borra su checklist', async () => {
  const { cuerpo } = await pedir(`/api/ventas/${ventaId}`);
  const permutaId = cuerpo.venta.permutas[0].id;

  const { status, cuerpo: actualizado } = await pedir(
    `/api/ventas/${ventaId}/permutas/${permutaId}`,
    { method: 'DELETE' }
  );
  assert.equal(status, 200);
  assert.equal(actualizado.venta.permutas.length, 0);
  assert.equal(actualizado.venta.documentacion.length, 1);
});

test('un vendedor no puede crear usuarios', async () => {
  await pedir('/api/auth/login', {
    method: 'POST',
    body: { email: 'juan@test.com', password: 'vendedor123' }
  });

  const { status } = await pedir('/api/usuarios', {
    method: 'POST',
    body: { nombre: 'Otro', email: 'otro@test.com', password: 'clave12345' }
  });
  assert.equal(status, 403);
});

test('un vendedor no puede borrar ventas', async () => {
  const { status } = await pedir(`/api/ventas/${ventaId}`, { method: 'DELETE' });
  assert.equal(status, 403);
});

test('manda las cabeceras de seguridad', async () => {
  const respuesta = await fetch(`${base}/`);
  assert.equal(respuesta.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(respuesta.headers.get('x-frame-options'), 'DENY');
  assert.match(respuesta.headers.get('content-security-policy') || '', /default-src 'self'/);
});

test('frena los intentos repetidos de ingreso', async () => {
  let ultimoStatus = 0;
  for (let intento = 0; intento < 15; intento += 1) {
    const respuesta = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@test.com', password: 'mal' })
    });
    ultimoStatus = respuesta.status;
    if (ultimoStatus === 429) break;
  }
  assert.equal(ultimoStatus, 429, 'despues de varios intentos fallidos corta con 429');
});
