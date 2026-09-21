#!/usr/bin/env bash
# Crea una base limpia, aplica todo el esquema y corre las pruebas.
set -euo pipefail

PUERTO="${PGPORT:-5433}"
HOST="${PGHOST:-/tmp}"
USUARIO="${PGUSER:-engel}"
BASE="${1:-engel_prueba}"
AQUI="$(cd "$(dirname "$0")" && pwd)"

psql -h "$HOST" -p "$PUERTO" -U "$USUARIO" -d postgres -qc "DROP DATABASE IF EXISTS $BASE" 
psql -h "$HOST" -p "$PUERTO" -U "$USUARIO" -d postgres -qc "CREATE DATABASE $BASE"

correr() {
  psql -h "$HOST" -p "$PUERTO" -U "$USUARIO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$1"
}

correr "$AQUI/emular-supabase.sql"
correr "$AQUI/../01-esquema.sql"
correr "$AQUI/../02-seguridad.sql"
correr "$AQUI/../03-funciones.sql"
correr "$AQUI/../04-consultas.sql"
correr "$AQUI/../05-almacenamiento.sql"
correr "$AQUI/../06-permisos.sql"

echo "Esquema aplicado sin errores."

psql -h "$HOST" -p "$PUERTO" -U "$USUARIO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$AQUI/pruebas.sql"
psql -h "$HOST" -p "$PUERTO" -U "$USUARIO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$AQUI/seguridad.sql"

node "$AQUI/../../herramientas/armar-migracion.js" --verificar
node "$AQUI/../../herramientas/armar-instalacion.js" --verificar

echo ""
echo "Todas las pruebas del esquema pasaron."
