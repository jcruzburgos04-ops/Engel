'use strict';

const { ErrorHttp } = require('./errores');

// Limitador simple en memoria para frenar intentos de adivinar contrasenas.
// Alcanza para una instalacion chica: no necesita Redis ni dependencias.
function limitador({ intentos = 10, ventanaMs = 10 * 60 * 1000, mensaje } = {}) {
  const registros = new Map();

  // Limpieza periodica para que el Map no crezca sin control.
  const limpieza = setInterval(() => {
    const ahora = Date.now();
    for (const [clave, registro] of registros) {
      if (ahora > registro.expira) registros.delete(clave);
    }
  }, ventanaMs);
  if (limpieza.unref) limpieza.unref();

  const middleware = (req, _res, next) => {
    const clave = req.ip || 'desconocido';
    const ahora = Date.now();
    const registro = registros.get(clave);

    if (!registro || ahora > registro.expira) {
      registros.set(clave, { contador: 1, expira: ahora + ventanaMs });
      return next();
    }

    registro.contador += 1;
    if (registro.contador > intentos) {
      const minutos = Math.ceil((registro.expira - ahora) / 60000);
      return next(
        new ErrorHttp(429, mensaje || `Demasiados intentos. Volve a probar en ${minutos} minuto(s).`)
      );
    }
    return next();
  };

  // Un ingreso correcto borra los intentos acumulados.
  middleware.reiniciar = (req) => registros.delete(req.ip || 'desconocido');
  return middleware;
}

module.exports = { limitador };
