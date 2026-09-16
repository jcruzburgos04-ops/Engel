// Borradores de formularios.
//
// Mientras alguien completa una carga, lo escrito se guarda solo: primero en
// el navegador (al instante) y despues en el servidor (a los pocos segundos).
// Si se cierra la pagina sin guardar, al volver se ofrece recuperar lo que
// estaba escrito, incluso desde otra computadora.

const PREFIJO_LOCAL = 'engel:borrador:';
const DEMORA_SERVIDOR = 1500;

function claveLocal(clave) {
  return PREFIJO_LOCAL + clave;
}

function guardarLocal(clave, contenido) {
  try {
    localStorage.setItem(claveLocal(clave), JSON.stringify({ contenido, fecha: new Date().toISOString() }));
  } catch {
    // Sin localStorage el borrador vive solo en el servidor.
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

async function guardarEnServidor(clave, contenido) {
  await fetch(`/api/borradores/${encodeURIComponent(clave)}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contenido })
  });
}

async function leerDelServidor(clave) {
  try {
    const respuesta = await fetch(`/api/borradores/${encodeURIComponent(clave)}`, {
      credentials: 'same-origin'
    });
    if (!respuesta.ok) return null;
    const { borrador } = await respuesta.json();
    if (!borrador) return null;
    return { contenido: JSON.parse(borrador.contenido), fecha: borrador.actualizado_en };
  } catch {
    return null;
  }
}

export async function descartarBorrador(clave) {
  borrarLocal(clave);
  try {
    await fetch(`/api/borradores/${encodeURIComponent(clave)}`, {
      method: 'DELETE',
      credentials: 'same-origin'
    });
  } catch {
    // Si falla, el borrador queda y se vuelve a ofrecer. Preferible a perderlo.
  }
}

/** Devuelve el borrador mas reciente entre el del navegador y el del servidor. */
export async function recuperarBorrador(clave) {
  const [local, remoto] = await Promise.all([
    Promise.resolve(leerLocal(clave)),
    leerDelServidor(clave)
  ]);

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
      guardarEnServidor(clave, contenido)
        .then(() => alGuardar && alGuardar())
        .catch(() => {
          // El borrador ya quedo en el navegador; se reintenta al proximo cambio.
        });
    }, DEMORA_SERVIDOR);
  };

  formulario.addEventListener('input', guardar);
  formulario.addEventListener('change', guardar);

  // Al salir de la pagina se intenta dejar la ultima version en el servidor.
  const alSalir = () => {
    try {
      const contenido = leer();
      guardarLocal(clave, contenido);
      navigator.sendBeacon?.(
        `/api/borradores/${encodeURIComponent(clave)}`,
        new Blob([JSON.stringify({ contenido })], { type: 'application/json' })
      );
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
