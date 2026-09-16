'use strict';

const fs = require('fs');
const path = require('path');

const db = require('../db');
const config = require('../config');

// Copias de seguridad automaticas de la base. Se hacen con la API de backup de
// SQLite, que copia una base consistente aunque en ese momento se este usando.

const CARPETA = path.join(path.dirname(config.dbPath), 'respaldos');

function nombreDeRespaldo(fecha = new Date()) {
  const sello = fecha.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `engel-${sello}.db`;
}

async function hacerRespaldo() {
  fs.mkdirSync(CARPETA, { recursive: true });
  const destino = path.join(CARPETA, nombreDeRespaldo());
  await db.backup(destino);
  rotar();
  return destino;
}

// Deja solo los ultimos respaldos para no llenar el disco.
function rotar() {
  let archivos;
  try {
    archivos = fs
      .readdirSync(CARPETA)
      .filter((nombre) => nombre.startsWith('engel-') && nombre.endsWith('.db'))
      .sort();
  } catch {
    return;
  }

  const sobran = archivos.length - config.respaldos.conservar;
  for (let i = 0; i < sobran; i += 1) {
    try {
      fs.unlinkSync(path.join(CARPETA, archivos[i]));
    } catch (error) {
      console.warn(`[engel] no se pudo borrar el respaldo ${archivos[i]}:`, error.message);
    }
  }
}

function listar() {
  try {
    return fs
      .readdirSync(CARPETA)
      .filter((nombre) => nombre.startsWith('engel-') && nombre.endsWith('.db'))
      .sort()
      .reverse()
      .map((nombre) => {
        const datos = fs.statSync(path.join(CARPETA, nombre));
        return { nombre, tamano: datos.size, fecha: datos.mtime.toISOString() };
      });
  } catch {
    return [];
  }
}

function rutaDeRespaldo(nombre) {
  if (!/^engel-[\w-]+\.db$/.test(String(nombre))) return null;
  const destino = path.join(CARPETA, nombre);
  return fs.existsSync(destino) ? destino : null;
}

let temporizador;

function iniciarProgramado() {
  if (!config.respaldos.cadaMinutos) return;

  const correr = async () => {
    try {
      const destino = await hacerRespaldo();
      console.log(`[engel] respaldo automatico: ${destino}`);
    } catch (error) {
      console.error('[engel] fallo el respaldo automatico:', error.message);
    }
  };

  // Uno al arrancar, para tener siempre una copia reciente del estado actual.
  correr();
  temporizador = setInterval(correr, config.respaldos.cadaMinutos * 60 * 1000);
  if (temporizador.unref) temporizador.unref();
}

function detener() {
  if (temporizador) clearInterval(temporizador);
}

module.exports = { CARPETA, hacerRespaldo, listar, rutaDeRespaldo, iniciarProgramado, detener };
