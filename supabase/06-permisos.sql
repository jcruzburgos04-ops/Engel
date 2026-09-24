-- Permisos de tabla. Supabase los aplica solo a las tablas nuevas del esquema
-- public, pero dejarlos explicitos evita sorpresas. Quien protege los datos
-- son las politicas (RLS), no estos permisos.

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.perfiles, public.invitaciones, public.vehiculos, public.ventas,
  public.permutas, public.documentos, public.archivos, public.notas,
  public.borradores
TO authenticated;

GRANT SELECT ON public.auditoria, public.estado_datos TO authenticated;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- El visitante sin sesion no puede tocar nada.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- >>> infracciones
GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.portales_infracciones, public.infracciones, public.infracciones_archivos
TO authenticated;
GRANT SELECT, INSERT ON public.consultas_infracciones TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
REVOKE ALL ON public.portales_infracciones, public.infracciones,
  public.infracciones_archivos, public.consultas_infracciones FROM anon;
-- <<< infracciones
