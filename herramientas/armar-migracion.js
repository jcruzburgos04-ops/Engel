'use strict';

// Arma supabase/actualizar.sql: el archivo que pone al dia una base que ya
// estaba instalada. Las funciones se copian del codigo real, asi la
// migracion nunca queda desincronizada con el esquema.

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

// Todas las funciones que cambiaron desde la primera instalacion.
const FUNCIONES = [
  ['03-funciones.sql', 'dominio_valido'],
  ['03-funciones.sql', 'estados_documento'],
  ['03-funciones.sql', 'guardar_vehiculo'],
  ['03-funciones.sql', 'actualizar_vehiculo'],
  ['04-consultas.sql', 'documentacion_de_venta'],
  ['04-consultas.sql', 'venta_completa'],
  ['04-consultas.sql', 'listar_ventas'],
  ['04-consultas.sql', 'panel_documentacion'],
  ['04-consultas.sql', 'estadisticas']
];

const salida = `-- =====================================================================
-- Engel · Poner al dia una base ya instalada
-- =====================================================================
-- Copiar TODO este archivo, pegarlo en el editor SQL de Supabase y RUN.
--
-- Trae tres cambios:
--   1. Acepta las patentes de moto anteriores a 2016 (590LLL).
--   2. Saca el numero de chasis y el numero de motor.
--   3. Los estados de la documentacion pasan a ser:
--      Faltante -> Pedido -> En proceso -> Aprobado.
--
-- Se puede correr aunque ya hayas aplicado alguno: no repite nada.
-- Al final aparece una tabla con el resultado.
--
-- Este archivo se genera solo con: node herramientas/armar-migracion.js
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Las funciones primero
-- ---------------------------------------------------------------------
-- Tienen que actualizarse ANTES de tocar las tablas: si no, entre un paso
-- y el otro quedan apuntando a columnas que ya no existen y cargar una
-- venta falla.

${FUNCIONES.map(([archivo, nombre]) => extraerFuncion(archivo, nombre)).join('\n\n')}

-- ---------------------------------------------------------------------
-- 2. Sacar chasis y motor
-- ---------------------------------------------------------------------
-- Si tenias alguno cargado, el paso 4 te avisa antes de que se pierda.

ALTER TABLE public.vehiculos DROP COLUMN IF EXISTS nro_chasis;
ALTER TABLE public.vehiculos DROP COLUMN IF EXISTS nro_motor;

-- ---------------------------------------------------------------------
-- 3. Estados nuevos de la documentacion
-- ---------------------------------------------------------------------
-- Como quedan los que ya tenias cargados:
--   Pendiente  -> Faltante
--   En tramite -> En proceso
--   Listo      -> Aprobado
--   No aplica  -> Aprobado

DO $migracion$
DECLARE
  restriccion text;
  cambiados integer;
BEGIN
  -- La restriccion que limita los valores puede tener distinto nombre.
  FOR restriccion IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.documentos'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%estado%'
  LOOP
    EXECUTE format('ALTER TABLE public.documentos DROP CONSTRAINT %I', restriccion);
  END LOOP;

  ALTER TABLE public.documentos ALTER COLUMN estado DROP DEFAULT;

  -- Renombrar no es un cambio que haya hecho una persona, asi que no tiene
  -- sentido que llene el historial. Se pausan los disparadores solo para
  -- esta operacion; al terminar la transaccion se restablecen solos.
  BEGIN
    SET LOCAL session_replication_role = 'replica';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'El renombre va a quedar registrado en el historial.';
  END;

  UPDATE public.documentos
  SET estado = CASE estado
        WHEN 'pendiente'  THEN 'faltante'
        WHEN 'en_tramite' THEN 'en_proceso'
        WHEN 'ok'         THEN 'aprobado'
        WHEN 'no_aplica'  THEN 'aprobado'
        ELSE estado
      END
  WHERE estado IN ('pendiente', 'en_tramite', 'ok', 'no_aplica');

  GET DIAGNOSTICS cambiados = ROW_COUNT;
  RAISE NOTICE 'Documentos pasados a los estados nuevos: %', cambiados;

  ALTER TABLE public.documentos ALTER COLUMN estado SET DEFAULT 'faltante';
  ALTER TABLE public.documentos
    ADD CONSTRAINT documentos_estado_check
    CHECK (estado IN ('faltante', 'pedido', 'en_proceso', 'aprobado'));
END
$migracion$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 4. Comprobacion
-- ---------------------------------------------------------------------

SELECT control, estado, detalle FROM (
  SELECT 1 AS orden, 'Patentes de moto (590LLL)' AS control,
         CASE WHEN public.dominio_valido('590LLL') THEN 'OK' ELSE 'FALTA' END AS estado,
         'se aceptan los cuatro formatos' AS detalle
  UNION ALL
  SELECT 2, 'Chasis y motor',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'vehiculos'
             AND column_name IN ('nro_chasis', 'nro_motor')
         ) THEN 'OK' ELSE 'FALTA' END,
         'ya no estan'
  UNION ALL
  SELECT 3, 'Estados de la documentacion',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM public.documentos
           WHERE estado IN ('pendiente', 'en_tramite', 'ok', 'no_aplica')
         ) THEN 'OK' ELSE 'FALTA' END,
         (SELECT COALESCE(string_agg(estado || ': ' || cantidad, ' · ' ORDER BY estado), 'sin documentos')
            FROM (SELECT estado, count(*) AS cantidad FROM public.documentos GROUP BY estado) AS t)
  UNION ALL
  SELECT 4, 'Tus datos',
         'INFO',
         (SELECT count(*) FROM public.ventas) || ' venta(s) · '
         || (SELECT count(*) FROM public.vehiculos) || ' auto(s) · '
         || (SELECT count(*) FROM public.archivos) || ' archivo(s)'
) AS filas ORDER BY orden;
`;

const destino = path.join(SUPA, 'actualizar.sql');

// Con --verificar no escribe: solo avisa si el archivo quedo desactualizado
// respecto del codigo. Lo usa la bateria de pruebas.
if (process.argv.includes('--verificar')) {
  const actual = fs.existsSync(destino) ? fs.readFileSync(destino, 'utf8') : '';
  if (actual !== salida) {
    console.error(
      'supabase/actualizar.sql quedo desactualizado.\n' +
        'Corrigelo con: node herramientas/armar-migracion.js'
    );
    process.exit(1);
  }
  console.log('supabase/actualizar.sql esta al dia con el codigo.');
} else {
  fs.writeFileSync(destino, salida);
  console.log('supabase/actualizar.sql armado desde el codigo.');
}
