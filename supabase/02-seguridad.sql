-- =====================================================================
-- Engel · Seguridad: quien entra, que puede ver y el historial automatico
-- =====================================================================

-- ---------------------------------------------------------------------
-- Quien es quien
-- ---------------------------------------------------------------------

-- Estas funciones son SECURITY DEFINER a proposito: consultan perfiles sin
-- pasar por las politicas, que es lo que evita una recursion infinita.

CREATE OR REPLACE FUNCTION public.es_miembro()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfiles WHERE id = auth.uid() AND activo
  );
$$;

CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.perfiles WHERE id = auth.uid() AND activo AND rol = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.mi_nombre()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(NULLIF(nombre, ''), email, 'Alguien del equipo')
  FROM public.perfiles WHERE id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- Alta de usuarios: solo por invitacion
-- ---------------------------------------------------------------------

-- Cuando alguien se registra, se le crea el perfil. Si su email no estaba
-- invitado por un administrador, el perfil queda inactivo y no ve nada.
-- El primer usuario que se registra en una base vacia queda como admin.
CREATE OR REPLACE FUNCTION public.al_crear_usuario()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  invitacion public.invitaciones%ROWTYPE;
  primer_usuario boolean;
BEGIN
  SELECT * INTO invitacion
  FROM public.invitaciones
  WHERE lower(email) = lower(NEW.email);

  SELECT NOT EXISTS (SELECT 1 FROM public.perfiles) INTO primer_usuario;

  INSERT INTO public.perfiles (id, nombre, email, rol, activo)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(invitacion.nombre, ''),
      NULLIF(NEW.raw_user_meta_data ->> 'nombre', ''),
      split_part(NEW.email, '@', 1)
    ),
    NEW.email,
    CASE WHEN primer_usuario THEN 'admin' ELSE COALESCE(invitacion.rol, 'vendedor') END,
    primer_usuario OR invitacion.email IS NOT NULL
  )
  ON CONFLICT (id) DO NOTHING;

  IF invitacion.email IS NOT NULL THEN
    UPDATE public.invitaciones SET usada_en = now() WHERE email = invitacion.email;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_al_crear_usuario ON auth.users;
CREATE TRIGGER trg_al_crear_usuario
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.al_crear_usuario();

-- ---------------------------------------------------------------------
-- Historial automatico
-- ---------------------------------------------------------------------

-- Campos que no aportan nada al historial y solo hacen ruido.
CREATE OR REPLACE FUNCTION public.campos_ignorados()
RETURNS text[] LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY['actualizado_en', 'creado_en', 'actualizado_por']::text[] $$;

-- Describe en castellano que cambio entre dos versiones de una fila.
CREATE OR REPLACE FUNCTION public.describir_cambios(antes jsonb, despues jsonb)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  clave text;
  viejo text;
  nuevo text;
  partes text[] := ARRAY[]::text[];
BEGIN
  FOR clave IN SELECT jsonb_object_keys(despues) LOOP
    IF clave = ANY (public.campos_ignorados()) THEN CONTINUE; END IF;
    viejo := COALESCE(antes ->> clave, '');
    nuevo := COALESCE(despues ->> clave, '');
    IF viejo IS DISTINCT FROM nuevo THEN
      partes := partes || format('%s: "%s" → "%s"', replace(clave, '_', ' '), viejo, nuevo);
    END IF;
  END LOOP;
  RETURN array_to_string(partes, '; ');
END;
$$;

-- Sube el contador global para que las otras pantallas se enteren.
CREATE OR REPLACE FUNCTION public.marcar_cambio()
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  UPDATE public.estado_datos SET version = version + 1, cambio_en = now() WHERE id = 1;
$$;

-- Deja una linea en el historial. La usan los disparadores y las funciones.
CREATE OR REPLACE FUNCTION public.anotar(
  p_entidad text,
  p_entidad_id text,
  p_venta_id bigint,
  p_accion text,
  p_resumen text,
  p_antes jsonb DEFAULT NULL,
  p_despues jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.auditoria
    (entidad, entidad_id, venta_id, accion, resumen, antes, despues, usuario_id, usuario_nombre)
  VALUES (
    p_entidad, p_entidad_id, p_venta_id, p_accion, left(COALESCE(p_resumen, ''), 1000),
    p_antes, p_despues, auth.uid(), COALESCE(public.mi_nombre(), 'Sistema')
  );
  PERFORM public.marcar_cambio();
END;
$$;

-- Disparador generico. El primer argumento dice de que columna sale el
-- venta_id, y el segundo como llamar a la entidad en el historial.
CREATE OR REPLACE FUNCTION public.auditar()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  nombre_entidad text := COALESCE(TG_ARGV[1], TG_TABLE_NAME);
  columna_venta text := TG_ARGV[0];
  fila jsonb;
  venta bigint;
  resumen text;
  detalle text;
BEGIN
  fila := to_jsonb(COALESCE(NEW, OLD));

  IF columna_venta = 'id' THEN
    venta := (fila ->> 'id')::bigint;
  ELSIF columna_venta IS NOT NULL AND columna_venta <> '' THEN
    venta := NULLIF(fila ->> columna_venta, '')::bigint;
  END IF;

  IF TG_OP = 'INSERT' THEN
    resumen := format('Se creo %s', nombre_entidad);
    PERFORM public.anotar(nombre_entidad, fila ->> 'id', venta, 'crear', resumen, NULL, fila);

  ELSIF TG_OP = 'UPDATE' THEN
    detalle := public.describir_cambios(to_jsonb(OLD), to_jsonb(NEW));
    -- Si no cambio nada que importe, no se ensucia el historial.
    IF detalle = '' THEN RETURN NEW; END IF;
    resumen := format('%s — %s', initcap(nombre_entidad), detalle);
    PERFORM public.anotar(nombre_entidad, fila ->> 'id', venta, 'editar', resumen,
                          to_jsonb(OLD), to_jsonb(NEW));

  ELSE
    resumen := format('Se borro %s', nombre_entidad);
    PERFORM public.anotar(nombre_entidad, fila ->> 'id', venta, 'borrar', resumen, fila, NULL);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_auditar_ventas ON public.ventas;
CREATE TRIGGER trg_auditar_ventas
  AFTER INSERT OR UPDATE OR DELETE ON public.ventas
  FOR EACH ROW EXECUTE FUNCTION public.auditar('id', 'venta');

DROP TRIGGER IF EXISTS trg_auditar_permutas ON public.permutas;
CREATE TRIGGER trg_auditar_permutas
  AFTER INSERT OR UPDATE OR DELETE ON public.permutas
  FOR EACH ROW EXECUTE FUNCTION public.auditar('venta_id', 'permuta');

DROP TRIGGER IF EXISTS trg_auditar_documentos ON public.documentos;
CREATE TRIGGER trg_auditar_documentos
  AFTER UPDATE ON public.documentos
  FOR EACH ROW EXECUTE FUNCTION public.auditar('venta_id', 'documento');

DROP TRIGGER IF EXISTS trg_auditar_archivos ON public.archivos;
CREATE TRIGGER trg_auditar_archivos
  AFTER INSERT OR DELETE ON public.archivos
  FOR EACH ROW EXECUTE FUNCTION public.auditar('', 'archivo');

DROP TRIGGER IF EXISTS trg_auditar_notas ON public.notas;
CREATE TRIGGER trg_auditar_notas
  AFTER INSERT OR DELETE ON public.notas
  FOR EACH ROW EXECUTE FUNCTION public.auditar('venta_id', 'nota');

DROP TRIGGER IF EXISTS trg_auditar_vehiculos ON public.vehiculos;
CREATE TRIGGER trg_auditar_vehiculos
  AFTER UPDATE ON public.vehiculos
  FOR EACH ROW EXECUTE FUNCTION public.auditar('', 'vehiculo');

DROP TRIGGER IF EXISTS trg_auditar_perfiles ON public.perfiles;
CREATE TRIGGER trg_auditar_perfiles
  AFTER INSERT OR UPDATE ON public.perfiles
  FOR EACH ROW EXECUTE FUNCTION public.auditar('', 'usuario');

-- Los archivos y notas no tienen venta_id propio: se completa despues.
CREATE OR REPLACE FUNCTION public.completar_venta_de_archivo()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  venta bigint;
BEGIN
  SELECT d.venta_id INTO venta
  FROM public.documentos d
  WHERE d.id = COALESCE(NEW.documento_id, OLD.documento_id);

  UPDATE public.auditoria
  SET venta_id = venta
  WHERE id = (SELECT max(id) FROM public.auditoria WHERE entidad = 'archivo');

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_venta_de_archivo ON public.archivos;
CREATE TRIGGER trg_venta_de_archivo
  AFTER INSERT OR DELETE ON public.archivos
  FOR EACH ROW EXECUTE FUNCTION public.completar_venta_de_archivo();

-- Marca de tiempo de la ultima modificacion.
CREATE OR REPLACE FUNCTION public.tocar_actualizado_en()
RETURNS trigger LANGUAGE plpgsql
AS $$ BEGIN NEW.actualizado_en := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_tocar_ventas ON public.ventas;
CREATE TRIGGER trg_tocar_ventas BEFORE UPDATE ON public.ventas
  FOR EACH ROW EXECUTE FUNCTION public.tocar_actualizado_en();

DROP TRIGGER IF EXISTS trg_tocar_vehiculos ON public.vehiculos;
CREATE TRIGGER trg_tocar_vehiculos BEFORE UPDATE ON public.vehiculos
  FOR EACH ROW EXECUTE FUNCTION public.tocar_actualizado_en();

-- ---------------------------------------------------------------------
-- Politicas de acceso (RLS)
-- ---------------------------------------------------------------------
-- Sin sesion no se ve absolutamente nada. Con sesion, solo si el perfil
-- esta activo, o sea si un administrador invito a esa persona.

ALTER TABLE public.perfiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitaciones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehiculos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permutas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documentos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archivos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borradores    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estado_datos  ENABLE ROW LEVEL SECURITY;

-- Perfiles: todos los del equipo se ven entre si; cada uno edita su nombre;
-- los administradores pueden dar de alta y de baja.
DROP POLICY IF EXISTS perfiles_ver ON public.perfiles;
CREATE POLICY perfiles_ver ON public.perfiles FOR SELECT
  USING (public.es_miembro() OR id = auth.uid());

DROP POLICY IF EXISTS perfiles_editar_propio ON public.perfiles;
CREATE POLICY perfiles_editar_propio ON public.perfiles FOR UPDATE
  USING (id = auth.uid()) WITH CHECK (id = auth.uid() AND rol = (SELECT rol FROM public.perfiles p WHERE p.id = auth.uid()));

DROP POLICY IF EXISTS perfiles_admin ON public.perfiles;
CREATE POLICY perfiles_admin ON public.perfiles FOR UPDATE
  USING (public.es_admin()) WITH CHECK (public.es_admin());

-- Invitaciones: solo administradores.
DROP POLICY IF EXISTS invitaciones_admin ON public.invitaciones;
CREATE POLICY invitaciones_admin ON public.invitaciones FOR ALL
  USING (public.es_admin()) WITH CHECK (public.es_admin());

-- Datos del negocio: los ve y los edita cualquier integrante activo.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vehiculos', 'ventas', 'permutas', 'documentos', 'archivos', 'notas']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_ver ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_ver ON public.%I FOR SELECT USING (public.es_miembro())', t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I_crear ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_crear ON public.%I FOR INSERT WITH CHECK (public.es_miembro())', t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I_editar ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_editar ON public.%I FOR UPDATE USING (public.es_miembro()) WITH CHECK (public.es_miembro())', t, t);
  END LOOP;
END $$;

-- Borrar: las permutas, notas y archivos los puede quitar cualquiera del
-- equipo; una venta entera, solo un administrador.
DROP POLICY IF EXISTS permutas_borrar ON public.permutas;
CREATE POLICY permutas_borrar ON public.permutas FOR DELETE USING (public.es_miembro());

DROP POLICY IF EXISTS notas_borrar ON public.notas;
CREATE POLICY notas_borrar ON public.notas FOR DELETE USING (public.es_miembro());

DROP POLICY IF EXISTS archivos_borrar ON public.archivos;
CREATE POLICY archivos_borrar ON public.archivos FOR DELETE USING (public.es_miembro());

DROP POLICY IF EXISTS ventas_borrar ON public.ventas;
CREATE POLICY ventas_borrar ON public.ventas FOR DELETE USING (public.es_admin());

-- Historial: se lee, no se escribe a mano. Lo escriben los disparadores.
DROP POLICY IF EXISTS auditoria_ver ON public.auditoria;
CREATE POLICY auditoria_ver ON public.auditoria FOR SELECT USING (public.es_miembro());

-- Borradores: cada uno ve y edita solamente los suyos.
DROP POLICY IF EXISTS borradores_propios ON public.borradores;
CREATE POLICY borradores_propios ON public.borradores FOR ALL
  USING (usuario_id = auth.uid()) WITH CHECK (usuario_id = auth.uid());

-- Contador de cambios: lo lee cualquiera del equipo.
DROP POLICY IF EXISTS estado_ver ON public.estado_datos;
CREATE POLICY estado_ver ON public.estado_datos FOR SELECT USING (public.es_miembro());

-- >>> infracciones
-- ---------------------------------------------------------------------
-- Infracciones: historial, marcas de tiempo y reglas de acceso
-- ---------------------------------------------------------------------

-- Al marcar una multa como pagada se anota la fecha de hoy, si no se puso
-- otra. Si se vuelve atras, la fecha de pago se borra para no confundir.
CREATE OR REPLACE FUNCTION public.infraccion_al_cambiar_estado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.estado = 'pagada' AND NEW.fecha_pago IS NULL THEN
    NEW.fecha_pago := current_date;
  ELSIF TG_OP = 'UPDATE' AND OLD.estado = 'pagada' AND NEW.estado <> 'pagada'
        AND NEW.fecha_pago IS NOT DISTINCT FROM OLD.fecha_pago THEN
    NEW.fecha_pago := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_infraccion_estado ON public.infracciones;
CREATE TRIGGER trg_infraccion_estado
  BEFORE INSERT OR UPDATE ON public.infracciones
  FOR EACH ROW EXECUTE FUNCTION public.infraccion_al_cambiar_estado();

DROP TRIGGER IF EXISTS trg_tocar_infracciones ON public.infracciones;
CREATE TRIGGER trg_tocar_infracciones BEFORE UPDATE ON public.infracciones
  FOR EACH ROW EXECUTE FUNCTION public.tocar_actualizado_en();

DROP TRIGGER IF EXISTS trg_tocar_portales ON public.portales_infracciones;
CREATE TRIGGER trg_tocar_portales BEFORE UPDATE ON public.portales_infracciones
  FOR EACH ROW EXECUTE FUNCTION public.tocar_actualizado_en();

DROP TRIGGER IF EXISTS trg_auditar_infracciones ON public.infracciones;
CREATE TRIGGER trg_auditar_infracciones
  AFTER INSERT OR UPDATE OR DELETE ON public.infracciones
  FOR EACH ROW EXECUTE FUNCTION public.auditar('', 'infraccion');

DROP TRIGGER IF EXISTS trg_auditar_infracciones_archivos ON public.infracciones_archivos;
CREATE TRIGGER trg_auditar_infracciones_archivos
  AFTER INSERT OR DELETE ON public.infracciones_archivos
  FOR EACH ROW EXECUTE FUNCTION public.auditar('', 'comprobante de infraccion');

DROP TRIGGER IF EXISTS trg_auditar_portales ON public.portales_infracciones;
CREATE TRIGGER trg_auditar_portales
  AFTER INSERT OR UPDATE OR DELETE ON public.portales_infracciones
  FOR EACH ROW EXECUTE FUNCTION public.auditar('', 'pagina de consulta');

DROP TRIGGER IF EXISTS trg_auditar_consultas ON public.consultas_infracciones;
CREATE TRIGGER trg_auditar_consultas
  AFTER INSERT ON public.consultas_infracciones
  FOR EACH ROW EXECUTE FUNCTION public.auditar('', 'consulta de infracciones');

ALTER TABLE public.portales_infracciones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.infracciones           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.infracciones_archivos  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultas_infracciones ENABLE ROW LEVEL SECURITY;

-- Todo el equipo ve, carga y edita. Borrar una multa o un comprobante
-- tambien (un error de carga se tiene que poder corregir): el historial
-- guarda una copia completa de lo borrado.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['portales_infracciones', 'infracciones', 'infracciones_archivos', 'consultas_infracciones']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_ver ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_ver ON public.%I FOR SELECT USING (public.es_miembro())', t, t);

    EXECUTE format('DROP POLICY IF EXISTS %I_crear ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_crear ON public.%I FOR INSERT WITH CHECK (public.es_miembro())', t, t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['portales_infracciones', 'infracciones']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_editar ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_editar ON public.%I FOR UPDATE USING (public.es_miembro()) WITH CHECK (public.es_miembro())', t, t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['infracciones', 'infracciones_archivos']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_borrar ON public.%I', t, t);
    EXECUTE format('CREATE POLICY %I_borrar ON public.%I FOR DELETE USING (public.es_miembro())', t, t);
  END LOOP;
END $$;

-- Una pagina de consulta la saca solo un administrador (el resto la puede
-- desactivar). El registro de consultas no se edita ni se borra.
DROP POLICY IF EXISTS portales_infracciones_borrar ON public.portales_infracciones;
CREATE POLICY portales_infracciones_borrar ON public.portales_infracciones
  FOR DELETE USING (public.es_admin());
-- <<< infracciones
