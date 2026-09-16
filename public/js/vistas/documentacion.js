import { api } from '../api.js';
import {
  h, vaciar, fecha, diasHasta, avisar, etiquetaDominio, etiquetaTenencia, barraProgreso,
  vacio, campo, campoCasilla
} from '../util.js';
import { encabezado } from '../app.js';
import { descargarDocumentacionCsv } from '../descargas.js';
import { botonZip } from './documentos-ui.js';

function descripcion(fila) {
  return [fila.marca, fila.modelo, fila.anio].filter(Boolean).join(' ') || fila.descripcion || 'Sin descripcion';
}

function filaPanel(fila) {
  const dias = diasHasta(fila.fecha_entrega_estimada);
  let entrega = h('span', { class: 'tenue' }, 'Sin fecha');
  if (fila.fecha_entrega_estimada) {
    const texto = fecha(fila.fecha_entrega_estimada);
    if (dias < 0) entrega = h('span', {}, texto, h('div', {}, h('span', { class: 'etiqueta etiqueta--error' }, `Vencida ${Math.abs(dias)} d`)));
    else if (dias <= 7) entrega = h('span', {}, texto, h('div', {}, h('span', { class: 'etiqueta etiqueta--aviso' }, dias === 0 ? 'Hoy' : `En ${dias} d`)));
    else entrega = h('span', {}, texto);
  }

  const faltan = fila.total - fila.listos;

  return h(
    'tr',
    {},
    h(
      'td',
      {},
      h('a', { href: `#/ventas/${fila.venta_id}` }, etiquetaDominio(fila.dominio)),
      h('div', { style: 'margin-top:.25rem' },
        fila.rol === 'permuta'
          ? h('span', { class: 'etiqueta etiqueta--info' }, '🔄 Permuta')
          : etiquetaTenencia(fila.tenencia))
    ),
    h('td', {}, descripcion(fila), h('div', { class: 'mini' }, `Venta #${fila.venta_id} · ${fila.cliente_nombre}`)),
    h('td', {}, fila.vendedor_nombre),
    h('td', {}, entrega),
    h('td', {}, barraProgreso(fila.listos, fila.total),
      faltan > 0 ? h('div', { class: 'mini' }, `faltan ${faltan}`) : h('div', { class: 'mini' }, 'completo')),
    h('td', { class: 'numero' }, `${fila.archivos} archivo${fila.archivos === 1 ? '' : 's'}`),
    h(
      'td',
      { class: 'acciones' },
      h('a', { class: 'boton boton--chico', href: `#/ventas/${fila.venta_id}` }, 'Cargar'),
      fila.archivos ? (() => { const b = botonZip(fila.dominio, 'ZIP'); b.style.marginLeft = '.3rem'; return b; })() : null
    )
  );
}

export async function vistaDocumentacion() {
  const buscador = h('input', { type: 'search', placeholder: 'Dominio, vehiculo o cliente…' });
  const verTodos = h('input', { type: 'checkbox' });
  const resultados = h('section', { class: 'tarjeta' }, h('div', { class: 'cargando' }, 'Cargando…'));

  async function cargar() {
    vaciar(resultados).append(h('div', { class: 'cargando' }, 'Cargando…'));
    try {
      const { filas } = await api.panelDocumentacion({
        q: buscador.value.trim(),
        todos: verTodos.checked ? 'true' : ''
      });

      const titulo = h(
        'div',
        { class: 'tarjeta__titulo' },
        verTodos.checked
          ? `${filas.length} auto(s) en operaciones activas`
          : `${filas.length} auto(s) con documentacion pendiente`,
        h('span', { class: 'derecha' }, h(
          'button',
          {
            class: 'boton boton--chico',
            type: 'button',
            onClick: async (e) => {
              const b = e.currentTarget;
              b.disabled = true;
              try {
                await descargarDocumentacionCsv();
              } catch (error) {
                avisar(error.message, 'error');
              } finally {
                b.disabled = false;
              }
            }
          },
          '⬇️ Exportar CSV'
        ))
      );

      if (!filas.length) {
        vaciar(resultados).append(
          titulo,
          vacio(verTodos.checked ? 'No hay operaciones activas.' : '¡Toda la documentacion esta al dia!', '✅')
        );
        return;
      }

      vaciar(resultados).append(
        titulo,
        h(
          'div',
          { class: 'tabla-scroll' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {},
              h('th', {}, 'Dominio'), h('th', {}, 'Vehiculo'), h('th', {}, 'Vendedor'),
              h('th', {}, 'Entrega est.'), h('th', {}, 'Documentacion'), h('th', { class: 'numero' }, 'Archivos'), h('th', {}))),
            h('tbody', {}, ...filas.map(filaPanel))
          )
        )
      );
    } catch (error) {
      vaciar(resultados).append(h('div', { class: 'aviso aviso--error', style: 'margin:1rem' }, error.message));
    }
  }

  let temporizador;
  buscador.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(cargar, 250);
  });
  verTodos.addEventListener('change', cargar);

  const filtros = h(
    'section',
    { class: 'tarjeta' },
    h(
      'div',
      { class: 'tarjeta__cuerpo' },
      h(
        'div',
        { class: 'filtros' },
        (() => { const c = campo('Buscar', buscador); c.classList.add('campo--busqueda'); return c; })(),
        campoCasilla('Ver tambien las completas', verTodos)
      )
    )
  );

  const contenedor = h(
    'div',
    {},
    encabezado(
      'Documentacion',
      'Autos con papeles pendientes, ordenados por fecha de entrega mas cercana'
    ),
    filtros,
    resultados
  );

  await cargar();
  return contenedor;
}
