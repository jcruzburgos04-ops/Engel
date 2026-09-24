'use strict';

// Se corre en cada publicacion (Netlify o Vercel). Escribe public/version.json
// con el codigo del cambio publicado: las pestanas abiertas lo consultan cada
// tanto y, si cambio, se recargan solas para usar la web nueva.

const fs = require('fs');
const path = require('path');

const version =
  process.env.COMMIT_REF ||            // Netlify
  process.env.VERCEL_GIT_COMMIT_SHA || // Vercel
  process.env.GITHUB_SHA ||
  String(Date.now());

const destino = path.resolve(__dirname, '..', 'public', 'version.json');
fs.writeFileSync(destino, `${JSON.stringify({ version, publicado: new Date().toISOString() })}\n`);
console.log(`version.json: ${version}`);
