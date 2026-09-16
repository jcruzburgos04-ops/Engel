import { api } from '../api.js';
import {
  h, vaciar, fecha, fechaHora, dinero, numero, diasHasta, avisar, confirmar, abrirModal,
  campo, campoAncho, opciones, etiquetaEstadoVenta, etiquetaDominio, etiquetaTenencia,
  descripcionVehiculo, ESTADOS_VENTA
} from '../util.js';
import { campoAuto, campoAutoAncho } from '../campo-auto.js';
import { esperarGuardado } from '../guardado.js';
import { encabezado, navegar, estado as estadoApp, refrescarPendientes } from '../app.js';
import { bloqueDocumentacion, botonZip } from './documentos-ui.js';
import { camposVehiculo } from './campos-vehiculo.js';

const MONEDAS = [{ valor: 'ARS', texto: 'Pesos (ARS)' }, { valor: 'USD', texto: 'Dolares (USD)' }];

function avisoEntrega(venta) {
  if (!venta.fecha_entrega_estimada) return null;
  if (venta.estado === 'entregado' || venta.estado === 'cancelado') return null;

  const dias = diasHasta(venta.fecha_entrega_estimada);
  if (dias < 0) {
    return h('div', { class: 'aviso aviso--error' }, `⚠️ La fecha de entrega estimada vencio hace ${Math.abs(dias)} dia(s).`);
  }
  if (dias <= 7) {
    return h('div', { class: 'aviso aviso--info' }, dias === 0 ? '📅 La entrega estimada es hoy.' : `📅 Faltan ${dias} dia(s) para la entrega estimada.`);
  }
  return null;
}

export async function vistaVenta({ id }) {
  const contenedor = h('div', {});
  const { usuarios } = await api.usuarios(true);

  async function recargar() {
    const { venta } = await api.venta(id);
    await refrescarPendientes();
    vaciar(contenedor).append(...pintar(venta));
  }

  // Redibujar borraria lo que la persona este escribiendo en ese momento.
  // Por eso se espera a que termine de guardarse todo y a que no haya ningun
  // campo con el foco puesto; si lo hay, se vuelve a intentar mas tarde.
  let reloj;
  function recargarCuandoSePueda() {
    clearTimeout(reloj);
    reloj = setTimeout(async function intentar() {
      const activo = document.activeElement;
      const escribiendo = activo && ['INPUT', 'TEXTAREA'].includes(activo.tagName);
      if (escribiendo || !contenedor.isConnected) {
        reloj = setTimeout(intentar, 1500);
        return;
      }
      await esperarGuardado(5000);
      if (contenedor.isConnected) recargar();
    }, 600);
  }

  // Campo de la venta que se guarda solo.
  const campoVenta = (etiqueta, control, nombre, ayuda) =>
    campoAuto({ etiqueta, control, ventaId: id, campo: nombre, ayuda });

  // Campo del auto vendido: viaja anidado dentro de `vehiculo`.
  const campoAuto2 = (etiqueta, control, nombre, ayuda) =>
    campoAuto({
      etiqueta,
      control,
      ventaId: id,
      campo: nombre,
      ayuda,
      claveExtra: ':vehiculo',
      envolver: (valor, clave) => ({ vehiculo: { [clave]: valor } })
    });

  function pintar(venta) {
    const esAdmin = estadoApp.usuario.rol === 'admin';
    const totalDocs = venta.documentacion.reduce((suma, g) => suma + g.total, 0);
    const listosDocs = venta.documentacion.reduce((suma, g) => suma + g.listos, 0);
    const v = venta.vehiculo;

    const cabecera = encabezado(
      `Venta #${venta.id}`,
      `${descripcionVehiculo(v)} · cargada por ${venta.creado_por_nombre || venta.vendedor_nombre} el ${fechaHora(venta.creado_en)}`,
      h('a', { class: 'boton', href: '#/ventas' }, '← Volver'),
      botonZip(v.dominio, '⬇️ Documentacion ZIP'),
      h('button', { class: 'boton', type: 'button', onClick: () => abrirHistorial(venta) }, '🕓 Historial'),
      esAdmin
        ? h(
            'button',
            {
              class: 'boton boton--peligro',
              type: 'button',
              onClick: async () => {
                const ok = await confirmar(
                  `Vas a borrar la venta #${venta.id} (${v.dominio}) con toda su documentacion cargada. ` +
                    'Queda registrada en el historial, pero la ficha desaparece del listado.',
                  { textoBoton: 'Borrar venta' }
                );
                if (!ok) return;
                try {
                  await api.borrarVenta(venta.id);
                  avisar('Venta borrada. Queda constancia en el historial.');
                  navegar('ventas');
                } catch (error) {
                  avisar(error.message, 'error');
                }
              }
            },
            '🗑️ Borrar'
          )
        : null
    );

    // --- Datos de la operacion, todos editables y con guardado automatico ---

    const selectorEstado = opciones(
      h('select', {}),
      Object.entries(ESTADOS_VENTA).map(([valor, info]) => ({ valor, texto: info.texto })),
      venta.estado
    );

    const selectorVendedor = opciones(
      h('select', {}),
      usuarios.map((u) => ({ valor: u.id, texto: u.nombre + (u.activo ? '' : ' (baja)') })),
      venta.vendedor_id
    );

    const operacion = h(
      'section',
      { class: 'tarjeta' },
      h(
        'div',
        { class: 'tarjeta__titulo' },
        etiquetaDominio(v.dominio),
        etiquetaTenencia(v.tenencia),
        etiquetaEstadoVenta(venta.estado),
        h('span', { class: 'derecha tenue' }, 'Los cambios se guardan solos')
      ),
      h(
        'div',
        { class: 'tarjeta__cuerpo' },
        h(
          'div',
          { class: 'campos' },
          campoVenta('Estado', selectorEstado, 'estado'),
          campoVenta('Vendio', selectorVendedor, 'vendedor_id', 'Quien hizo esta venta.'),
          campoVenta('Fecha de venta', h('input', { type: 'date', value: venta.fecha_venta || '' }), 'fecha_venta'),
          campoVenta('Cliente', h('input', { value: venta.cliente_nombre || '' }), 'cliente_nombre'),
          campoVenta('Documento del cliente', h('input', { value: venta.cliente_documento || '' }), 'cliente_documento'),
          campoVenta('Telefono', h('input', { value: venta.cliente_telefono || '' }), 'cliente_telefono'),
          campoVenta('Email', h('input', { type: 'email', value: venta.cliente_email || '' }), 'cliente_email'),
          campoVenta('Precio de venta', h('input', { type: 'number', min: 0, step: '0.01', value: venta.precio_venta ?? '' }), 'precio_venta'),
          campoVenta('Moneda', opciones(h('select', {}), MONEDAS, venta.moneda), 'moneda'),
          campoVenta('Sena', h('input', { type: 'number', min: 0, step: '0.01', value: venta.sena ?? '' }), 'sena'),
          campoVenta('Forma de pago', h('input', { value: venta.forma_pago || '' }), 'forma_pago'),
          campoVenta('Entrega estimada', h('input', { type: 'date', value: venta.fecha_entrega_estimada || '' }), 'fecha_entrega_estimada', 'Se usa para los avisos de entrega.'),
          campoVenta('Entrega real', h('input', { type: 'date', value: venta.fecha_entrega_real || '' }), 'fecha_entrega_real'),
          campoAutoAncho({
            etiqueta: 'Detalles extras de la operacion',
            control: (() => { const t = h('textarea', { rows: 3 }); t.value = venta.detalles || ''; return t; })(),
            ventaId: id,
            campo: 'detalles'
          })
        )
      )
    );

    // Al cambiar el estado conviene redibujar para que se actualicen las etiquetas.
    selectorEstado.addEventListener('change', recargarCuandoSePueda);

    // --- Auto vendido ---

    const selectorTenencia = opciones(
      h('select', {}),
      [{ valor: 'propio', texto: 'Propio (de la concesionaria)' }, { valor: 'consigna', texto: 'En consigna' }],
      v.tenencia
    );
    selectorTenencia.addEventListener('change', recargarCuandoSePueda);

    const auto = h(
      'section',
      { class: 'tarjeta' },
      h(
        'div',
        { class: 'tarjeta__titulo' },
        '🚗 Auto vendido',
        h('span', { class: 'tenue' }, `Dominio ${v.dominio} (no se cambia desde aca)`),
        h('span', { class: 'derecha' }, h('a', { class: 'boton boton--chico', href: `#/buscador/${v.dominio}` }, 'Ver ficha del dominio'))
      ),
      h(
        'div',
        { class: 'tarjeta__cuerpo' },
        h(
          'div',
          { class: 'campos' },
          campoAuto2('Marca', h('input', { value: v.marca || '' }), 'marca'),
          campoAuto2('Modelo', h('input', { value: v.modelo || '' }), 'modelo'),
          campoAuto2('Version', h('input', { value: v.version || '' }), 'version'),
          campoAuto2('Ano', h('input', { type: 'number', value: v.anio ?? '' }), 'anio'),
          campoAuto2('Color', h('input', { value: v.color || '' }), 'color'),
          campoAuto2('Kilometraje', h('input', { type: 'number', min: 0, value: v.kilometraje ?? '' }), 'kilometraje'),
          campoAuto2('Nro. de chasis', h('input', { value: v.nro_chasis || '' }), 'nro_chasis'),
          campoAuto2('Nro. de motor', h('input', { value: v.nro_motor || '' }), 'nro_motor'),
          campoAuto2('Origen del auto', selectorTenencia, 'tenencia'),
          v.tenencia === 'consigna'
            ? campoAuto2('Consignante', h('input', { value: v.consignante_nombre || '' }), 'consignante_nombre')
            : null,
          v.tenencia === 'consigna'
            ? campoAuto2('Contacto del consignante', h('input', { value: v.consignante_contacto || '' }), 'consignante_contacto')
            : null,
          campoAutoAncho({
            etiqueta: 'Descripcion',
            control: (() => { const t = h('textarea', { rows: 2 }); t.value = v.descripcion || ''; return t; })(),
            ventaId: id,
            campo: 'descripcion',
            claveExtra: ':vehiculo',
            envolver: (valor, clave) => ({ vehiculo: { [clave]: valor } }),
            ayuda: 'Sirve para reconocer el auto de un vistazo en los listados.'
          })
        )
      )
    );

    // --- Permutas ---

    const permutas = h(
      'section',
      { class: 'tarjeta' },
      h(
        'div',
        { class: 'tarjeta__titulo' },
        '🔄 Permutas recibidas',
        h('span', { class: 'tenue' }, 'autos que entrega el comprador por esta compra'),
        h('span', { class: 'derecha' }, h('button', { class: 'boton boton--chico', type: 'button', onClick: () => abrirNuevaPermuta(venta, recargar) }, '➕ Agregar permuta'))
      ),
      h(
        'div',
        { class: 'tarjeta__cuerpo' },
        venta.permutas.length
          ? h('div', {}, ...venta.permutas.map((permuta) => bloquePermuta(venta, permuta, recargar)))
          : h('p', { class: 'tenue', style: 'margin:0' }, 'Esta operacion no tiene permutas vinculadas.')
      )
    );

    // --- Notas ---

    const textoNota = h('textarea', { rows: 2, placeholder: 'Sumar un detalle de la operacion…' });
    const guardarNota = async () => {
      const texto = textoNota.value.trim();
      if (!texto) return;
      try {
        await api.agregarNota(venta.id, texto);
        textoNota.value = '';
        recargar();
      } catch (error) {
        avisar(error.message, 'error');
      }
    };

    const notas = h(
      'section',
      { class: 'tarjeta' },
      h('div', { class: 'tarjeta__titulo' }, '💬 Detalles extras de la operacion'),
      h(
        'div',
        { class: 'tarjeta__cuerpo' },
        h('div', { style: 'display:flex;gap:.5rem;align-items:flex-start;margin-bottom:.75rem' },
          textoNota,
          h('button', { class: 'boton boton--primario', type: 'button', onClick: guardarNota }, 'Agregar')),
        venta.notas.length
          ? h('div', {}, ...venta.notas.map((nota) => bloqueNota(venta, nota, recargar)))
          : h('p', { class: 'tenue', style: 'margin:0' }, 'Todavia no hay detalles cargados.')
      )
    );

    const tituloDocs = h(
      'h2',
      { style: 'margin:1.5rem 0 .75rem' },
      '📁 Documentacion de la operacion ',
      h('span', { class: 'tenue', style: 'font-weight:400' }, `(${listosDocs}/${totalDocs})`)
    );

    return [
      cabecera,
      avisoEntrega(venta),
      operacion,
      auto,
      permutas,
      tituloDocs,
      bloqueDocumentacion(venta.documentacion),
      notas
    ].filter(Boolean);
  }

  await recargar();
  return contenedor;
}

// ---------- Bloques auxiliares ----------

function bloqueNota(venta, nota, recargar) {
  return h(
    'div',
    { class: 'nota' },
    h(
      'div',
      { class: 'nota__meta' },
      h('strong', {}, nota.autor || 'Sin autor'),
      h('span', {}, fechaHora(nota.creado_en)),
      h(
        'button',
        {
          class: 'boton boton--chico',
          type: 'button',
          style: 'margin-left:auto',
          onClick: async () => {
            if (!(await confirmar('Vas a borrar esta nota. Queda registrada en el historial.', { textoBoton: 'Borrar' }))) return;
            try {
              await api.borrarNota(venta.id, nota.id);
              recargar();
            } catch (error) {
              avisar(error.message, 'error');
            }
          }
        },
        'Borrar'
      )
    ),
    h('div', { class: 'nota__texto' }, nota.texto)
  );
}

function bloquePermuta(venta, permuta, recargar) {
  return h(
    'div',
    { class: 'permuta' },
    h(
      'div',
      { class: 'permuta__cabecera' },
      etiquetaDominio(permuta.dominio, true),
      h('strong', {}, descripcionVehiculo(permuta)),
      permuta.valor_tomado ? h('span', { class: 'etiqueta etiqueta--ok' }, `Tomado en ${dinero(permuta.valor_tomado, permuta.moneda)}`) : null,
      h(
        'span',
        { class: 'derecha', style: 'display:flex;gap:.4rem' },
        h('a', { class: 'boton boton--chico', href: `#/buscador/${permuta.dominio}` }, 'Ver ficha'),
        h(
          'button',
          {
            class: 'boton boton--chico boton--peligro',
            type: 'button',
            onClick: async () => {
              const ok = await confirmar(
                `Vas a desvincular la permuta ${permuta.dominio} de esta venta. Se borra tambien su checklist de documentacion.`,
                { textoBoton: 'Desvincular' }
              );
              if (!ok) return;
              try {
                await api.quitarPermuta(venta.id, permuta.id);
                avisar('Permuta desvinculada.');
                recargar();
              } catch (error) {
                avisar(error.message, 'error');
              }
            }
          },
          'Quitar'
        )
      )
    ),
    h(
      'div',
      { class: 'mini', style: 'margin-top:.35rem' },
      [
        permuta.color ? `Color ${permuta.color}` : null,
        permuta.kilometraje ? `${numero(permuta.kilometraje)} km` : null,
        permuta.nro_chasis ? `Chasis ${permuta.nro_chasis}` : null
      ].filter(Boolean).join(' · ') || 'Sin datos adicionales'
    ),
    permuta.observaciones ? h('div', { style: 'margin-top:.35rem;white-space:pre-wrap' }, permuta.observaciones) : null
  );
}

function abrirNuevaPermuta(venta, recargar) {
  const vehiculo = camposVehiculo({}, { conTenencia: false });
  const valor = h('input', { type: 'number', min: 0, step: '0.01', placeholder: '4000000' });
  const moneda = opciones(h('select', {}), MONEDAS, 'ARS');
  const observaciones = h('textarea', { rows: 2 });
  const error = h('div', { class: 'aviso aviso--error', style: 'display:none' });

  const guardar = async () => {
    error.style.display = 'none';
    try {
      await api.agregarPermuta(venta.id, {
        ...vehiculo.leer(),
        valor_tomado: valor.value || null,
        moneda: moneda.value,
        observaciones: observaciones.value.trim()
      });
      ref.cerrar();
      avisar('Permuta vinculada a la venta.');
      recargar();
    } catch (err) {
      error.textContent = err.message;
      error.style.display = '';
    }
  };

  const ref = abrirModal({
    titulo: `Agregar permuta a la venta #${venta.id}`,
    cuerpo: h(
      'div',
      {},
      error,
      vehiculo.contenedor,
      h('div', { class: 'campos', style: 'margin-top:.875rem' },
        campo('Valor tomado', valor),
        campo('Moneda', moneda),
        campoAncho('Observaciones', observaciones))
    ),
    acciones: [
      h('button', { class: 'boton', type: 'button', onClick: () => ref.cerrar() }, 'Cancelar'),
      h('button', { class: 'boton boton--primario', type: 'button', onClick: guardar }, 'Vincular permuta')
    ]
  });
}

const ACCIONES = { crear: '➕', editar: '✏️', borrar: '🗑️' };

async function abrirHistorial(venta) {
  const cuerpo = h('div', {}, h('div', { class: 'cargando' }, 'Cargando historial…'));

  const ref = abrirModal({
    titulo: `Historial de la venta #${venta.id}`,
    cuerpo,
    acciones: [h('button', { class: 'boton', type: 'button', onClick: () => ref.cerrar() }, 'Cerrar')]
  });

  try {
    const { historial } = await api.historialVenta(venta.id);
    vaciar(cuerpo).append(
      h('p', { class: 'tenue' }, 'Queda registrado todo lo que se hizo sobre esta operacion, con quien lo hizo y cuando.'),
      historial.length
        ? h(
            'div',
            {},
            ...historial.map((linea) =>
              h(
                'div',
                { class: 'nota' },
                h(
                  'div',
                  { class: 'nota__meta' },
                  h('strong', {}, `${ACCIONES[linea.accion] || ''} ${linea.usuario_nombre || 'Sistema'}`),
                  h('span', {}, fechaHora(linea.creado_en))
                ),
                h('div', { class: 'nota__texto' }, linea.resumen || linea.entidad)
              )
            )
          )
        : h('p', { class: 'tenue' }, 'Todavia no hay movimientos registrados.')
    );
  } catch (error) {
    vaciar(cuerpo).append(h('div', { class: 'aviso aviso--error' }, error.message));
  }
}
