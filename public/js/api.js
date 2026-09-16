// Cliente de la API. Centraliza el manejo de errores y la sesion vencida.

class ErrorApi extends Error {
  constructor(mensaje, status, detalles) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

let alPerderSesion = () => {};

export function cuandoSePierdeLaSesion(callback) {
  alPerderSesion = callback;
}

async function pedir(ruta, { metodo = 'GET', cuerpo, formulario } = {}) {
  const opciones = { method: metodo, credentials: 'same-origin', headers: {} };

  if (formulario) {
    opciones.body = formulario;
  } else if (cuerpo !== undefined) {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify(cuerpo);
  }

  let respuesta;
  try {
    respuesta = await fetch(ruta, opciones);
  } catch {
    throw new ErrorApi('No se pudo conectar con el servidor. Revisa tu conexion.', 0);
  }

  if (respuesta.status === 204) return null;

  const tipo = respuesta.headers.get('content-type') || '';
  const datos = tipo.includes('application/json') ? await respuesta.json() : await respuesta.text();

  if (!respuesta.ok) {
    const mensaje = (datos && datos.error) || `Error ${respuesta.status}`;
    if (respuesta.status === 401 && ruta !== '/api/auth/login') alPerderSesion();
    throw new ErrorApi(mensaje, respuesta.status, datos && datos.detalles);
  }
  return datos;
}

function consulta(parametros = {}) {
  const query = new URLSearchParams();
  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor !== undefined && valor !== null && valor !== '') query.set(clave, valor);
  }
  const texto = query.toString();
  return texto ? `?${texto}` : '';
}

export const api = {
  ErrorApi,
  consulta,

  configuracion: () => pedir('/api/config'),

  // Sesion
  login: (email, password) => pedir('/api/auth/login', { metodo: 'POST', cuerpo: { email, password } }),
  logout: () => pedir('/api/auth/logout', { metodo: 'POST' }),
  cambiarPassword: (password_actual, password_nueva) =>
    pedir('/api/auth/password', { metodo: 'POST', cuerpo: { password_actual, password_nueva } }),

  // Usuarios
  usuarios: (inactivos = false) => pedir(`/api/usuarios${consulta({ inactivos: inactivos || '' })}`),
  crearUsuario: (datos) => pedir('/api/usuarios', { metodo: 'POST', cuerpo: datos }),
  editarUsuario: (id, datos) => pedir(`/api/usuarios/${id}`, { metodo: 'PATCH', cuerpo: datos }),

  // Ventas
  ventas: (filtros) => pedir(`/api/ventas${consulta(filtros)}`),
  venta: (id) => pedir(`/api/ventas/${id}`),
  crearVenta: (datos) => pedir('/api/ventas', { metodo: 'POST', cuerpo: datos }),
  editarVenta: (id, datos) => pedir(`/api/ventas/${id}`, { metodo: 'PATCH', cuerpo: datos }),
  borrarVenta: (id) => pedir(`/api/ventas/${id}`, { metodo: 'DELETE' }),

  // Permutas
  agregarPermuta: (ventaId, datos) => pedir(`/api/ventas/${ventaId}/permutas`, { metodo: 'POST', cuerpo: datos }),
  quitarPermuta: (ventaId, permutaId) =>
    pedir(`/api/ventas/${ventaId}/permutas/${permutaId}`, { metodo: 'DELETE' }),

  // Notas
  agregarNota: (ventaId, texto) => pedir(`/api/ventas/${ventaId}/notas`, { metodo: 'POST', cuerpo: { texto } }),
  borrarNota: (ventaId, notaId) => pedir(`/api/ventas/${ventaId}/notas/${notaId}`, { metodo: 'DELETE' }),

  // Documentacion
  panelDocumentacion: (filtros) => pedir(`/api/documentos/panel${consulta(filtros)}`),
  editarDocumento: (id, datos) => pedir(`/api/documentos/${id}`, { metodo: 'PATCH', cuerpo: datos }),
  subirArchivos: (documentoId, formulario) =>
    pedir(`/api/documentos/${documentoId}/archivos`, { metodo: 'POST', formulario }),
  borrarArchivo: (archivoId) => pedir(`/api/documentos/archivos/${archivoId}`, { metodo: 'DELETE' }),
  urlArchivo: (archivoId) => `/api/documentos/archivos/${archivoId}`,

  historialVenta: (id) => pedir(`/api/ventas/${id}/historial`),

  // Busqueda y tableros
  buscarDominio: (dominio) => pedir(`/api/buscar/dominio/${encodeURIComponent(dominio)}`),
  estadisticas: () => pedir('/api/buscar/estadisticas'),

  // Descargas
  urlVentasCsv: (filtros) => `/api/exportar/ventas.csv${consulta(filtros)}`,
  urlDocumentacionCsv: () => '/api/exportar/documentacion.csv',
  urlZipDominio: (dominio) => `/api/exportar/dominio/${encodeURIComponent(dominio)}/documentacion.zip`,
  urlBackup: () => '/api/exportar/backup.db',

  // Respaldos automaticos guardados en el servidor
  respaldos: () => pedir('/api/exportar/respaldos'),
  crearRespaldo: () => pedir('/api/exportar/respaldos', { metodo: 'POST' }),
  urlRespaldo: (nombre) => `/api/exportar/respaldos/${encodeURIComponent(nombre)}`
};
