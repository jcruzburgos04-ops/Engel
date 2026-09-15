'use strict';

// Error con codigo HTTP, para cortar el flujo desde cualquier capa.
class ErrorHttp extends Error {
  constructor(status, mensaje, detalles) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

const badRequest = (mensaje, detalles) => new ErrorHttp(400, mensaje, detalles);
const noAutorizado = (mensaje = 'Necesitas iniciar sesion.') => new ErrorHttp(401, mensaje);
const prohibido = (mensaje = 'No tenes permisos para esta accion.') => new ErrorHttp(403, mensaje);
const noEncontrado = (mensaje = 'No se encontro el recurso.') => new ErrorHttp(404, mensaje);
const conflicto = (mensaje, detalles) => new ErrorHttp(409, mensaje, detalles);

// Envuelve un handler async para que los errores lleguen al middleware de errores.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = {
  ErrorHttp,
  badRequest,
  noAutorizado,
  prohibido,
  noEncontrado,
  conflicto,
  asyncHandler
};
