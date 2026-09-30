// Autos en stock: los que entran a la concesionaria (o estan en el playon) y
// todavia no se vendieron. Tienen su checklist de documentacion igual que un
// auto vendido; cuando se cargan en una venta, ese checklist pasa a la venta
// con todo lo que ya tenia.

import { api } from '../api.js';
import { campoAuto } from '../campo-auto.js';
import {
  h, avisar, confirmar, abrirModal, opciones, vacio, etiquetaDominio,
  etiquetaTenencia, descripcionVehiculo, dominioEsValido, normalizarDominio, formatearDominio,
  campoDominio
} from '../util.js';
import { encabezado, navegar, estado } from '../app.js';
import { bloqueDocumentacion, botonZip } from './documentos-ui.js';

const TENENCIAS = [
  { valor: 'propio', texto: 'Propio' },
  { valor: 'consigna', texto: 'Consigna' }
];

const AYUDA_DOMINIO = 'Autos: AAA123 o AB123CD. Motos: 123ABC o A123BCD.';

// ---------------------------------------------------------------------
// Alta de uno o varios autos
// ---------------------------------------------------------------------

export function abrirAltaStock({ alGuardar } = {}) {
  const filas = h('div', { class: 'carga-municipios' });

  function agregarFila() {
    const dominio = campoDominio({ class: 'dominio-input stock__dominio' });
    const marca = h('input', { placeholder: 'Marca', class: 'stock__marca' });
    const modelo = h('input', { placeholder: 'Modelo', class: 'stock__modelo' });
    const anio = h('input', { type: 'number', min: 1950, max: 2100, placeholder: 'Año', inputMode: 'numeric', class: 'stock__anio' });
    const tenencia = opciones(h('select', { class: 'stock__tenencia' }), TENENCIAS, 'propio');
    const consignante = h('input', { placeholder: 'Nombre del consignante', class: 'stock__consignante', hidden: true });
    tenencia.addEventListener('change', () => {
      consignante.hidden = tenencia.value !== 'consigna';
      if (!consignante.hidden) consignante.focus();
    });

    // Enter en el ultimo dato de un renglon agrega otro: asi se cargan
    // muchos autos seguidos sin tocar el mouse.
    const alEnter = (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (bloque === filas.lastElementChild) agregarFila().focus();
    };
    anio.addEventListener('keydown', alEnter);
    consignante.addEventListener('keydown', alEnter);

    const bloque = h(
      'div',
      { class: 'carga__bloque' },
      h(
        'div',
        { class: 'stock__fila' },
        h('label', {}, h('span', { class: 'carga__rotulo' }, 'Dominio'), dominio),
        h('label', {}, h('span', { class: 'carga__rotulo' }, 'Marca'), marca),
        h('label', {}, h('span', { class: 'carga__rotulo' }, 'Modelo'), modelo),
        h('label', {}, h('span', { class: 'carga__rotulo' }, 'Año'), anio),
        h('label', {}, h('span', { class: 'carga__rotulo' }, 'Origen'), tenencia),
        h('button', {
          class: 'boton boton--chico',
          type: 'button',
          title: 'Quitar este auto',
          onClick: () => { if (filas.children.length > 1) bloque.remove(); }
        }, '×')
      ),
      consignante
    );
    bloque.leer = () => ({
      dominio: normalizarDominio(dominio.value),
      marca: marca.value.trim(),
      modelo: modelo.value.trim(),
      anio: anio.value.trim(),
      tenencia: tenencia.value,
      consignante_nombre: consignante.value.trim()
    });
    filas.append(bloque);
    return dominio;
  }

  const primero = agregarFila();

  const error = h('div', { class: 'aviso aviso--error', style: 'display:none' });
  const mostrarError = (texto) => { error.textContent = texto; error.style.display = ''; };
  const botonGuardar = h('button', { class: 'boton boton--primario', type: 'button' }, 'Agregar al stock');

  botonGuardar.addEventListener('click', async () => {
    error.style.display = 'none';
    const autos = [];
    const vistos = new Set();
    for (const bloque of filas.children) {
      const auto = bloque.leer();
      if (!auto.dominio && !auto.marca && !auto.modelo && !auto.anio) continue; // renglon vacio
      if (!dominioEsValido(auto.dominio)) {
        return mostrarError(`Revisa el dominio "${auto.dominio || '(vacio)'}". ${AYUDA_DOMINIO}`);
      }
      if (vistos.has(auto.dominio)) return mostrarError(`El ${formatearDominio(auto.dominio)} esta dos veces.`);
      vistos.add(auto.dominio);
      if (auto.anio && !/^\d{4}$/.test(auto.anio)) return mostrarError(`${auto.dominio}: el año tiene que tener 4 numeros.`);
      if (auto.tenencia === 'consigna' && !auto.consignante_nombre) {
        return mostrarError(`${auto.dominio} esta en consigna: falta el nombre del consignante.`);
      }
      autos.push(auto);
    }
    if (!autos.length) return mostrarError('Carga al menos un auto.');

    botonGuardar.disabled = true;
    botonGuardar.textContent = 'Agregando…';
    try {
      const { agregados = [], ya_estaban: yaEstaban = [] } = await api.agregarAStock(autos);
      ref.cerrar();
      const partes = [];
      if (agregados.length) partes.push(`${agregados.length} auto(s) agregados al stock`);
      if (yaEstaban.length) partes.push(`${yaEstaban.length} ya estaban (${yaEstaban.map(formatearDominio).join(', ')})`);
      avisar(`${partes.join('; ')}.`);
      if (alGuardar) alGuardar(agregados.length === 1 && autos.length === 1 ? agregados[0] : null);
    } catch (err) {
      // La carga es todo o nada: si un auto falla, no se agrega ninguno.
      mostrarError(`${err.message} No se agrego ningun auto: corregilo y volve a guardar.`);
      botonGuardar.disabled = false;
      botonGuardar.textContent = 'Agregar al stock';
    }
    return undefined;
  });

  const ref = abrirModal({
    titulo: 'Agregar autos al stock',
    cuerpo: h(
      'div',
      {},
      error,
      h('p', { class: 'tenue', style: 'font-size:.85rem;margin:0 0 .75rem' },
        'Cada auto queda con su checklist de documentacion. Cuando se venda, al cargar la venta con ese dominio, ' +
          'la documentacion pasa sola a la venta. Tip: Enter en el año agrega otro renglon.'),
      filas,
      h('button', { class: 'boton boton--chico', type: 'button', style: 'margin-top:.25rem',
        onClick: () => agregarFila().focus() }, '➕ Otro auto')
    ),
    acciones: [
      h('button', { class: 'boton', type: 'button', onClick: () => ref.cerrar() }, 'Cancelar'),
      botonGuardar
    ]
  });
  ref.modal.classList.add('modal--ancho');
  primero.focus();
  return ref;
}

// ---------------------------------------------------------------------
// Ficha de un auto en stock
// ---------------------------------------------------------------------

function campoDelAuto(vehiculo, etiqueta, control, nombre, extra = {}) {
  return campoAuto({
    etiqueta,
    control,
    campo: nombre,
    operacion: 'editar_vehiculo',
    clave: `vehiculo:${vehiculo.id}:${nombre}`,
    armarArgs: (valor) => ({ id: vehiculo.id, datos: { [nombre]: valor } }),
    ...extra
  });
}

export async function vistaStock({ dominio }) {
  const d = normalizarDominio(dominio);
  if (!dominioEsValido(d)) {
    return h('div', {},
      encabezado('Documentacion'),
      h('div', { class: 'aviso aviso--error' }, `"${dominio}" no es un dominio valido. ${AYUDA_DOMINIO}`),
      h('a', { class: 'boton', href: '#/documentacion' }, 'Volver'));
  }

  let ficha;
  try {
    ficha = await api.fichaStock(d);
  } catch (err) {
    return h('div', {},
      encabezado(h('span', {}, etiquetaDominio(d))),
      h('div', { class: 'aviso aviso--error' }, err.message),
      h('a', { class: 'boton', href: '#/documentacion' }, 'Volver a Documentacion'));
  }

  const v = ficha.vehiculo;
  const titulo = h('span', { style: 'display:inline-flex;gap:.6rem;align-items:center;flex-wrap:wrap' },
    etiquetaDominio(d), descripcionVehiculo(v) || 'Sin marca ni modelo', etiquetaTenencia(v.tenencia));

  // No esta en stock: o esta en una venta abierta (su documentacion se carga
  // ahi), o se puede agregar.
  if (!ficha.en_stock) {
    const agregar = async () => {
      try {
        await api.agregarAStock([{ dominio: d }]);
        avisar(`${formatearDominio(d)} agregado al stock.`);
        navegar(`stock/${d}`, { reemplazar: true });
      } catch (err) {
        avisar(err.message, 'error');
      }
    };
    return h('div', {},
      encabezado(titulo, 'No esta en stock'),
      ficha.venta_abierta
        ? h('div', { class: 'aviso aviso--info' },
            `Este auto esta en la venta #${ficha.venta_abierta}: su documentacion se carga ahi. `,
            h('a', { href: `#/ventas/${ficha.venta_abierta}` }, 'Ir a la venta'))
        : h('div', {},
            vacio('Este auto no esta en stock.', '📦'),
            h('p', { style: 'text-align:center' },
              h('button', { class: 'boton boton--primario', type: 'button', onClick: agregar }, '📦 Agregar al stock'))));
  }

  const selectorTenencia = opciones(h('select', {}), TENENCIAS, v.tenencia);
  const consignante = h('input', { value: v.consignante_nombre || '' });
  const campoConsignante = campoDelAuto(v, 'Consignante', consignante, 'consignante_nombre');
  campoConsignante.hidden = v.tenencia !== 'consigna';
  selectorTenencia.addEventListener('change', () => { campoConsignante.hidden = selectorTenencia.value !== 'consigna'; });

  const tieneArchivos = ficha.documentacion.some((g) => g.items.some((i) => i.archivos.length));
  const esAdmin = estado.usuario && estado.usuario.rol === 'admin';

  const quitar = async () => {
    const texto = tieneArchivos
      ? `Vas a sacar ${formatearDominio(d)} del stock. Se borran su checklist y los archivos cargados ` +
        '(queda una copia de los datos en el historial). Si necesitas los archivos, bajalos antes con el ZIP.'
      : `Vas a sacar ${formatearDominio(d)} del stock. Se borra su checklist (queda una copia en el historial).`;
    if (!(await confirmar(texto, { textoBoton: 'Sacar del stock' }))) return;
    try {
      await api.quitarDeStock(v.id);
      avisar(`${formatearDominio(d)} salio del stock.`);
      navegar('documentacion');
    } catch (err) {
      avisar(err.message, 'error');
    }
  };

  return h(
    'div',
    {},
    encabezado(
      titulo,
      'En stock · la documentacion pasa sola a la venta cuando se venda',
      h('a', { class: 'boton', href: '#/documentacion' }, '← Documentacion'),
      h('a', { class: 'boton', href: `#/buscador/${d}` }, 'Ficha del dominio'),
      h('a', { class: 'boton', href: `#/infracciones/${d}` }, '🚨 Infracciones'),
      botonZip(d, '⬇️ ZIP'),
      !tieneArchivos || esAdmin
        ? h('button', { class: 'boton boton--peligro', type: 'button', onClick: quitar }, 'Sacar del stock')
        : null
    ),
    h(
      'section',
      { class: 'tarjeta' },
      h('div', { class: 'tarjeta__titulo' }, '🚗 Datos del auto', h('span', { class: 'derecha tenue' }, 'Los cambios se guardan solos')),
      h(
        'div',
        { class: 'tarjeta__cuerpo' },
        h(
          'div',
          { class: 'campos' },
          campoDelAuto(v, 'Marca', h('input', { value: v.marca || '' }), 'marca'),
          campoDelAuto(v, 'Modelo', h('input', { value: v.modelo || '' }), 'modelo'),
          campoDelAuto(v, 'Año', h('input', { type: 'number', min: 1950, max: 2100, value: v.anio ?? '' }), 'anio'),
          campoDelAuto(v, 'Origen', selectorTenencia, 'tenencia'),
          campoConsignante
        )
      )
    ),
    bloqueDocumentacion(ficha.documentacion)
  );
}
