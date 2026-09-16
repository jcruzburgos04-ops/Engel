// Motor de guardado automatico.
//
// Todo cambio que se hace en la web se encola aca y se reintenta hasta que el
// servidor lo confirma. La cola se guarda en el navegador, asi que sobrevive a
// una recarga, a un cierre del navegador o a una caida de internet: cuando se
// vuelve a abrir la pagina, los cambios pendientes se mandan solos.

import { h } from './util.js';
import { api } from './api.js';

// Operaciones que se pueden encolar. La cola guarda el nombre y los datos
// (no la funcion), asi sobrevive a una recarga del navegador.
const OPERACIONES = {
  editar_venta: ({ id, datos }) => api.editarVenta(id, datos),
  editar_documento: ({ id, cambios }) => api.editarDocumento(id, cambios),
  guardar_borrador: ({ clave, contenido }) => api.guardarBorrador(clave, contenido)
};

const CLAVE_COLA = 'engel:cola-de-guardado';
const MAX_INTENTOS = 12;
const ESPERAS = [500, 1000, 2000, 4000, 8000, 15000, 30000];

let cola = [];
let enviando = false;
let indicador;
let ultimoError = '';
const escuchas = new Set();

// ---------- Persistencia de la cola ----------

function leerCola() {
  try {
    const guardado = localStorage.getItem(CLAVE_COLA);
    return guardado ? JSON.parse(guardado) : [];
  } catch {
    return [];
  }
}

function escribirCola() {
  try {
    localStorage.setItem(CLAVE_COLA, JSON.stringify(cola));
  } catch {
    // Si el navegador no deja guardar (modo privado, disco lleno), la cola
    // sigue funcionando en memoria durante esta sesion.
  }
}

// ---------- Indicador visible ----------

function estadoActual() {
  if (!cola.length) return ultimoError ? 'error' : 'guardado';
  if (!navigator.onLine) return 'sin-conexion';
  return enviando ? 'guardando' : 'pendiente';
}

const TEXTOS = {
  guardado: { icono: '✓', texto: 'Guardado', clase: 'guardado--ok' },
  guardando: { icono: '⏳', texto: 'Guardando…', clase: 'guardado--trabajando' },
  pendiente: { icono: '⏳', texto: 'Cambios sin guardar', clase: 'guardado--trabajando' },
  'sin-conexion': { icono: '⚠️', texto: 'Sin conexion — se reintenta solo', clase: 'guardado--alerta' },
  error: { icono: '⚠️', texto: 'Hubo un problema al guardar', clase: 'guardado--alerta' }
};

function refrescarIndicador() {
  if (!indicador) {
    indicador = h('div', { class: 'guardado', role: 'status', 'aria-live': 'polite' });
    document.body.append(indicador);
  }

  const estado = estadoActual();
  const info = TEXTOS[estado];
  const pendientes = cola.length;

  indicador.className = `guardado ${info.clase}`;
  indicador.textContent = pendientes > 1 ? `${info.icono} ${info.texto} (${pendientes})` : `${info.icono} ${info.texto}`;
  if (estado === 'error' && ultimoError) indicador.title = ultimoError;
  else indicador.removeAttribute('title');

  // Cuando esta todo guardado el cartel se disimula, para no molestar.
  indicador.classList.toggle('guardado--tranquilo', estado === 'guardado' && !ultimoError);

  for (const escucha of escuchas) escucha({ estado, pendientes });
}

export function alCambiarEstado(callback) {
  escuchas.add(callback);
  callback({ estado: estadoActual(), pendientes: cola.length });
  return () => escuchas.delete(callback);
}

export function hayCambiosPendientes() {
  return cola.length > 0;
}

// ---------- Envio ----------

async function mandar(item) {
  const operacion = OPERACIONES[item.operacion];
  if (!operacion) {
    const error = new Error(`Operacion desconocida: ${item.operacion}`);
    error.definitivo = true;
    throw error;
  }
  return operacion(item.args);
}

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

async function procesar() {
  if (enviando) return;
  enviando = true;
  refrescarIndicador();

  while (cola.length) {
    if (!navigator.onLine) break;

    const item = cola[0];
    try {
      const datos = await mandar(item);
      cola.shift();
      escribirCola();
      ultimoError = '';
      if (item.alConfirmar) item.alConfirmar(datos);
    } catch (error) {
      // Si la base rechazo el dato (por ejemplo, un dominio invalido) o no
      // hay permisos, reintentar no lo va a arreglar: se avisa y se saca.
      const sinSentidoReintentar =
        error.definitivo ||
        ['22023', 'P0002', '23505', '42501', '23503', '23514'].includes(error.codigo);

      if (sinSentidoReintentar) {
        cola.shift();
        escribirCola();
        ultimoError = `${item.descripcion || 'Un cambio'}: ${error.message}`;
        if (item.alFallar) item.alFallar(error);
        refrescarIndicador();
        continue;
      }

      item.intentos = (item.intentos || 0) + 1;
      ultimoError = `${item.descripcion || 'Un cambio'}: ${error.message}`;
      escribirCola();
      refrescarIndicador();

      if (item.intentos >= MAX_INTENTOS) {
        // No se descarta: queda en la cola para el proximo intento (al volver
        // la conexion, al recargar o al pasar el temporizador de fondo).
        break;
      }
      await esperar(ESPERAS[Math.min(item.intentos - 1, ESPERAS.length - 1)]);
    }
  }

  enviando = false;
  refrescarIndicador();
}

/**
 * Encola un cambio para que se guarde solo.
 * Si ya habia un cambio pendiente con la misma clave, lo reemplaza: sirve para
 * que escribir varias letras en un campo no genere veinte guardados.
 */
export function encolar({ clave, operacion, args, descripcion, alConfirmar, alFallar }) {
  const item = { clave, operacion, args, descripcion, intentos: 0, alConfirmar, alFallar };

  const existente = clave ? cola.findIndex((i, indice) => i.clave === clave && !(indice === 0 && enviando)) : -1;
  if (existente >= 0) cola[existente] = item;
  else cola.push(item);

  escribirCola();
  refrescarIndicador();
  procesar();
}

/** Espera a que no quede nada pendiente (o a que se agote el tiempo). */
export function esperarGuardado(msMaximo = 8000) {
  const limite = Date.now() + msMaximo;
  return new Promise((resolver) => {
    const revisar = () => {
      if (!cola.length || Date.now() > limite) return resolver(!cola.length);
      return setTimeout(revisar, 150);
    };
    revisar();
  });
}

export function reintentarAhora() {
  ultimoError = '';
  refrescarIndicador();
  procesar();
}

// ---------- Arranque ----------

export function iniciarGuardado() {
  cola = leerCola().map((item) => ({ ...item, intentos: 0 }));
  refrescarIndicador();
  if (cola.length) procesar();

  window.addEventListener('online', () => reintentarAhora());
  window.addEventListener('offline', refrescarIndicador);

  // Red de seguridad: si algo quedo trabado, se reintenta cada 20 segundos.
  setInterval(() => {
    if (cola.length && !enviando && navigator.onLine) procesar();
  }, 20000);

  // Aviso al cerrar la pestana si todavia hay algo sin confirmar.
  window.addEventListener('beforeunload', (evento) => {
    if (!cola.length) return undefined;
    evento.preventDefault();
    evento.returnValue = '';
    return '';
  });

  // Al volver a la pestana se aprovecha para vaciar la cola.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && cola.length) procesar();
  });
}
