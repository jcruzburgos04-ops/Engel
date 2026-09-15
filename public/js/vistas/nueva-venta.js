import { api } from '../api.js';
import { h, hoy, avisar, campo, campoAncho, opciones, ESTADOS_VENTA } from '../util.js';
import { encabezado, navegar, estado as estadoApp, refrescarPendientes } from '../app.js';
import { camposVehiculo } from './campos-vehiculo.js';

// Bloque de una permuta dentro del formulario de carga.
function bloquePermuta(indice, alQuitar) {
  const vehiculo = camposVehiculo({}, { conTenencia: false });
  const valor = h('input', { type: 'number', min: 0, step: '0.01', placeholder: '4000000' });
  const moneda = opciones(h('select', {}), [{ valor: 'ARS', texto: 'Pesos (ARS)' }, { valor: 'USD', texto: 'Dolares (USD)' }], 'ARS');
  const observaciones = h('textarea', { rows: 2, placeholder: 'Estado del auto, deudas, faltantes…' });

  const contenedor = h(
    'div',
    { class: 'permuta' },
    h(
      'div',
      { class: 'permuta__cabecera', style: 'margin-bottom:.75rem' },
      h('strong', {}, `Permuta ${indice}`),
      h('span', { class: 'tenue' }, 'auto que entrega el comprador'),
      h('span', { class: 'derecha' }, h('button', { class: 'boton boton--chico boton--peligro', type: 'button', onClick: () => alQuitar(contenedor) }, 'Quitar'))
    ),
    vehiculo.contenedor,
    h(
      'div',
      { class: 'campos', style: 'margin-top:.875rem' },
      campo('Valor tomado', valor),
      campo('Moneda', moneda),
      campoAncho('Observaciones de la permuta', observaciones)
    )
  );

  contenedor.leer = () => ({
    ...vehiculo.leer(),
    valor_tomado: valor.value || null,
    moneda: moneda.value,
    observaciones: observaciones.value.trim()
  });
  contenedor.dominio = () => vehiculo.controles.dominio;

  return contenedor;
}

export async function vistaNuevaVenta() {
  const { usuarios } = await api.usuarios();

  const vehiculo = camposVehiculo({ tenencia: 'propio' });

  const controles = {
    fecha_venta: h('input', { type: 'date', value: hoy(), required: true }),
    vendedor_id: opciones(
      h('select', { required: true }),
      [
        { valor: '', texto: 'Elegir vendedor…' },
        ...usuarios.map((u) => ({ valor: u.id, texto: u.nombre }))
      ],
      estadoApp.usuario.id
    ),
    estado: opciones(
      h('select', {}),
      Object.entries(ESTADOS_VENTA)
        .filter(([valor]) => valor !== 'cancelado')
        .map(([valor, info]) => ({ valor, texto: info.texto })),
      'pendiente'
    ),
    cliente_nombre: h('input', { required: true, placeholder: 'Nombre y apellido', autocomplete: 'off' }),
    cliente_documento: h('input', { placeholder: 'DNI o CUIT', autocomplete: 'off' }),
    cliente_telefono: h('input', { placeholder: '11 5555 5555', autocomplete: 'off' }),
    cliente_email: h('input', { type: 'email', placeholder: 'cliente@email.com', autocomplete: 'off' }),
    precio_venta: h('input', { type: 'number', min: 0, step: '0.01', placeholder: '15000000' }),
    moneda: opciones(h('select', {}), [{ valor: 'ARS', texto: 'Pesos (ARS)' }, { valor: 'USD', texto: 'Dolares (USD)' }], 'ARS'),
    sena: h('input', { type: 'number', min: 0, step: '0.01', placeholder: 'Opcional' }),
    forma_pago: h('input', { placeholder: 'Transferencia, permuta + efectivo…', autocomplete: 'off' }),
    fecha_entrega_estimada: h('input', { type: 'date' }),
    detalles: h('textarea', { rows: 3, placeholder: 'Detalles extras de la operacion: condiciones, compromisos, lo que haya que recordar…' })
  };

  // --- Permutas dinamicas ---
  const listaPermutas = h('div', {});
  const sinPermutas = h('p', { class: 'tenue' }, 'Si el comprador entrega un auto como parte de pago, agregalo aca y queda vinculado a esta venta.');

  const quitarPermuta = (bloque) => {
    bloque.remove();
    renumerar();
  };

  function renumerar() {
    const bloques = [...listaPermutas.children];
    bloques.forEach((bloque, i) => {
      const titulo = bloque.querySelector('strong');
      if (titulo) titulo.textContent = `Permuta ${i + 1}`;
    });
    sinPermutas.style.display = bloques.length ? 'none' : '';
  }

  const agregarPermuta = () => {
    const bloque = bloquePermuta(listaPermutas.children.length + 1, quitarPermuta);
    listaPermutas.append(bloque);
    renumerar();
    bloque.dominio().focus();
  };

  // --- Envio ---
  const error = h('div', { class: 'aviso aviso--error', style: 'display:none' });
  const boton = h('button', { class: 'boton boton--primario', type: 'submit' }, 'Guardar venta');

  const formulario = h(
    'form',
    {
      onSubmit: async (e) => {
        e.preventDefault();
        error.style.display = 'none';
        boton.disabled = true;
        boton.textContent = 'Guardando…';

        const cuerpo = {
          fecha_venta: controles.fecha_venta.value,
          vendedor_id: Number(controles.vendedor_id.value),
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
          detalles: controles.detalles.value.trim(),
          vehiculo: vehiculo.leer(),
          permutas: [...listaPermutas.children].map((bloque) => bloque.leer())
        };

        try {
          const { venta } = await api.crearVenta(cuerpo);
          await refrescarPendientes();
          avisar(`Venta cargada. Ya podes empezar a subir la documentacion de ${venta.vehiculo.dominio}.`);
          navegar(`ventas/${venta.id}`);
        } catch (err) {
          error.textContent = err.message;
          error.style.display = '';
          error.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } finally {
          boton.disabled = false;
          boton.textContent = 'Guardar venta';
        }
      }
    },

    error,

    h(
      'section',
      { class: 'tarjeta' },
      h('div', { class: 'tarjeta__titulo' }, '🚗 Auto que se vende'),
      h('div', { class: 'tarjeta__cuerpo' }, vehiculo.contenedor)
    ),

    h(
      'section',
      { class: 'tarjeta' },
      h('div', { class: 'tarjeta__titulo' }, '🧾 Datos de la operacion'),
      h(
        'div',
        { class: 'tarjeta__cuerpo' },
        h(
          'div',
          { class: 'campos' },
          campo('Fecha de la venta', controles.fecha_venta),
          campo('Vendedor', controles.vendedor_id, 'Queda registrado quien vendio el auto.'),
          campo('Estado', controles.estado),
          campo('Cliente', controles.cliente_nombre),
          campo('Documento del cliente', controles.cliente_documento),
          campo('Telefono', controles.cliente_telefono),
          campo('Email', controles.cliente_email),
          campo('Precio de venta', controles.precio_venta),
          campo('Moneda', controles.moneda),
          campo('Sena', controles.sena),
          campo('Forma de pago', controles.forma_pago),
          campo('Fecha de entrega estimada', controles.fecha_entrega_estimada, 'Se usa para avisar las entregas proximas y vencidas.'),
          campoAncho('Detalles extras de la operacion', controles.detalles)
        )
      )
    ),

    h(
      'section',
      { class: 'tarjeta' },
      h(
        'div',
        { class: 'tarjeta__titulo' },
        '🔄 Permutas',
        h('span', { class: 'derecha' }, h('button', { class: 'boton boton--chico', type: 'button', onClick: agregarPermuta }, '➕ Agregar permuta'))
      ),
      h('div', { class: 'tarjeta__cuerpo' }, sinPermutas, listaPermutas)
    ),

    h(
      'div',
      { style: 'display:flex;gap:.5rem;justify-content:flex-end' },
      h('a', { class: 'boton', href: '#/ventas' }, 'Cancelar'),
      boton
    )
  );

  return h(
    'div',
    {},
    encabezado('Cargar venta', 'Los 8 documentos del checklist se generan solos al guardar'),
    formulario
  );
}
