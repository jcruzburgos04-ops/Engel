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
  const entrada = campoDominio({
    placeholder: 'AB123CD',
    style: 'font-size:1.15rem;padding:.7rem .9rem',
    onInput: () => pedirSugerencias(entrada.value)
  });
  const resultados = h('div', {});

  // ---------- Sugerencias mientras se escribe ----------
  const lista = h('div', { class: 'sugerencias', role: 'listbox', hidden: true });
  let sugerencias = [];
  let marcada = -1;
  let reloj = null;
  let ultimoPedido = 0;

  function cerrarSugerencias() {
    lista.hidden = true;
    marcada = -1;
  }

  function marcar(indice) {
    marcada = indice;
    [...lista.children].forEach((fila, i) => fila.classList.toggle('sugerencia--activa', i === marcada));
  }

  function elegir(sugerencia) {
    entrada.value = sugerencia.dominio;
    cerrarSugerencias();
    buscar(sugerencia.dominio);
  }

  function dibujarSugerencias() {
    vaciar(lista);
    if (!sugerencias.length) return cerrarSugerencias();

    sugerencias.forEach((s, i) => {
      lista.append(
        h(
          'div',
          {
            class: 'sugerencia',
            role: 'option',
            // mousedown en vez de click: el click llega despues del blur y la
            // lista ya estaria cerrada.
            onMousedown: (e) => { e.preventDefault(); elegir(s); },
            onMouseenter: () => marcar(i)
          },
          etiquetaDominio(s.dominio),
          h('span', { class: 'sugerencia__texto' },
            [s.descripcion, s.anio].filter(Boolean).join(' · ') || 'Sin marca ni modelo'),
          h('span', { class: 'sugerencia__papeles' },
            s.documentos ? `${s.aprobados}/${s.documentos} papeles` : 'sin papeles')
        )
      );
    });

    marcar(-1);
    lista.hidden = false;
    return undefined;
  }

  // Se espera un momento entre tecla y tecla para no pedirle una consulta a
  // la base por cada letra.
  function pedirSugerencias(valor) {
    clearTimeout(reloj);
    const texto = String(valor || '').replace(/[^A-Za-z0-9]/g, '');
    if (!texto) {
      sugerencias = [];
      cerrarSugerencias();
      return;
    }

    reloj = setTimeout(async () => {
      const miPedido = ++ultimoPedido;
      const encontradas = await api.sugerirDominios(texto);
      // Si mientras tanto se siguio escribiendo, esta respuesta ya no sirve.
      if (miPedido !== ultimoPedido || entrada.value.replace(/[^A-Z0-9]/g, '') !== texto.toUpperCase()) return;
      sugerencias = encontradas;
      dibujarSugerencias();
    }, 150);
  }

  entrada.addEventListener('keydown', (e) => {
    if (lista.hidden || !sugerencias.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      marcar((marcada + 1) % sugerencias.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      marcar(marcada <= 0 ? sugerencias.length - 1 : marcada - 1);
    } else if (e.key === 'Enter' && marcada >= 0) {
      e.preventDefault();
      elegir(sugerencias[marcada]);
    } else if (e.key === 'Escape') {
      cerrarSugerencias();
    }
  });

  entrada.addEventListener('blur', () => cerrarSugerencias());
  entrada.addEventListener('focus', () => { if (sugerencias.length) dibujarSugerencias(); });

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
        cerrarSugerencias();
        buscar(entrada.value);
      }
    },
    h(
      'div',
      { style: 'display:flex;gap:.5rem;align-items:stretch' },
      h('div', { class: 'sugeridor' }, entrada, lista),
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
