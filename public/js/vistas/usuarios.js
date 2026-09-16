import { api } from '../api.js';
import { h, vaciar, fecha, fechaHora, tamano, avisar, confirmar, abrirModal, campo, opciones, vacio } from '../util.js';
import { encabezado, estado as estadoApp } from '../app.js';

function formularioUsuario(usuario, alGuardar) {
  const esNuevo = !usuario;

  const nombre = h('input', { value: usuario ? usuario.nombre : '', required: true, placeholder: 'Nombre y apellido' });
  const email = h('input', { type: 'email', value: usuario ? usuario.email : '', required: esNuevo, disabled: !esNuevo, placeholder: 'vendedor@engel.com' });
  const password = h('input', { type: 'password', autocomplete: 'new-password', placeholder: esNuevo ? 'Minimo 8 caracteres' : 'Dejar vacio para no cambiarla' });
  const rol = opciones(
    h('select', {}),
    [{ valor: 'vendedor', texto: 'Vendedor' }, { valor: 'admin', texto: 'Administrador' }],
    usuario ? usuario.rol : 'vendedor'
  );
  const error = h('div', { class: 'aviso aviso--error', style: 'display:none' });

  const guardar = async () => {
    error.style.display = 'none';
    try {
      if (esNuevo) {
        await api.crearUsuario({
          nombre: nombre.value.trim(),
          email: email.value.trim(),
          password: password.value,
          rol: rol.value
        });
        avisar('Usuario creado.');
      } else {
        const cambios = { nombre: nombre.value.trim(), rol: rol.value };
        if (password.value) cambios.password = password.value;
        await api.editarUsuario(usuario.id, cambios);
        avisar('Usuario actualizado.');
      }
      ref.cerrar();
      alGuardar();
    } catch (err) {
      error.textContent = err.message;
      error.style.display = '';
    }
  };

  const ref = abrirModal({
    titulo: esNuevo ? 'Agregar integrante del equipo' : `Editar a ${usuario.nombre}`,
    cuerpo: h(
      'div',
      { class: 'campos' },
      error,
      campo('Nombre', nombre),
      campo('Email', email, esNuevo ? 'Con este email inicia sesion.' : 'El email no se puede cambiar.'),
      campo('Contrasena', password, esNuevo ? 'Minimo 8 caracteres.' : 'Solo si queres restablecerla.'),
      campo('Rol', rol, 'Los administradores pueden crear usuarios y borrar ventas.')
    ),
    acciones: [
      h('button', { class: 'boton', type: 'button', onClick: () => ref.cerrar() }, 'Cancelar'),
      h('button', { class: 'boton boton--primario', type: 'button', onClick: guardar }, esNuevo ? 'Crear' : 'Guardar')
    ]
  });
}

export async function vistaUsuarios() {
  const tabla = h('section', { class: 'tarjeta' }, h('div', { class: 'cargando' }, 'Cargando…'));

  async function cargar() {
    vaciar(tabla).append(h('div', { class: 'cargando' }, 'Cargando…'));
    const { usuarios } = await api.usuarios(true);

    const filas = usuarios.map((usuario) =>
      h(
        'tr',
        {},
        h('td', {}, h('strong', {}, usuario.nombre),
          usuario.id === estadoApp.usuario.id ? h('span', { class: 'etiqueta etiqueta--info', style: 'margin-left:.4rem' }, 'vos') : null),
        h('td', {}, usuario.email),
        h('td', {}, usuario.rol === 'admin'
          ? h('span', { class: 'etiqueta etiqueta--info' }, 'Administrador')
          : h('span', { class: 'etiqueta' }, 'Vendedor')),
        h('td', {}, usuario.activo
          ? h('span', { class: 'etiqueta etiqueta--ok' }, 'Activo')
          : h('span', { class: 'etiqueta etiqueta--error' }, 'Dado de baja')),
        h('td', {}, fecha(usuario.creado_en)),
        h(
          'td',
          { class: 'acciones' },
          h('button', { class: 'boton boton--chico', type: 'button', onClick: () => formularioUsuario(usuario, cargar) }, 'Editar'),
          h(
            'button',
            {
              class: `boton boton--chico${usuario.activo ? ' boton--peligro' : ''}`,
              type: 'button',
              style: 'margin-left:.3rem',
              onClick: async () => {
                const texto = usuario.activo
                  ? `${usuario.nombre} no va a poder ingresar mas, pero sus ventas quedan registradas a su nombre.`
                  : `${usuario.nombre} vuelve a poder ingresar a la web.`;
                if (!(await confirmar(texto, { textoBoton: usuario.activo ? 'Dar de baja' : 'Reactivar', peligro: !!usuario.activo }))) return;
                try {
                  await api.editarUsuario(usuario.id, { activo: !usuario.activo });
                  avisar(usuario.activo ? 'Usuario dado de baja.' : 'Usuario reactivado.');
                  cargar();
                } catch (error) {
                  avisar(error.message, 'error');
                }
              }
            },
            usuario.activo ? 'Dar de baja' : 'Reactivar'
          )
        )
      )
    );

    vaciar(tabla).append(
      h('div', { class: 'tarjeta__titulo' }, `${usuarios.length} integrante(s)`),
      h(
        'div',
        { class: 'tabla-scroll' },
        h(
          'table',
          {},
          h('thead', {}, h('tr', {}, h('th', {}, 'Nombre'), h('th', {}, 'Email'), h('th', {}, 'Rol'), h('th', {}, 'Estado'), h('th', {}, 'Alta'), h('th', {}))),
          h('tbody', {}, ...filas)
        )
      )
    );
  }

  // --- Respaldos automaticos de la base ---

  const tarjetaRespaldos = h('section', { class: 'tarjeta' }, h('div', { class: 'cargando' }, 'Cargando respaldos…'));

  async function cargarRespaldos() {
    vaciar(tarjetaRespaldos).append(h('div', { class: 'cargando' }, 'Cargando respaldos…'));

    const botonNuevo = h(
      'button',
      {
        class: 'boton boton--chico',
        type: 'button',
        onClick: async () => {
          botonNuevo.disabled = true;
          botonNuevo.textContent = 'Generando…';
          try {
            await api.crearRespaldo();
            avisar('Respaldo generado.');
            cargarRespaldos();
          } catch (error) {
            avisar(error.message, 'error');
            botonNuevo.disabled = false;
            botonNuevo.textContent = '➕ Hacer uno ahora';
          }
        }
      },
      '➕ Hacer uno ahora'
    );

    const titulo = h(
      'div',
      { class: 'tarjeta__titulo' },
      '💾 Respaldos automaticos',
      h('span', { class: 'tenue' }, 'copias completas de la base, por si alguna vez hace falta volver atras'),
      h('span', { class: 'derecha' }, botonNuevo)
    );

    try {
      const { respaldos } = await api.respaldos();
      if (!respaldos.length) {
        vaciar(tarjetaRespaldos).append(titulo, vacio('Todavia no hay respaldos guardados.', '💾'));
        return;
      }

      vaciar(tarjetaRespaldos).append(
        titulo,
        h(
          'div',
          { class: 'tabla-scroll' },
          h(
            'table',
            {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Fecha'), h('th', { class: 'numero' }, 'Tamano'), h('th', {}))),
            h(
              'tbody',
              {},
              ...respaldos.map((respaldo) =>
                h(
                  'tr',
                  {},
                  h('td', {}, fechaHora(respaldo.fecha)),
                  h('td', { class: 'numero' }, tamano(respaldo.tamano)),
                  h('td', { class: 'acciones' },
                    h('a', { class: 'boton boton--chico', href: api.urlRespaldo(respaldo.nombre), download: '' }, '⬇️ Descargar'))
                )
              )
            )
          )
        )
      );
    } catch (error) {
      vaciar(tarjetaRespaldos).append(titulo, h('div', { class: 'aviso aviso--error', style: 'margin:1rem' }, error.message));
    }
  }

  const contenedor = h(
    'div',
    {},
    encabezado(
      'Equipo',
      'Quienes pueden entrar a la web y cargar ventas',
      h('a', { class: 'boton', href: api.urlBackup(), download: '' }, '💾 Descargar base de datos'),
      h('button', { class: 'boton boton--primario', type: 'button', onClick: () => formularioUsuario(null, cargar) }, '➕ Agregar integrante')
    ),
    tabla,
    tarjetaRespaldos
  );

  await Promise.all([cargar(), cargarRespaldos()]);
  return contenedor;
}
