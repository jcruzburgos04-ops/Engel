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
  const limpio = String(iso).replace(' ', 'T') + (String(iso).endsWith('Z') ? '' : 'Z');
  const d = new Date(limpio);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
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

export function formatearDominio(dominio) {
  const d = String(dominio || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z]{3}\d{3}$/.test(d)) return `${d.slice(0, 3)} ${d.slice(3)}`;
  if (/^[A-Z]{2}\d{3}[A-Z]{2}$/.test(d)) return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
  return d;
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

export const ESTADOS_DOCUMENTO = {
  pendiente: { texto: 'Pendiente', clase: '' },
  en_tramite: { texto: 'En tramite', clase: 'etiqueta--aviso' },
  ok: { texto: 'Listo', clase: 'etiqueta--ok' },
  no_aplica: { texto: 'No aplica', clase: 'etiqueta--info' }
};

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

export function opciones(select, lista, seleccionado) {
  for (const { valor, texto } of lista) {
    select.append(h('option', { value: valor, selected: String(valor) === String(seleccionado) }, texto));
  }
  return select;
}

export function vacio(texto, icono = '📭') {
  return h('div', { class: 'vacio' }, h('span', { class: 'vacio__icono' }, icono), texto);
}
