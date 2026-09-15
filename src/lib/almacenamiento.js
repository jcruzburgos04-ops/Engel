'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const config = require('../config');
const { badRequest } = require('./errores');

const EXTENSIONES_PERMITIDAS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif', '.tif', '.tiff',
  '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'
]);

fs.mkdirSync(config.uploadDir, { recursive: true });

// Los archivos se guardan con un nombre aleatorio; el nombre original
// queda en la base de datos para mostrarlo y para la descarga.
const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    const carpeta = path.join(config.uploadDir, new Date().toISOString().slice(0, 7));
    fs.mkdir(carpeta, { recursive: true }, (err) => cb(err, carpeta));
  },
  filename(_req, file, cb) {
    const extension = path.extname(file.originalname).toLowerCase().slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`);
  }
});

const subida = multer({
  storage,
  limits: { fileSize: config.maxFileBytes, files: 10 },
  fileFilter(_req, file, cb) {
    const extension = path.extname(file.originalname).toLowerCase();
    if (!EXTENSIONES_PERMITIDAS.has(extension)) {
      return cb(
        badRequest(
          `El archivo "${file.originalname}" no es de un tipo permitido. ` +
            `Se aceptan: ${[...EXTENSIONES_PERMITIDAS].join(', ')}.`
        )
      );
    }
    return cb(null, true);
  }
});

// Ruta absoluta de un archivo guardado, validando que no escape de UPLOAD_DIR.
function rutaAbsoluta(nombreArchivo) {
  const base = path.resolve(config.uploadDir);
  const destino = path.resolve(base, nombreArchivo);
  if (destino !== base && !destino.startsWith(base + path.sep)) {
    throw badRequest('Ruta de archivo invalida.');
  }
  return destino;
}

function borrarArchivo(nombreArchivo) {
  if (!nombreArchivo) return;
  try {
    fs.unlinkSync(rutaAbsoluta(nombreArchivo));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`[engel] No se pudo borrar el archivo ${nombreArchivo}:`, error.message);
    }
  }
}

function borrarArchivos(nombres = []) {
  for (const nombre of nombres) borrarArchivo(nombre);
}

// Nombre relativo a UPLOAD_DIR, que es lo que se guarda en la base.
function nombreRelativo(archivoMulter) {
  return path.relative(path.resolve(config.uploadDir), archivoMulter.path).split(path.sep).join('/');
}

module.exports = { subida, rutaAbsoluta, borrarArchivo, borrarArchivos, nombreRelativo };
