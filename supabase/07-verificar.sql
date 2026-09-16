-- =====================================================================
-- Engel · Verificacion: se corre al final de la instalacion
-- =====================================================================
-- Muestra un resumen para saber de un vistazo si quedo todo bien.

DO $$
DECLARE
  tablas integer;
  funciones integer;
  politicas integer;
  deposito integer;
  politicas_archivos integer;
BEGIN
  SELECT count(*) INTO tablas
  FROM pg_tables WHERE schemaname = 'public'
    AND tablename IN ('perfiles','invitaciones','vehiculos','ventas','permutas',
                      'documentos','archivos','notas','auditoria','borradores','estado_datos');

  SELECT count(*) INTO funciones
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('crear_venta','actualizar_venta','venta_completa','listar_ventas',
                      'buscar_dominio','panel_documentacion','estadisticas','es_miembro');

  SELECT count(*) INTO politicas FROM pg_policies WHERE schemaname = 'public';
  SELECT count(*) INTO deposito FROM storage.buckets WHERE id = 'documentacion';
  SELECT count(*) INTO politicas_archivos
  FROM pg_policies WHERE schemaname = 'storage' AND policyname LIKE 'documentacion%';

  RAISE NOTICE '';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '  Resultado de la instalacion de Engel';
  RAISE NOTICE '=====================================================';
  RAISE NOTICE '  Tablas creadas .............. % de 11', tablas;
  RAISE NOTICE '  Funciones principales ....... % de 8', funciones;
  RAISE NOTICE '  Reglas de acceso ............ %', politicas;
  RAISE NOTICE '  Deposito de archivos ........ %', CASE WHEN deposito = 1 THEN 'listo' ELSE 'FALTA' END;
  RAISE NOTICE '  Politicas de archivos ....... % de 4', politicas_archivos;
  RAISE NOTICE '=====================================================';

  IF tablas = 11 AND funciones = 8 AND deposito = 1 AND politicas_archivos = 4 THEN
    RAISE NOTICE '  TODO LISTO. Ya podes conectar la web.';
  ELSIF tablas = 11 AND funciones = 8 AND deposito = 1 THEN
    RAISE NOTICE '  Casi listo: faltan las politicas del deposito de archivos.';
    RAISE NOTICE '  Mira el aviso de mas arriba para crearlas desde el panel.';
  ELSE
    RAISE NOTICE '  Algo no se creo. Revisa los errores de mas arriba.';
  END IF;
  RAISE NOTICE '';
END $$;

-- Avisa a la API de Supabase que el esquema cambio, para que las funciones
-- nuevas esten disponibles enseguida y no haya que esperar ni reiniciar.
NOTIFY pgrst, 'reload schema';
