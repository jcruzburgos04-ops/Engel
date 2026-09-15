'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
fs.mkdirSync(config.uploadDir, { recursive: true });

const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
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
