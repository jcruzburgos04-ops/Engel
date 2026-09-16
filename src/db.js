'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new Database(config.dbPath);

// WAL permite leer mientras otro escribe, que es lo que pasa cuando varios
// usan la web al mismo tiempo.
db.pragma('journal_mode = WAL');
// synchronous = FULL hace que cada cambio confirmado ya este en el disco:
// un corte de luz no se lleva la ultima carga.
db.pragma('synchronous = FULL');
// Si otra escritura tiene la base tomada, esperar en vez de fallar.
db.pragma('busy_timeout = 10000');
db.pragma('foreign_keys = ON');

function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

// Crea el usuario administrador la primera vez que arranca la aplicacion.
function ensureAdmin() {
  const total = db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
  if (total > 0) return null;

  const hash = bcrypt.hashSync(config.admin.password, 10);
  db.prepare(
    `INSERT INTO usuarios (nombre, email, password_hash, rol, activo)
     VALUES (?, ?, ?, 'admin', 1)`
  ).run(config.admin.nombre, config.admin.email, hash);

  console.log(
    `[engel] Usuario administrador creado: ${config.admin.email} ` +
      '(cambiale la contrasena desde la web apenas ingreses).'
  );
  return config.admin.email;
}

migrate();
ensureAdmin();

module.exports = db;
