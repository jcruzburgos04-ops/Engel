import { api } from '../api.js';
import {
  h, vaciar, avisar, confirmar, fechaHora, tamano, etiquetaDominio,
  barraProgreso, ESTADOS_DOCUMENTO, opciones
} from '../util.js';

function chipArchivo(archivo, alBorrar) {
  return h(
    'span',
    { class: 'archivo', title: `${archivo.nombre_original} · ${tamano(archivo.tamano)} · subido por ${archivo.subido_por_nombre || 'alguien'} el ${fechaHora(archivo.subido_en)}` },
    h('a', { href: api.urlArchivo(archivo.id), download: archivo.nombre_original }, `📄 ${archivo.nombre_original}`),
    h('span', { class: 'mini' }, tamano(archivo.tamano)),
    h(
      'button',
      {
        type: 'button',
        title: 'Borrar archivo',
        onClick: async () => {
          if (!(await confirmar(`Vas a borrar "${archivo.nombre_original}". Esta accion no se puede deshacer.`, { textoBoton: 'Borrar archivo' }))) return;
          try {
            const { documentacion } = await api.borrarArchivo(archivo.id);
            avisar('Archivo borrado.');
            alBorrar(documentacion);
          } catch (error) {
            avisar(error.message, 'error');
          }
        }
      },
      '×'
    )
  );
}

function filaDocumento(item, alActualizar) {
  const selector = opciones(
    h('select', { class: 'boton--chico' }),
    Object.entries(ESTADOS_DOCUMENTO).map(([valor, info]) => ({ valor, texto: info.texto })),
    item.estado
  );

  selector.addEventListener('change', async () => {
    try {
      const { documentacion } = await api.editarDocumento(item.id, { estado: selector.value });
      alActualizar(documentacion);
    } catch (error) {
      avisar(error.message, 'error');
      selector.value = item.estado;
    }
  });

  const observaciones = h('input', {
    value: item.observaciones || '',
    placeholder: 'Observaciones…',
    style: 'font-size:.82rem'
  });

  observaciones.addEventListener('change', async () => {
    try {
      const { documentacion } = await api.editarDocumento(item.id, { observaciones: observaciones.value });
      avisar('Observacion guardada.');
      alActualizar(documentacion);
    } catch (error) {
      avisar(error.message, 'error');
    }
  });

  const entrada = h('input', { type: 'file', multiple: true, style: 'display:none' });
  const botonSubir = h('button', { class: 'boton boton--chico', type: 'button', onClick: () => entrada.click() }, '⬆️ Subir');

  entrada.addEventListener('change', async () => {
    if (!entrada.files.length) return;
    const formulario = new FormData();
    for (const archivo of entrada.files) formulario.append('archivos', archivo);

    botonSubir.disabled = true;
    botonSubir.textContent = 'Subiendo…';
    try {
      const { documentacion } = await api.subirArchivos(item.id, formulario);
      avisar(`${entrada.files.length} archivo(s) cargados en ${item.etiqueta}.`);
      alActualizar(documentacion);
    } catch (error) {
      avisar(error.message, 'error');
    } finally {
      botonSubir.disabled = false;
      botonSubir.textContent = '⬆️ Subir';
      entrada.value = '';
    }
  });

  const indicador = { pendiente: '⬜', en_tramite: '🟡', ok: '✅', no_aplica: '➖' }[item.estado] || '⬜';

  return h(
    'div',
    { class: 'doc-item' },
    h('div', { class: 'doc-item__nombre' }, `${indicador} ${item.etiqueta}`),
    h('div', { class: 'doc-item__estado' }, selector),
    h('div', { style: 'flex:1 1 180px' }, observaciones),
    h('div', {}, botonSubir, entrada),
    item.archivos.length
      ? h('div', { class: 'doc-item__archivos' }, ...item.archivos.map((a) => chipArchivo(a, alActualizar)))
      : null
  );
}

// Tarjeta con el checklist de documentacion de un auto de la operacion.
export function tarjetaDocumentacion(grupo, alActualizar) {
  const completo = grupo.listos === grupo.total;

  return h(
    'section',
    { class: 'tarjeta' },
    h(
      'div',
      { class: 'tarjeta__titulo' },
      etiquetaDominio(grupo.dominio),
      h('span', {}, grupo.descripcion),
      grupo.rol === 'permuta'
        ? h('span', { class: 'etiqueta etiqueta--info' }, '🔄 Permuta')
        : h('span', { class: 'etiqueta' }, 'Auto vendido'),
      completo ? h('span', { class: 'etiqueta etiqueta--ok' }, 'Documentacion completa') : null,
      h(
        'span',
        { class: 'derecha' },
        barraProgreso(grupo.listos, grupo.total),
        h('a', { class: 'boton boton--chico', href: api.urlZipDominio(grupo.dominio) }, '⬇️ ZIP')
      )
    ),
    h('div', { class: 'tarjeta__cuerpo' }, ...grupo.items.map((item) => filaDocumento(item, alActualizar)))
  );
}

// Redibuja el bloque completo de documentacion cuando algo cambia.
export function bloqueDocumentacion(documentacion) {
  const contenedor = h('div', {});

  const pintar = (datos) => {
    vaciar(contenedor).append(...datos.map((grupo) => tarjetaDocumentacion(grupo, pintar)));
  };

  pintar(documentacion);
  return contenedor;
}
