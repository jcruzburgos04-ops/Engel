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
DROP POLICY IF EXISTS documentacion_ver ON storage.objects;
CREATE POLICY documentacion_ver ON storage.objects FOR SELECT
  USING (bucket_id = 'documentacion' AND public.es_miembro());

DROP POLICY IF EXISTS documentacion_subir ON storage.objects;
CREATE POLICY documentacion_subir ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'documentacion' AND public.es_miembro());

DROP POLICY IF EXISTS documentacion_reemplazar ON storage.objects;
CREATE POLICY documentacion_reemplazar ON storage.objects FOR UPDATE
  USING (bucket_id = 'documentacion' AND public.es_miembro());

DROP POLICY IF EXISTS documentacion_borrar ON storage.objects;
CREATE POLICY documentacion_borrar ON storage.objects FOR DELETE
  USING (bucket_id = 'documentacion' AND public.es_miembro());
