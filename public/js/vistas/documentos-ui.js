import { api } from '../api.js';
import { encolar } from '../guardado.js';
import { descargarArchivo, descargarZipDominio } from '../descargas.js';
import {
  h, vaciar, avisar, confirmar, fechaHora, tamano, etiquetaDominio,
  barraProgreso, ESTADOS_DOCUMENTO, opciones, mientrasTrabaja
} from '../util.js';

function chipArchivo(archivo, alBorrar) {
  return h(
    'span',
    { class: 'archivo', title: `${archivo.nombre_original} · ${tamano(archivo.tamano)} · subido por ${archivo.subido_por_nombre || 'alguien'} el ${fechaHora(archivo.subido_en)}` },
    h(
      'a',
      {
        href: '#',
        onClick: async (e) => {
          e.preventDefault();
          try {
            await descargarArchivo(archivo);
          } catch (error) {
            avisar(error.message, 'error');
          }
        }
      },
      `📄 ${archivo.nombre_original}`
    ),
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

  selector.addEventListener('change', () => {
    encolar({
      clave: `documento:${item.id}:estado`,
      operacion: 'editar_documento',
      args: { id: item.id, cambios: { estado: selector.value } },
      descripcion: `Estado de ${item.etiqueta}`,
      alConfirmar: ({ documentacion }) => alActualizar(documentacion),
      alFallar: (error) => {
        avisar(error.message, 'error');
        selector.value = item.estado;
      }
    });
  });

  const observaciones = h('input', {
    value: item.observaciones || '',
    placeholder: 'Observaciones…',
    style: 'font-size:.82rem'
  });

  const guardarObservacion = () => {
    if (observaciones.value === (item.observaciones || '')) return;
    encolar({
      clave: `documento:${item.id}:observaciones`,
      operacion: 'editar_documento',
      args: { id: item.id, cambios: { observaciones: observaciones.value } },
      descripcion: `Observaciones de ${item.etiqueta}`,
      alConfirmar: ({ documentacion }) => alActualizar(documentacion),
      alFallar: (error) => avisar(error.message, 'error')
    });
  };
  observaciones.addEventListener('change', guardarObservacion);
  observaciones.addEventListener('blur', guardarObservacion);

  const entrada = h('input', { type: 'file', multiple: true, style: 'display:none' });
  const botonSubir = h('button', { class: 'boton boton--chico', type: 'button', onClick: () => entrada.click() }, '⬆️ Subir');

  entrada.addEventListener('change', async () => {
    if (!entrada.files.length) return;
    const elegidos = [...entrada.files];
    const cantidad = elegidos.length;
    botonSubir.disabled = true;

    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
    const ESPERAS = [1000, 3000, 6000, 12000];
    let ultimoError;

    for (let intento = 0; intento <= ESPERAS.length; intento += 1) {
      botonSubir.textContent = intento === 0 ? 'Subiendo…' : `Reintentando (${intento})…`;
      try {
        const { documentacion } = await mientrasTrabaja(api.subirArchivos(item.id, elegidos));
        avisar(`${cantidad} archivo(s) cargados en ${item.etiqueta}.`);
        alActualizar(documentacion);
        ultimoError = null;
        break;
      } catch (error) {
        ultimoError = error;
        // Si el servidor rechazo el archivo, reintentar no sirve.
        if (error.status >= 400 && error.status < 500) break;
        if (intento < ESPERAS.length) await esperar(ESPERAS[intento]);
      }
    }

    if (ultimoError) {
      avisar(`${ultimoError.message} El archivo no se subio: volve a intentarlo.`, 'error');
    }

    botonSubir.disabled = false;
    botonSubir.textContent = '⬆️ Subir';
    entrada.value = '';
  });

  const indicador = (ESTADOS_DOCUMENTO[item.estado] || ESTADOS_DOCUMENTO.faltante).icono;

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

// Boton que arma el ZIP con toda la documentacion de un dominio.
export function botonZip(dominio, texto = '⬇️ ZIP') {
  const boton = h(
    'button',
    {
      class: 'boton boton--chico',
      type: 'button',
      onClick: async () => {
        boton.disabled = true;
        const original = boton.textContent;
        try {
          await descargarZipDominio(dominio, {
            alAvanzar: (hechos, total) => { boton.textContent = `Armando ${hechos}/${total}…`; }
          });
        } catch (error) {
          avisar(error.message, 'error');
        } finally {
          boton.disabled = false;
          boton.textContent = original;
        }
      }
    },
    texto
  );
  return boton;
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
        botonZip(grupo.dominio)
      )
    ),
    h('div', { class: 'tarjeta__cuerpo' }, ...grupo.items.map((item) => filaDocumento(item, alActualizar)))
  );
}

// Redibuja el bloque completo de documentacion cuando algo cambia.
// `alCambiar` recibe la documentacion nueva, para que el contador del titulo
// no quede mostrando un numero viejo.
export function bloqueDocumentacion(documentacion, alCambiar) {
  const contenedor = h('div', {});

  const pintar = (datos) => {
    vaciar(contenedor).append(...datos.map((grupo) => tarjetaDocumentacion(grupo, pintar)));
    if (alCambiar) alCambiar(datos);
  };

  pintar(documentacion);
  return contenedor;
}
