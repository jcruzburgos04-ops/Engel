import { api, cuandoSePierdeLaSesion } from './api.js';
import { h, vaciar, avisar, abrirModal, campo } from './util.js';
import { iniciarGuardado, hayCambiosPendientes, esperarGuardado } from './guardado.js';
import { iniciarSincronizacion, marcarComoVisto, detenerSincronizacion } from './sincronizacion.js';

import { vistaPanel } from './vistas/panel.js';
import { vistaVentas } from './vistas/ventas.js';
import { vistaNuevaVenta } from './vistas/nueva-venta.js';
import { vistaVenta } from './vistas/venta.js';
import { vistaDocumentacion } from './vistas/documentacion.js';
import { vistaBuscador } from './vistas/buscador.js';
import { vistaUsuarios } from './vistas/usuarios.js';

export const estado = {
  usuario: null,
  config: null,
  documentosPendientes: 0
};

const RUTAS = [
  { ruta: 'panel', titulo: 'Panel', icono: '📊', vista: vistaPanel },
  { ruta: 'ventas', titulo: 'Ventas', icono: '🚗', vista: vistaVentas },
  { ruta: 'ventas/nueva', titulo: 'Cargar venta', icono: '➕', vista: vistaNuevaVenta },
  { ruta: 'documentacion', titulo: 'Documentacion', icono: '📁', vista: vistaDocumentacion, globo: 'documentos' },
  { ruta: 'buscador', titulo: 'Buscar dominio', icono: '🔎', vista: vistaBuscador },
  { ruta: 'usuarios', titulo: 'Equipo', icono: '👥', vista: vistaUsuarios, soloAdmin: true }
];

const raiz = document.getElementById('app');

export function navegar(ruta, { reemplazar = false } = {}) {
  const destino = `#/${String(ruta).replace(/^#?\/?/, '')}`;
  if (location.hash === destino) return dibujar();
  if (reemplazar) history.replaceState(null, '', destino);
  else location.hash = destino;
  return undefined;
}

function rutaActual() {
  return location.hash.replace(/^#\/?/, '') || 'panel';
}

function resolver(ruta) {
  if (/^ventas\/nueva$/.test(ruta)) return { definicion: RUTAS.find((r) => r.ruta === 'ventas/nueva'), params: {} };

  const detalle = ruta.match(/^ventas\/(\d+)$/);
  if (detalle) {
    return { definicion: { ruta: 'ventas', titulo: 'Detalle de la venta', vista: vistaVenta }, params: { id: Number(detalle[1]) } };
  }

  const dominio = ruta.match(/^buscador\/(.+)$/);
  if (dominio) {
    return { definicion: RUTAS.find((r) => r.ruta === 'buscador'), params: { dominio: decodeURIComponent(dominio[1]) } };
  }

  const definicion = RUTAS.find((r) => r.ruta === ruta);
  return definicion ? { definicion, params: {} } : null;
}

// ---------- Estructura de la aplicacion ----------

function menuLateral(rutaActiva) {
  const links = RUTAS.filter((r) => !r.soloAdmin || estado.usuario.rol === 'admin').map((r) => {
    const activo = rutaActiva === r.ruta || (r.ruta === 'ventas' && /^ventas\/\d+$/.test(rutaActiva));
    const pendientes = r.globo === 'documentos' ? estado.documentosPendientes : 0;
    return h(
      'a',
      { class: `menu__link${activo ? ' activo' : ''}`, href: `#/${r.ruta}` },
      h('span', { class: 'icono' }, r.icono),
      h('span', { class: 'texto' }, r.titulo),
      pendientes > 0 ? h('span', { class: 'globo' }, pendientes > 99 ? '99+' : String(pendientes)) : null
    );
  });

  return h(
    'nav',
    { class: 'menu' },
    h('div', { class: 'menu__marca' }, h('strong', {}, 'ENGEL'), h('span', {}, 'Ventas')),
    h('div', { class: 'menu__links' }, ...links),
    h(
      'div',
      { class: 'menu__pie' },
      h('div', { class: 'menu__usuario' }, estado.usuario.nombre),
      h('div', { class: 'menu__rol' }, estado.usuario.rol === 'admin' ? 'Administrador' : 'Vendedor'),
      h(
        'div',
        { style: 'display:flex;gap:.4rem;margin-top:.5rem;flex-wrap:wrap' },
        h('button', { class: 'boton boton--chico', type: 'button', onClick: abrirCambioPassword }, 'Clave'),
        h('button', { class: 'boton boton--chico', type: 'button', onClick: cerrarSesion }, 'Salir')
      )
    )
  );
}

export function encabezado(titulo, subtitulo, ...acciones) {
  return h(
    'header',
    { class: 'encabezado' },
    h('div', { class: 'encabezado__texto' }, h('h1', {}, titulo), subtitulo ? h('p', {}, subtitulo) : null),
    acciones.length ? h('div', { class: 'encabezado__acciones' }, ...acciones) : null
  );
}

async function dibujar() {
  if (!estado.usuario) return dibujarLogin();

  const ruta = rutaActual();
  const resuelto = resolver(ruta);

  if (!resuelto) return navegar('panel', { reemplazar: true });
  if (resuelto.definicion.soloAdmin && estado.usuario.rol !== 'admin') {
    return navegar('panel', { reemplazar: true });
  }

  const contenido = h('main', { class: 'contenido' }, h('div', { class: 'cargando' }, 'Cargando…'));
  vaciar(raiz).append(h('div', { class: 'app' }, menuLateral(resuelto.definicion.ruta), contenido));

  try {
    const vista = await resuelto.definicion.vista(resuelto.params);
    vaciar(contenido).append(vista);
    marcarComoVisto();
    window.scrollTo(0, 0);
  } catch (error) {
    vaciar(contenido).append(
      encabezado('Ups'),
      h('div', { class: 'aviso aviso--error' }, error.message || 'No se pudo cargar la pagina.'),
      h('button', { class: 'boton', type: 'button', onClick: dibujar }, 'Reintentar')
    );
  }
  return undefined;
}

// ---------- Login ----------

function dibujarLogin(mensaje) {
  const email = h('input', { type: 'email', required: true, autocomplete: 'username', placeholder: 'tunombre@engel.com' });
  const password = h('input', { type: 'password', required: true, autocomplete: 'current-password', placeholder: '••••••••' });
  const boton = h('button', { class: 'boton boton--primario boton--ancho', type: 'submit' }, 'Ingresar');
  const error = h('div', { class: 'aviso aviso--error', style: 'display:none' });

  if (mensaje) {
    error.textContent = mensaje;
    error.style.display = '';
  }

  const formulario = h(
    'form',
    {
      onSubmit: async (e) => {
        e.preventDefault();
        boton.disabled = true;
        boton.textContent = 'Ingresando…';
        error.style.display = 'none';
        try {
          const { usuario } = await api.login(email.value.trim(), password.value);
          estado.usuario = usuario;
          await refrescarPendientes();
          iniciarSincronizacion(() => dibujar());
          navegar(rutaActual());
          dibujar();
        } catch (err) {
          error.textContent = err.message;
          error.style.display = '';
          password.value = '';
          password.focus();
        } finally {
          boton.disabled = false;
          boton.textContent = 'Ingresar';
        }
      }
    },
    error,
    campo('Email', email),
    h('div', { style: 'height:.75rem' }),
    campo('Contrasena', password),
    h('div', { style: 'height:1.25rem' }),
    boton
  );

  vaciar(raiz).append(
    h(
      'div',
      { class: 'login' },
      h(
        'div',
        { class: 'login__caja' },
        h('div', { class: 'login__marca' }, h('strong', {}, 'ENGEL'), h('span', {}, 'Administracion de ventas')),
        formulario
      )
    )
  );
  email.focus();
}

async function cerrarSesion() {
  if (hayCambiosPendientes()) {
    avisar('Esperando a que terminen de guardarse los ultimos cambios…');
    await esperarGuardado();
  }
  try {
    await api.logout();
  } finally {
    estado.usuario = null;
    detenerSincronizacion();
    dibujarLogin();
  }
}

function abrirCambioPassword() {
  const actual = h('input', { type: 'password', required: true, autocomplete: 'current-password' });
  const nueva = h('input', { type: 'password', required: true, minLength: 8, autocomplete: 'new-password' });
  const repetir = h('input', { type: 'password', required: true, minLength: 8, autocomplete: 'new-password' });
  const error = h('div', { class: 'aviso aviso--error', style: 'display:none' });

  const guardar = async () => {
    error.style.display = 'none';
    if (nueva.value !== repetir.value) {
      error.textContent = 'La contrasena nueva y su repeticion no coinciden.';
      error.style.display = '';
      return;
    }
    if (nueva.value.length < 8) {
      error.textContent = 'La contrasena nueva tiene que tener al menos 8 caracteres.';
      error.style.display = '';
      return;
    }
    try {
      await api.cambiarPassword(actual.value, nueva.value);
      ref.cerrar();
      avisar('Contrasena actualizada.');
    } catch (err) {
      error.textContent = err.message;
      error.style.display = '';
    }
  };

  const ref = abrirModal({
    titulo: 'Cambiar contrasena',
    cuerpo: h(
      'div',
      { class: 'campos' },
      error,
      campo('Contrasena actual', actual),
      campo('Contrasena nueva', nueva, 'Minimo 8 caracteres'),
      campo('Repetir contrasena nueva', repetir)
    ),
    acciones: [
      h('button', { class: 'boton', type: 'button', onClick: () => ref.cerrar() }, 'Cancelar'),
      h('button', { class: 'boton boton--primario', type: 'button', onClick: guardar }, 'Guardar')
    ]
  });
}

// ---------- Arranque ----------

export async function refrescarPendientes() {
  try {
    const stats = await api.estadisticas();
    estado.documentosPendientes = stats.documentos_pendientes || 0;
  } catch {
    estado.documentosPendientes = 0;
  }
}

cuandoSePierdeLaSesion(() => {
  if (!estado.usuario) return;
  estado.usuario = null;
  dibujarLogin('Tu sesion vencio. Volve a ingresar.');
});

window.addEventListener('hashchange', dibujar);

(async function iniciar() {
  try {
    const config = await api.configuracion();
    estado.config = config;
    estado.usuario = config.usuario;
  } catch {
    vaciar(raiz).append(
      h('div', { class: 'cargando' }, 'No se pudo conectar con el servidor. Actualiza la pagina.')
    );
    return;
  }

  iniciarGuardado();

  if (estado.usuario) {
    await refrescarPendientes();
    iniciarSincronizacion(() => dibujar());
  }
  dibujar();
})();

export { dibujar };
