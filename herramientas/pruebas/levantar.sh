#!/usr/bin/env bash
# Deja todo listo para probar la web: base limpia, doble de Supabase y
# servidor estatico. Guarda los PID para poder bajarlos despues.
set -euo pipefail

AQUI="$(cd "$(dirname "$0")" && pwd)"
RAIZ="$(cd "$AQUI/../.." && pwd)"
PIDS="$AQUI/.pids"

# Bajar lo que hubiera quedado de una corrida anterior, incluso si se
# perdio el archivo de PID: lo que importa es que los puertos queden libres.
liberar_puerto() {
  local puerto="$1"
  if command -v fuser > /dev/null 2>&1; then
    fuser -k "${puerto}/tcp" > /dev/null 2>&1 || true
  elif command -v lsof > /dev/null 2>&1; then
    lsof -ti "tcp:${puerto}" 2>/dev/null | xargs -r kill 2>/dev/null || true
  fi
}

# Espera a que el puerto quede realmente libre antes de seguir.
esperar_puerto_libre() {
  local puerto="$1"
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/${puerto}") 2>/dev/null; then return 0; fi
    exec 3>&- 2>/dev/null || true
    sleep 0.5
  done
  echo "El puerto ${puerto} sigue ocupado." >&2
  return 1
}

if [ -f "$PIDS" ]; then
  while read -r pid; do kill "$pid" 2>/dev/null || true; done < "$PIDS"
  rm -f "$PIDS"
fi

liberar_puerto 5555
liberar_puerto "${PUERTO_WEB:-4100}"
esperar_puerto_libre 5555
esperar_puerto_libre "${PUERTO_WEB:-4100}"

bash "$AQUI/preparar.sh" > /dev/null
rm -rf "$AQUI/deposito"

node "$AQUI/servidor-falso.js" > "$AQUI/falso.log" 2>&1 &
echo $! >> "$PIDS"

PORT="${PUERTO_WEB:-4100}" node "$RAIZ/herramientas/servidor-local.js" > "$AQUI/web.log" 2>&1 &
echo $! >> "$PIDS"

sleep 2

# Si alguno no levanto, avisar en vez de seguir con un servidor viejo.
if ! curl -sf "http://127.0.0.1:5555/supabase-falso.js" > /dev/null; then
  echo "No arranco el doble de Supabase. Revisa $AQUI/falso.log" >&2
  tail -5 "$AQUI/falso.log" >&2
  exit 1
fi

curl -sf "http://127.0.0.1:${PUERTO_WEB:-4100}/index.html" > /dev/null
curl -sf -X POST http://127.0.0.1:5555/rpc -H 'Content-Type: application/json' \
  -d '{"funcion":"normalizar_dominio","argumentos":{"p_dominio":"ab123cd"}}' > /dev/null

echo "Listo: web en http://127.0.0.1:${PUERTO_WEB:-4100}, doble de Supabase en :5555"
