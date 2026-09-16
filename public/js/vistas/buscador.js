import { api } from '../api.js';
import {
  h, vaciar, fecha, fechaHora, tamano, numero, avisar, campoDominio, etiquetaDominio,
  etiquetaEstadoVenta, etiquetaTenencia, descripcionVehiculo, vacio, ESTADOS_DOCUMENTO
} from '../util.js';
import { encabezado } from '../app.js';
import { descargarArchivo } from '../descargas.js';
import { botonZip } from './documentos-ui.js';

function fichaVehiculo(vehiculo) {
  const filas = [
    ['Marca y modelo', descripcionVehiculo(vehiculo)],
    ['Color', vehiculo.color || '—'],
    ['Kilometraje', vehiculo.kilometraje ? `${numero(vehiculo.kilometraje)} km` : '—'],
    ['Nro. de chasis', vehiculo.nro_chasis || '—'],
    ['Nro. de motor', vehiculo.nro_motor || '—'],
    ['Descripcion', vehiculo.descripcion || '—']
  ];

  return h(
    'section',
    { class: 'tarjeta' },
    h(
      'div',
      { class: 'tarjeta__titulo' },
      etiquetaDominio(vehiculo.dominio),
      h('span', {}, descripcionVehiculo(vehiculo)),
      etiquetaTenencia(vehiculo.tenencia),
      h('span', { class: 'derecha' }, botonZip(vehiculo.dominio, '⬇️ Descargar toda la documentacion'))
    ),
    h(
      'div',
      { class: 'tarjeta__cuerpo' },
      h('div', { class: 'campos' },
        ...filas.map(([etiqueta, valor]) =>
          h('div', { class: 'campo' }, h('label', {}, etiqueta), h('div', {}, valor))))
    )
  );
}

function tablaOperaciones(ventas) {
  return h(
    'section',
    { class: 'tarjeta' },
    h('div', { class: 'tarjeta__titulo' }, `Operaciones donde aparece este dominio (${ventas.length})`),
    h(
      'div',
      { class: 'tabla-scroll' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Venta'), h('th', {}, 'Rol'), h('th', {}, 'Fecha'), h('th', {}, 'Cliente'), h('th', {}, 'Vendedor'), h('th', {}, 'Entrega est.'), h('th', {}, 'Estado'), h('th', {}))),
        h(
          'tbody',
          {},
          ...ventas.map((venta) =>
            h(
              'tr',
              {},
              h('td', {}, `#${venta.id}`),
              h('td', {}, venta.rol === 'permuta'
                ? h('span', { class: 'etiqueta etiqueta--info' }, '🔄 Permuta')
                : h('span', { class: 'etiqueta' }, 'Auto vendido')),
              h('td', {}, fecha(venta.fecha_venta)),
              h('td', {}, venta.cliente_nombre),
              h('td', {}, venta.vendedor_nombre),
              h('td', {}, fecha(venta.fecha_entrega_estimada)),
              h('td', {}, etiquetaEstadoVenta(venta.estado)),
              h('td', { class: 'acciones' }, h('a', { class: 'boton boton--chico', href: `#/ventas/${venta.id}` }, 'Abrir'))
            )
          )
        )
      )
    )
  );
}

function tablaDocumentos(documentos) {
  if (!documentos.length) return vacio('Este dominio todavia no tiene checklist de documentacion.', '📁');

  return h(
    'section',
    { class: 'tarjeta' },
    h('div', { class: 'tarjeta__titulo' }, 'Documentacion cargada'),
    h(
      'div',
      { class: 'tabla-scroll' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Documento'), h('th', {}, 'Venta'), h('th', {}, 'Estado'), h('th', {}, 'Archivos'), h('th', {}, 'Observaciones'))),
        h(
          'tbody',
          {},
          ...documentos.map((doc) => {
            const info = ESTADOS_DOCUMENTO[doc.estado] || { texto: doc.estado, clase: '' };
            return h(
              'tr',
              {},
              h('td', {}, h('strong', {}, doc.etiqueta)),
              h('td', {}, h('a', { href: `#/ventas/${doc.venta_id}` }, `#${doc.venta_id}`),
                doc.rol === 'permuta' ? h('div', { class: 'mini' }, 'como permuta') : null),
              h('td', {}, h('span', { class: `etiqueta ${info.clase}` }, info.texto)),
              h(
                'td',
                {},
                doc.archivos.length
                  ? h('div', { style: 'display:flex;flex-wrap:wrap;gap:.35rem' },
                      ...doc.archivos.map((archivo) =>
                        h('span', { class: 'archivo' },
                          h('a', {
                            href: '#',
                            title: `Subido el ${fechaHora(archivo.subido_en)}`,
                            onClick: async (e) => {
                              e.preventDefault();
                              try {
                                await descargarArchivo(archivo);
                              } catch (error) {
                                avisar(error.message, 'error');
                              }
                            }
                          }, `📄 ${archivo.nombre_original}`),
                          h('span', { class: 'mini' }, tamano(archivo.tamano)))))
                  : h('span', { class: 'tenue' }, 'Sin archivos')
              ),
              h('td', {}, doc.observaciones || '—')
            );
          })
        )
      )
    )
  );
}

export async function vistaBuscador({ dominio } = {}) {
  const entrada = campoDominio({ placeholder: 'AB123CD', style: 'font-size:1.15rem;padding:.7rem .9rem' });
  const resultados = h('div', {});

  async function buscar(valor) {
    const limpio = String(valor || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!limpio) {
      vaciar(resultados).append(vacio('Escribi un dominio para ver el auto, sus operaciones y bajar los papeles.', '🔎'));
      return;
    }

    history.replaceState(null, '', `#/buscador/${limpio}`);
    vaciar(resultados).append(h('div', { class: 'cargando' }, 'Buscando…'));

    try {
      const datos = await api.buscarDominio(limpio);
      vaciar(resultados).append(
        fichaVehiculo(datos.vehiculo),
        datos.ventas.length ? tablaOperaciones(datos.ventas) : vacio('Este dominio no esta vinculado a ninguna operacion.', '🧾'),
        tablaDocumentos(datos.documentos)
      );
    } catch (error) {
      vaciar(resultados).append(
        h('div', { class: 'aviso aviso--error' }, error.message),
        vacio('Proba con otro dominio o carga la venta desde "Cargar venta".', '🔎')
      );
    }
  }

  const formulario = h(
    'form',
    {
      onSubmit: (e) => {
        e.preventDefault();
        buscar(entrada.value);
      }
    },
    h(
      'div',
      { style: 'display:flex;gap:.5rem;align-items:stretch' },
      entrada,
      h('button', { class: 'boton boton--primario', type: 'submit' }, 'Buscar')
    )
  );

  const contenedor = h(
    'div',
    {},
    encabezado('Buscar por dominio', 'Entra la patente y baja toda la documentacion del auto'),
    h('section', { class: 'tarjeta' }, h('div', { class: 'tarjeta__cuerpo' }, formulario)),
    resultados
  );

  if (dominio) {
    entrada.value = String(dominio).toUpperCase();
    await buscar(dominio);
  } else {
    vaciar(resultados).append(vacio('Escribi un dominio para ver el auto, sus operaciones y bajar los papeles.', '🔎'));
    setTimeout(() => entrada.focus(), 0);
  }

  return contenedor;
}
