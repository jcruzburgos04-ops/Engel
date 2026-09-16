#!/usr/bin/env bash
AQUI="$(cd "$(dirname "$0")" && pwd)"
PIDS="$AQUI/.pids"
[ -f "$PIDS" ] || exit 0
while read -r pid; do kill "$pid" 2>/dev/null || true; done < "$PIDS"
rm -f "$PIDS"
echo "Servidores de prueba bajados."
