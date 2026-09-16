import { api } from '../api.js';
import {
  h, vaciar, fecha, dinero, diasHasta, avisar, etiquetaEstadoVenta, etiquetaDominio,
  etiquetaTenencia, descripcionVehiculo, barraProgreso, vacio, campo, opciones, ESTADOS_VENTA
} from '../util.js';
import { encabezado, estado as estadoApp } from '../app.js';
import { descargarVentasCsv } from '../descargas.js';

function filtrosDeLaUrl() {
  const partes = location.hash.split('?');
  const query = new URLSearchParams(partes[1] || '');
  return {
    q: query.get('q') || '',
    estado: query.get('estado') || '',
    vendedor_id: query.get('vendedor_id') || '',
    tenencia: query.get('tenencia') || '',
    desde: query.get('desde') || '',
    hasta: query.get('hasta') || '',
    entrega_vencida: query.get('entrega_vencida') || '',
    pagina: Number(query.get('pagina')) || 1
  };
}

function actualizarUrl(filtros) {
  const query = new URLSearchParams();
  for (const [clave, valor] of Object.entries(filtros)) {
    if (valor && !(clave === 'pagina' && valor === 1)) query.set(clave, valor);
  }
  const texto = query.toString();
  history.replaceState(null, '', `#/ventas${texto ? `?${texto}` : ''}`);
}

function avisoEntrega(venta) {
  if (venta.estado === 'entregado' || venta.estado === 'cancelado') return null;
  const dias = diasHasta(venta.fecha_entrega_estimada);
  if (dias === null) return null;
  if (dias < 0) return h('span', { class: 'etiqueta etiqueta--error' }, `Vencida ${Math.abs(dias)} d`);
  if (dias <= 3) return h('span', { class: 'etiqueta etiqueta--aviso' }, dias === 0 ? 'Hoy' : `En ${dias} d`);
  return null;
}

function fila(venta) {
  const aviso = avisoEntrega(venta);
  return h(
    'tr',
    {},
    h(
      'td',
      {},
      h('a', { href: `#/ventas/${venta.id}` }, etiquetaDominio(venta.dominio)),
      venta.cantidad_permutas
        ? h('div', { style: 'margin-top:.25rem' }, h('span', { class: 'etiqueta etiqueta--info' }, `🔄 ${venta.cantidad_permutas} permuta${venta.cantidad_permutas > 1 ? 's' : ''}`))
        : null
    ),
    h(
      'td',
      {},
      h('a', { href: `#/ventas/${venta.id}`, style: 'font-weight:600;text-decoration:none;color:inherit' }, descripcionVehiculo(venta)),
      h('div', { class: 'mini oculta-movil' }, venta.descripcion || ''),
      h('div', { class: 'mini solo-movil' }, venta.cliente_nombre)
    ),
    h('td', { class: 'oculta-movil' }, etiquetaTenencia(venta.tenencia), venta.consignante_nombre ? h('div', { class: 'mini' }, venta.consignante_nombre) : null),
    h('td', { class: 'oculta-movil' }, venta.cliente_nombre, venta.cliente_telefono ? h('div', { class: 'mini' }, venta.cliente_telefono) : null),
    h('td', { class: 'oculta-movil' }, venta.vendedor_nombre),
    h('td', { class: 'numero oculta-movil' }, dinero(venta.precio_venta, venta.moneda)),
    h('td', { class: 'oculta-movil' }, fecha(venta.fecha_venta)),
    h('td', {}, fecha(venta.fecha_entrega_estimada), aviso ? h('div', { style: 'margin-top:.2rem' }, aviso) : null),
    h('td', { class: 'oculta-movil' }, barraProgreso(venta.documentos_listos, venta.documentos_total)),
    h('td', {}, etiquetaEstadoVenta(venta.estado)),
    h('td', { class: 'acciones oculta-movil' }, h('a', { class: 'boton boton--chico', href: `#/ventas/${venta.id}` }, 'Abrir'))
  );
}

export async function vistaVentas() {
  const filtros = filtrosDeLaUrl();

  const contenedor = h('div', {});
  const resultados = h('section', { class: 'tarjeta' }, h('div', { class: 'cargando' }, 'Buscando…'));

  const controles = {
    q: h('input', { type: 'search', placeholder: 'Dominio, cliente, vehiculo o vendedor…', value: filtros.q }),
    estado: opciones(
      h('select', {}),
      [{ valor: '', texto: 'Todos los estados' }, ...Object.entries(ESTADOS_VENTA).map(([valor, info]) => ({ valor, texto: info.texto }))],
      filtros.estado
    ),
    vendedor_id: h('input', {
      type: 'checkbox',
      checked: String(filtros.vendedor_id) === String(estadoApp.usuario.id)
    }),
    tenencia: opciones(
      h('select', {}),
      [{ valor: '', texto: 'Propios y consigna' }, { valor: 'propio', texto: 'Solo propios' }, { valor: 'consigna', texto: 'Solo consigna' }],
      filtros.tenencia
    ),
    desde: h('input', { type: 'date', value: filtros.desde }),
    hasta: h('input', { type: 'date', value: filtros.hasta })
  };

  function leerFiltros() {
    return {
      q: controles.q.value.trim(),
      estado: controles.estado.value,
      vendedor_id: controles.vendedor_id.checked ? String(estadoApp.usuario.id) : '',
      tenencia: controles.tenencia.value,
      desde: controles.desde.value,
      hasta: controles.hasta.value,
      entrega_vencida: filtros.entrega_vencida,
      pagina: 1
    };
  }

  let filtrosActivos = filtros;

  async function buscar(nuevos) {
    filtrosActivos = { ...filtrosActivos, ...nuevos };
    actualizarUrl(filtrosActivos);
    vaciar(resultados).append(h('div', { class: 'cargando' }, 'Buscando…'));

    try {
      const datos = await api.ventas(filtrosActivos);
      vaciar(resultados).append(...armarTabla(datos));
    } catch (error) {
      vaciar(resultados).append(h('div', { class: 'aviso aviso--error', style: 'margin:1rem' }, error.message));
    }
  }

  function armarTabla(datos) {
    const titulo = h(
      'div',
      { class: 'tarjeta__titulo' },
      `${datos.total} ${datos.total === 1 ? 'venta' : 'ventas'}`,
      filtrosActivos.entrega_vencida
        ? h('span', { class: 'etiqueta etiqueta--error' }, 'Solo entregas vencidas')
        : null,
      h(
        'span',
        { class: 'derecha' },
        filtrosActivos.entrega_vencida
          ? h('button', { class: 'boton boton--chico', type: 'button', onClick: () => buscar({ entrega_vencida: '' }) }, 'Quitar filtro')
          : null
      )
    );

    if (!datos.ventas.length) {
      return [titulo, vacio('No hay ventas que coincidan con la busqueda.', '🔍')];
    }

    const tabla = h(
      'div',
      { class: 'tabla-scroll' },
      h(
        'table',
        {},
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            h('th', {}, 'Dominio'), h('th', {}, 'Vehiculo'), h('th', { class: 'oculta-movil' }, 'Origen'),
            h('th', { class: 'oculta-movil' }, 'Cliente'), h('th', { class: 'oculta-movil' }, 'Vendedor'),
            h('th', { class: 'numero oculta-movil' }, 'Precio'), h('th', { class: 'oculta-movil' }, 'Venta'),
            h('th', {}, 'Entrega est.'), h('th', { class: 'oculta-movil' }, 'Documentacion'),
            h('th', {}, 'Estado'), h('th', { class: 'oculta-movil' })
          )
        ),
        h('tbody', {}, ...datos.ventas.map(fila))
      )
    );

    const paginacion =
      datos.paginas > 1
        ? h(
            'div',
            { class: 'tarjeta__cuerpo tarjeta__cuerpo--compacto', style: 'display:flex;align-items:center;gap:.75rem' },
            h('button', { class: 'boton boton--chico', type: 'button', disabled: datos.pagina <= 1, onClick: () => buscar({ pagina: datos.pagina - 1 }) }, '← Anterior'),
            h('span', { class: 'tenue' }, `Pagina ${datos.pagina} de ${datos.paginas}`),
            h('button', { class: 'boton boton--chico', type: 'button', disabled: datos.pagina >= datos.paginas, onClick: () => buscar({ pagina: datos.pagina + 1 }) }, 'Siguiente →')
          )
        : null;

    return [titulo, tabla, paginacion].filter(Boolean);
  }

  const botonExportar = h(
    'button',
    {
      class: 'boton',
      type: 'button',
      onClick: async () => {
        botonExportar.disabled = true;
        botonExportar.textContent = 'Preparando…';
        try {
          await descargarVentasCsv(filtrosActivos);
        } catch (error) {
          avisar(error.message, 'error');
        } finally {
          botonExportar.disabled = false;
          botonExportar.textContent = '⬇️ Exportar CSV';
        }
      }
    },
    '⬇️ Exportar CSV'
  );

  let temporizador;
  controles.q.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => buscar(leerFiltros()), 300);
  });
  for (const clave of ['estado', 'vendedor_id', 'tenencia', 'desde', 'hasta']) {
    controles[clave].addEventListener('change', () => buscar(leerFiltros()));
  }

  const formularioFiltros = h(
    'section',
    { class: 'tarjeta' },
    h(
      'div',
      { class: 'tarjeta__cuerpo' },
      h(
        'div',
        { class: 'filtros' },
        (() => { const c = campo('Buscar', controles.q); c.classList.add('campo--busqueda'); return c; })(),
        campo('Estado', controles.estado),
        h(
          'label',
          { class: 'campo', style: 'flex:0 0 auto' },
          h('span', { style: 'font-size:.8rem;font-weight:600;color:var(--texto-suave)' }, '\u00a0'),
          h('span', { style: 'display:flex;align-items:center;gap:.4rem;padding:.5rem 0;white-space:nowrap' },
            controles.vendedor_id, 'Solo mis ventas')
        ),
        campo('Origen', controles.tenencia),
        campo('Desde', controles.desde),
        campo('Hasta', controles.hasta),
        h(
          'div',
          { class: 'campo', style: 'flex:0 0 auto' },
          h('label', {}, ' '),
          h(
            'button',
            {
              class: 'boton',
              type: 'button',
              onClick: () => {
                for (const control of Object.values(controles)) {
                  if (control.type === 'checkbox') control.checked = false;
                  else control.value = '';
                }
                buscar({ q: '', estado: '', vendedor_id: '', tenencia: '', desde: '', hasta: '', entrega_vencida: '', pagina: 1 });
              }
            },
            'Limpiar'
          )
        )
      )
    )
  );

  contenedor.append(
    encabezado(
      'Ventas',
      'Todas las operaciones cargadas por el equipo',
      botonExportar,
      h('a', { class: 'boton boton--primario', href: '#/ventas/nueva' }, '➕ Cargar venta')
    ),
    formularioFiltros,
    resultados
  );

  await buscar({});
  return contenedor;
}
