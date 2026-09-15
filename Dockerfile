FROM node:22-bookworm-slim

# Compilar better-sqlite3 si no hay binario precompilado para la plataforma.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# La base y los archivos viven en /datos: montar un volumen ahi para que
# no se pierdan al actualizar la aplicacion.
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/datos/engel.db \
    UPLOAD_DIR=/datos/documentacion

RUN mkdir -p /datos/documentacion
VOLUME ["/datos"]

EXPOSE 3000
CMD ["node", "src/server.js"]
