import { api } from '../api.js';
import { h, vaciar, fecha, fechaHora, avisar, confirmar, abrirModal, campo, opciones, vacio } from '../util.js';
import { encabezado, estado as estadoApp } from '../app.js';
import { descargarCopiaCompleta } from '../descargas.js';

// Para sumar a alguien al equipo se invita su email. Despues esa persona
// entra al link, crea su contrasena y queda habilitada sola.
function formularioInvitacion(alGuardar) {
  const email = h('input', { type: 'email', required: true, placeholder: 'vendedor@engel.com' });
  const nombre = h('input', { placeholder: 'Nombre y apellido' });
  const rol = opciones(
    h('select', {}),
    [{ valor: 'vendedor', texto: 'Vendedor' }, { valor: 'admin', texto: 'Administrador' }],
    'vendedor'
  );
  const error = h('div', { class: 'aviso aviso--error', style: 'display:none' });

  const guardar = async () => {
    error.style.display = 'none';
    const direccion = email.value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(direccion)) {
      error.textContent = 'Escribi un email valido.';
      error.style.display = '';
      return;
    }
    try {
      await api.invitar({ email: direccion, nombre: nombre.value, rol: rol.value });
      ref.cerrar();
      avisar(`Listo. Pasale el link de la web a ${direccion} para que cree su contrasena.`);
      alGuardar();
    } catch (err) {
      error.textContent = err.message;
      error.style.display = '';
    }
  };

  const ref = abrirModal({
    titulo: 'Sumar a alguien al equipo',
    cuerpo: h(
      'div',
      { class: 'campos' },
      error,
      h('div', { class: 'aviso aviso--info campo--ancho' },
        'Se invita el email. Despues esa persona entra al link de la web, elige "Crear mi cuenta" ' +
        'con ese mismo email y arma su propia contrasena. Vos nunca ves su clave.'),
      campo('Email', email, 'Tiene que ser el mismo con el que se va a registrar.'),
      campo('Nombre', nombre),
      campo('Rol', rol, 'Los administradores invitan gente y pueden borrar ventas.')
    ),
    acciones: [
      h('button', { class: 'boton', type: 'button', onClick: () => ref.cerrar() }, 'Cancelar'),
      h('button', { class: 'boton boton--primario', type: 'button', onClick: guardar }, 'Invitar')
    ]
  });
}

function formularioEditar(usuario, alGuardar) {
  const nombre = h('input', { value: usuario.nombre, required: true });
  const rol = opciones(
    h('select', {}),
    [{ valor: 'vendedor', texto: 'Vendedor' }, { valor: 'admin', texto: 'Administrador' }],
    usuario.rol
  );
  const error = h('div', { class: 'aviso aviso--error', style: 'display:none' });

  const guardar = async () => {
    error.style.display = 'none';
    try {
      await api.editarUsuario(usuario.id, { nombre: nombre.value.trim(), rol: rol.value });
      ref.cerrar();
      avisar('Datos actualizados.');
      alGuardar();
    } catch (err) {
      error.textContent = err.message;
      error.style.display = '';
    }
  };

  const ref = abrirModal({
    titulo: `Editar a ${usuario.nombre}`,
    cuerpo: h(
      'div',
      { class: 'campos' },
      error,
      campo('Nombre', nombre),
      campo('Rol', rol),
      h('div', { class: 'aviso aviso--info campo--ancho' },
        'La contrasena la maneja cada uno. Si se la olvido, puede usar "Olvide mi contrasena" en la pantalla de ingreso.')
    ),
    acciones: [
      h('button', { class: 'boton', type: 'button', onClick: () => ref.cerrar() }, 'Cancelar'),
      h('button', { class: 'boton boton--primario', type: 'button', onClick: guardar }, 'Guardar')
    ]
  });
}

export async function vistaUsuarios() {
  const tabla = h('section', { class: 'tarjeta' }, h('div', { class: 'cargando' }, 'Cargando…'));
  const pendientes = h('section', { class: 'tarjeta' });

  async function cargar() {
    const [{ usuarios }, { invitaciones }] = await Promise.all([
      api.usuarios(true),
      api.invitaciones().catch(() => ({ invitaciones: [] }))
    ]);

    const filas = usuarios.map((usuario) =>
      h(
        'tr',
        {},
        h('td', {}, h('strong', {}, usuario.nombre || '(sin nombre)'),
          usuario.id === estadoApp.usuario.id ? h('span', { class: 'etiqueta etiqueta--info', style: 'margin-left:.4rem' }, 'vos') : null),
        h('td', {}, usuario.email),
        h('td', {}, usuario.rol === 'admin'
          ? h('span', { class: 'etiqueta etiqueta--info' }, 'Administrador')
          : h('span', { class: 'etiqueta' }, 'Vendedor')),
        h('td', {}, usuario.activo
          ? h('span', { class: 'etiqueta etiqueta--ok' }, 'Activo')
          : h('span', { class: 'etiqueta etiqueta--error' }, 'Sin acceso')),
        h('td', {}, fecha(usuario.creado_en)),
        h(
          'td',
          { class: 'acciones' },
          h('button', { class: 'boton boton--chico', type: 'button', onClick: () => formularioEditar(usuario, cargar) }, 'Editar'),
          usuario.id === estadoApp.usuario.id
            ? null
            : h(
                'button',
                {
                  class: `boton boton--chico${usuario.activo ? ' boton--peligro' : ''}`,
                  type: 'button',
                  style: 'margin-left:.3rem',
                  onClick: async () => {
                    const texto = usuario.activo
                      ? `${usuario.nombre} no va a poder entrar mas, pero sus ventas quedan registradas a su nombre.`
                      : `${usuario.nombre} vuelve a poder entrar a la web.`;
                    if (!(await confirmar(texto, { textoBoton: usuario.activo ? 'Quitar acceso' : 'Devolver acceso', peligro: !!usuario.activo }))) return;
                    try {
                      await api.editarUsuario(usuario.id, { activo: !usuario.activo });
                      avisar(usuario.activo ? 'Acceso quitado.' : 'Acceso devuelto.');
                      cargar();
                    } catch (error) {
                      avisar(error.message, 'error');
                    }
                  }
                },
                usuario.activo ? 'Quitar acceso' : 'Devolver acceso'
              )
        )
      )
    );

    vaciar(tabla).append(
      h('div', { class: 'tarjeta__titulo' }, `${usuarios.length} integrante(s) con cuenta`),
      h(
        'div',
        { class: 'tabla-scroll' },
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Nombre'), h('th', {}, 'Email'), h('th', {}, 'Rol'), h('th', {}, 'Acceso'), h('th', {}, 'Alta'), h('th', {}))),
          h('tbody', {}, ...filas)
        )
      )
    );

    // Invitaciones que todavia nadie uso.
    const sinUsar = invitaciones.filter((i) => !i.usada_en);
    vaciar(pendientes).append(
      h('div', { class: 'tarjeta__titulo' }, '✉️ Invitaciones sin usar',
        h('span', { class: 'tenue' }, 'esperando que la persona cree su cuenta')),
      sinUsar.length
        ? h(
            'div',
            { class: 'tabla-scroll' },
            h(
              'table',
              {},
              h('thead', {}, h('tr', {}, h('th', {}, 'Email'), h('th', {}, 'Nombre'), h('th', {}, 'Rol'), h('th', {}, 'Invitado'), h('th', {}))),
              h(
                'tbody',
                {},
                ...sinUsar.map((i) =>
                  h(
                    'tr',
                    {},
                    h('td', {}, i.email),
                    h('td', {}, i.nombre || '—'),
                    h('td', {}, i.rol === 'admin' ? 'Administrador' : 'Vendedor'),
                    h('td', {}, fechaHora(i.creado_en)),
                    h('td', { class: 'acciones' },
                      h('button', {
                        class: 'boton boton--chico boton--peligro',
                        type: 'button',
                        onClick: async () => {
                          if (!(await confirmar(`Se cancela la invitacion a ${i.email}.`, { textoBoton: 'Cancelar invitacion' }))) return;
                          await api.quitarInvitacion(i.email);
                          cargar();
                        }
                      }, 'Cancelar'))
                  )
                )
              )
            )
          )
        : vacio('No hay invitaciones pendientes.', '✉️')
    );
  }

  const botonCopia = h(
    'button',
    {
      class: 'boton',
      type: 'button',
      onClick: async () => {
        botonCopia.disabled = true;
        botonCopia.textContent = 'Preparando…';
        try {
          await descargarCopiaCompleta();
          avisar('Copia descargada. Guardala en un lugar seguro.');
        } catch (error) {
          avisar(error.message, 'error');
        } finally {
          botonCopia.disabled = false;
          botonCopia.textContent = '💾 Descargar copia de todo';
        }
      }
    },
    '💾 Descargar copia de todo'
  );

  const contenedor = h(
    'div',
    {},
    encabezado(
      'Equipo',
      'Quienes pueden entrar a la web y cargar ventas',
      botonCopia,
      h('button', { class: 'boton boton--primario', type: 'button', onClick: () => formularioInvitacion(cargar) }, '➕ Sumar a alguien')
    ),
    tabla,
    pendientes
  );

  await cargar();
  return contenedor;
}
