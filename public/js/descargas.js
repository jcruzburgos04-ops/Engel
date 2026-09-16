// Descargas armadas en el navegador: sin servidor propio, el ZIP y el CSV
// se generan aca mismo con los datos que ya tiene la pagina.

import { api } from './api.js';
import { avisar } from './util.js';

const CDN_ZIP = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

let zipPromesa;
function cargarZip() {
  if (!zipPromesa) {
    const modulo = globalThis.__ENGEL_MODULO_ZIP__ || CDN_ZIP;
    zipPromesa = import(/* @vite-ignore */ modulo).then((m) => m.default || m);
  }
  return zipPromesa;
}

function bajar(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  // Se libera despues, para que el navegador alcance a arrancar la descarga.
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/** Abre un archivo guardado, pidiendo un enlace temporal. */
export async function descargarArchivo(archivo) {
  const blob = await api.descargarArchivo(archivo);
  bajar(blob, archivo.nombre_original);
}

/** Toda la documentacion de un dominio, en un ZIP. */
export async function descargarZipDominio(dominio, { alAvanzar } = {}) {
  const datos = await api.buscarDominio(dominio);

  const conArchivos = (datos.documentos || []).filter((d) => d.archivos && d.archivos.length);
  const total = conArchivos.reduce((suma, d) => suma + d.archivos.length, 0);

  if (!total) {
    throw new Error(`El dominio ${dominio} todavia no tiene documentacion cargada.`);
  }

  const JSZip = await cargarZip();
  const zip = new JSZip();
  const usados = new Set();
  let hechos = 0;
  const fallados = [];

  for (const documento of conArchivos) {
    for (const archivo of documento.archivos) {
      const carpeta = `venta-${documento.venta_id}/${documento.etiqueta}`;
      let nombre = `${carpeta}/${archivo.nombre_original}`;
      let sufijo = 2;
      while (usados.has(nombre)) nombre = `${carpeta}/(${sufijo++}) ${archivo.nombre_original}`;
      usados.add(nombre);

      try {
        zip.file(nombre, await api.descargarArchivo(archivo));
      } catch {
        fallados.push(archivo.nombre_original);
      }
      hechos += 1;
      if (alAvanzar) alAvanzar(hechos, total);
    }
  }

  if (fallados.length) {
    avisar(`No se pudieron incluir ${fallados.length} archivo(s): ${fallados.join(', ')}`, 'error');
  }

  bajar(await zip.generateAsync({ type: 'blob' }), `documentacion-${dominio}.zip`);
}

// ---------------------------------------------------------------------
// Planillas
// ---------------------------------------------------------------------

function celda(valor) {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor).replace(/"/g, '""');
  return /[";\n\r]/.test(texto) ? `"${texto}"` : texto;
}

export function descargarCsv(nombre, encabezados, filas) {
  const lineas = [encabezados.map(celda).join(';')];
  for (const fila of filas) lineas.push(fila.map(celda).join(';'));
  // El BOM hace que Excel abra bien los acentos.
  bajar(new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' }), nombre);
}

const ETIQUETA_ESTADO = {
  pendiente: 'Pendiente',
  en_preparacion: 'En preparacion',
  listo_entrega: 'Listo para entrega',
  entregado: 'Entregado',
  cancelado: 'Cancelado'
};

/** Planilla de ventas, respetando los filtros que esten puestos. */
export async function descargarVentasCsv(filtros = {}) {
  const { ventas } = await api.ventas({ ...filtros, limite: 500, pagina: 1 });

  const encabezados = [
    'Venta', 'Fecha', 'Vendio', 'Estado', 'Dominio', 'Marca', 'Modelo', 'Version', 'Anio',
    'Color', 'Kilometraje', 'Origen', 'Consignante', 'Descripcion', 'Cliente', 'Telefono',
    'Precio', 'Moneda', 'Forma de pago', 'Permutas', 'Entrega estimada', 'Entrega real',
    'Documentacion', 'Detalles'
  ];

  // Las permutas de cada venta se piden solo para las que tienen alguna.
  const permutasPorVenta = new Map();
  for (const venta of ventas.filter((v) => v.cantidad_permutas > 0)) {
    const { venta: ficha } = await api.venta(venta.id);
    permutasPorVenta.set(
      venta.id,
      ficha.permutas
        .map((p) => {
          const detalle = [p.dominio, [p.marca, p.modelo, p.anio].filter(Boolean).join(' ')]
            .filter(Boolean)
            .join(' - ');
          return p.valor_tomado ? `${detalle} (${p.moneda} ${p.valor_tomado})` : detalle;
        })
        .join(' | ')
    );
  }

  const filas = ventas.map((v) => [
    v.id, v.fecha_venta, v.vendedor_nombre, ETIQUETA_ESTADO[v.estado] || v.estado,
    v.dominio, v.marca, v.modelo, v.version, v.anio, v.color, v.kilometraje,
    v.tenencia === 'consigna' ? 'Consigna' : 'Propio', v.consignante_nombre, v.descripcion,
    v.cliente_nombre, v.cliente_telefono, v.precio_venta, v.moneda, v.forma_pago,
    permutasPorVenta.get(v.id) || '',
    v.fecha_entrega_estimada || '', v.fecha_entrega_real || '',
    `${v.documentos_listos}/${v.documentos_total}`, v.detalles
  ]);

  descargarCsv(`ventas-engel-${new Date().toISOString().slice(0, 10)}.csv`, encabezados, filas);
}

/** Estado de la documentacion de todas las operaciones activas. */
export async function descargarDocumentacionCsv() {
  const { filas } = await api.panelDocumentacion({ todos: 'true' });

  descargarCsv(
    `documentacion-engel-${new Date().toISOString().slice(0, 10)}.csv`,
    ['Venta', 'Dominio', 'Rol', 'Vehiculo', 'Cliente', 'Vendio', 'Entrega estimada',
     'Listos', 'Total', 'Pendientes', 'En tramite', 'Archivos'],
    filas.map((f) => [
      f.venta_id, f.dominio, f.rol === 'permuta' ? 'Permuta' : 'Venta',
      [f.marca, f.modelo, f.anio].filter(Boolean).join(' '),
      f.cliente_nombre, f.vendedor_nombre, f.fecha_entrega_estimada || '',
      f.listos, f.total, f.pendientes, f.en_tramite, f.archivos
    ])
  );
}

/** Copia completa de toda la informacion, para guardarla aparte. */
export async function descargarCopiaCompleta() {
  const datos = await api.exportarTodo();
  bajar(
    new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' }),
    `engel-copia-${new Date().toISOString().slice(0, 10)}.json`
  );
  return datos;
}
