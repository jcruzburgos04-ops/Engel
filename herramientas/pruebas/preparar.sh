#!/usr/bin/env bash
# Deja lista una base limpia con el esquema real para probar la web.
set -euo pipefail

HOST="${PGHOST:-/tmp}"
PUERTO="${PGPORT:-5433}"
USUARIO="${PGUSER:-engel}"
BASE="${1:-engel_web}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
SUPA="$AQUI/../../supabase"

psql -h "$HOST" -p "$PUERTO" -U "$USUARIO" -d postgres -qc "DROP DATABASE IF EXISTS $BASE"
psql -h "$HOST" -p "$PUERTO" -U "$USUARIO" -d postgres -qc "CREATE DATABASE $BASE"

psql -h "$HOST" -p "$PUERTO" -U "$USUARIO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$SUPA/pruebas/emular-supabase.sql"
psql -h "$HOST" -p "$PUERTO" -U "$USUARIO" -d "$BASE" -v ON_ERROR_STOP=1 -q -f "$SUPA/instalar.sql" 2>/dev/null

rm -rf "$AQUI/deposito"
echo "Base $BASE lista con el esquema real."
