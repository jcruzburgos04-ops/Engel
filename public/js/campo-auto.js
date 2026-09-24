// Campos que se guardan solos.
//
// En cuanto la persona deja de escribir (o cambia un desplegable), el valor se
// manda al servidor a traves de la cola de guardado, que reintenta si algo
// falla. Cada campo se guarda por separado, asi dos personas pueden editar la
// misma venta al mismo tiempo sin pisarse: cada una toca sus propios campos.

import { h } from './util.js';
import { encolar } from './guardado.js';

const DEMORA_TEXTO = 700;

function marcar(contenedor, marca, estado, texto) {
  contenedor.classList.remove('autoguardado--guardando', 'autoguardado--ok', 'autoguardado--error');
  marca.className = 'autoguardado__marca';
  if (!estado) {
    marca.textContent = '';
    return;
  }
  contenedor.classList.add(`autoguardado--${estado}`);
  marca.classList.add(`autoguardado__marca--${estado}`);
  marca.textContent = texto;
}

/**
 * Crea un campo enganchado al guardado automatico.
 *
 * - `control`: el input, select o textarea ya construido.
 * - `ventaId`: la venta a la que pertenece el campo.
 * - `campo`: nombre del dato que se guarda.
 * - `leerValor`: como sacar el valor del control (por defecto, `.value`).
 * - `envolver`: permite mandar el dato anidado (por ejemplo dentro de `vehiculo`).
 */
export function campoAuto({
  etiqueta,
  control,
  ventaId,
  campo,
  ayuda,
  leerValor = (el) => el.value,
  envolver = (valor, nombre) => ({ [nombre]: valor }),
  alConfirmar,
  claveExtra = '',
  // Para usar el mismo campo con otra cosa que no sea una venta (por
  // ejemplo una multa): que operacion encolar, con que datos y que clave.
  operacion = 'editar_venta',
  armarArgs,
  clave,
  // Si devuelve un texto, el valor no se manda y se muestra ese error.
  validar
}) {
  const marca = h('span', { class: 'autoguardado__marca' });
  const contenedor = h(
    'div',
    { class: 'campo autoguardado' },
    etiqueta ? h('label', {}, etiqueta) : null,
    control,
    ayuda ? h('span', { class: 'ayuda' }, ayuda) : null,
    marca
  );

  let ultimoValor = leerValor(control);
  let temporizador;

  const guardar = () => {
    const valor = leerValor(control);
    if (String(valor ?? '') === String(ultimoValor ?? '')) return;

    const problema = validar ? validar(valor) : '';
    if (problema) {
      marcar(contenedor, marca, 'error', problema);
      return;
    }
    ultimoValor = valor;

    marcar(contenedor, marca, 'guardando', 'Guardando…');

    encolar({
      clave: clave || `venta:${ventaId}:${campo}${claveExtra}`,
      operacion,
      args: armarArgs ? armarArgs(valor) : { id: ventaId, datos: envolver(valor, campo) },
      descripcion: etiqueta || campo,
      alConfirmar: (datos) => {
        marcar(contenedor, marca, 'ok', 'Guardado ✓');
        setTimeout(() => marcar(contenedor, marca, null), 2500);
        if (alConfirmar) alConfirmar(datos);
      },
      alFallar: (error) => marcar(contenedor, marca, 'error', error.message)
    });
  };

  const esTexto = control.tagName === 'TEXTAREA' || (control.tagName === 'INPUT' && ['text', 'search', 'email', 'tel', 'number', ''].includes(control.type));

  if (esTexto) {
    control.addEventListener('input', () => {
      clearTimeout(temporizador);
      temporizador = setTimeout(guardar, DEMORA_TEXTO);
    });
    // Al salir del campo se guarda enseguida, sin esperar la demora.
    control.addEventListener('blur', () => {
      clearTimeout(temporizador);
      guardar();
    });
  } else {
    control.addEventListener('change', guardar);
  }

  contenedor.guardarAhora = () => {
    clearTimeout(temporizador);
    guardar();
  };

  return contenedor;
}

/** Igual que campoAuto pero ocupando todo el ancho de la grilla. */
export function campoAutoAncho(opciones) {
  const c = campoAuto(opciones);
  c.classList.add('campo--ancho');
  return c;
}
