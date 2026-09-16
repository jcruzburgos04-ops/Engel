'use strict';

const path = require('path');
const crypto = require('crypto');

require('dotenv').config();

const ROOT = path.resolve(__dirname, '..');

function resolveFromRoot(value, fallback) {
  return path.resolve(ROOT, value || fallback);
}

const isProduction = process.env.NODE_ENV === 'production';
let sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  if (isProduction) {
    throw new Error(
      'Falta la variable SESSION_SECRET. Definila en el archivo .env antes de arrancar en produccion.'
    );
  }
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn(
    '[engel] SESSION_SECRET no esta definida: se genero una temporal. ' +
      'Las sesiones se cierran al reiniciar el servidor.'
  );
}

module.exports = {
  root: ROOT,
  port: Number(process.env.PORT) || 3000,
  sessionSecret,
  dbPath: resolveFromRoot(process.env.DB_PATH, './data/engel.db'),
  uploadDir: resolveFromRoot(process.env.UPLOAD_DIR, './uploads'),
  maxFileBytes: (Number(process.env.MAX_FILE_MB) || 25) * 1024 * 1024,
  sessionMaxAgeMs: 12 * 60 * 60 * 1000,
  secureCookies: process.env.SECURE_COOKIES === 'true',
  forzarHttps: process.env.FORZAR_HTTPS === 'true',
  respaldos: {
    // Cada cuantos minutos se hace una copia automatica de la base (0 = nunca).
    cadaMinutos: Number(process.env.RESPALDO_CADA_MINUTOS ?? 180),
    // Cuantas copias se conservan antes de ir borrando las mas viejas.
    conservar: Number(process.env.RESPALDOS_A_CONSERVAR ?? 24)
  },
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@engel.com',
    password: process.env.ADMIN_PASSWORD || 'engel1234',
    nombre: process.env.ADMIN_NOMBRE || 'Administrador'
  }
};
