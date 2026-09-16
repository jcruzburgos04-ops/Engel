'use strict';

// Servidor estatico minimo para probar la web en tu computadora.
// En produccion no hace falta: la web son archivos sueltos que cualquier
// hosting gratuito sirve tal cual.

const http = require('http');
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..', 'public');
const PUERTO = Number(process.env.PORT) || 4000;

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

http
  .createServer((peticion, respuesta) => {
    const pedido = decodeURIComponent((peticion.url || '/').split('?')[0]);
    const destino = path.join(RAIZ, pedido === '/' ? 'index.html' : pedido);

    // Nada fuera de public/.
    if (!destino.startsWith(RAIZ)) {
      respuesta.writeHead(403).end('Prohibido');
      return;
    }

    fs.readFile(destino, (error, contenido) => {
      if (error) {
        // Navegacion del lado del cliente: cualquier ruta devuelve la web.
        fs.readFile(path.join(RAIZ, 'index.html'), (err2, indice) => {
          if (err2) respuesta.writeHead(404).end('No encontrado');
          else respuesta.writeHead(200, { 'Content-Type': TIPOS['.html'] }).end(indice);
        });
        return;
      }
      respuesta
        .writeHead(200, {
          'Content-Type': TIPOS[path.extname(destino)] || 'application/octet-stream',
          'Cache-Control': 'no-cache'
        })
        .end(contenido);
    });
  })
  .listen(PUERTO, () => {
    console.log(`[engel] Web local en http://localhost:${PUERTO}`);
    console.log('[engel] Recorda completar public/js/config.js con los datos de Supabase.');
  });
