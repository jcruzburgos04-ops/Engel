'use strict';

// Arma supabase/actualizar-campos.sql tomando las funciones del codigo real,
// asi la migracion nunca queda desincronizada con el esquema.

const fs = require('fs');
const path = require('path');

const SUPA = path.resolve(__dirname, '..', 'supabase');

// Extrae una funcion completa, desde su CREATE hasta el $$; que la cierra.
function extraerFuncion(archivo, nombre) {
  const texto = fs.readFileSync(path.join(SUPA, archivo), 'utf8');
  const inicio = texto.indexOf(`CREATE OR REPLACE FUNCTION public.${nombre}(`);
  if (inicio === -1) throw new Error(`No se encontro la funcion ${nombre} en ${archivo}`);

  const fin = texto.indexOf('\n$$;', inicio);
  if (fin === -1) throw new Error(`No se pudo cerrar la funcion ${nombre}`);
  return texto.slice(inicio, fin + 4);
}

const funciones = [
  ['03-funciones.sql', 'guardar_vehiculo'],
  ['03-funciones.sql', 'actualizar_vehiculo'],
  ['04-consultas.sql', 'venta_completa']
];

const salida = `-- =====================================================================
-- Engel · Actualizacion: sacar numero de chasis y numero de motor
-- =====================================================================
-- Pegar TODO esto en el editor SQL de Supabase y apretar RUN.
--
-- Estos dos campos casi nunca se completaban y demoraban la carga. Al
-- sacarlos, la ficha queda con lo que realmente identifica al vehiculo:
-- dominio, marca, modelo y ano.
--
-- Este archivo se genera solo con: node herramientas/armar-migracion.js
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Primero se actualizan las funciones que usaban esas columnas.
--    Tiene que ir antes del borrado: si no, cargar una venta falla.
-- ---------------------------------------------------------------------

${funciones.map(([archivo, nombre]) => extraerFuncion(archivo, nombre)).join('\n\n')}

-- ---------------------------------------------------------------------
-- 2. Recien ahora se sacan las columnas.
-- ---------------------------------------------------------------------
-- Si en alguna ficha habias cargado el chasis o el motor, ese dato se
-- pierde. La consulta del paso 3 te muestra si habia algo.

ALTER TABLE public.vehiculos DROP COLUMN IF EXISTS nro_chasis;
ALTER TABLE public.vehiculos DROP COLUMN IF EXISTS nro_motor;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 3. Comprobacion
-- ---------------------------------------------------------------------

SELECT
  CASE
    WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'vehiculos'
        AND column_name IN ('nro_chasis', 'nro_motor')
    ) THEN 'FALTA: las columnas siguen ahi'
    ELSE 'LISTO: chasis y motor ya no estan'
  END AS resultado,
  (SELECT count(*) FROM public.vehiculos) AS autos_cargados,
  (SELECT count(*) FROM public.ventas) AS ventas_cargadas;
`;

const destino = path.join(SUPA, 'actualizar-campos.sql');

// Con --verificar no escribe: solo avisa si el archivo quedo desactualizado
// respecto del codigo. Lo usa la bateria de pruebas.
if (process.argv.includes('--verificar')) {
  const actual = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8') : '';
  if (actual !== salida) {
    console.error(
      'supabase/actualizar-campos.sql quedo desactualizado.\n' +
        'Corrigelo con: node herramientas/armar-migracion.js'
    );
    process.exit(1);
  }
  console.log('supabase/actualizar-campos.sql esta al dia con el codigo.');
} else {
  fs.writeFileSync(destino, salida);
  console.log('supabase/actualizar-campos.sql armado desde el codigo.');
}
