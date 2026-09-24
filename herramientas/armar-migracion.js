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

// Extrae un bloque marcado en el codigo con "-- >>> nombre" y "-- <<< nombre".
// Asi las tablas y reglas nuevas se escriben una sola vez, en su archivo.
function extraerBloque(archivo, nombre) {
  const texto = fs.readFileSync(path.join(SUPA, archivo), 'utf8');
  const inicio = texto.indexOf(`-- >>> ${nombre}\n`);
  const fin = texto.indexOf(`-- <<< ${nombre}`, inicio);
  if (inicio === -1 || fin === -1) throw new Error(`No se encontro el bloque ${nombre} en ${archivo}`);
  return texto.slice(inicio + `-- >>> ${nombre}\n`.length, fin).trim();
}

// Todas las funciones que cambiaron desde la primera instalacion.
const FUNCIONES = [
  ['03-funciones.sql', 'version_esquema'],
  ['03-funciones.sql', 'dominio_valido'],
  ['03-funciones.sql', 'estados_documento'],
  ['03-funciones.sql', 'guardar_vehiculo'],
  ['03-funciones.sql', 'actualizar_vehiculo'],
  ['04-consultas.sql', 'documentacion_de_venta'],
  ['04-consultas.sql', 'sugerir_dominios'],
  ['04-consultas.sql', 'venta_completa'],
  ['04-consultas.sql', 'listar_ventas'],
  ['04-consultas.sql', 'panel_documentacion'],
  ['04-consultas.sql', 'estadisticas'],
  ['04-consultas.sql', 'exportar_todo'],
  ['03-funciones.sql', 'guardar_infraccion'],
  ['03-funciones.sql', 'registrar_consulta_infracciones'],
  ['04-consultas.sql', 'infracciones_de_dominio'],
  ['04-consultas.sql', 'listar_infracciones']
];

// Funciones nuevas que solo puede usar quien inicio sesion.
const FUNCIONES_NUEVAS = [
  'sugerir_dominios(text, integer)',
  'guardar_infraccion(jsonb)',
  'registrar_consulta_infracciones(text, bigint, text)',
  'infracciones_de_dominio(text)',
  'listar_infracciones(text, text)'
];

const salida = `-- =====================================================================
-- Engel · Poner al dia una base ya instalada
-- =====================================================================
-- Copiar TODO este archivo, pegarlo en el editor SQL de Supabase y RUN.
--
-- Trae estos cambios:
--   1. Acepta las patentes de moto anteriores a 2016 (590LLL).
--   2. Saca el numero de chasis y el numero de motor.
--   3. Los estados de la documentacion pasan a ser:
--      Faltante -> Pedido -> En proceso -> Aprobado.
--   4. El buscador sugiere dominios mientras se escribe.
--   5. Infracciones: multas de cada auto, paginas de consulta y pagos.
--
-- Se puede correr aunque ya hayas aplicado alguno: no repite nada.
-- Al final aparece una tabla con el resultado.
--
-- Este archivo se genera solo con: node herramientas/armar-migracion.js
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Tablas nuevas de infracciones
-- ---------------------------------------------------------------------
-- Van antes que las funciones porque algunas las usan.

${extraerBloque('01-esquema.sql', 'infracciones')}

-- ---------------------------------------------------------------------
-- 1. Las funciones
-- ---------------------------------------------------------------------
-- Tienen que actualizarse ANTES de tocar las columnas viejas: si no, entre
-- un paso y el otro quedan apuntando a columnas que ya no existen y cargar
-- una venta falla.

${FUNCIONES.map(([archivo, nombre]) => extraerFuncion(archivo, nombre)).join('\n\n')}

-- ---------------------------------------------------------------------
-- 2. Sacar chasis y motor
-- ---------------------------------------------------------------------
-- Ya no se piden en la carga; los datos de esas dos columnas se descartan.

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

-- ---------------------------------------------------------------------
-- 4. Reglas de acceso de las infracciones
-- ---------------------------------------------------------------------

${extraerBloque('02-seguridad.sql', 'infracciones')}

${extraerBloque('06-permisos.sql', 'infracciones')}

${FUNCIONES_NUEVAS.map((f) => `REVOKE ALL ON FUNCTION public.${f} FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.${f} TO authenticated;`).join('\n')}
GRANT EXECUTE ON FUNCTION public.version_esquema() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 5. Comprobacion
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
  SELECT 4, 'Version de la base',
         CASE WHEN public.version_esquema() >= 4 THEN 'OK' ELSE 'FALTA' END,
         'version ' || public.version_esquema()
  UNION ALL
  SELECT 5, 'Sugerencias del buscador',
         CASE WHEN to_regprocedure('public.sugerir_dominios(text, integer)') IS NOT NULL
              THEN 'OK' ELSE 'FALTA' END,
         'el buscador completa solo mientras escribis'
  UNION ALL
  SELECT 6, 'Infracciones',
         CASE WHEN (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'
                      AND tablename IN ('portales_infracciones', 'infracciones',
                                        'infracciones_archivos', 'consultas_infracciones')) = 4
              THEN 'OK' ELSE 'FALTA' END,
         'nuevo menu para cargar multas y seguir los pagos'
  UNION ALL
  SELECT 7, 'Tus datos',
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
