import { api } from '../api.js';
import {
  h, vaciar, fecha, fechaHora, dinero, numero, diasHasta, avisar, confirmar, abrirModal,
  campo, campoAncho, opciones, etiquetaEstadoVenta, etiquetaDominio, etiquetaTenencia,
  descripcionVehiculo, ESTADOS_VENTA
} from '../util.js';
import { encabezado, navegar, estado as estadoApp, refrescarPendientes } from '../app.js';
import { bloqueDocumentacion } from './documentos-ui.js';
import { camposVehiculo } from './campos-vehiculo.js';

function dato(etiqueta, ...valor) {
  return h(
    'div',
    { class: 'campo' },
    h('label', {}, etiqueta),
    h('div', { style: 'font-size:.95rem' }, ...valor.map((v) => (v instanceof Node ? v : String(v ?? '—'))))
  );
}

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

  async function recargar() {
    const { venta } = await api.venta(id);
    await refrescarPendientes();
    vaciar(contenedor).append(...pintar(venta));
  }

  function pintar(venta) {
    const esAdmin = estadoApp.usuario.rol === 'admin';
    const totalDocs = venta.documentacion.reduce((suma, g) => suma + g.total, 0);
    const listosDocs = venta.documentacion.reduce((suma, g) => suma + g.listos, 0);

    // --- Cambio rapido de estado ---
    const selectorEstado = opciones(
      h('select', {}),
      Object.entries(ESTADOS_VENTA).map(([valor, info]) => ({ valor, texto: info.texto })),
      venta.estado
    );
    selectorEstado.addEventListener('change', async () => {
      try {
        await api.editarVenta(venta.id, { estado: selectorEstado.value });
        avisar('Estado actualizado.');
        recargar();
      } catch (error) {
        avisar(error.message, 'error');
        selectorEstado.value = venta.estado;
      }
    });

    const cabecera = encabezado(
      `Venta #${venta.id}`,
      `${descripcionVehiculo(venta.vehiculo)} · cargada por ${venta.creado_por_nombre || venta.vendedor_nombre} el ${fechaHora(venta.creado_en)}`,
      h('a', { class: 'boton', href: '#/ventas' }, '← Volver'),
      h('button', { class: 'boton', type: 'button', onClick: () => abrirEdicion(venta, recargar) }, '✏️ Editar'),
      h('a', { class: 'boton', href: api.urlZipDominio(venta.vehiculo.dominio) }, '⬇️ Documentacion ZIP'),
      esAdmin
        ? h(
            'button',
            {
              class: 'boton boton--peligro',
              type: 'button',
              onClick: async () => {
                const ok = await confirmar(
                  `Vas a borrar la venta #${venta.id} (${venta.vehiculo.dominio}) con toda su documentacion cargada. No se puede deshacer.`,
                  { textoBoton: 'Borrar venta' }
                );
                if (!ok) return;
                try {
                  await api.borrarVenta(venta.id);
                  avisar('Venta borrada.');
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

    // --- Resumen de la operacion ---
    const resumen = h(
      'section',
      { class: 'tarjeta' },
      h(
        'div',
        { class: 'tarjeta__titulo' },
        etiquetaDominio(venta.vehiculo.dominio),
        etiquetaTenencia(venta.vehiculo.tenencia),
        etiquetaEstadoVenta(venta.estado),
        h('span', { class: 'derecha', style: 'display:flex;align-items:center;gap:.5rem' },
          h('span', { class: 'tenue' }, 'Cambiar estado:'), selectorEstado)
      ),
      h(
        'div',
        { class: 'tarjeta__cuerpo' },
        h(
          'div',
          { class: 'campos' },
          dato('Vehiculo', descripcionVehiculo(venta.vehiculo)),
          dato('Color', venta.vehiculo.color || '—'),
          dato('Kilometraje', venta.vehiculo.kilometraje ? `${numero(venta.vehiculo.kilometraje)} km` : '—'),
          dato('Origen', venta.vehiculo.tenencia === 'consigna'
            ? `Consigna${venta.vehiculo.consignante_nombre ? ` de ${venta.vehiculo.consignante_nombre}` : ''}`
            : 'Propio de la concesionaria'),
          dato('Vendedor', venta.vendedor_nombre),
          dato('Fecha de venta', fecha(venta.fecha_venta)),
          dato('Cliente', venta.cliente_nombre),
          dato('Documento', venta.cliente_documento || '—'),
          dato('Telefono', venta.cliente_telefono || '—'),
          dato('Email', venta.cliente_email || '—'),
          dato('Precio', dinero(venta.precio_venta, venta.moneda)),
          dato('Sena', venta.sena ? dinero(venta.sena, venta.moneda) : '—'),
          dato('Forma de pago', venta.forma_pago || '—'),
          dato('Entrega estimada', fecha(venta.fecha_entrega_estimada)),
          dato('Entrega real', fecha(venta.fecha_entrega_real)),
          dato('Documentacion', `${listosDocs} de ${totalDocs} listos`),
          venta.vehiculo.nro_chasis ? dato('Nro. de chasis', venta.vehiculo.nro_chasis) : null,
          venta.vehiculo.nro_motor ? dato('Nro. de motor', venta.vehiculo.nro_motor) : null,
          venta.vehiculo.descripcion ? campoAncho('Descripcion del auto', h('div', {}, venta.vehiculo.descripcion)) : null,
          venta.detalles
            ? campoAncho('Detalles de la operacion', h('div', { style: 'white-space:pre-wrap' }, venta.detalles))
            : null
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
          ? h(
              'div',
              {},
              ...venta.notas.map((nota) =>
                h(
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
                          if (!(await confirmar('Vas a borrar esta nota.', { textoBoton: 'Borrar' }))) return;
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
                )
              )
            )
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
      resumen,
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
  const moneda = opciones(h('select', {}), [{ valor: 'ARS', texto: 'Pesos (ARS)' }, { valor: 'USD', texto: 'Dolares (USD)' }], 'ARS');
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

function abrirEdicion(venta, recargar) {
  const vehiculo = camposVehiculo(venta.vehiculo);
  vehiculo.controles.dominio.disabled = true;
  vehiculo.controles.dominio.title = 'El dominio no se puede cambiar desde aca.';

  const controles = {
    fecha_venta: h('input', { type: 'date', value: venta.fecha_venta || '' }),
    estado: opciones(h('select', {}), Object.entries(ESTADOS_VENTA).map(([valor, info]) => ({ valor, texto: info.texto })), venta.estado),
    cliente_nombre: h('input', { value: venta.cliente_nombre || '' }),
    cliente_documento: h('input', { value: venta.cliente_documento || '' }),
    cliente_telefono: h('input', { value: venta.cliente_telefono || '' }),
    cliente_email: h('input', { type: 'email', value: venta.cliente_email || '' }),
    precio_venta: h('input', { type: 'number', min: 0, step: '0.01', value: venta.precio_venta ?? '' }),
    moneda: opciones(h('select', {}), [{ valor: 'ARS', texto: 'Pesos (ARS)' }, { valor: 'USD', texto: 'Dolares (USD)' }], venta.moneda),
    sena: h('input', { type: 'number', min: 0, step: '0.01', value: venta.sena ?? '' }),
    forma_pago: h('input', { value: venta.forma_pago || '' }),
    fecha_entrega_estimada: h('input', { type: 'date', value: venta.fecha_entrega_estimada || '' }),
    fecha_entrega_real: h('input', { type: 'date', value: venta.fecha_entrega_real || '' }),
    detalles: h('textarea', { rows: 3 })
  };
  controles.detalles.value = venta.detalles || '';

  const selectorVendedor = h('select', {});
  api.usuarios(true).then(({ usuarios }) => {
    opciones(selectorVendedor, usuarios.map((u) => ({ valor: u.id, texto: u.nombre + (u.activo ? '' : ' (baja)') })), venta.vendedor_id);
  });

  const error = h('div', { class: 'aviso aviso--error', style: 'display:none' });

  const guardar = async () => {
    error.style.display = 'none';
    try {
      await api.editarVenta(venta.id, {
        fecha_venta: controles.fecha_venta.value,
        vendedor_id: Number(selectorVendedor.value) || venta.vendedor_id,
        estado: controles.estado.value,
        cliente_nombre: controles.cliente_nombre.value.trim(),
        cliente_documento: controles.cliente_documento.value.trim(),
        cliente_telefono: controles.cliente_telefono.value.trim(),
        cliente_email: controles.cliente_email.value.trim(),
        precio_venta: controles.precio_venta.value || null,
        moneda: controles.moneda.value,
        sena: controles.sena.value || null,
        forma_pago: controles.forma_pago.value.trim(),
        fecha_entrega_estimada: controles.fecha_entrega_estimada.value || null,
        fecha_entrega_real: controles.fecha_entrega_real.value || null,
        detalles: controles.detalles.value.trim(),
        vehiculo: vehiculo.leer()
      });
      ref.cerrar();
      avisar('Venta actualizada.');
      recargar();
    } catch (err) {
      error.textContent = err.message;
      error.style.display = '';
    }
  };

  const ref = abrirModal({
    titulo: `Editar venta #${venta.id}`,
    cuerpo: h(
      'div',
      {},
      error,
      h('fieldset', {}, h('legend', {}, 'Operacion'),
        h('div', { class: 'campos' },
          campo('Fecha de venta', controles.fecha_venta),
          campo('Vendedor', selectorVendedor),
          campo('Estado', controles.estado),
          campo('Cliente', controles.cliente_nombre),
          campo('Documento', controles.cliente_documento),
          campo('Telefono', controles.cliente_telefono),
          campo('Email', controles.cliente_email),
          campo('Precio', controles.precio_venta),
          campo('Moneda', controles.moneda),
          campo('Sena', controles.sena),
          campo('Forma de pago', controles.forma_pago),
          campo('Entrega estimada', controles.fecha_entrega_estimada),
          campo('Entrega real', controles.fecha_entrega_real),
          campoAncho('Detalles extras', controles.detalles))),
      h('fieldset', {}, h('legend', {}, 'Auto vendido'), vehiculo.contenedor)
    ),
    acciones: [
      h('button', { class: 'boton', type: 'button', onClick: () => ref.cerrar() }, 'Cancelar'),
      h('button', { class: 'boton boton--primario', type: 'button', onClick: guardar }, 'Guardar cambios')
    ]
  });
}
