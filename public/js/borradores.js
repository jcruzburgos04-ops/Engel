// Borradores de formularios.
//
// Mientras alguien completa una carga, lo escrito se guarda solo: primero en
// el navegador (al instante) y despues en la base (a los pocos segundos).
// Si se cierra la pagina sin guardar, al volver se ofrece recuperar lo que
// estaba escrito, incluso desde otra computadora.

import { api } from './api.js';
import { encolar } from './guardado.js';
import { config } from './config.js';

const PREFIJO_LOCAL = `engel:borrador:${config.proyecto}:`;
const DEMORA_REMOTA = 1500;

function claveLocal(clave) {
  return PREFIJO_LOCAL + clave;
}

function guardarLocal(clave, contenido) {
  try {
    localStorage.setItem(claveLocal(clave), JSON.stringify({ contenido, fecha: new Date().toISOString() }));
  } catch {
    // Sin localStorage el borrador vive solo en la base.
  }
}

function leerLocal(clave) {
  try {
    const guardado = localStorage.getItem(claveLocal(clave));
    return guardado ? JSON.parse(guardado) : null;
  } catch {
    return null;
  }
}

function borrarLocal(clave) {
  try {
    localStorage.removeItem(claveLocal(clave));
  } catch {
    // Nada que hacer.
  }
}

export async function descartarBorrador(clave) {
  borrarLocal(clave);
  try {
    await api.descartarBorrador(clave);
  } catch {
    // Si falla, el borrador queda y se vuelve a ofrecer. Preferible a perderlo.
  }
}

/** Devuelve el borrador mas reciente entre el del navegador y el de la base. */
export async function recuperarBorrador(clave) {
  const local = leerLocal(clave);
  let remoto = null;
  try {
    remoto = await api.leerBorrador(clave);
  } catch {
    // Sin conexion alcanza con el del navegador.
  }

  if (local && remoto) {
    return new Date(local.fecha) >= new Date(remoto.fecha) ? local : remoto;
  }
  return local || remoto;
}

/**
 * Engancha un formulario al guardado automatico de borradores.
 * `leer` devuelve el contenido actual del formulario.
 */
export function vigilarBorrador(formulario, clave, leer, { alGuardar } = {}) {
  let temporizador;
  let ultimo = '';

  const guardar = () => {
    let contenido;
    try {
      contenido = leer();
    } catch {
      return;
    }

    const serializado = JSON.stringify(contenido);
    if (serializado === ultimo) return;
    ultimo = serializado;

    guardarLocal(clave, contenido);

    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      // Pasa por la cola: si no hay internet, se reintenta solo.
      encolar({
        clave: `borrador:${clave}`,
        operacion: 'guardar_borrador',
        args: { clave, contenido },
        descripcion: 'Borrador',
        alConfirmar: () => alGuardar && alGuardar()
      });
    }, DEMORA_REMOTA);
  };

  formulario.addEventListener('input', guardar);
  formulario.addEventListener('change', guardar);

  // Al salir de la pagina el borrador queda al menos en el navegador.
  const alSalir = () => {
    try {
      guardarLocal(clave, leer());
    } catch {
      // Nada que hacer al cerrar.
    }
  };
  window.addEventListener('pagehide', alSalir);

  return {
    guardarAhora: guardar,
    detener() {
      clearTimeout(temporizador);
      formulario.removeEventListener('input', guardar);
      formulario.removeEventListener('change', guardar);
      window.removeEventListener('pagehide', alSalir);
    }
  };
}
