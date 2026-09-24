// Utilidades compartidas por todas las vistas.

// Crea elementos del DOM. Los textos se asignan con textContent, asi que
// nada de lo que cargan los usuarios se interpreta como HTML.
export function h(etiqueta, props = {}, ...hijos) {
  const el = document.createElement(etiqueta);

  for (const [clave, valor] of Object.entries(props || {})) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (clave === 'class') el.className = valor;
    else if (clave === 'html') el.innerHTML = valor;
    else if (clave === 'dataset') Object.assign(el.dataset, valor);
    else if (clave.startsWith('on') && typeof valor === 'function') {
      el.addEventListener(clave.slice(2).toLowerCase(), valor);
    } else if (clave in el && clave !== 'list' && clave !== 'form') {
      el[clave] = valor;
    } else {
      el.setAttribute(clave, valor === true ? '' : valor);
    }
  }

  for (const hijo of hijos.flat(Infinity)) {
    if (hijo === null || hijo === undefined || hijo === false) continue;
    el.append(hijo instanceof Node ? hijo : document.createTextNode(String(hijo)));
  }
  return el;
}

export function vaciar(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// ---------- Formato ----------

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export function fecha(iso) {
  if (!iso) return '—';
  const [anio, mes, dia] = String(iso).slice(0, 10).split('-');
  if (!anio || !mes || !dia) return iso;
  return `${dia}/${mes}/${anio}`;
}

export function fechaLarga(iso) {
  if (!iso) return '—';
  const [anio, mes, dia] = String(iso).slice(0, 10).split('-');
  return `${Number(dia)} ${MESES[Number(mes) - 1] || ''} ${anio}`;
}

export function fechaHora(iso) {
  if (!iso) return '—';

  const texto = String(iso);
  // Postgres devuelve "2026-09-16T05:09:30.299+00:00"; SQLite devolvia
  // "2026-09-16 05:09:30" sin zona. Se aceptan las dos formas.
  const tieneZona = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(texto);
  const normalizado = texto.replace(' ', 'T') + (tieneZona ? '' : 'Z');

  const d = new Date(normalizado);
  if (Number.isNaN(d.getTime())) return texto;
  return d.toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

export function hoy() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// Dias que faltan (positivo) o que pasaron (negativo) hasta una fecha.
export function diasHasta(iso) {
  if (!iso) return null;
  const objetivo = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  const ahora = new Date();
  ahora.setHours(0, 0, 0, 0);
  return Math.round((objetivo - ahora) / 86400000);
}

export function dinero(valor, moneda = 'ARS') {
  if (valor === null || valor === undefined || valor === '') return '—';
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return '—';
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda,
    maximumFractionDigits: 0
  }).format(numero);
}

export function numero(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  return new Intl.NumberFormat('es-AR').format(Number(valor));
}

export function tamano(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(Math.round(bytes / 1024), 1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Los cuatro formatos que circulan en el pais, separados para leerlos mejor.
const FORMATOS_DOMINIO = [
  { patron: /^[A-Z]{3}\d{3}$/, cortes: [3] },          // auto viejo:    AAA 123
  { patron: /^[A-Z]{2}\d{3}[A-Z]{2}$/, cortes: [2, 5] }, // auto Mercosur: AB 123 CD
  { patron: /^\d{3}[A-Z]{3}$/, cortes: [3] },          // moto vieja:    123 ABC
  { patron: /^[A-Z]\d{3}[A-Z]{3}$/, cortes: [1, 4] }    // moto Mercosur: A 123 BCD
];

export function normalizarDominio(dominio) {
  return String(dominio || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function dominioEsValido(dominio) {
  const d = normalizarDominio(dominio);
  return FORMATOS_DOMINIO.some(({ patron }) => patron.test(d));
}

export function formatearDominio(dominio) {
  const d = normalizarDominio(dominio);
  const formato = FORMATOS_DOMINIO.find(({ patron }) => patron.test(d));
  if (!formato) return d;

  const partes = [];
  let desde = 0;
  for (const corte of formato.cortes) {
    partes.push(d.slice(desde, corte));
    desde = corte;
  }
  partes.push(d.slice(desde));
  return partes.join(' ');
}

export function descripcionVehiculo(v) {
  if (!v) return '';
  const partes = [v.marca, v.modelo, v.version].filter(Boolean).join(' ').trim();
  const detalle = [partes, v.anio].filter(Boolean).join(' ');
  return detalle || v.descripcion || 'Sin descripcion';
}

export const ESTADOS_VENTA = {
  pendiente: { texto: 'Pendiente', clase: '' },
  en_preparacion: { texto: 'En preparacion', clase: 'etiqueta--info' },
  listo_entrega: { texto: 'Listo para entrega', clase: 'etiqueta--aviso' },
  entregado: { texto: 'Entregado', clase: 'etiqueta--ok' },
  cancelado: { texto: 'Cancelado', clase: 'etiqueta--error' }
};

// Orden de trabajo de un documento: de lo que falta a lo que ya esta.
export const ESTADOS_DOCUMENTO = {
  faltante: { texto: 'Faltante', clase: '', icono: '⬜' },
  pedido: { texto: 'Pedido', clase: 'etiqueta--info', icono: '📩' },
  en_proceso: { texto: 'En proceso', clase: 'etiqueta--aviso', icono: '🟡' },
  aprobado: { texto: 'Aprobado', clase: 'etiqueta--ok', icono: '✅' }
};

// Estados del pago de las infracciones de un auto en un municipio.
export const ESTADOS_INFRACCION = {
  impaga: { texto: 'Impaga', clase: 'etiqueta--error' },
  en_gestion: { texto: 'En gestion', clase: 'etiqueta--aviso' },
  pagada: { texto: 'Pagada', clase: 'etiqueta--ok' },
  anulada: { texto: 'Anulada', clase: '' }
};

// Lee un monto escrito a la argentina: "85.000", "85000,50", "$ 12.500".
// Devuelve el texto listo para la base ("85000.50"), '' si esta vacio, o
// null si no se entiende.
export function leerMonto(texto) {
  let t = String(texto ?? '').replace(/[$\s]/g, '');
  if (!t) return '';
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  return /^\d+(\.\d{1,2})?$/.test(t) ? t : null;
}

// Copia un texto al portapapeles. Primero de la forma "vieja", que es
// inmediata y no depende de permisos: asi queda copiado antes de que se
// abra otra pestana y la pagina pierda el foco.
export function copiarAlPortapapeles(texto) {
  let copiado = false;
  const area = h('textarea', { readOnly: true, style: 'position:fixed;top:-100px;opacity:0' });
  area.value = texto;
  document.body.append(area);
  area.select();
  try {
    copiado = document.execCommand('copy');
  } catch {
    copiado = false;
  }
  area.remove();

  if (!copiado && navigator.clipboard) {
    navigator.clipboard.writeText(texto).catch(() => {});
    copiado = true;
  }
  return copiado;
}

// Arma el link de una pagina de consulta. Si la direccion trae {dominio},
// se reemplaza por la patente.
export function linkDePortal(url, dominio) {
  return String(url || '').replace(/\{dominio\}/gi, encodeURIComponent(normalizarDominio(dominio)));
}

export function portalCompletaSolo(url) {
  return /\{dominio\}/i.test(String(url || ''));
}

export function etiquetaEstadoVenta(estado) {
  const info = ESTADOS_VENTA[estado] || { texto: estado, clase: '' };
  return h('span', { class: `etiqueta ${info.clase}` }, info.texto);
}

export function etiquetaDominio(dominio, claro = false) {
  return h('span', { class: `dominio${claro ? ' dominio--claro' : ''}` }, formatearDominio(dominio));
}

export function etiquetaTenencia(tenencia) {
  return tenencia === 'consigna'
    ? h('span', { class: 'etiqueta etiqueta--aviso' }, 'Consigna')
    : h('span', { class: 'etiqueta etiqueta--info' }, 'Propio');
}

export function barraProgreso(listos, total) {
  const porcentaje = total ? Math.round((listos / total) * 100) : 0;
  const completo = total > 0 && listos === total;
  return h(
    'div',
    { class: 'progreso' },
    h(
      'div',
      { class: 'progreso__barra' },
      h('div', {
        class: `progreso__relleno${completo ? '' : ' progreso__relleno--parcial'}`,
        style: `width:${porcentaje}%`
      })
    ),
    h('span', { class: 'progreso__texto' }, `${listos}/${total}`)
  );
}

// ---------- Avisos y modales ----------

let contenedorMensajes;

export function avisar(texto, tipo = 'ok') {
  if (!contenedorMensajes) {
    contenedorMensajes = h('div', { class: 'mensajes' });
    document.body.append(contenedorMensajes);
  }
  const mensaje = h('div', { class: `mensaje mensaje--${tipo}` }, texto);
  contenedorMensajes.append(mensaje);
  setTimeout(() => mensaje.remove(), tipo === 'error' ? 6000 : 3500);
}

export function abrirModal({ titulo, cuerpo, acciones = [], alCerrar }) {
  const fondo = h('div', { class: 'modal-fondo' });

  const cerrar = () => {
    fondo.remove();
    document.removeEventListener('keydown', alTeclado);
    if (alCerrar) alCerrar();
  };
  const alTeclado = (e) => { if (e.key === 'Escape') cerrar(); };

  const modal = h(
    'div',
    { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
    h(
      'div',
      { class: 'modal__titulo' },
      h('span', {}, titulo),
      h('button', { class: 'modal__cerrar', type: 'button', 'aria-label': 'Cerrar', onClick: cerrar }, '×')
    ),
    h('div', { class: 'modal__cuerpo' }, cuerpo),
    acciones.length ? h('div', { class: 'modal__pie' }, ...acciones) : null
  );

  fondo.append(modal);
  fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(); });
  document.addEventListener('keydown', alTeclado);
  document.body.append(fondo);

  const primerCampo = modal.querySelector('input, select, textarea');
  if (primerCampo) primerCampo.focus();

  return { cerrar, modal };
}

export function confirmar(texto, { titulo = 'Confirmar', textoBoton = 'Confirmar', peligro = true } = {}) {
  return new Promise((resolver) => {
    let respondido = false;
    const responder = (valor) => { respondido = true; ref.cerrar(); resolver(valor); };

    const ref = abrirModal({
      titulo,
      cuerpo: h('p', {}, texto),
      acciones: [
        h('button', { class: 'boton', type: 'button', onClick: () => responder(false) }, 'Cancelar'),
        h(
          'button',
          { class: `boton ${peligro ? 'boton--peligro' : 'boton--primario'}`, type: 'button', onClick: () => responder(true) },
          textoBoton
        )
      ],
      alCerrar: () => { if (!respondido) resolver(false); }
    });
  });
}

// Mantiene el dominio en mayusculas mientras se escribe.
export function campoDominio(props = {}) {
  return h('input', {
    class: 'dominio-input',
    placeholder: 'AB123CD',
    maxLength: 10,
    autocomplete: 'off',
    ...props,
    onInput: (e) => {
      const pos = e.target.selectionStart;
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      e.target.setSelectionRange(pos, pos);
      if (props.onInput) props.onInput(e);
    }
  });
}

export function campo(etiqueta, control, ayuda) {
  return h('div', { class: 'campo' }, h('label', {}, etiqueta), control, ayuda ? h('span', { class: 'ayuda' }, ayuda) : null);
}

export function campoAncho(etiqueta, control, ayuda) {
  const c = campo(etiqueta, control, ayuda);
  c.classList.add('campo--ancho');
  return c;
}

// Casilla de tildar con su texto al lado, alineada con el resto de los
// filtros. Se usa en vez de armarla a mano con estilos sueltos.
export function campoCasilla(etiqueta, control) {
  return h('label', { class: 'casilla' }, control, h('span', {}, etiqueta));
}

export function opciones(select, lista, seleccionado) {
  for (const { valor, texto } of lista) {
    select.append(h('option', { value: valor, selected: String(valor) === String(seleccionado) }, texto));
  }
  return select;
}

export function vacio(texto, icono = '📭') {
  return h('div', { class: 'vacio' }, h('span', { class: 'vacio__icono' }, icono), texto);
}

// ---------- Trabajos en curso y memoria de la pantalla ----------

// Mientras se sube un archivo la pantalla no se redibuja sola: se perderia
// el cartel de "Subiendo…".
let trabajosEnCurso = 0;
export async function mientrasTrabaja(promesa) {
  trabajosEnCurso += 1;
  try {
    return await promesa;
  } finally {
    trabajosEnCurso -= 1;
  }
}
export function hayTrabajoEnCurso() {
  return trabajosEnCurso > 0;
}

// Filtros y busquedas elegidos en cada pantalla. Asi, cuando la pantalla se
// actualiza sola con cambios nuevos, queda como la dejaste.
const memoria = new Map();
export function recordar(clave, valor) {
  memoria.set(clave, valor);
}
export function recordado(clave, porDefecto) {
  return memoria.has(clave) ? memoria.get(clave) : porDefecto;
}
