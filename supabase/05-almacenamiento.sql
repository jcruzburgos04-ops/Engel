-- =====================================================================
-- Engel · Donde se guardan los archivos de documentacion
-- =====================================================================

-- Un deposito privado: no se accede por URL directa, solo con un enlace
-- temporal que la web pide despues de verificar quien sos.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documentacion',
  'documentacion',
  false,
  26214400,  -- 25 MB por archivo
  ARRAY[
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/gif', 'image/tiff',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv', 'text/plain'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Solo el equipo entra a los archivos, con las mismas reglas que a los datos.
--
-- En algunos proyectos de Supabase las politicas de Storage no se pueden
-- crear desde el editor SQL por una cuestion de permisos. Si pasa eso, el
-- resto de la instalacion NO se interrumpe: al final aparece un aviso
-- explicando como crearlas a mano desde el panel (Storage → Policies).
DO $$
DECLARE
  politica record;
  faltaron boolean := false;
BEGIN
  FOR politica IN
    SELECT * FROM (VALUES
      ('documentacion_ver', 'SELECT', 'USING'),
      ('documentacion_subir', 'INSERT', 'WITH CHECK'),
      ('documentacion_reemplazar', 'UPDATE', 'USING'),
      ('documentacion_borrar', 'DELETE', 'USING')
    ) AS t(nombre, operacion, clausula)
  LOOP
    BEGIN
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', politica.nombre);
      EXECUTE format(
        'CREATE POLICY %I ON storage.objects FOR %s %s (bucket_id = ''documentacion'' AND public.es_miembro())',
        politica.nombre, politica.operacion, politica.clausula
      );
    EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
      faltaron := true;
      RAISE WARNING 'No se pudo crear la politica % de Storage: %', politica.nombre, SQLERRM;
    END;
  END LOOP;

  IF faltaron THEN
    RAISE WARNING '%', '
  ATENCION: faltan las politicas del deposito de archivos.
  Todo lo demas quedo instalado. Para completarlo, en el panel de Supabase:
    Storage -> documentacion -> Policies -> New policy -> For full customization
  Crear cuatro politicas (SELECT, INSERT, UPDATE, DELETE), todas con la
  expresion:  bucket_id = ''documentacion'' AND public.es_miembro()
  y el rol "authenticated".';
  END IF;
END $$;
