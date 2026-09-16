// Prueba de punta a punta de la web contra el esquema real de la base.
//
// Antes de correrla: bash herramientas/pruebas/levantar.sh
// Despues:           node herramientas/pruebas/web.mjs [carpeta-de-capturas]

import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://127.0.0.1:4100';
const FALSO = 'http://127.0.0.1:5555';
const SALIDA = process.argv[2] || '.';
const errores = [];
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) errores.push(m); };

// En algunos entornos el navegador ya viene instalado en otra ruta.
const NAVEGADOR = process.env.CHROME_PATH || undefined;
const nav = await chromium.launch(NAVEGADOR ? { executablePath: NAVEGADOR } : {});

async function nuevaPagina() {
  const ctx = await nav.newContext({ viewport: { width: 1440, height: 950 }, acceptDownloads: true });
  const p = await ctx.newPage();
  // La web carga Supabase y JSZip desde un CDN; en la prueba, del servidor falso.
  await p.addInitScript(([falso]) => {
    globalThis.__ENGEL_MODULO_SUPABASE__ = `${falso}/supabase-falso.js`;
    globalThis.__ENGEL_MODULO_ZIP__ = `${falso}/jszip.mjs`;
    globalThis.__ENGEL_SERVIDOR_FALSO__ = falso;
    try {
      localStorage.setItem('engel:url', `${falso}`);
      localStorage.setItem('engel:clave', 'clave-de-prueba');
    } catch { /* sin localStorage */ }
  }, [FALSO]);
  p.on('console', (m) => { if (m.type() === 'error') errores.push(`console: ${m.text()}`); });
  p.on('pageerror', (e) => errores.push(`pageerror: ${e.message}`));
  return { ctx, p };
}

async function captura(p, nombre) {
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${SALIDA}/${nombre}.png`, fullPage: true });
}

// ---------------------------------------------------------------------
console.log('1. Primera entrada: crear la cuenta del administrador');
const { p } = await nuevaPagina();
await p.goto(BASE, { waitUntil: 'networkidle' });
await p.waitForSelector('.login__caja');
await captura(p, '20-ingreso');

await p.click('a:has-text("Crear mi cuenta")');
await p.waitForSelector('input[type=email]');
await p.fill('input[type=email]', 'jefe@engel.com');
await p.locator('.campo', { hasText: 'Nombre' }).locator('input').fill('Juan Cruz');
await p.fill('input[type=password]', 'clave-larga-123');
await p.click('button[type=submit]');
await p.waitForSelector('.menu', { timeout: 15000 });
ok(true, 'el primero que se registra entra como administrador');

const menu = await p.locator('.menu').innerText();
ok(/Equipo/.test(menu), 've la solapa Equipo (es administrador)');
ok(/administrador/i.test(menu), 'el rol figura como administrador');

// ---------------------------------------------------------------------
console.log('2. Invitar a un companero');
await p.click('a[href="#/usuarios"]');
await p.waitForSelector('table');
await p.click('button:has-text("Sumar a alguien")');
await p.waitForSelector('.modal');
await p.locator('.modal input[type=email]').fill('lucia@engel.com');
await p.locator('.modal .campo', { hasText: 'Nombre' }).locator('input').fill('Lucia Fernandez');
await p.click('.modal__pie button:has-text("Invitar")');
await p.waitForTimeout(1200);
const equipo = await p.locator('.contenido').innerText();
ok(/lucia@engel.com/.test(equipo), 'la invitacion queda pendiente');
await captura(p, '21-equipo');

// ---------------------------------------------------------------------
console.log('3. Cargar una venta con permuta');
await p.click('a[href="#/ventas/nueva"]');
await p.waitForSelector('form');
await p.fill('input.dominio-input', 'AB123CD');
await p.locator('.campo', { hasText: 'Marca' }).first().locator('input').fill('Toyota');
await p.locator('.campo', { hasText: 'Modelo' }).first().locator('input').fill('Corolla');
await p.locator('.campo', { hasText: 'Cliente' }).first().locator('input').fill('Maria Gomez');
await p.locator('.campo', { hasText: 'Precio de venta' }).locator('input').fill('15000000');

await p.click('button:has-text("Agregar permuta")');
await p.waitForTimeout(400);
const permuta = p.locator('.permuta');
await permuta.locator('input.dominio-input').fill('AAA111');
await permuta.locator('.campo', { hasText: 'Marca' }).locator('input').fill('Volkswagen');
await captura(p, '22-cargar-venta');

await p.click('button:has-text("Guardar venta")');
await p.waitForSelector('.doc-item', { timeout: 15000 });
ok(true, 'la venta se guardo');

const checklists = await p.locator('.tarjeta__titulo:has-text("Permuta"), .tarjeta__titulo:has-text("Auto vendido")').count();
const documentos = await p.locator('.doc-item').count();
ok(documentos === 16, `se generaron los checklists de los dos autos (${documentos} documentos)`);
ok(checklists >= 2, 'hay una tarjeta de documentacion por auto');

// ---------------------------------------------------------------------
console.log('4. Subir documentacion');
const archivo = `${SALIDA}/titulo-prueba.pdf`;
fs.writeFileSync(archivo, '%PDF-1.4 titulo de prueba');
await p.locator('.doc-item').first().locator('input[type=file]').setInputFiles(archivo);
await p.waitForTimeout(2500);
const chips = await p.locator('.archivo').count();
ok(chips >= 1, `el archivo quedo cargado (${chips} archivo)`);

const estadoTitulo = await p.locator('.doc-item').first().locator('select').inputValue();
ok(estadoTitulo === 'ok', 'al subir el archivo el documento pasa a "Listo" solo');
const progreso = await p.locator('.progreso__texto').first().innerText();
ok(progreso === '1/8', `el contador de documentacion se actualiza (${progreso})`);
await captura(p, '23-ficha-venta');

// ---------------------------------------------------------------------
console.log('5. Guardado automatico campo por campo');
const telefono = p.locator('.autoguardado', { hasText: 'Telefono' }).locator('input');
await telefono.fill('11 7777 8888');
await telefono.blur();
await p.waitForSelector('.autoguardado__marca--ok', { timeout: 10000 });
ok(true, 'el campo avisa "Guardado"');

await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.autoguardado', { timeout: 15000 });
const guardado = await p.locator('.autoguardado', { hasText: 'Telefono' }).locator('input').inputValue();
ok(guardado === '11 7777 8888', 'el valor persiste tras recargar');
const marca = await p.locator('.autoguardado', { hasText: 'Marca' }).locator('input').inputValue();
ok(marca === 'Toyota', 'guardar un campo no borro los datos del auto');

// ---------------------------------------------------------------------
console.log('6. Historial');
await p.click('button:has-text("Historial")');
await p.waitForSelector('.modal .nota', { timeout: 10000 });
const historial = await p.locator('.modal').innerText();
ok(/Juan Cruz/.test(historial), 'el historial dice quien hizo el cambio');
ok(/11 7777 8888/.test(historial), 'el historial guarda el valor nuevo');
ok(/Se cargo la venta/.test(historial), 'la creacion quedo registrada');
await captura(p, '24-historial');
await p.click('.modal__cerrar');

// ---------------------------------------------------------------------
console.log('7. Buscar por dominio y bajar el ZIP');
await p.click('a[href="#/buscador"]');
await p.waitForSelector('input.dominio-input');
await p.fill('input.dominio-input', 'ab123cd');
await p.click('button:has-text("Buscar")');
await p.waitForSelector('.tarjeta__titulo', { timeout: 10000 });
await p.waitForTimeout(800);
const ficha = await p.locator('.contenido').innerText();
ok(/AB 123 CD/.test(ficha), 'encuentra el auto por su dominio');
ok(/titulo-prueba\.pdf/.test(ficha), 'muestra la documentacion cargada');
await captura(p, '25-buscador');

const descargaZip = p.waitForEvent('download', { timeout: 20000 });
await p.click('button:has-text("Descargar toda la documentacion")');
const zip = await descargaZip;
const rutaZip = `${SALIDA}/${zip.suggestedFilename()}`;
await zip.saveAs(rutaZip);
const cabecera = fs.readFileSync(rutaZip).subarray(0, 2).toString();
ok(cabecera === 'PK', `el ZIP se armo en el navegador (${zip.suggestedFilename()})`);

// ---------------------------------------------------------------------
console.log('8. Exportar la planilla de ventas');
await p.click('a[href="#/ventas"]');
await p.waitForSelector('table');
const descargaCsv = p.waitForEvent('download', { timeout: 20000 });
await p.click('button:has-text("Exportar CSV")');
const csv = await descargaCsv;
const rutaCsv = `${SALIDA}/${csv.suggestedFilename()}`;
await csv.saveAs(rutaCsv);
const textoCsv = fs.readFileSync(rutaCsv, 'utf8');
ok(/AB123CD/.test(textoCsv) && /Maria Gomez/.test(textoCsv), 'el CSV trae la venta');
ok(/AAA111/.test(textoCsv), 'el CSV trae la permuta vinculada');

const listado = await p.locator('.contenido').innerText();
ok(!/ventas por vendedor/i.test(listado), 'no hay ranking de vendedores');
ok(/Solo mis ventas/.test(listado), 'el filtro es "Solo mis ventas"');

// ---------------------------------------------------------------------
console.log('9. El companero invitado puede entrar');
const { p: p2 } = await nuevaPagina();
await p2.goto(BASE, { waitUntil: 'networkidle' });
await p2.waitForSelector('.login__caja');
await p2.click('a:has-text("Crear mi cuenta")');
await p2.fill('input[type=email]', 'lucia@engel.com');
await p2.locator('.campo', { hasText: 'Nombre' }).locator('input').fill('Lucia Fernandez');
await p2.fill('input[type=password]', 'otra-clave-larga');
await p2.click('button[type=submit]');
await p2.waitForSelector('.menu', { timeout: 15000 });
ok(true, 'la persona invitada entra sin problemas');

const menuLucia = await p2.locator('.menu').innerText();
ok(!/Equipo/.test(menuLucia), 'una vendedora no ve la solapa Equipo');

await p2.click('a[href="#/ventas"]');
await p2.waitForSelector('table');
const ventasLucia = await p2.locator('tbody tr').count();
ok(ventasLucia === 1, 've las ventas cargadas por el equipo');

// ---------------------------------------------------------------------
console.log('10. Quien no fue invitado queda afuera');
const { p: p3 } = await nuevaPagina();
await p3.goto(BASE, { waitUntil: 'networkidle' });
await p3.waitForSelector('.login__caja');
await p3.click('a:has-text("Crear mi cuenta")');
await p3.fill('input[type=email]', 'desconocido@otrolado.com');
await p3.fill('input[type=password]', 'clave-cualquiera-1');
await p3.click('button[type=submit]');
await p3.waitForTimeout(3000);

const entro = await p3.locator('.menu').count();
const avisoIntruso = await p3.locator('.aviso--error').innerText().catch(() => '');
ok(entro === 0, 'no entra a la web');
ok(/no fue habilitado|administrador/i.test(avisoIntruso), `se le explica por que: "${avisoIntruso.slice(0, 70)}"`);
await captura(p3, '26-sin-invitacion');

await nav.close();

if (errores.length) {
  console.log('\nPROBLEMAS:');
  errores.forEach((e) => console.log(' -', e));
  process.exit(1);
}
console.log('\nTodo verificado contra el esquema real, sin errores de consola.');
