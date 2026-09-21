-- =====================================================================
-- Engel · Verificacion: se corre al final de la instalacion
-- =====================================================================
-- Devuelve una tabla con el resultado. Tiene que ser lo ultimo del archivo:
-- el editor de Supabase muestra el resultado de la ultima consulta.

-- Avisa a la API de Supabase que el esquema cambio, para que las funciones
-- nuevas esten disponibles enseguida y no haya que esperar ni reiniciar.
NOTIFY pgrst, 'reload schema';

WITH controles AS (
  SELECT
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'
       AND tablename IN ('perfiles','invitaciones','vehiculos','ventas','permutas',
                         'documentos','archivos','notas','auditoria','borradores','estado_datos')) AS tablas,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('crear_venta','actualizar_venta','venta_completa','listar_ventas',
                          'buscar_dominio','panel_documentacion','estadisticas','es_miembro',
                          'version_esquema')) AS funciones,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS reglas,
    (SELECT count(*) FROM storage.buckets WHERE id = 'documentacion') AS deposito,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage'
       AND policyname LIKE 'documentacion%') AS reglas_archivos
),
filas AS (
  SELECT 1 AS orden,
         'Tablas de datos' AS control,
         CASE WHEN tablas = 11 THEN 'OK' ELSE 'FALTA' END AS estado,
         tablas || ' de 11' AS detalle
  FROM controles
  UNION ALL
  SELECT 2, 'Funciones del sistema',
         CASE WHEN funciones = 9 THEN 'OK' ELSE 'FALTA' END,
         funciones || ' de 9'
  FROM controles
  UNION ALL
  SELECT 3, 'Reglas de acceso a los datos',
         CASE WHEN reglas >= 20 THEN 'OK' ELSE 'FALTA' END,
         reglas || ' reglas (sin permiso no se ve nada)'
  FROM controles
  UNION ALL
  SELECT 4, 'Deposito de documentacion',
         CASE WHEN deposito = 1 THEN 'OK' ELSE 'FALTA' END,
         CASE WHEN deposito = 1 THEN 'creado' ELSE 'no se creo' END
  FROM controles
  UNION ALL
  SELECT 5, 'Reglas de acceso a los archivos',
         CASE WHEN reglas_archivos = 4 THEN 'OK' ELSE 'FALTA' END,
         CASE WHEN reglas_archivos = 4
              THEN '4 de 4'
              ELSE reglas_archivos || ' de 4 — crealas en Storage → documentacion → Policies, '
                   || 'con la expresion: bucket_id = ''documentacion'' AND public.es_miembro()'
         END
  FROM controles
  UNION ALL
  SELECT 6,
         '>>> RESULTADO',
         CASE WHEN tablas = 11 AND funciones = 9 AND deposito = 1 AND reglas_archivos = 4
              THEN 'TODO LISTO'
              WHEN tablas = 11 AND funciones = 9 AND deposito = 1
              THEN 'CASI'
              ELSE 'REVISAR' END,
         CASE WHEN tablas = 11 AND funciones = 9 AND deposito = 1 AND reglas_archivos = 4
              THEN 'Ya podes conectar la web. Seguí con el paso 3 del README.'
              WHEN tablas = 11 AND funciones = 9 AND deposito = 1
              THEN 'Falta solo lo de la fila 5. Todo lo demas quedo instalado.'
              ELSE 'Algo no se creo: volve a pegar el archivo completo y correlo de nuevo.' END
  FROM controles
)
SELECT control, estado, detalle FROM filas ORDER BY orden;
