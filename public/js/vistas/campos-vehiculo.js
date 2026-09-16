import { h, campo, campoAncho, campoDominio, opciones } from '../util.js';

// Bloque de campos de un vehiculo, reutilizado por el formulario de venta,
// por las permutas y por la edicion del auto vendido.
export function camposVehiculo(datos = {}, { conTenencia = true, requerido = true } = {}) {
  const controles = {
    dominio: campoDominio({ value: datos.dominio || '', required: requerido }),
    marca: h('input', { value: datos.marca || '', placeholder: 'Toyota', autocomplete: 'off' }),
    modelo: h('input', { value: datos.modelo || '', placeholder: 'Corolla', autocomplete: 'off' }),
    version: h('input', { value: datos.version || '', placeholder: 'XEI 2.0 CVT', autocomplete: 'off' }),
    anio: h('input', { type: 'number', value: datos.anio || '', min: 1900, max: new Date().getFullYear() + 2, placeholder: '2021' }),
    color: h('input', { value: datos.color || '', placeholder: 'Gris', autocomplete: 'off' }),
    kilometraje: h('input', { type: 'number', value: datos.kilometraje ?? '', min: 0, placeholder: '45000' }),
    nro_chasis: h('input', { value: datos.nro_chasis || '', placeholder: 'Opcional', autocomplete: 'off' }),
    nro_motor: h('input', { value: datos.nro_motor || '', placeholder: 'Opcional', autocomplete: 'off' }),
    descripcion: h('textarea', { rows: 2, placeholder: 'Como identificar el auto: detalles, estado, equipamiento…' }),
    tenencia: opciones(
      h('select', {}),
      [{ valor: 'propio', texto: 'Propio (de la concesionaria)' }, { valor: 'consigna', texto: 'En consigna' }],
      datos.tenencia || 'propio'
    ),
    consignante_nombre: h('input', { value: datos.consignante_nombre || '', placeholder: 'Nombre del titular', autocomplete: 'off' }),
    consignante_contacto: h('input', { value: datos.consignante_contacto || '', placeholder: 'Telefono o email', autocomplete: 'off' })
  };

  controles.descripcion.value = datos.descripcion || '';

  const camposConsigna = h(
    'div',
    { class: 'campos', style: 'grid-column:1/-1' },
    campo('Consignante', controles.consignante_nombre),
    campo('Contacto del consignante', controles.consignante_contacto)
  );

  const sincronizarConsigna = () => {
    camposConsigna.style.display = controles.tenencia.value === 'consigna' ? '' : 'none';
  };
  controles.tenencia.addEventListener('change', sincronizarConsigna);
  sincronizarConsigna();

  const contenedor = h(
    'div',
    { class: 'campos' },
    campo('Dominio (patente)', controles.dominio, 'Autos: AAA123 o AB123CD · Motos: 123ABC o A123BCD'),
    campo('Marca', controles.marca),
    campo('Modelo', controles.modelo),
    campo('Version', controles.version),
    campo('Ano', controles.anio),
    campo('Color', controles.color),
    campo('Kilometraje', controles.kilometraje),
    campo('Nro. de chasis', controles.nro_chasis),
    campo('Nro. de motor', controles.nro_motor),
    conTenencia ? campo('Origen del auto', controles.tenencia) : null,
    conTenencia ? camposConsigna : null,
    campoAncho('Descripcion', controles.descripcion, 'Sirve para reconocer el auto de un vistazo en los listados.')
  );

  const leer = () => ({
    dominio: controles.dominio.value.trim(),
    marca: controles.marca.value.trim(),
    modelo: controles.modelo.value.trim(),
    version: controles.version.value.trim(),
    anio: controles.anio.value || null,
    color: controles.color.value.trim(),
    kilometraje: controles.kilometraje.value || null,
    nro_chasis: controles.nro_chasis.value.trim(),
    nro_motor: controles.nro_motor.value.trim(),
    descripcion: controles.descripcion.value.trim(),
    ...(conTenencia
      ? {
          tenencia: controles.tenencia.value,
          consignante_nombre: controles.consignante_nombre.value.trim(),
          consignante_contacto: controles.consignante_contacto.value.trim()
        }
      : {})
  });

  return { contenedor, controles, leer };
}
