-- Esquema de la base de datos de ventas de Engel.
-- Se aplica de forma idempotente al arrancar el servidor.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS usuarios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL DEFAULT 'vendedor' CHECK (rol IN ('admin', 'vendedor')),
  activo        INTEGER NOT NULL DEFAULT 1,
  creado_en     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Un vehiculo se identifica por su dominio (patente). Puede entrar al sistema
-- como auto vendido (propio o en consigna) o como permuta que entrega el comprador.
CREATE TABLE IF NOT EXISTS vehiculos (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  dominio               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  marca                 TEXT NOT NULL DEFAULT '',
  modelo                TEXT NOT NULL DEFAULT '',
  version               TEXT NOT NULL DEFAULT '',
  anio                  INTEGER,
  color                 TEXT NOT NULL DEFAULT '',
  kilometraje           INTEGER,
  nro_chasis            TEXT NOT NULL DEFAULT '',
  nro_motor             TEXT NOT NULL DEFAULT '',
  tenencia              TEXT NOT NULL DEFAULT 'propio' CHECK (tenencia IN ('propio', 'consigna')),
  consignante_nombre    TEXT NOT NULL DEFAULT '',
  consignante_contacto  TEXT NOT NULL DEFAULT '',
  descripcion           TEXT NOT NULL DEFAULT '',
  creado_en             TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vehiculos_dominio ON vehiculos (dominio);

CREATE TABLE IF NOT EXISTS ventas (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha_venta             TEXT NOT NULL,
  vendedor_id             INTEGER NOT NULL REFERENCES usuarios (id),
  vehiculo_id             INTEGER NOT NULL REFERENCES vehiculos (id),
  cliente_nombre          TEXT NOT NULL,
  cliente_documento       TEXT NOT NULL DEFAULT '',
  cliente_telefono        TEXT NOT NULL DEFAULT '',
  cliente_email           TEXT NOT NULL DEFAULT '',
  precio_venta            REAL,
  moneda                  TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
  forma_pago              TEXT NOT NULL DEFAULT '',
  sena                    REAL,
  estado                  TEXT NOT NULL DEFAULT 'pendiente'
                          CHECK (estado IN ('pendiente', 'en_preparacion', 'listo_entrega', 'entregado', 'cancelado')),
  fecha_entrega_estimada  TEXT,
  fecha_entrega_real      TEXT,
  detalles                TEXT NOT NULL DEFAULT '',
  creado_por              INTEGER REFERENCES usuarios (id),
  creado_en               TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ventas_vendedor ON ventas (vendedor_id);
CREATE INDEX IF NOT EXISTS idx_ventas_vehiculo ON ventas (vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON ventas (fecha_venta DESC);
CREATE INDEX IF NOT EXISTS idx_ventas_estado ON ventas (estado);

-- Permuta: el auto que entrega el comprador queda vinculado a la venta que compra.
CREATE TABLE IF NOT EXISTS permutas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id      INTEGER NOT NULL REFERENCES ventas (id) ON DELETE CASCADE,
  vehiculo_id   INTEGER NOT NULL REFERENCES vehiculos (id),
  valor_tomado  REAL,
  moneda        TEXT NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
  observaciones TEXT NOT NULL DEFAULT '',
  creado_en     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (venta_id, vehiculo_id)
);

CREATE INDEX IF NOT EXISTS idx_permutas_venta ON permutas (venta_id);
CREATE INDEX IF NOT EXISTS idx_permutas_vehiculo ON permutas (vehiculo_id);

-- Checklist de documentacion. Se genera automaticamente para el auto vendido
-- y para cada permuta recibida.
CREATE TABLE IF NOT EXISTS documentos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id        INTEGER NOT NULL REFERENCES ventas (id) ON DELETE CASCADE,
  vehiculo_id     INTEGER NOT NULL REFERENCES vehiculos (id),
  rol             TEXT NOT NULL DEFAULT 'venta' CHECK (rol IN ('venta', 'permuta')),
  tipo            TEXT NOT NULL,
  estado          TEXT NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente', 'en_tramite', 'ok', 'no_aplica')),
  observaciones   TEXT NOT NULL DEFAULT '',
  actualizado_en  TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_por INTEGER REFERENCES usuarios (id),
  UNIQUE (venta_id, vehiculo_id, tipo)
);

CREATE INDEX IF NOT EXISTS idx_documentos_venta ON documentos (venta_id);
CREATE INDEX IF NOT EXISTS idx_documentos_vehiculo ON documentos (vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_documentos_estado ON documentos (estado);

-- Archivos adjuntos a cada item del checklist. Un item puede tener varios
-- archivos (por ejemplo, varios comprobantes de multas).
CREATE TABLE IF NOT EXISTS archivos (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  documento_id    INTEGER NOT NULL REFERENCES documentos (id) ON DELETE CASCADE,
  nombre_original TEXT NOT NULL,
  nombre_archivo  TEXT NOT NULL,
  mime            TEXT NOT NULL DEFAULT 'application/octet-stream',
  tamano          INTEGER NOT NULL DEFAULT 0,
  subido_por      INTEGER REFERENCES usuarios (id),
  subido_en       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_archivos_documento ON archivos (documento_id);

-- Detalles extras vinculados a la operacion, con autor y fecha.
CREATE TABLE IF NOT EXISTS notas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id   INTEGER NOT NULL REFERENCES ventas (id) ON DELETE CASCADE,
  usuario_id INTEGER REFERENCES usuarios (id),
  texto      TEXT NOT NULL,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notas_venta ON notas (venta_id);
