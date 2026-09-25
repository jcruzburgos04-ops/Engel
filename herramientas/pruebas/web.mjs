// Prueba de punta a punta de la web contra el esquema real de la base.
//
// Antes de correrla: bash herramientas/pruebas/levantar.sh
// Despues:           node herramientas/pruebas/web.mjs [carpeta-de-capturas]

import { chromium } from 'playwright';
import fs from 'fs';
import { execSync } from 'child_process';

const BASE = 'http://127.0.0.1:4100';
const FALSO = 'http://127.0.0.1:5555';
const SALIDA = process.argv[2] || '.';
const errores = [];
const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) errores.push(m); };

// Para cambiar datos "desde otro lado" directamente en la base.
const psql = (sql) =>
  execSync(
    `psql -h "${process.env.PGHOST || '/tmp'}" -p ${process.env.PGPORT || 5433} ` +
      `-U "${process.env.PGUSER || 'engel'}" -d "${process.env.PGDATABASE || 'engel_web'}" -qc ${JSON.stringify(sql)}`,
    { stdio: 'pipe' }
  );
const psqlValor = (sql) =>
  execSync(
    `psql -h "${process.env.PGHOST || '/tmp'}" -p ${process.env.PGPORT || 5433} ` +
      `-U "${process.env.PGUSER || 'engel'}" -d "${process.env.PGDATABASE || 'engel_web'}" -tAc ${JSON.stringify(sql)}`,
    { stdio: 'pipe' }
  ).toString().trim();

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
    // En la prueba se revisan los cambios mas seguido, para no esperar tanto.
    globalThis.__ENGEL_INTERVALO_DATOS__ = 2000;
    globalThis.__ENGEL_INTERVALO_WEB__ = 1500;
    try {
      localStorage.setItem('engel:url', `${falso}`);
      localStorage.setItem('engel:clave', 'clave-de-prueba');
    } catch { /* sin localStorage */ }
  }, [FALSO]);
  p.on('console', (m) => {
    if (m.type() === 'error') errores.push(`console: ${m.text()}`);
    if (globalThis.__TRAZAS__ && m.text().startsWith('TRACE')) console.log('    |', m.text());
  });
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
await p.locator('.campo', { hasText: 'Comprador' }).first().locator('input').fill('Maria Gomez');
await p.locator('.campo', { hasText: 'Celular' }).first().locator('input').fill('11 5555 5555');

// El precio esta en la seccion plegada de la operacion.
await p.locator('.tarjeta', { hasText: 'Datos de la operacion' }).locator('summary').click();
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
ok(estadoTitulo === 'aprobado', 'al subir el archivo el documento pasa a "Aprobado" solo');

const opciones = await p.locator('.doc-item').first().locator('select option').allInnerTexts();
ok(
  opciones.join('|') === 'Faltante|Pedido|En proceso|Aprobado',
  `los estados son los cuatro, en orden (${opciones.join(' → ')})`
);
const progreso = await p.locator('.progreso__texto').first().innerText();
ok(progreso === '1/8', `el contador de documentacion se actualiza (${progreso})`);
await captura(p, '23-ficha-venta');

// ---------------------------------------------------------------------
console.log('5. Guardado automatico campo por campo');
const telefono = p.locator('.autoguardado', { hasText: 'Celular' }).locator('input');
await telefono.fill('11 7777 8888');
await telefono.blur();
await p.waitForSelector('.autoguardado__marca--ok', { timeout: 10000 });
ok(true, 'el campo avisa "Guardado"');

await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.autoguardado', { timeout: 15000 });
const guardado = await p.locator('.autoguardado', { hasText: 'Celular' }).locator('input').inputValue();
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

// Mientras se escribe tienen que aparecer los dominios que coinciden.
await p.click('input.dominio-input');
await p.type('input.dominio-input', 'ab', { delay: 60 });
await p.waitForSelector('.sugerencia', { timeout: 10000 });
const sugeridas = await p.locator('.sugerencia').allInnerTexts();
ok(sugeridas.some((t) => /AB 123 CD/.test(t)), `sugiere el dominio mientras se escribe (${sugeridas.length})`);
ok(sugeridas.some((t) => /Toyota|Corolla/i.test(t)), 'la sugerencia dice que auto es');
await captura(p, '25-sugerencias');

// Al elegir una sugerencia se busca sola, sin apretar Buscar.
await p.click('.sugerencia');
await p.waitForSelector('.tarjeta__titulo', { timeout: 10000 });
ok((await p.inputValue('input.dominio-input')) === 'AB123CD', 'al elegirla completa el dominio y busca');

// Un dominio que no existe no sugiere nada.
await p.fill('input.dominio-input', '');
await p.type('input.dominio-input', 'zz9', { delay: 60 });
await p.waitForTimeout(900);
ok((await p.locator('.sugerencia').count()) === 0, 'no sugiere dominios que no existen');

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

// Muy de vez en cuando el doble de pruebas pierde un pedido (ver el
// comentario en supabase-falso.js). Cuando pasa, la web avisa del problema
// a los 20 segundos, igual que en produccion. La prueba hace lo que haria
// una persona: volver a cargar. Si falla las dos veces, es un problema real.
async function esperarFilas(intentos = 3) {
  for (let intento = 1; intento <= intentos; intento += 1) {
    const hayFilas = await p2
      .waitForSelector('tbody tr', { timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    if (hayFilas) {
      const cuantas = await p2.locator('tbody tr').count();
      if (cuantas > 0) return cuantas;
    }

    if (intento === intentos) return 0;

    console.log(`    (intento ${intento}: el doble perdio un pedido; se vuelve a cargar)`);
    await p2.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await p2.waitForSelector('.menu', { timeout: 20000 }).catch(() => {});
  }
  return 0;
}

const ventasLucia = await esperarFilas();
ok(ventasLucia === 1, `ve las ventas cargadas por el equipo (${ventasLucia} fila/s)`);

if (ventasLucia !== 1) {
  console.log('    direccion:', p2.url());
  console.log('    menu activo:', await p2.locator('.menu__link.activo').innerText().catch(() => '(ninguno)'));
  console.log('    diagnostico:', (await p2.locator('.contenido').innerText()).slice(0, 220).replace(/\n+/g, ' | '));
  const detalle = await p2.evaluate(async () => {
    const { api } = await import('/js/api.js');
    const salida = {};
    try { salida.perfil = (await api.configuracion()).usuario; } catch (e) { salida.perfil = e.message; }
    try { salida.listado = await api.ventas({}); } catch (e) { salida.listado = e.message; }
    return salida;
  });
  console.log('    perfil:', JSON.stringify(detalle.perfil));
  console.log('    listado:', JSON.stringify(detalle.listado).slice(0, 220));
}

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

// ---------------------------------------------------------------------
console.log('11. Infracciones');
await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
await p.goto(`${BASE}/#/infracciones`, { waitUntil: 'networkidle' });
await p.waitForSelector('#paginas-de-consulta', { timeout: 15000 });
ok(/Todavia no hay paginas/.test(await p.locator('#paginas-de-consulta').innerText()), 'arranca sin paginas de consulta');

// Dos paginas: una acepta la patente en el link, la otra no.
async function agregarPagina(nombre, url) {
  await p.click('button:has-text("Agregar pagina")');
  await p.waitForSelector('.modal');
  await p.locator('.modal .campo', { hasText: 'Nombre' }).locator('input').fill(nombre);
  await p.locator('.modal .campo', { hasText: 'Link' }).locator('input').fill(url);
  await p.click('.modal__pie button:has-text("Guardar")');
  await p.waitForSelector('.modal', { state: 'detached', timeout: 10000 });
  await p.waitForSelector(`#paginas-de-consulta td:has-text("${nombre}")`, { timeout: 10000 });
}
await agregarPagina('CABA', `${FALSO}/portal-caba?patente={dominio}`);
await agregarPagina('Provincia', `${FALSO}/portal-provincia`);
const tablaPaginas = await p.locator('#paginas-de-consulta').innerText();
ok(/Completa el dominio/.test(tablaPaginas) && /Copia el dominio/.test(tablaPaginas), 'distingue las paginas que completan el dominio solas');

// Se llega al auto escribiendo el dominio y eligiendo la sugerencia.
await p.click('.sugeridor input');
await p.type('.sugeridor input', 'ab', { delay: 60 });
await p.waitForSelector('.sugerencia', { timeout: 10000 });
await p.click('.sugerencia');
await p.waitForSelector('tr.municipio', { timeout: 15000 });
ok(/#\/infracciones\/AB123CD$/.test(p.url()), 'al elegir la sugerencia abre las multas del auto');
ok((await p.locator('tr.municipio a[aria-label^="Consultar en"]').count()) === 2, 'hay un renglon con boton de consulta por municipio');

// El boton abre la pagina del municipio con la patente ya puesta.
const [pestanaCaba] = await Promise.all([
  p.context().waitForEvent('page', { timeout: 10000 }),
  p.click('a[aria-label="Consultar en CABA"]')
]);
ok(/patente=AB123CD/.test(pestanaCaba.url()), `abre CABA con el dominio en el link (${pestanaCaba.url().replace(FALSO, '')})`);
await pestanaCaba.close();

// Si la pagina no acepta la patente en el link, queda copiada para pegar.
await p.evaluate(() => navigator.clipboard.writeText('otra cosa'));
const [pestanaProvincia] = await Promise.all([
  p.context().waitForEvent('page', { timeout: 10000 }),
  p.click('a[aria-label="Consultar en Provincia"]')
]);
await pestanaProvincia.close();
const portapapeles = await p.evaluate(() => navigator.clipboard.readText());
ok(portapapeles === 'AB123CD', `copia el dominio para pegarlo (portapapeles: "${portapapeles}")`);

// Anotar lo que se encontro.
const renglon = (nombre) => p.locator('tr.municipio', { has: p.locator(`strong:text-is("${nombre}")`) });
await renglon('Provincia').locator('button:has-text("No tiene")').click();
await p.waitForSelector('tr.municipio:has-text("Sin multas")', { timeout: 10000 });
ok(/Juan Cruz/.test(await renglon('Provincia').innerText()), 'queda anotado quien reviso y que no tenia multas');

// "Tiene" abre la carga con el municipio ya puesto: se pone la cantidad y
// se suma otro municipio en el mismo paso.
await renglon('CABA').locator('button:has-text("Tiene multas")').click();
await p.waitForSelector('.modal .carga__fila', { timeout: 10000 });
ok((await p.locator('.modal .carga__municipio').first().inputValue()) === 'CABA', 'al marcar que tiene multas abre la carga con CABA puesto');
await p.locator('.modal .carga__cantidad').first().fill('3');
await p.click('.modal button:has-text("Otro municipio")');
await p.locator('.modal .carga__municipio').nth(1).fill('Pilar');
await p.locator('.modal .carga__cantidad').nth(1).fill('2');
// Quien las resuelve y detalles (los detalles se abren con un boton).
ok(await p.locator('.modal .carga__detalles').nth(1).isHidden(), 'en la carga los detalles arrancan ocultos');
await p.locator('.modal .carga__responsable').nth(1).fill('Gestoria Lopez');
await p.locator('.modal .carga__bloque').nth(1).locator('button:has-text("Detalles")').click();
await p.locator('.modal .carga__detalles').nth(1).fill('Pidio el acta por mail');
await p.click('.modal__pie button:has-text("Guardar")');
await p.waitForSelector('.modal', { state: 'detached', timeout: 15000 });
await p.waitForSelector('tr.municipio:has(strong:text-is("Pilar"))', { timeout: 15000 });
const resumenMultas = await p.locator('.encabezado').innerText();
ok(/5 multa\(s\) por resolver en 2 municipio\(s\)/.test(resumenMultas), 'muestra cuantas hay por resolver');
ok(!/adeudado/i.test(await p.locator('.contenido').innerText()), 'no aparece el total adeudado');
ok((await renglon('Pilar').locator('input.municipio__responsable').inputValue()) === 'Gestoria Lopez', 'queda anotado quien las resuelve');
const filaDetallesPilar = p.locator('tr.municipio:has(strong:text-is("Pilar")) + tr.municipio__fila-detalles');
ok(await filaDetallesPilar.isHidden(), 'los detalles no se ven hasta que se piden');
await renglon('Pilar').locator('button:has-text("Ver detalles")').click();
ok((await filaDetallesPilar.locator('textarea').inputValue()) === 'Pidio el acta por mail', 'al tocar "Ver detalles" aparecen');
await renglon('Pilar').locator('button:has-text("Ocultar detalles")').click();
const responsableCaba = renglon('CABA').locator('input.municipio__responsable');
await responsableCaba.fill('Juan Cruz');
await responsableCaba.blur();
await p.waitForSelector('tr.municipio .autoguardado__marca--ok', { timeout: 10000 });
ok(true, 'quien las resuelve se edita en la tabla y se guarda solo');
await p.waitForTimeout(500);
ok((await p.locator('a.menu__link[href="#/infracciones"] .globo').innerText().catch(() => '')) === '5', 'el menu cuenta las multas por resolver');
await captura(p, '28-infracciones-auto');

// Cantidad invalida: avisa y no se manda. Corregida, se guarda sola.
const cantidadCaba = renglon('CABA').locator('input.municipio__cantidad');
await cantidadCaba.fill('0');
await cantidadCaba.blur();
await p.waitForSelector('tr.municipio .autoguardado__marca--error', { timeout: 5000 });
ok(true, 'una cantidad en cero avisa y no se guarda');
await cantidadCaba.fill('4');
await cantidadCaba.blur();
await p.waitForSelector('tr.municipio .autoguardado__marca--ok', { timeout: 10000 });
ok(true, 'la cantidad corregida se guarda sola');

await p.waitForTimeout(1500);

// Marcar CABA pagada: se guarda sola y anota la fecha de pago.
await renglon('CABA').locator('select').selectOption('pagada');
await p.waitForSelector('tr.municipio--pagada', { timeout: 15000 });
const hoyTexto = await p.evaluate(() => new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }));
ok((await renglon('CABA').innerText()).includes(`el ${hoyTexto}`), 'al marcarla pagada anota la fecha de pago');

// Comprobante de pago.
const comprobante = `${SALIDA}/comprobante-prueba.pdf`;
fs.writeFileSync(comprobante, '%PDF-1.4 comprobante');
await renglon('CABA').locator('input[type=file]').setInputFiles(comprobante);
await p.waitForSelector('tr.municipio .archivo', { timeout: 15000 });
ok(/comprobante-prueba\.pdf/.test(await renglon('CABA').innerText()), 'el comprobante queda cargado');

// Despues de recargar sigue todo.
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('tr.municipio', { timeout: 15000 });
ok((await renglon('CABA').locator('input.municipio__cantidad').inputValue()) === '4', 'la cantidad persiste tras recargar');
ok((await p.locator('a.menu__link[href="#/infracciones"] .globo').innerText().catch(() => '')) === '2', 'pagada CABA, el menu cuenta solo las de Pilar');

// El listado general: un renglon por auto con sus municipios.
await p.click('a.menu__link[href="#/infracciones"]');
await p.waitForSelector('#paginas-de-consulta', { timeout: 15000 });
const filaAuto = await p.locator('.tarjeta', { hasText: 'Seguimiento' }).locator('tbody tr').first().innerText();
ok(/CABA · 4/.test(filaAuto) && /Pilar · 2/.test(filaAuto), `el listado muestra los municipios del auto (${filaAuto.replace(/\s+/g, ' ').slice(0, 60)})`);
ok(/Gestoria Lopez/.test(filaAuto) && /Juan Cruz/.test(filaAuto), 'el listado dice quien resuelve cada auto');
await captura(p, '29-infracciones');

// Cargar un auto en stock directamente desde el listado.
await p.click('button:has-text("Cargar infracciones")');
await p.waitForSelector('.modal .carga__fila');
await p.locator('.modal .sugeridor input').fill('AD111AA');
await p.locator('.modal .carga__municipio').first().fill('Tigre');
await p.locator('.modal .carga__cantidad').first().fill('1');
await p.click('.modal__pie button:has-text("Guardar")');
await p.waitForSelector('tr.municipio:has(strong:text-is("Tigre"))', { timeout: 15000 });
ok(/#\/infracciones\/AD111AA$/.test(p.url()), 'un dominio que no estaba cargado se da de alta con sus multas');

// Quitar un municipio cargado por error.
await p.goto(`${BASE}/#/infracciones/AB123CD`);
await p.waitForSelector('tr.municipio', { timeout: 15000 });
await renglon('Pilar').locator('button:has-text("Quitar")').click();
await p.click('.modal__pie button:has-text("Quitar")');
await p.waitForFunction(() => ![...document.querySelectorAll('tr.municipio strong')].some((e) => e.textContent === 'Pilar'), null, { timeout: 10000 });
ok(true, 'se puede quitar un municipio');

// ---------------------------------------------------------------------
console.log('12. La pantalla se actualiza sola');
ok((await p.locator('a.menu__link[href="#/documentacion"] .globo').count()) === 0, 'Documentacion no muestra numero');

// Otra persona cambia algo: la pantalla lo muestra sin tocar nada.
psql("UPDATE public.infracciones SET cantidad = 9 WHERE jurisdiccion = 'CABA'");
await p.waitForFunction(
  () => [...document.querySelectorAll('tr.municipio')].some((tr) =>
    tr.querySelector('strong')?.textContent === 'CABA' && tr.querySelector('input.municipio__cantidad')?.value === '9'),
  null, { timeout: 20000 }
).then(() => ok(true, 'un cambio de otra persona aparece solo, sin recargar'))
  .catch(() => ok(false, 'un cambio de otra persona aparece solo, sin recargar'));

// Pero si estas escribiendo, espera a que termines.
await renglon('CABA').locator('input.municipio__responsable').click();
psql("UPDATE public.infracciones SET cantidad = 7 WHERE jurisdiccion = 'CABA'");
await p.waitForTimeout(7000);
ok((await renglon('CABA').locator('input.municipio__cantidad').inputValue()) === '9', 'mientras escribis no te cambia la pantalla');
await p.locator('h1').first().click();
await p.waitForFunction(
  () => [...document.querySelectorAll('tr.municipio input.municipio__cantidad')].some((i) => i.value === '7'),
  null, { timeout: 20000 }
).then(() => ok(true, 'al terminar de escribir se pone al dia'))
  .catch(() => ok(false, 'al terminar de escribir se pone al dia'));

// Cuando se publica una version nueva de la web, la pestana se recarga sola.
const rutaVersion = new URL('../../public/version.json', import.meta.url);
fs.writeFileSync(rutaVersion, JSON.stringify({ version: 'prueba-1' }));
try {
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForSelector('tr.municipio', { timeout: 15000 });
  await p.waitForTimeout(2500);
  await p.evaluate(() => { window.__sigoSiendoLaMisma = true; });
  fs.writeFileSync(rutaVersion, JSON.stringify({ version: 'prueba-2' }));
  await p.waitForFunction(() => !window.__sigoSiendoLaMisma, null, { timeout: 20000, polling: 500 })
    .then(() => ok(true, 'con una version nueva publicada, la web se recarga sola'))
    .catch(() => ok(false, 'con una version nueva publicada, la web se recarga sola'));
  await p.waitForSelector('tr.municipio', { timeout: 15000 });
} finally {
  fs.rmSync(rutaVersion, { force: true });
}

// ---------------------------------------------------------------------
console.log('13. Cambio de proyecto de Supabase: nada del anterior se mezcla');
{
  // Una sesion que la base no reconoce (de otro proyecto): se pide ingresar,
  // no se muestra un error.
  const { p: p4 } = await nuevaPagina();
  await p4.addInitScript(() => {
    try {
      localStorage.setItem('engel:sesion:127.0.0.1:5555', JSON.stringify({
        access_token: 'token-de-otro-proyecto',
        user: { id: '00000000-0000-0000-0000-000000000000', email: 'jefe@engel.com' }
      }));
    } catch { /* sin localStorage */ }
  });
  await p4.goto(BASE, { waitUntil: 'networkidle' });
  await p4.waitForSelector('.login__caja', { timeout: 15000 });
  const cajaIngreso = await p4.locator('.login__caja').innerText();
  ok(!/No se pudo conectar/i.test(cajaIngreso) && (await p4.locator('input[type=email]').count()) === 1,
    'con la sesion de otro proyecto muestra el ingreso, sin error');
  await p4.fill('input[type=email]', 'jefe@engel.com');
  await p4.fill('input[type=password]', 'clave-larga-123');
  await p4.click('button[type=submit]');
  await p4.waitForSelector('.menu', { timeout: 15000 });
  ok(true, 'y se puede ingresar normalmente');
  await p4.context().close();
}

// Cambios pendientes guardados por una version anterior, sin proyecto: no se
// mandan a la base actual.
await p.evaluate((venta) => {
  localStorage.setItem('engel:cola-de-guardado', JSON.stringify([{
    clave: 'vieja', operacion: 'editar_venta', intentos: 0,
    args: { id: venta, datos: { cliente_nombre: 'NO SE DEBE MANDAR' } }
  }]));
}, Number(psqlValor('SELECT min(id) FROM public.ventas')));
await p.reload({ waitUntil: 'networkidle' });
await p.waitForSelector('.menu', { timeout: 15000 });
await p.waitForTimeout(4000);
ok(psqlValor("SELECT count(*) FROM public.ventas WHERE cliente_nombre = 'NO SE DEBE MANDAR'") === '0',
  'los cambios pendientes de otro proyecto no se mandan a este');

// ---------------------------------------------------------------------
console.log('14. Si la base quedo vieja, la web lo dice');
// La web se publica sola y el SQL se corre a mano: hay que avisar en castellano
// en vez de dejar que Postgres tire un error que nadie entiende.

// La version que pide la web sube con cada cambio del esquema: se lee de ahi
// para que la prueba no haya que retocarla cada vez.
const versionWeb = await p.evaluate(async () => (await import('/js/api.js')).VERSION_ESQUEMA);
const ponerVersion = (n) =>
  psql(`CREATE OR REPLACE FUNCTION public.version_esquema() RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT ${n}'`);

ponerVersion(versionWeb - 1);
await p.goto(BASE, { waitUntil: 'networkidle' });
await p.waitForSelector('.barra-version', { timeout: 15000 }).catch(() => {});
const avisoVersion = await p.locator('.barra-version').innerText().catch(() => '');
ok(/desactualizada/i.test(avisoVersion), 'avisa que la base quedo atras');
ok(/actualizar\.sql/i.test(avisoVersion), 'dice que archivo hay que correr');
await captura(p, '27-base-vieja');

ponerVersion(versionWeb);
await p.goto(BASE, { waitUntil: 'networkidle' });
await p.waitForSelector('.menu', { timeout: 15000 });
ok((await p.locator('.barra-version').count()) === 0, 'con la base al dia no molesta con avisos');

await nav.close();

if (errores.length) {
  console.log('\nPROBLEMAS:');
  errores.forEach((e) => console.log(' -', e));
  process.exit(1);
}
console.log('\nTodo verificado contra el esquema real, sin errores de consola.');
