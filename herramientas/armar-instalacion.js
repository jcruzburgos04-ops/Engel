'use strict';

// Arma supabase/instalar.sql: los archivos 01 a 07 pegados uno atras de otro,
// para poder instalar todo de una sola vez desde el editor SQL de Supabase.
// Se genera solo para que nunca quede distinto del codigo real.

const fs = require('fs');
const path = require('path');

const SUPA = path.resolve(__dirname, '..', 'supabase');

const PARTES = [
  '01-esquema.sql',
  '02-seguridad.sql',
  '03-funciones.sql',
  '04-consultas.sql',
  '05-almacenamiento.sql',
  '06-permisos.sql',
  '07-verificar.sql'
];

const CABECERA = `-- =====================================================================
-- Engel · Instalacion completa, para pegar de una sola vez
-- =====================================================================
-- Copiar TODO este archivo y pegarlo en el editor SQL de Supabase
-- (menu izquierdo -> SQL Editor -> New query), y apretar RUN.
--
-- Al terminar, abajo en "Results" aparece una tabla con el resultado.
-- Se puede volver a ejecutar sin problema: no borra ni duplica nada.
-- =====================================================================
`;

// Cada parte entra con su primera linea (la raya de adorno) cambiada por un
// titulo que dice de que archivo viene.
function parte(archivo) {
  const texto = fs.readFileSync(path.join(SUPA, archivo), 'utf8');
  const lineas = texto.replace(/\s+$/, '').split('\n');
  lineas[0] = `-- ===== ${archivo} =====`;
  return lineas.join('\n');
}

const salida = `${CABECERA}\n${PARTES.map(parte).join('\n\n')}\n`;
const destino = path.join(SUPA, 'instalar.sql');

if (process.argv.includes('--verificar')) {
  const actual = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8') : '';
  if (actual !== salida) {
    console.error(
      'supabase/instalar.sql quedo desactualizado.\n' +
        'Corrigelo con: node herramientas/armar-instalacion.js'
    );
    process.exit(1);
  }
  console.log('supabase/instalar.sql esta al dia con el codigo.');
} else {
  fs.writeFileSync(destino, salida);
  console.log('supabase/instalar.sql armado desde el codigo.');
}
