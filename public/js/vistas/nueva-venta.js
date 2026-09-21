import { api } from '../api.js';
import { h, hoy, avisar, fechaHora, campo, campoAncho, opciones, ESTADOS_VENTA } from '../util.js';
import { vigilarBorrador, recuperarBorrador, descartarBorrador } from '../borradores.js';
import { encabezado, navegar, estado as estadoApp, refrescarPendientes } from '../app.js';
import { camposVehiculo } from './campos-vehiculo.js';

const CLAVE_BORRADOR = 'venta-nueva';
const MONEDAS = [{ valor: 'ARS', texto: 'Pesos (ARS)' }, { valor: 'USD', texto: 'Dolares (USD)' }];

// Bloque de una permuta dentro del formulario de carga.
function bloquePermuta(indice, alQuitar, datos = {}) {
  const vehiculo = camposVehiculo(datos, { conTenencia: false });
  const valor = h('input', { type: 'number', min: 0, step: '0.01', placeholder: '4000000', value: datos.valor_tomado ?? '' });
  const moneda = opciones(h('select', {}), MONEDAS, datos.moneda || 'ARS');
  const observaciones = h('textarea', { rows: 2, placeholder: 'Estado del auto, deudas, faltantes…' });
  observaciones.value = datos.observaciones || '';

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
      [{ valor: '', texto: 'Elegir vendedor…' }, ...usuarios.map((u) => ({ valor: u.id, texto: u.nombre }))],
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
    cliente_documento: h('input', { placeholder: '30111222', autocomplete: 'off' }),
    cliente_telefono: h('input', { placeholder: '11 5555 5555', autocomplete: 'off' }),
    cliente_email: h('input', { type: 'email', placeholder: 'cliente@email.com', autocomplete: 'off' }),
    precio_venta: h('input', { type: 'number', min: 0, step: '0.01', placeholder: '15000000' }),
    moneda: opciones(h('select', {}), MONEDAS, 'ARS'),
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
    vigilante.guardarAhora();
  };

  function renumerar() {
    const bloques = [...listaPermutas.children];
    bloques.forEach((bloque, i) => {
      const titulo = bloque.querySelector('strong');
      if (titulo) titulo.textContent = `Permuta ${i + 1}`;
    });
    sinPermutas.style.display = bloques.length ? 'none' : '';
  }

  const agregarPermuta = (datos) => {
    const bloque = bloquePermuta(listaPermutas.children.length + 1, quitarPermuta, datos);
    listaPermutas.append(bloque);
    renumerar();
    return bloque;
  };

  // --- Lectura y restauracion del formulario completo ---

  const leerFormulario = () => ({
    fecha_venta: controles.fecha_venta.value,
    vendedor_id: controles.vendedor_id.value,
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
  });

  function aplicarFormulario(datos) {
    for (const [clave, control] of Object.entries(controles)) {
      if (datos[clave] !== undefined && datos[clave] !== null) control.value = datos[clave];
    }
    for (const [clave, control] of Object.entries(vehiculo.controles)) {
      const valor = datos.vehiculo ? datos.vehiculo[clave] : undefined;
      if (valor !== undefined && valor !== null) control.value = valor;
    }
    vehiculo.controles.tenencia.dispatchEvent(new Event('change'));

    listaPermutas.replaceChildren();
    for (const permuta of datos.permutas || []) agregarPermuta(permuta);
    renumerar();
  }

  // --- Envio ---
  const error = h('div', { class: 'aviso aviso--error', style: 'display:none' });
  const boton = h('button', { class: 'boton boton--primario', type: 'submit' }, 'Guardar venta');
  const avisoBorrador = h('div', {});
  const estadoBorrador = h('span', { class: 'tenue' }, '');

  const formulario = h(
    'form',
    {
      onSubmit: async (e) => {
        e.preventDefault();
        error.style.display = 'none';
        boton.disabled = true;
        boton.textContent = 'Guardando…';

        const cuerpo = leerFormulario();

        try {
          const { venta } = await api.crearVenta(cuerpo);
          // Recien cuando el servidor confirma se descarta el borrador.
          await descartarBorrador(CLAVE_BORRADOR);
          vigilante.detener();
          await refrescarPendientes();
          avisar(`Venta cargada. Ya podes empezar a subir la documentacion de ${venta.vehiculo.dominio}.`);
          navegar(`ventas/${venta.id}`);
        } catch (err) {
          error.textContent = `${err.message} Lo que cargaste quedo guardado como borrador, no se pierde.`;
          error.style.display = '';
          error.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } finally {
          boton.disabled = false;
          boton.textContent = 'Guardar venta';
        }
      }
    },

    avisoBorrador,
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
          campo('Vendio', controles.vendedor_id, 'Queda registrado quien vendio el auto.'),
          campo('Estado', controles.estado),
          campo('Comprador', controles.cliente_nombre),
          campo('Celular', controles.cliente_telefono),
          campo('DNI / CUIT', controles.cliente_documento)
        ),
        h(
          'details',
          { class: 'mas-datos' },
          h('summary', {}, 'Mas datos de la operacion (opcional)'),
          h(
            'div',
            { class: 'campos' },
            campo('Fecha de entrega estimada', controles.fecha_entrega_estimada, 'Ordena el panel de documentacion y avisa las entregas vencidas.'),
            campo('Precio de venta', controles.precio_venta),
            campo('Moneda', controles.moneda),
            campo('Sena', controles.sena),
            campo('Forma de pago', controles.forma_pago),
            campo('Email', controles.cliente_email),
            campoAncho('Detalles extras de la operacion', controles.detalles)
          )
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
        h('span', { class: 'derecha' }, h('button', {
          class: 'boton boton--chico',
          type: 'button',
          onClick: () => { const b = agregarPermuta(); b.dominio().focus(); }
        }, '➕ Agregar permuta'))
      ),
      h('div', { class: 'tarjeta__cuerpo' }, sinPermutas, listaPermutas)
    ),

    h(
      'div',
      { style: 'display:flex;gap:.5rem;justify-content:flex-end;align-items:center' },
      estadoBorrador,
      h('a', { class: 'boton', href: '#/ventas' }, 'Cancelar'),
      boton
    )
  );

  // El borrador se guarda solo mientras se escribe.
  const vigilante = vigilarBorrador(formulario, CLAVE_BORRADOR, leerFormulario, {
    alGuardar: () => {
      estadoBorrador.textContent = `Borrador guardado ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
    }
  });

  // Si habia una carga a medias, se ofrece recuperarla.
  const guardado = await recuperarBorrador(CLAVE_BORRADOR);
  const tieneAlgo =
    guardado &&
    guardado.contenido &&
    (guardado.contenido.cliente_nombre ||
      (guardado.contenido.vehiculo && guardado.contenido.vehiculo.dominio));

  if (tieneAlgo) {
    avisoBorrador.append(
      h(
        'div',
        { class: 'borrador-aviso' },
        h('span', {}, `📝 Tenes una carga sin terminar de ${fechaHora(guardado.fecha)}.`),
        h(
          'span',
          { class: 'derecha' },
          h(
            'button',
            {
              class: 'boton boton--chico boton--primario',
              type: 'button',
              onClick: () => {
                aplicarFormulario(guardado.contenido);
                avisoBorrador.replaceChildren();
                avisar('Se recupero la carga que habias empezado.');
              }
            },
            'Recuperar'
          ),
          h(
            'button',
            {
              class: 'boton boton--chico',
              type: 'button',
              onClick: async () => {
                await descartarBorrador(CLAVE_BORRADOR);
                avisoBorrador.replaceChildren();
              }
            },
            'Descartar'
          )
        )
      )
    );
  }

  return h(
    'div',
    {},
    encabezado('Cargar venta', 'Se guarda un borrador solo mientras completas; los 8 documentos del checklist se generan al guardar'),
    formulario
  );
}
