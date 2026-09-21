import { api, cuandoSePierdeLaSesion } from './api.js';
import { config, estaConfigurado } from './config.js';
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

  if (reemplazar) {
    // replaceState no dispara "hashchange", asi que hay que redibujar a mano:
    // si no, la pantalla se queda en "Cargando…" para siempre.
    history.replaceState(null, '', destino);
    return dibujar();
  }

  // Cambiar el hash si dispara "hashchange", que es quien redibuja.
  location.hash = destino;
  return undefined;
}

function rutaActual() {
  return location.hash.replace(/^#\/?/, '').split('?')[0] || 'panel';
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
      h('div', { class: 'menu__usuario' }, estado.usuario.nombre || estado.usuario.email),
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

// La web se publica sola pero el SQL se corre a mano, asi que la base puede
// quedar atras. Cuando pasa, medio programa deja de funcionar con errores de
// Postgres que no dicen nada: mejor decirlo una vez, arriba de todo.
function avisoDeVersion() {
  const cfg = estado.config;
  if (!cfg || typeof cfg.version_base !== 'number') return null;
  if (cfg.version_base >= api.VERSION_ESQUEMA) return null;

  return h(
    'div',
    { class: 'aviso aviso--error barra-version' },
    h('strong', {}, 'La base de datos esta desactualizada. '),
    'Hasta que se actualice, algunas cosas van a fallar (por ejemplo los estados nuevos ' +
      'de la documentacion). Entra a Supabase → SQL Editor, pega el contenido del archivo ' +
      'supabase/actualizar.sql y dale a Run. Se puede correr las veces que haga falta.'
  );
}

// Numero del ultimo dibujado pedido. Si mientras se arma una pantalla se
// pide otra, la primera se descarta en vez de pisar a la nueva.
let dibujadoActual = 0;

async function dibujar() {
  if (!estaConfigurado()) return dibujarSinConfigurar();
  if (!estado.usuario) return dibujarIngreso();

  const ruta = rutaActual();
  const resuelto = resolver(ruta);

  if (!resuelto) return navegar('panel', { reemplazar: true });
  if (resuelto.definicion.soloAdmin && estado.usuario.rol !== 'admin') {
    return navegar('panel', { reemplazar: true });
  }

  const miTurno = ++dibujadoActual;

  const contenido = h('main', { class: 'contenido' }, h('div', { class: 'cargando' }, 'Cargando…'));
  const partes = [
    avisoDeVersion(),
    h('div', { class: 'app' }, menuLateral(resuelto.definicion.ruta), contenido)
  ].filter(Boolean);
  vaciar(raiz).append(...partes);

  try {
    const vista = await resuelto.definicion.vista(resuelto.params);
    if (miTurno !== dibujadoActual) return undefined;
    vaciar(contenido).append(vista);
    marcarComoVisto();
    window.scrollTo(0, 0);
  } catch (error) {
    if (miTurno !== dibujadoActual) return undefined;
    vaciar(contenido).append(
      encabezado('Ups'),
      h('div', { class: 'aviso aviso--error' }, error.message || 'No se pudo cargar la pagina.'),
      h('button', { class: 'boton', type: 'button', onClick: dibujar }, 'Reintentar')
    );
  }
  return undefined;
}

// ---------- Pantalla de ingreso ----------

function cajaLogin(...contenido) {
  vaciar(raiz).append(
    h(
      'div',
      { class: 'login' },
      h(
        'div',
        { class: 'login__caja' },
        h('div', { class: 'login__marca' }, h('strong', {}, 'ENGEL'), h('span', {}, 'Administracion de ventas')),
        avisoDeVersion(),
        ...contenido
      )
    )
  );
}

function dibujarSinConfigurar() {
  cajaLogin(
    h('div', { class: 'aviso aviso--error' }, 'Falta conectar la web con la base de datos.'),
    h('p', { class: 'tenue' },
      'Hay que completar el archivo public/js/config.js con los datos del proyecto de Supabase ' +
      '(Project Settings → API): la "Project URL" y la clave "anon public".'),
    h('p', { class: 'tenue' }, 'El README del repositorio tiene el paso a paso.')
  );
}

function dibujarIngreso(mensaje, modo = 'ingresar') {
  const email = h('input', { type: 'email', required: true, autocomplete: 'username', placeholder: 'tunombre@engel.com' });
  const password = h('input', {
    type: 'password',
    required: modo !== 'olvide',
    autocomplete: modo === 'crear' ? 'new-password' : 'current-password',
    placeholder: '••••••••',
    minLength: 8
  });
  const nombre = h('input', { placeholder: 'Nombre y apellido', autocomplete: 'name' });

  const aviso = h('div', { class: 'aviso aviso--error', style: 'display:none' });
  if (mensaje) {
    aviso.textContent = mensaje.texto || mensaje;
    aviso.className = `aviso aviso--${mensaje.tipo || 'error'}`;
    aviso.style.display = '';
  }

  const TEXTOS = {
    ingresar: { boton: 'Ingresar', cargando: 'Ingresando…' },
    crear: { boton: 'Crear mi cuenta', cargando: 'Creando…' },
    olvide: { boton: 'Enviarme un email', cargando: 'Enviando…' }
  };

  const boton = h('button', { class: 'boton boton--primario boton--ancho', type: 'submit' }, TEXTOS[modo].boton);

  const enviar = async (e) => {
    e.preventDefault();
    boton.disabled = true;
    boton.textContent = TEXTOS[modo].cargando;
    aviso.style.display = 'none';

    try {
      if (modo === 'olvide') {
        await api.recuperarPassword(email.value);
        dibujarIngreso(
          { texto: 'Te mandamos un email con el link para poner una contrasena nueva.', tipo: 'ok' },
          'ingresar'
        );
        return;
      }

      if (modo === 'crear') {
        const { necesitaConfirmar } = await api.registrarse(email.value, password.value, nombre.value);
        if (necesitaConfirmar) {
          dibujarIngreso(
            { texto: 'Cuenta creada. Revisa tu email y confirma la direccion para poder entrar.', tipo: 'ok' },
            'ingresar'
          );
          return;
        }
      }

      const { usuario } = await api.login(email.value, password.value);
      estado.usuario = usuario;
      await refrescarPendientes();
      iniciarSincronizacion(() => dibujar());
      dibujar();
    } catch (error) {
      aviso.textContent = error.message;
      aviso.className = 'aviso aviso--error';
      aviso.style.display = '';
      password.value = '';
    } finally {
      boton.disabled = false;
      boton.textContent = TEXTOS[modo].boton;
    }
  };

  const cambiarA = (nuevo) => (e) => {
    e.preventDefault();
    dibujarIngreso(null, nuevo);
  };

  const pie =
    modo === 'ingresar'
      ? h(
          'div',
          { style: 'margin-top:1rem;text-align:center;font-size:.85rem' },
          h('a', { href: '#', onClick: cambiarA('crear') }, 'Crear mi cuenta'),
          h('span', { class: 'tenue' }, ' · '),
          h('a', { href: '#', onClick: cambiarA('olvide') }, 'Olvide mi contrasena')
        )
      : h(
          'div',
          { style: 'margin-top:1rem;text-align:center;font-size:.85rem' },
          h('a', { href: '#', onClick: cambiarA('ingresar') }, '← Volver al ingreso')
        );

  cajaLogin(
    h(
      'form',
      { onSubmit: enviar },
      aviso,
      modo === 'crear'
        ? h('div', { class: 'aviso aviso--info' },
            'Usa el mismo email con el que te invitaron. Si todavia no te invitaron, pedile a un ' +
            'administrador de Engel que te sume desde la solapa Equipo.')
        : null,
      modo === 'olvide'
        ? h('p', { class: 'tenue' }, 'Te mandamos un link a tu email para poner una contrasena nueva.')
        : null,
      campo('Email', email),
      modo === 'crear' ? h('div', { style: 'height:.75rem' }) : null,
      modo === 'crear' ? campo('Nombre', nombre) : null,
      modo !== 'olvide' ? h('div', { style: 'height:.75rem' }) : null,
      modo !== 'olvide'
        ? campo('Contrasena', password, modo === 'crear' ? 'Minimo 8 caracteres. La elegis vos.' : null)
        : null,
      h('div', { style: 'height:1.25rem' }),
      boton
    ),
    pie
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
    dibujarIngreso();
  }
}

function abrirCambioPassword() {
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
      error.textContent = 'La contrasena tiene que tener al menos 8 caracteres.';
      error.style.display = '';
      return;
    }
    try {
      await api.cambiarPassword(null, nueva.value);
      ref.cerrar();
      avisar('Contrasena actualizada.');
    } catch (err) {
      error.textContent = err.message;
      error.style.display = '';
    }
  };

  const ref = abrirModal({
    titulo: 'Cambiar mi contrasena',
    cuerpo: h(
      'div',
      { class: 'campos' },
      error,
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
  detenerSincronizacion();
  dibujarIngreso('Tu sesion vencio. Volve a ingresar.');
});

window.addEventListener('hashchange', dibujar);

(async function iniciar() {
  if (!estaConfigurado()) {
    dibujarSinConfigurar();
    return;
  }

  try {
    const configuracion = await api.configuracion();
    estado.config = configuracion;
    estado.usuario = configuracion.usuario && configuracion.usuario.activo ? configuracion.usuario : null;
  } catch (error) {
    cajaLogin(
      h('div', { class: 'aviso aviso--error' }, `No se pudo conectar con la base de datos: ${error.message}`),
      h('p', { class: 'tenue' }, `Revisa que la direccion en config.js sea correcta (${config.url || 'sin definir'}).`),
      h('button', { class: 'boton boton--ancho', type: 'button', onClick: () => location.reload() }, 'Reintentar')
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
