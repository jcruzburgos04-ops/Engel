-- =====================================================================
-- Engel · Comprobar como quedo la instalacion
-- =====================================================================
-- Pegar esto solo en el editor SQL de Supabase y apretar RUN.
-- Sirve para ver en cualquier momento si esta todo en su lugar.
-- No modifica nada.

WITH controles AS (
  SELECT
    (SELECT count(*) FROM pg_tables WHERE schemaname = 'public'
       AND tablename IN ('perfiles','invitaciones','vehiculos','ventas','permutas',
                         'documentos','archivos','notas','auditoria','borradores','estado_datos')) AS tablas,
    (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('crear_venta','actualizar_venta','venta_completa','listar_ventas',
                          'buscar_dominio','panel_documentacion','estadisticas','es_miembro',
                          'version_esquema','sugerir_dominios')) AS funciones,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public') AS reglas,
    (SELECT count(*) FROM storage.buckets WHERE id = 'documentacion') AS deposito,
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'storage'
       AND policyname LIKE 'documentacion%') AS reglas_archivos,
    (SELECT count(*) FROM public.perfiles) AS personas,
    (SELECT count(*) FROM public.ventas) AS ventas
)
SELECT control, estado, detalle FROM (
  SELECT 1 AS orden, 'Tablas de datos' AS control,
         CASE WHEN tablas = 11 THEN 'OK' ELSE 'FALTA' END AS estado,
         tablas || ' de 11' AS detalle FROM controles
  UNION ALL
  SELECT 2, 'Funciones del sistema',
         CASE WHEN funciones = 10 THEN 'OK' ELSE 'FALTA' END, funciones || ' de 10' FROM controles
  UNION ALL
  SELECT 3, 'Reglas de acceso a los datos',
         CASE WHEN reglas >= 20 THEN 'OK' ELSE 'FALTA' END,
         reglas || ' reglas' FROM controles
  UNION ALL
  SELECT 4, 'Deposito de documentacion',
         CASE WHEN deposito = 1 THEN 'OK' ELSE 'FALTA' END,
         CASE WHEN deposito = 1 THEN 'creado' ELSE 'no se creo' END FROM controles
  UNION ALL
  SELECT 5, 'Reglas de acceso a los archivos',
         CASE WHEN reglas_archivos = 4 THEN 'OK' ELSE 'FALTA' END,
         reglas_archivos || ' de 4' FROM controles
  UNION ALL
  SELECT 6, 'Personas con cuenta', 'INFO', personas::text FROM controles
  UNION ALL
  SELECT 7, 'Ventas cargadas', 'INFO', ventas::text FROM controles
  UNION ALL
  SELECT 8, '>>> RESULTADO',
         CASE WHEN tablas = 11 AND funciones = 10 AND deposito = 1 AND reglas_archivos = 4
              THEN 'TODO LISTO' ELSE 'REVISAR' END,
         CASE WHEN tablas = 11 AND funciones = 10 AND deposito = 1 AND reglas_archivos = 4
              THEN 'La base esta lista.'
              ELSE 'Volve a pegar instalar.sql completo y correlo de nuevo.' END
  FROM controles
) AS filas ORDER BY orden;
