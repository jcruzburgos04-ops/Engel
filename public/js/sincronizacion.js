// Mantiene la pantalla al dia sola.
//
// - Datos: cada pocos segundos se pregunta a la base si algo cambio (lo haya
//   cambiado otra persona, vos desde otra pestana o vos mismo en esta). Si
//   cambio, la pantalla se vuelve a dibujar con lo nuevo, sin avisos ni
//   botones.
// - La web: si se publico una version nueva, la pagina se recarga sola.
//
// En los dos casos se espera el momento justo: nunca mientras estas
// escribiendo, con una ventana abierta, subiendo un archivo o con cambios
// que todavia no se guardaron. Lo que no se puede interrumpir, se posterga.

import { api } from './api.js';

const INTERVALO_VISIBLE = globalThis.__ENGEL_INTERVALO_DATOS__ || 8000;
const INTERVALO_OCULTO = 60000;
const INTERVALO_WEB = globalThis.__ENGEL_INTERVALO_WEB__ || 60000;
const REINTENTO_OCUPADO = 2000;

let versionVista = null; // version de los datos que muestra la pantalla
let hayDatosNuevos = false;
let temporizador;
let reintento;
let alActualizar = null;
let sePuedeInterrumpir = () => true;

let versionWeb = null; // version de la web cargada en esta pestana
let hayWebNueva = false;
let temporizadorWeb;
let escuchando = false;

// ---------- Datos ----------

async function consultar() {
  try {
    const { version } = await api.estadoDatos();
    if (versionVista === null) {
      versionVista = version;
      return;
    }
    if (version !== versionVista) {
      hayDatosNuevos = true;
      versionVista = version;
      intentar();
    }
  } catch {
    // Sin conexion: se vuelve a intentar en el proximo ciclo.
  }
}

// Aplica lo pendiente si se puede; si no, lo reintenta en un rato.
function intentar() {
  clearTimeout(reintento);
  if (!hayWebNueva && !hayDatosNuevos) return;

  if (document.visibilityState !== 'visible' || !sePuedeInterrumpir()) {
    reintento = setTimeout(intentar, REINTENTO_OCUPADO);
    return;
  }

  if (hayWebNueva) {
    // La cola de guardado vive en el navegador, pero igual se espera a que
    // este vacia (sePuedeInterrumpir lo revisa) antes de recargar.
    location.reload();
    return;
  }

  hayDatosNuevos = false;
  if (alActualizar) alActualizar();
}

function programar() {
  clearTimeout(temporizador);
  const espera = document.visibilityState === 'visible' ? INTERVALO_VISIBLE : INTERVALO_OCULTO;
  temporizador = setTimeout(async () => {
    await consultar();
    programar();
  }, espera);
}

// ---------- Version de la web ----------

// version.json lo escribe la publicacion (Netlify o Vercel) con el codigo
// del cambio. Si no existe (por ejemplo, probando en la computadora), esta
// parte queda apagada.
async function leerVersionWeb() {
  try {
    const respuesta = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!respuesta.ok) return null;
    const datos = await respuesta.json();
    return datos && datos.version ? String(datos.version) : null;
  } catch {
    return null;
  }
}

async function revisarWeb() {
  const actual = await leerVersionWeb();
  if (actual === null) return;
  if (versionWeb === null) {
    versionWeb = actual;
  } else if (actual !== versionWeb) {
    hayWebNueva = true;
    intentar();
    return;
  }
  temporizadorWeb = setTimeout(revisarWeb, INTERVALO_WEB);
}

// ---------- Uso desde la aplicacion ----------

/** La pantalla se acaba de dibujar con datos frescos. */
export function marcarComoVisto() {
  hayDatosNuevos = false;
  versionVista = null;
  consultar();
}

/**
 * - `actualizar`: redibuja la pantalla actual con los datos nuevos.
 * - `puedeInterrumpir`: dice si ahora se puede redibujar sin molestar.
 */
export function iniciarSincronizacion(actualizar, puedeInterrumpir) {
  alActualizar = actualizar;
  if (puedeInterrumpir) sePuedeInterrumpir = puedeInterrumpir;
  consultar();
  programar();
  if (versionWeb === null) revisarWeb();

  if (!escuchando) {
    escuchando = true;
    document.addEventListener('visibilitychange', () => {
      if (!alActualizar) return;
      if (document.visibilityState === 'visible') {
        consultar();
        intentar();
      }
      programar();
    });
  }
}

export function detenerSincronizacion() {
  alActualizar = null;
  hayDatosNuevos = false;
  clearTimeout(temporizador);
  clearTimeout(reintento);
  clearTimeout(temporizadorWeb);
}
