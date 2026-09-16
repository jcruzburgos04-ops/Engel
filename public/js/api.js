// Capa de datos. Todo lo que la web guarda o consulta pasa por aca.
//
// Las operaciones importantes son funciones de la base de datos: las
// validaciones y las transacciones viven en el servidor, donde el navegador
// no las puede saltear.

import { conectar, traducirError } from './supabase.js';
import { config } from './config.js';

class ErrorApi extends Error {
  constructor(mensaje, codigo) {
    super(mensaje);
    this.codigo = codigo;
  }
}

let alPerderSesion = () => {};
export function cuandoSePierdeLaSesion(callback) {
  alPerderSesion = callback;
}

// Ninguna consulta puede quedar colgada para siempre: si la base no contesta,
// la pantalla tiene que decirlo en vez de quedarse en "Cargando…".
const ESPERA_CONSULTA_MS = 20000;
const ESPERA_ARCHIVO_MS = 180000;

function conLimiteDeEspera(promesa, ms = ESPERA_CONSULTA_MS, queEs = 'La consulta') {
  let reloj;
  const limite = new Promise((_, rechazar) => {
    reloj = setTimeout(
      () => rechazar(new ErrorApi(`${queEs} tardo demasiado. Revisa tu conexion y proba de nuevo.`, 'TIEMPO')),
      ms
    );
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(reloj));
}

function revisar({ data, error }) {
  if (error) {
    const traducido = traducirError(error);
    if (/sesion vencio/i.test(traducido.message)) alPerderSesion();
    throw new ErrorApi(traducido.message, traducido.codigo);
  }
  return data;
}

// Sin sesion valida las reglas de la base no devuelven ninguna fila, pero
// tampoco dan error: la pantalla quedaria vacia sin explicar por que. Por eso
// se revisa antes y se avisa que hay que volver a ingresar.
async function clienteConSesion() {
  const cliente = await conLimiteDeEspera(conectar(), ESPERA_CONSULTA_MS, 'La conexion con la base');
  // getSession() lee la sesion guardada en el navegador: no sale a la red.
  const { data } = await conLimiteDeEspera(cliente.auth.getSession(), ESPERA_CONSULTA_MS, 'Tu sesion');

  if (!data || !data.session) {
    alPerderSesion();
    throw new ErrorApi('Tu sesion vencio. Volve a ingresar.', 'SIN_SESION');
  }
  return { cliente, usuario: data.session.user };
}

async function rpc(nombre, args = {}) {
  const { cliente } = await clienteConSesion();
  return revisar(await conLimiteDeEspera(cliente.rpc(nombre, args)));
}

// Igual que rpc pero para las consultas directas a una tabla.
async function consultar(armar, queEs = 'La consulta') {
  const { cliente } = await clienteConSesion();
  return conLimiteDeEspera(armar(cliente), ESPERA_CONSULTA_MS, queEs);
}

// ---------------------------------------------------------------------
// Sesion y equipo
// ---------------------------------------------------------------------

async function perfilDe(usuario) {
  if (!usuario) return null;
  const { data, error } = await consultar(
    (cliente) =>
      cliente.from('perfiles').select('id, nombre, email, rol, activo').eq('id', usuario.id).maybeSingle(),
    'Tu perfil'
  );

  if (error) throw new ErrorApi(traducirError(error).message, error.code);
  if (!data) return { id: usuario.id, email: usuario.email, nombre: '', rol: 'vendedor', activo: false };
  return data;
}

export const api = {
  ErrorApi,

  async configuracion() {
    const cliente = await conectar();
    const { data } = await cliente.auth.getSession();
    return {
      estados_venta: ['pendiente', 'en_preparacion', 'listo_entrega', 'entregado', 'cancelado'],
      monedas: ['ARS', 'USD'],
      max_file_mb: config.maxArchivoMb,
      usuario: data.session ? await perfilDe(data.session.user) : null
    };
  },

  async login(email, password) {
    const cliente = await conectar();
    const data = revisar(
      await cliente.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    );
    const usuario = await perfilDe(data.user);
    if (!usuario.activo) {
      await cliente.auth.signOut();
      throw new ErrorApi(
        'Tu usuario todavia no fue habilitado. Pedile a un administrador de Engel que te invite.'
      );
    }
    return { usuario };
  },

  // Alta de cuenta. Solo sirve si un administrador invito ese email antes.
  async registrarse(email, password, nombre) {
    const cliente = await conectar();
    const data = revisar(
      await cliente.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { nombre: String(nombre || '').trim() } }
      })
    );
    return { necesitaConfirmar: !data.session, usuario: data.user };
  },

  async logout() {
    const cliente = await conectar();
    await cliente.auth.signOut();
    return { ok: true };
  },

  async cambiarPassword(_actual, nueva) {
    const cliente = await conectar();
    revisar(await cliente.auth.updateUser({ password: nueva }));
    return { ok: true };
  },

  async recuperarPassword(email) {
    const cliente = await conectar();
    revisar(
      await cliente.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${location.origin}${location.pathname}`
      })
    );
    return { ok: true };
  },

  async usuarios(incluirInactivos = false) {
    const data = revisar(
      await consultar((cliente) => {
        let pedido = cliente.from('perfiles').select('id, nombre, email, rol, activo, creado_en');
        if (!incluirInactivos) pedido = pedido.eq('activo', true);
        return pedido.order('activo', { ascending: false }).order('nombre');
      }, 'La lista del equipo')
    );
    return { usuarios: data || [] };
  },

  async invitaciones() {
    const { cliente } = await clienteConSesion();
    const data = revisar(
      await cliente.from('invitaciones').select('*').order('creado_en', { ascending: false })
    );
    return { invitaciones: data || [] };
  },

  async invitar({ email, nombre, rol }) {
    const { cliente } = await clienteConSesion();
    revisar(
      await cliente.from('invitaciones').upsert(
        { email: String(email).trim().toLowerCase(), nombre: String(nombre || '').trim(), rol: rol || 'vendedor' },
        { onConflict: 'email' }
      )
    );
    return { ok: true };
  },

  async quitarInvitacion(email) {
    const { cliente } = await clienteConSesion();
    revisar(await cliente.from('invitaciones').delete().eq('email', email));
    return { ok: true };
  },

  async editarUsuario(id, cambios) {
    const { cliente } = await clienteConSesion();
    const permitidos = {};
    if (cambios.nombre !== undefined) permitidos.nombre = cambios.nombre;
    if (cambios.rol !== undefined) permitidos.rol = cambios.rol;
    if (cambios.activo !== undefined) permitidos.activo = Boolean(cambios.activo);

    const data = revisar(await cliente.from('perfiles').update(permitidos).eq('id', id).select().single());
    return { usuario: data };
  },

  // ---------------------------------------------------------------------
  // Ventas
  // ---------------------------------------------------------------------

  async ventas(filtros = {}) {
    return rpc('listar_ventas', { p_filtros: limpiarFiltros(filtros) });
  },

  async venta(id) {
    const venta = await rpc('venta_completa', { p_id: Number(id) });
    if (!venta) throw new ErrorApi('No se encontro la venta.', 'P0002');
    return { venta };
  },

  async crearVenta(datos) {
    const id = await rpc('crear_venta', { p_datos: datos });
    return api.venta(id);
  },

  async editarVenta(id, datos) {
    await rpc('actualizar_venta', { p_id: Number(id), p_datos: datos });
    return api.venta(id);
  },

  async borrarVenta(id) {
    const rutas = await rpc('borrar_venta', { p_id: Number(id) });
    await borrarDeDeposito(rutas);
    return { ok: true };
  },

  async agregarPermuta(ventaId, datos) {
    await rpc('agregar_permuta', { p_venta_id: Number(ventaId), p_datos: datos });
    return api.venta(ventaId);
  },

  async quitarPermuta(ventaId, permutaId) {
    const rutas = await rpc('quitar_permuta', { p_permuta_id: Number(permutaId) });
    await borrarDeDeposito(rutas);
    return api.venta(ventaId);
  },

  async agregarNota(ventaId, texto) {
    const { cliente, usuario } = await clienteConSesion();
    revisar(
      await cliente.from('notas').insert({
        venta_id: Number(ventaId),
        usuario_id: usuario.id,
        texto: String(texto).slice(0, 2000)
      })
    );
    return api.venta(ventaId);
  },

  async borrarNota(ventaId, notaId) {
    const { cliente } = await clienteConSesion();
    revisar(await cliente.from('notas').delete().eq('id', notaId));
    return api.venta(ventaId);
  },

  async historialVenta(id) {
    return { historial: (await rpc('historial_venta', { p_id: Number(id) })) || [] };
  },

  // ---------------------------------------------------------------------
  // Documentacion
  // ---------------------------------------------------------------------

  async panelDocumentacion({ q = '', todos = '' } = {}) {
    const filas = await rpc('panel_documentacion', {
      p_solo_pendientes: todos !== 'true' && todos !== true,
      p_q: q || ''
    });
    return { filas: filas || [] };
  },

  async editarDocumento(id, cambios) {
    const { cliente, usuario } = await clienteConSesion();

    const fila = revisar(
      await cliente
        .from('documentos')
        .update({ ...cambios, actualizado_por: usuario.id, actualizado_en: new Date().toISOString() })
        .eq('id', id)
        .select('venta_id')
        .single()
    );
    return { documentacion: await api.documentacionDeVenta(fila.venta_id) };
  },

  async documentacionDeVenta(ventaId) {
    return (await rpc('documentacion_de_venta', { p_venta_id: Number(ventaId) })) || [];
  },

  async subirArchivos(documentoId, archivos) {
    // Acepta un FileList o un array, pero nunca un FormData: si llega otra
    // cosa conviene un error claro y no una subida vacia en silencio.
    const lista = Array.from(archivos || []);
    if (!lista.length || !lista.every((a) => a instanceof Blob)) {
      throw new ErrorApi('No se recibio ningun archivo para subir.');
    }

    const { cliente, usuario } = await clienteConSesion();

    const documento = revisar(
      await cliente.from('documentos').select('venta_id, vehiculo_id, tipo, estado').eq('id', documentoId).single()
    );

    const subidos = [];
    try {
      for (const archivo of lista) {
        if (archivo.size > config.maxArchivoMb * 1024 * 1024) {
          throw new ErrorApi(
            `"${archivo.name}" pesa mas de ${config.maxArchivoMb} MB y no se puede subir.`
          );
        }

        const ruta = rutaDeArchivo(documento, archivo.name);
        const subida = await conLimiteDeEspera(
          cliente.storage
            .from(config.deposito)
            .upload(ruta, archivo, { cacheControl: '3600', upsert: false, contentType: archivo.type || undefined }),
          ESPERA_ARCHIVO_MS,
          `La subida de "${archivo.name}"`
        );

        if (subida.error) throw new ErrorApi(traducirError(subida.error).message, subida.error.code);
        subidos.push(ruta);

        revisar(
          await cliente.from('archivos').insert({
            documento_id: Number(documentoId),
            nombre_original: archivo.name.slice(0, 200),
            ruta,
            mime: archivo.type || 'application/octet-stream',
            tamano: archivo.size,
            subido_por: usuario.id
          })
        );
      }

      // Al cargar documentacion el item pasa a listo si seguia pendiente.
      if (documento.estado === 'pendiente') {
        revisar(
          await cliente
            .from('documentos')
            .update({ estado: 'ok', actualizado_por: usuario.id, actualizado_en: new Date().toISOString() })
            .eq('id', documentoId)
        );
      }
    } catch (error) {
      // Si algo falla a mitad de camino no quedan archivos huerfanos.
      await borrarDeDeposito(subidos);
      throw error;
    }

    return { documentacion: await api.documentacionDeVenta(documento.venta_id) };
  },

  async borrarArchivo(archivoId) {
    const { cliente } = await clienteConSesion();
    const archivo = revisar(
      await cliente.from('archivos').select('id, ruta, documento_id').eq('id', archivoId).single()
    );
    const documento = revisar(
      await cliente.from('documentos').select('venta_id').eq('id', archivo.documento_id).single()
    );

    revisar(await cliente.from('archivos').delete().eq('id', archivoId));
    await borrarDeDeposito([archivo.ruta]);

    return { documentacion: await api.documentacionDeVenta(documento.venta_id) };
  },

  // Enlace temporal para bajar un archivo. Sin sesion no sirve de nada.
  async enlaceDescarga(archivo, { segundos = 300 } = {}) {
    const { cliente } = await clienteConSesion();
    const { data, error } = await cliente.storage
      .from(config.deposito)
      .createSignedUrl(archivo.ruta, segundos, { download: archivo.nombre_original });

    if (error) throw new ErrorApi(traducirError(error).message, error.code);
    return data.signedUrl;
  },

  async descargarArchivo(archivo) {
    const { cliente } = await clienteConSesion();
    const { data, error } = await conLimiteDeEspera(
      cliente.storage.from(config.deposito).download(archivo.ruta),
      ESPERA_ARCHIVO_MS,
      `La descarga de "${archivo.nombre_original}"`
    );
    if (error) throw new ErrorApi(traducirError(error).message, error.code);
    return data;
  },

  // ---------------------------------------------------------------------
  // Busqueda y tableros
  // ---------------------------------------------------------------------

  async buscarDominio(dominio) {
    const resultado = await rpc('buscar_dominio', { p_dominio: dominio });
    if (!resultado) {
      throw new ErrorApi(`No hay ningun auto cargado con el dominio ${normalizar(dominio)}.`, 'P0002');
    }
    return resultado;
  },

  async estadisticas() {
    return (await rpc('estadisticas')) || {};
  },

  async estadoDatos() {
    const { data } = await consultar(
      (cliente) => cliente.from('estado_datos').select('version, cambio_en').eq('id', 1).maybeSingle(),
      'El estado de los datos'
    );
    return data || { version: 0 };
  },

  async exportarTodo() {
    return rpc('exportar_todo');
  },

  // ---------------------------------------------------------------------
  // Borradores
  // ---------------------------------------------------------------------

  async leerBorrador(clave) {
    const { cliente, usuario } = await clienteConSesion();

    const { data } = await cliente
      .from('borradores')
      .select('contenido, actualizado_en')
      .eq('usuario_id', usuario.id)
      .eq('clave', clave)
      .maybeSingle();

    return data ? { contenido: data.contenido, fecha: data.actualizado_en } : null;
  },

  async guardarBorrador(clave, contenido) {
    const { cliente, usuario } = await clienteConSesion();

    revisar(
      await cliente.from('borradores').upsert(
        {
          usuario_id: usuario.id,
          clave,
          contenido,
          actualizado_en: new Date().toISOString()
        },
        { onConflict: 'usuario_id,clave' }
      )
    );
    return { ok: true };
  },

  async descartarBorrador(clave) {
    const { cliente, usuario } = await clienteConSesion();
    await cliente.from('borradores').delete().eq('usuario_id', usuario.id).eq('clave', clave);
    return { ok: true };
  }
};

// ---------------------------------------------------------------------
// Ayudas internas
// ---------------------------------------------------------------------

function normalizar(dominio) {
  return String(dominio || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function limpiarFiltros(filtros) {
  const salida = {};
  for (const [clave, valor] of Object.entries(filtros || {})) {
    if (valor !== undefined && valor !== null && valor !== '') salida[clave] = String(valor);
  }
  return salida;
}

// Los archivos se guardan agrupados por venta y por auto, con un nombre
// unico para que dos personas que suben a la vez no se pisen.
function rutaDeArchivo(documento, nombre) {
  const limpio = String(nombre)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(-80);
  const unico = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `venta-${documento.venta_id}/auto-${documento.vehiculo_id}/${documento.tipo}/${unico}-${limpio}`;
}

async function borrarDeDeposito(rutas) {
  if (!rutas || !rutas.length) return;
  try {
    const cliente = await conectar();
    await cliente.storage.from(config.deposito).remove(rutas);
  } catch (error) {
    // Si el archivo queda, no es grave: el dato ya se borro y se puede
    // limpiar despues. Perder el dato si, seria grave.
    console.warn('[engel] no se pudieron borrar archivos del deposito:', error.message);
  }
}
