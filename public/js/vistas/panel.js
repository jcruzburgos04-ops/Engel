import { api } from '../api.js';
import { h, fecha, diasHasta, etiquetaEstadoVenta, etiquetaDominio, descripcionVehiculo, barraProgreso, vacio } from '../util.js';
import { encabezado } from '../app.js';

function indicador(valor, etiqueta, modificador = '') {
  return h(
    'div',
    { class: `indicador ${modificador}` },
    h('div', { class: 'indicador__valor' }, String(valor ?? 0)),
    h('div', { class: 'indicador__etiqueta' }, etiqueta)
  );
}

function filaEntrega(venta) {
  const cerrada = venta.estado === 'entregado' || venta.estado === 'cancelado';
  const dias = cerrada ? null : diasHasta(venta.fecha_entrega_estimada);
  let aviso = null;
  if (dias !== null) {
    if (dias < 0) aviso = h('span', { class: 'etiqueta etiqueta--error' }, `Vencida hace ${Math.abs(dias)} d`);
    else if (dias === 0) aviso = h('span', { class: 'etiqueta etiqueta--aviso' }, 'Entrega hoy');
    else if (dias <= 7) aviso = h('span', { class: 'etiqueta etiqueta--aviso' }, `En ${dias} d`);
  }

  return h(
    'tr',
    {},
    h('td', {}, h('a', { href: `#/ventas/${venta.id}` }, etiquetaDominio(venta.dominio))),
    h('td', {}, descripcionVehiculo(venta), h('div', { class: 'mini' }, venta.cliente_nombre)),
    h('td', { class: 'oculta-movil' }, venta.vendedor_nombre),
    h('td', {}, fecha(venta.fecha_entrega_estimada), aviso ? h('div', { style: 'margin-top:.2rem' }, aviso) : null),
    h('td', {}, barraProgreso(venta.documentos_listos, venta.documentos_total)),
    h('td', {}, etiquetaEstadoVenta(venta.estado))
  );
}

export async function vistaPanel() {
  const [stats, proximas, vencidas] = await Promise.all([
    api.estadisticas(),
    api.ventas({ limite: 8 }),
    api.ventas({ entrega_vencida: 'true', limite: 20 })
  ]);

  const contenedor = h('div', {});

  contenedor.append(
    encabezado(
      'Panel',
      'Resumen de las operaciones de la concesionaria',
      h('a', { class: 'boton boton--primario', href: '#/ventas/nueva' }, '➕ Cargar venta')
    ),

    h(
      'div',
      { class: 'grilla grilla--tarjetas', style: 'margin-bottom:1.25rem' },
      indicador(stats.ventas_del_mes, 'Ventas de este mes'),
      indicador(stats.activas, 'Operaciones abiertas'),
      indicador(stats.entregadas, 'Entregadas'),
      indicador(stats.documentos_pendientes, 'Documentos pendientes', stats.documentos_pendientes ? 'indicador--aviso' : ''),
      indicador(stats.entregas_vencidas, 'Entregas vencidas', stats.entregas_vencidas ? 'indicador--alerta' : '')
    )
  );

  if (vencidas.ventas.length) {
    contenedor.append(
      h(
        'section',
        { class: 'tarjeta' },
        h(
          'div',
          { class: 'tarjeta__titulo' },
          '⚠️ Entregas con la fecha vencida',
          h('span', { class: 'derecha' }, h('a', { class: 'boton boton--chico', href: '#/ventas?entrega_vencida=true' }, 'Ver todas'))
        ),
        h(
          'div',
          { class: 'tabla-scroll' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Dominio'), h('th', {}, 'Vehiculo / cliente'), h('th', { class: 'oculta-movil' }, 'Vendedor'), h('th', {}, 'Entrega'), h('th', {}, 'Documentacion'), h('th', {}, 'Estado'))),
            h('tbody', {}, ...vencidas.ventas.map(filaEntrega))
          )
        )
      )
    );
  }

  contenedor.append(
    h(
      'div',
      { class: 'grilla grilla--2' },

      h(
        'section',
        { class: 'tarjeta' },
        h(
          'div',
          { class: 'tarjeta__titulo' },
          'Ultimas ventas cargadas',
          h('span', { class: 'derecha' }, h('a', { class: 'boton boton--chico', href: '#/ventas' }, 'Ver todas'))
        ),
        proximas.ventas.length
          ? h(
              'div',
              { class: 'tabla-scroll' },
              h(
                'table',
                {},
                h('thead', {}, h('tr', {}, h('th', {}, 'Dominio'), h('th', {}, 'Vehiculo / cliente'), h('th', { class: 'oculta-movil' }, 'Vendedor'), h('th', {}, 'Entrega'), h('th', {}, 'Doc.'), h('th', {}, 'Estado'))),
                h('tbody', {}, ...proximas.ventas.map(filaEntrega))
              )
            )
          : vacio('Todavia no hay ventas cargadas.', '🚗')
      ),

      h(
        'section',
        { class: 'tarjeta' },
        h('div', { class: 'tarjeta__titulo' }, 'Ventas por vendedor'),
        stats.porVendedor.length
          ? h(
              'div',
              { class: 'tabla-scroll' },
              h(
                'table',
                {},
                h('thead', {}, h('tr', {}, h('th', {}, 'Vendedor'), h('th', { class: 'numero' }, 'Ventas'), h('th', { class: 'numero' }, 'Entregadas'))),
                h(
                  'tbody',
                  {},
                  ...stats.porVendedor.map((v) =>
                    h(
                      'tr',
                      {},
                      h('td', {}, h('a', { href: `#/ventas?vendedor_id=${v.id}` }, v.nombre)),
                      h('td', { class: 'numero' }, String(v.ventas)),
                      h('td', { class: 'numero' }, String(v.entregadas))
                    )
                  )
                )
              )
            )
          : vacio('Todavia no hay vendedores con ventas.', '👥'),

        h(
          'div',
          { class: 'tarjeta__cuerpo tarjeta__cuerpo--compacto' },
          h(
            'div',
            { class: 'tenue' },
            'Origen de los autos vendidos: ',
            stats.porTenencia.length
              ? stats.porTenencia
                  .map((t) => `${t.tenencia === 'consigna' ? 'consigna' : 'propios'} ${t.cantidad}`)
                  .join(' · ')
              : 'sin datos'
          )
        )
      )
    )
  );

  return contenedor;
}
