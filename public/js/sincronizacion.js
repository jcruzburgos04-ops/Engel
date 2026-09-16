// Detecta que otra persona cargo o cambio algo mientras esta pagina estaba
// abierta. No pisa lo que el usuario esta escribiendo: avisa con un cartel y
// deja que decida cuando actualizar.

import { h } from './util.js';
import { api } from './api.js';

const INTERVALO_VISIBLE = 12000;
const INTERVALO_OCULTO = 60000;

let version = null;
let temporizador;
let cartel;
let alActualizar = null;

async function consultar() {
  try {
    const datos = await api.estadoDatos();

    if (version === null) {
      version = datos.version;
      return;
    }
    if (datos.version !== version) mostrarCartel();
  } catch {
    // Sin conexion: se vuelve a intentar en el proximo ciclo.
  }
}

function mostrarCartel() {
  if (cartel) return;

  cartel = h(
    'div',
    { class: 'aviso-sincro', role: 'status' },
    h('span', {}, '🔄 Alguien del equipo cargo cambios nuevos.'),
    h(
      'button',
      {
        class: 'boton boton--chico boton--primario',
        type: 'button',
        onClick: () => {
          ocultarCartel();
          version = null;
          if (alActualizar) alActualizar();
        }
      },
      'Actualizar'
    ),
    h('button', { class: 'boton boton--chico', type: 'button', onClick: ocultarCartel }, 'Despues')
  );
  document.body.append(cartel);
}

function ocultarCartel() {
  if (cartel) {
    cartel.remove();
    cartel = null;
  }
}

function programar() {
  clearTimeout(temporizador);
  const espera = document.visibilityState === 'visible' ? INTERVALO_VISIBLE : INTERVALO_OCULTO;
  temporizador = setTimeout(async () => {
    await consultar();
    programar();
  }, espera);
}

/** Marca la version actual como vista (se llama al redibujar una vista). */
export function marcarComoVisto() {
  ocultarCartel();
  version = null;
  consultar();
}

export function iniciarSincronizacion(callbackActualizar) {
  alActualizar = callbackActualizar;
  consultar();
  programar();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') consultar();
    programar();
  });
}

export function detenerSincronizacion() {
  clearTimeout(temporizador);
  ocultarCartel();
}
