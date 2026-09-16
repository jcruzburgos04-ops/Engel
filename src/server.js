'use strict';

const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const config = require('./config');
const auditoria = require('./lib/auditoria');
const respaldos = require('./lib/respaldos');
const { cargarUsuario } = require('./lib/auth');
const { ErrorHttp } = require('./lib/errores');
const { ESTADOS_VENTA, MONEDAS } = require('./lib/ventas');
const { TIPOS_DOCUMENTO, ESTADOS_DOCUMENTO } = require('./lib/documentos');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

// Si la web esta publicada, cualquier visita por http se manda a https.
if (config.forzarHttps) {
  app.use((req, res, siguiente) => {
    if (req.secure || req.get('x-forwarded-proto') === 'https') return siguiente();
    return res.redirect(308, `https://${req.get('host')}${req.originalUrl}`);
  });
}

// Cabeceras de seguridad basicas. La web solo carga recursos propios.
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (config.secureCookies) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
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

// La web consulta esto cada pocos segundos para enterarse de que otra persona
// cargo o modifico algo mientras tanto.
app.get('/api/estado-datos', require('./lib/auth').requiereSesion, (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(auditoria.versionDatos());
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/ventas', require('./routes/ventas'));
app.use('/api/documentos', require('./routes/documentos'));
app.use('/api/borradores', require('./routes/borradores'));
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
  const servidor = app.listen(config.port, () => {
    console.log(`[engel] Servidor escuchando en http://localhost:${config.port}`);
    console.log(`[engel] Base de datos: ${config.dbPath}`);
    console.log(`[engel] Documentacion: ${config.uploadDir}`);
  });

  respaldos.iniciarProgramado();

  // Al apagar el servidor se cierra la base de forma ordenada, para que el
  // ultimo cambio quede escrito en el disco.
  const apagar = (senal) => () => {
    console.log(`[engel] ${senal}: cerrando de forma ordenada…`);
    respaldos.detener();
    servidor.close(() => {
      try {
        require('./db').close();
      } catch (error) {
        console.error('[engel] error cerrando la base:', error.message);
      }
      process.exit(0);
    });
    // Si algo queda colgado, no esperar para siempre.
    setTimeout(() => process.exit(0), 10000).unref();
  };

  process.on('SIGTERM', apagar('SIGTERM'));
  process.on('SIGINT', apagar('SIGINT'));
}

module.exports = app;
