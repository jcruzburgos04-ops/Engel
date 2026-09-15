'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const config = require('./config');
const { cargarUsuario } = require('./lib/auth');
const { ErrorHttp } = require('./lib/errores');
const { ESTADOS_VENTA, MONEDAS } = require('./lib/ventas');
const { TIPOS_DOCUMENTO, ESTADOS_DOCUMENTO } = require('./lib/documentos');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Cabeceras de seguridad basicas. La web solo carga recursos propios.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());
app.use(cargarUsuario);

// Datos fijos que la web necesita para armar los formularios.
app.get('/api/config', (req, res) => {
  res.json({
    estados_venta: ESTADOS_VENTA,
    monedas: MONEDAS,
    tipos_documento: TIPOS_DOCUMENTO,
    estados_documento: ESTADOS_DOCUMENTO,
    max_file_mb: Math.round(config.maxFileBytes / (1024 * 1024)),
    usuario: req.usuario || null
  });
});

app.get('/api/salud', (_req, res) => res.json({ ok: true, fecha: new Date().toISOString() }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/ventas', require('./routes/ventas'));
app.use('/api/documentos', require('./routes/documentos'));
app.use('/api/buscar', require('./routes/busqueda'));
app.use('/api/exportar', require('./routes/exportar'));

app.use(express.static(path.join(config.root, 'public'), { maxAge: '1h', index: false }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// Cualquier otra ruta devuelve la aplicacion (navegacion del lado del cliente).
app.get('*', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(config.root, 'public', 'index.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((error, req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const mensaje =
      error.code === 'LIMIT_FILE_SIZE'
        ? `El archivo supera el maximo de ${Math.round(config.maxFileBytes / (1024 * 1024))} MB.`
        : `No se pudo subir el archivo (${error.code}).`;
    return res.status(400).json({ error: mensaje });
  }

  if (error instanceof ErrorHttp) {
    return res.status(error.status).json({ error: error.message, detalles: error.detalles });
  }

  if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: 'Ese registro ya existe en la base de datos.' });
  }

  console.error('[engel] error no controlado:', error);
  return res.status(500).json({ error: 'Se produjo un error inesperado en el servidor.' });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`[engel] Servidor escuchando en http://localhost:${config.port}`);
    console.log(`[engel] Base de datos: ${config.dbPath}`);
    console.log(`[engel] Documentacion: ${config.uploadDir}`);
  });
}

module.exports = app;
