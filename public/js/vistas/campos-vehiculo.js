import { api } from '../api.js';
import { h, campo, campoAncho, campoDominio, opciones, nombreSegunTenencia, dominioEsValido, normalizarDominio, formatearDominio } from '../util.js';

// Bloque de campos de un vehiculo, reutilizado por el formulario de venta,
// por las permutas y por la edicion del auto vendido.
//
// Arriba van solo los datos que hacen falta si o si para identificar el auto
// (dominio, marca, modelo y ano). El resto queda plegado, para no demorar la
// carga con campos que casi nunca se completan.
export function camposVehiculo(datos = {}, { conTenencia = true, requerido = true, autocompletar = true } = {}) {
  const controles = {
    dominio: campoDominio({ value: datos.dominio || '', required: requerido }),
    marca: h('input', { value: datos.marca || '', placeholder: 'Toyota', autocomplete: 'off' }),
    modelo: h('input', { value: datos.modelo || '', placeholder: 'Corolla', autocomplete: 'off' }),
    anio: h('input', { type: 'number', value: datos.anio || '', min: 1900, max: new Date().getFullYear() + 2, placeholder: '2021' }),
    version: h('input', { value: datos.version || '', placeholder: 'XEI 2.0 CVT', autocomplete: 'off' }),
    color: h('input', { value: datos.color || '', placeholder: 'Gris', autocomplete: 'off' }),
    kilometraje: h('input', { type: 'number', value: datos.kilometraje ?? '', min: 0, placeholder: '45000' }),
    descripcion: h('textarea', { rows: 2, placeholder: 'Como identificar el auto: detalles, estado, equipamiento…' }),
    tenencia: opciones(
      h('select', {}),
      [{ valor: 'propio', texto: 'Propio (de la concesionaria)' }, { valor: 'consigna', texto: 'En consigna' }],
      datos.tenencia || 'propio'
    ),
    consignante_nombre: h('input', { value: datos.consignante_nombre || '', placeholder: 'Nombre (opcional)', autocomplete: 'off' }),
    consignante_contacto: h('input', { value: datos.consignante_contacto || '', placeholder: 'Telefono o email', autocomplete: 'off' })
  };

  controles.descripcion.value = datos.descripcion || '';

  // El nombre va siempre (titular o consignante, opcional); el contacto,
  // solo en consigna.
  const campoNombre = campo(nombreSegunTenencia(controles.tenencia.value), controles.consignante_nombre, 'Opcional');
  const campoContacto = campo('Contacto del consignante', controles.consignante_contacto, 'Opcional');
  const camposConsigna = h('div', { class: 'campos', style: 'grid-column:1/-1' }, campoNombre, campoContacto);

  const sincronizarConsigna = () => {
    campoNombre.querySelector('label').textContent = nombreSegunTenencia(controles.tenencia.value);
    campoContacto.style.display = controles.tenencia.value === 'consigna' ? '' : 'none';
  };
  controles.tenencia.addEventListener('change', sincronizarConsigna);
  sincronizarConsigna();

  // Si alguno de estos ya tiene dato, la seccion arranca abierta.
  const hayDatosExtra = Boolean(datos.version || datos.color || datos.kilometraje);

  const masDatos = h(
    'details',
    { class: 'mas-datos', open: hayDatosExtra },
    h('summary', {}, 'Mas datos del auto (opcional)'),
    h(
      'div',
      { class: 'campos' },
      campo('Version', controles.version),
      campo('Color', controles.color),
      campo('Kilometraje', controles.kilometraje)
    )
  );

  // Si el dominio ya estaba cargado (por ejemplo, un auto en stock), se
  // completan solos los datos que todavia esten vacios y se avisa que su
  // documentacion pasa a la venta.
  const avisoDominio = h('div', { class: 'aviso-dominio', hidden: true });
  const tocados = new Set();
  for (const [nombre, control] of Object.entries(controles)) {
    if (nombre === 'dominio') continue;
    control.addEventListener('input', () => tocados.add(nombre));
    control.addEventListener('change', () => tocados.add(nombre));
  }
  let ultimoConsultado = '';

  async function completarDesdeLoCargado() {
    const d = normalizarDominio(controles.dominio.value);
    if (!autocompletar || d === ultimoConsultado) return;
    ultimoConsultado = d;
    avisoDominio.hidden = true;
    if (!dominioEsValido(d)) return;

    let ficha;
    try {
      ficha = await api.fichaStock(d);
    } catch {
      return; // dominio nuevo: no hay nada que completar
    }
    if (normalizarDominio(controles.dominio.value) !== d) return; // siguio escribiendo

    const v = ficha.vehiculo || {};
    const completados = [];
    const poner = (nombre, valor) => {
      const control = controles[nombre];
      if (!control || tocados.has(nombre) || valor === null || valor === undefined || valor === '') return;
      if (nombre === 'tenencia') {
        if (control.value === valor) return;
      } else if (String(control.value).trim() !== '') {
        return;
      }
      control.value = valor;
      completados.push(nombre);
    };
    for (const nombre of ['marca', 'modelo', 'anio', 'version', 'color', 'kilometraje', 'descripcion']) poner(nombre, v[nombre]);
    if (conTenencia) {
      poner('tenencia', v.tenencia);
      poner('consignante_nombre', v.consignante_nombre);
      poner('consignante_contacto', v.consignante_contacto);
      sincronizarConsigna();
    }
    if (completados.length) formulario().dispatchEvent(new Event('input', { bubbles: true }));

    const grupo = (ficha.documentacion || [])[0];
    let texto;
    let clase = 'aviso aviso--info';
    if (ficha.venta_abierta) {
      texto = `Ojo: ${formatearDominio(d)} ya esta en la venta #${ficha.venta_abierta}, que sigue abierta.`;
      clase = 'aviso aviso--error';
    } else if (ficha.en_stock && grupo) {
      const archivos = grupo.items.reduce((n, i) => n + i.archivos.length, 0);
      texto = `📦 ${formatearDominio(d)} esta en stock con ${grupo.listos} de ${grupo.total} documentos aprobados` +
        (archivos ? ` y ${archivos} archivo(s)` : '') +
        '. Al guardar la venta, toda esa documentacion pasa a la venta.';
    } else {
      texto = `${formatearDominio(d)} ya estaba cargado.`;
    }
    if (completados.length) texto += ' Se completaron los datos del auto con lo que ya estaba cargado.';
    avisoDominio.className = `${clase} aviso-dominio`;
    avisoDominio.textContent = texto;
    avisoDominio.hidden = false;
  }
  const formulario = () => contenedor.closest('form') || contenedor;
  controles.dominio.addEventListener('change', completarDesdeLoCargado);
  controles.dominio.addEventListener('blur', completarDesdeLoCargado);

  const contenedor = h(
    'div',
    {},
    avisoDominio,
    h(
      'div',
      { class: 'campos' },
      campo('Dominio (patente)', controles.dominio, 'Autos: AAA123 o AB123CD · Motos: 123ABC o A123BCD'),
      campo('Marca', controles.marca),
      campo('Modelo', controles.modelo),
      campo('Ano', controles.anio),
      conTenencia ? campo('Origen del auto', controles.tenencia) : null,
      conTenencia ? camposConsigna : null,
      campoAncho('Descripcion', controles.descripcion, 'Sirve para reconocer el auto de un vistazo en los listados.')
    ),
    masDatos
  );

  const leer = () => ({
    dominio: controles.dominio.value.trim(),
    marca: controles.marca.value.trim(),
    modelo: controles.modelo.value.trim(),
    anio: controles.anio.value || null,
    version: controles.version.value.trim(),
    color: controles.color.value.trim(),
    kilometraje: controles.kilometraje.value || null,
    descripcion: controles.descripcion.value.trim(),
    ...(conTenencia
      ? {
          tenencia: controles.tenencia.value,
          consignante_nombre: controles.consignante_nombre.value.trim(),
          consignante_contacto: controles.consignante_contacto.value.trim()
        }
      : {})
  });

  return { contenedor, controles, leer, completarDesdeLoCargado };
}
