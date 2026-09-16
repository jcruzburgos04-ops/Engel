'use strict';

// Revisa que todos los archivos de public/js se parseen bien como modulos y
// que cada import apunte a un archivo que existe. Corre con: npm run check
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..', 'public', 'js');
const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'engel-check-'));
const problemas = [];

function archivosJs(carpeta) {
  return fs.readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
    const completo = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) return archivosJs(completo);
    return entrada.name.endsWith('.js') ? [completo] : [];
  });
}

for (const archivo of archivosJs(RAIZ)) {
  const relativo = path.relative(RAIZ, archivo);
  const codigo = fs.readFileSync(archivo, 'utf8');

  // 1) Sintaxis de modulo.
  const copia = path.join(temporal, relativo.replace(/[\\/]/g, '_').replace(/\.js$/, '.mjs'));
  fs.writeFileSync(copia, codigo);
  try {
    execFileSync(process.execPath, ['--check', copia], { stdio: 'pipe' });
  } catch (error) {
    problemas.push(`${relativo}: ${String(error.stderr || error.message).split('\n')[0]}`);
    continue;
  }

  // 2) Los imports relativos tienen que existir.
  for (const linea of codigo.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const destino = path.resolve(path.dirname(archivo), linea[1]);
    if (!fs.existsSync(destino)) problemas.push(`${relativo}: no existe el import "${linea[1]}"`);
  }

  // 3) Cada nombre importado tiene que estar exportado en el archivo destino.
  for (const bloque of codigo.matchAll(/import\s+\{([^}]+)\}\s+from\s+['"](\.[^'"]+)['"]/g)) {
    const destino = path.resolve(path.dirname(archivo), bloque[2]);
    if (!fs.existsSync(destino)) continue;
    const origen = fs.readFileSync(destino, 'utf8');
    for (const nombre of bloque[1].split(',').map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
      const exportado =
        new RegExp(`export\\s+(async\\s+)?(function|const|let|var|class)\\s+${nombre}\\b`).test(origen) ||
        new RegExp(`export\\s*\\{[^}]*\\b${nombre}\\b`).test(origen);
      if (!exportado) problemas.push(`${relativo}: "${nombre}" no esta exportado por ${bloque[2]}`);
    }
  }
}

fs.rmSync(temporal, { recursive: true, force: true });

if (problemas.length) {
  console.error('Problemas en public/js:');
  for (const problema of problemas) console.error(' -', problema);
  process.exit(1);
}
console.log('public/js: sintaxis e imports correctos.');
