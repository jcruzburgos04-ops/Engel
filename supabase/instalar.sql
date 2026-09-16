-- =====================================================================
-- Engel · Instalacion completa, para pegar de una sola vez
-- =====================================================================
-- Copiar TODO este archivo y pegarlo en el editor SQL de Supabase
-- (menu izquierdo → SQL Editor → New query), y apretar RUN.
--
-- Se puede volver a ejecutar sin problema: no borra ni duplica nada.
-- =====================================================================

-- ===== 01-esquema.sql =====
-- Engel · Administracion de ventas — Esquema de la base (Supabase)
-- =====================================================================
-- Se ejecuta una sola vez, desde el editor SQL de Supabase.
-- Es idempotente: se puede volver a correr sin romper nada.

-- ---------------------------------------------------------------------
-- Personas del equipo
-- ---------------------------------------------------------------------

-- Cada persona que entra a la web tiene un perfil, atado a su usuario de
-- Supabase (auth.users). El perfil guarda el nombre y el rol.
CREATE TABLE IF NOT EXISTS public.perfiles (
  id                  uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  nombre              text NOT NULL DEFAULT '',
  email               text NOT NULL DEFAULT '',
  rol                 text NOT NULL DEFAULT 'vendedor' CHECK (rol IN ('admin', 'vendedor')),
  activo              boolean NOT NULL DEFAULT true,
  creado_en           timestamptz NOT NULL DEFAULT now()
);

-- Solo se puede registrar quien fue invitado por un administrador.
-- Asi el link puede ser publico sin que entre cualquiera.
CREATE TABLE IF NOT EXISTS public.invitaciones (
  email       text PRIMARY KEY,
  nombre      text NOT NULL DEFAULT '',
  rol         text NOT NULL DEFAULT 'vendedor' CHECK (rol IN ('admin', 'vendedor')),
  creado_por  uuid REFERENCES public.perfiles (id) ON DELETE SET NULL,
  creado_en   timestamptz NOT NULL DEFAULT now(),
  usada_en    timestamptz
);

-- ---------------------------------------------------------------------
-- Vehiculos
-- ---------------------------------------------------------------------

-- Un vehiculo se identifica por su dominio (patente). Puede entrar al sistema
-- como auto vendido (propio o en consigna) o como permuta del comprador.
CREATE TABLE IF NOT EXISTS public.vehiculos (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dominio               text NOT NULL UNIQUE,
  marca                 text NOT NULL DEFAULT '',
  modelo                text NOT NULL DEFAULT '',
  version               text NOT NULL DEFAULT '',
  anio                  integer,
  color                 text NOT NULL DEFAULT '',
  kilometraje           integer,
  nro_chasis            text NOT NULL DEFAULT '',
  nro_motor             text NOT NULL DEFAULT '',
  tenencia              text NOT NULL DEFAULT 'propio' CHECK (tenencia IN ('propio', 'consigna')),
  consignante_nombre    text NOT NULL DEFAULT '',
  consignante_contacto  text NOT NULL DEFAULT '',
  descripcion           text NOT NULL DEFAULT '',
  creado_en             timestamptz NOT NULL DEFAULT now(),
  actualizado_en        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Ventas
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.ventas (
  id                      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fecha_venta             date NOT NULL,
  vendedor_id             uuid NOT NULL REFERENCES public.perfiles (id),
  vehiculo_id             bigint NOT NULL REFERENCES public.vehiculos (id),
  cliente_nombre          text NOT NULL,
  cliente_documento       text NOT NULL DEFAULT '',
  cliente_telefono        text NOT NULL DEFAULT '',
  cliente_email           text NOT NULL DEFAULT '',
  precio_venta            numeric(14, 2),
  moneda                  text NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
  forma_pago              text NOT NULL DEFAULT '',
  sena                    numeric(14, 2),
  estado                  text NOT NULL DEFAULT 'pendiente'
                          CHECK (estado IN ('pendiente', 'en_preparacion', 'listo_entrega', 'entregado', 'cancelado')),
  fecha_entrega_estimada  date,
  fecha_entrega_real      date,
  detalles                text NOT NULL DEFAULT '',
  creado_por              uuid REFERENCES public.perfiles (id),
  creado_en               timestamptz NOT NULL DEFAULT now(),
  actualizado_en          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ventas_vendedor ON public.ventas (vendedor_id);
CREATE INDEX IF NOT EXISTS idx_ventas_vehiculo ON public.ventas (vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_ventas_fecha ON public.ventas (fecha_venta DESC);
CREATE INDEX IF NOT EXISTS idx_ventas_estado ON public.ventas (estado);

-- Un mismo dominio no puede estar en dos ventas abiertas a la vez.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ventas_vehiculo_activo
  ON public.ventas (vehiculo_id) WHERE estado <> 'cancelado';

-- ---------------------------------------------------------------------
-- Permutas: el auto que entrega el comprador, atado a la venta que compra
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.permutas (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venta_id      bigint NOT NULL REFERENCES public.ventas (id) ON DELETE CASCADE,
  vehiculo_id   bigint NOT NULL REFERENCES public.vehiculos (id),
  valor_tomado  numeric(14, 2),
  moneda        text NOT NULL DEFAULT 'ARS' CHECK (moneda IN ('ARS', 'USD')),
  observaciones text NOT NULL DEFAULT '',
  creado_en     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (venta_id, vehiculo_id)
);

CREATE INDEX IF NOT EXISTS idx_permutas_venta ON public.permutas (venta_id);
CREATE INDEX IF NOT EXISTS idx_permutas_vehiculo ON public.permutas (vehiculo_id);

-- ---------------------------------------------------------------------
-- Documentacion
-- ---------------------------------------------------------------------

-- Checklist que se genera solo para el auto vendido y para cada permuta.
CREATE TABLE IF NOT EXISTS public.documentos (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venta_id        bigint NOT NULL REFERENCES public.ventas (id) ON DELETE CASCADE,
  vehiculo_id     bigint NOT NULL REFERENCES public.vehiculos (id),
  rol             text NOT NULL DEFAULT 'venta' CHECK (rol IN ('venta', 'permuta')),
  tipo            text NOT NULL,
  estado          text NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente', 'en_tramite', 'ok', 'no_aplica')),
  observaciones   text NOT NULL DEFAULT '',
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid REFERENCES public.perfiles (id),
  UNIQUE (venta_id, vehiculo_id, tipo)
);

CREATE INDEX IF NOT EXISTS idx_documentos_venta ON public.documentos (venta_id);
CREATE INDEX IF NOT EXISTS idx_documentos_vehiculo ON public.documentos (vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_documentos_estado ON public.documentos (estado);

-- Archivos subidos. El contenido vive en Storage; aca queda la referencia.
CREATE TABLE IF NOT EXISTS public.archivos (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  documento_id    bigint NOT NULL REFERENCES public.documentos (id) ON DELETE CASCADE,
  nombre_original text NOT NULL,
  ruta            text NOT NULL,
  mime            text NOT NULL DEFAULT 'application/octet-stream',
  tamano          bigint NOT NULL DEFAULT 0,
  subido_por      uuid REFERENCES public.perfiles (id),
  subido_en       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_archivos_documento ON public.archivos (documento_id);

-- ---------------------------------------------------------------------
-- Detalles extras de la operacion
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.notas (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venta_id   bigint NOT NULL REFERENCES public.ventas (id) ON DELETE CASCADE,
  usuario_id uuid REFERENCES public.perfiles (id),
  texto      text NOT NULL,
  creado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notas_venta ON public.notas (venta_id);

-- ---------------------------------------------------------------------
-- Historial de cambios
-- ---------------------------------------------------------------------

-- Lo escriben disparadores de la base, no la web: aunque alguien toque los
-- datos por otro lado, el cambio queda registrado igual.
CREATE TABLE IF NOT EXISTS public.auditoria (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entidad        text NOT NULL,
  entidad_id     text,
  venta_id       bigint,
  accion         text NOT NULL CHECK (accion IN ('crear', 'editar', 'borrar')),
  resumen        text NOT NULL DEFAULT '',
  antes          jsonb,
  despues        jsonb,
  usuario_id     uuid,
  usuario_nombre text NOT NULL DEFAULT 'Sistema',
  creado_en      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auditoria_venta ON public.auditoria (venta_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_fecha ON public.auditoria (creado_en DESC);

-- ---------------------------------------------------------------------
-- Borradores de formularios a medio completar
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.borradores (
  usuario_id     uuid NOT NULL REFERENCES public.perfiles (id) ON DELETE CASCADE,
  clave          text NOT NULL,
  contenido      jsonb NOT NULL,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, clave)
);

-- ---------------------------------------------------------------------
-- Contador global de cambios (para avisar que otro cargo algo)
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.estado_datos (
  id        smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version   bigint NOT NULL DEFAULT 0,
  cambio_en timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.estado_datos (id, version) VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- ===== 02-seguridad.sql =====
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

-- ===== 03-funciones.sql =====
-- Engel · Funciones de negocio
-- =====================================================================
-- La web llama a estas funciones en vez de tocar las tablas directamente.
-- Asi las validaciones y las transacciones viven en la base, donde nadie
-- las puede saltear desde el navegador.
-- Son SECURITY INVOKER: siguen mandando las politicas de acceso.

-- ---------------------------------------------------------------------
-- Dominios (patentes)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalizar_dominio(p_dominio text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT upper(regexp_replace(COALESCE(p_dominio, ''), '[^A-Za-z0-9]', '', 'g')) $$;

-- Acepta el formato viejo (AAA123), el del Mercosur (AB123CD) y el de motos.
CREATE OR REPLACE FUNCTION public.dominio_valido(p_dominio text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$
  SELECT public.normalizar_dominio(p_dominio) ~ '^([A-Z]{3}[0-9]{3}|[A-Z]{2}[0-9]{3}[A-Z]{2}|[A-Z][0-9]{3}[A-Z]{3})$'
$$;

-- ---------------------------------------------------------------------
-- Ayudas internas
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.exigir_miembro()
RETURNS void LANGUAGE plpgsql STABLE
AS $$
BEGIN
  IF NOT public.es_miembro() THEN
    RAISE EXCEPTION 'Tu usuario todavia no fue habilitado. Pedile a un administrador que te invite.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tipos_documento()
RETURNS text[] LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY['titulo','dominio','multas','patentes','form_08','cedula','verificacion_policial','vtv']::text[] $$;

-- Texto recortado, nunca nulo.
CREATE OR REPLACE FUNCTION public.txt(p jsonb, p_clave text, p_largo integer DEFAULT 200)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT left(COALESCE(trim(p ->> p_clave), ''), p_largo) $$;

-- ---------------------------------------------------------------------
-- Vehiculos
-- ---------------------------------------------------------------------

-- Crea el vehiculo si el dominio es nuevo. Si ya existe, completa los campos
-- que vengan y deja como estaban los que no: guardar un dato no borra el resto.
CREATE OR REPLACE FUNCTION public.guardar_vehiculo(p_datos jsonb)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_dominio text := public.normalizar_dominio(p_datos ->> 'dominio');
  v_id bigint;
  v_tenencia text;
BEGIN
  IF v_dominio = '' THEN
    RAISE EXCEPTION 'El dominio (patente) es obligatorio.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.dominio_valido(v_dominio) THEN
    RAISE EXCEPTION 'El dominio "%" no tiene un formato valido. Ejemplos: AAA123, AB123CD.', p_datos ->> 'dominio'
      USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id FROM public.vehiculos WHERE dominio = v_dominio;

  IF v_id IS NULL THEN
    v_tenencia := COALESCE(NULLIF(p_datos ->> 'tenencia', ''), 'propio');
    IF v_tenencia = 'consigna' AND public.txt(p_datos, 'consignante_nombre', 150) = '' THEN
      RAISE EXCEPTION 'Si el auto esta en consigna tenes que indicar el nombre del consignante.'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.vehiculos (
      dominio, marca, modelo, version, anio, color, kilometraje, nro_chasis, nro_motor,
      tenencia, consignante_nombre, consignante_contacto, descripcion
    ) VALUES (
      v_dominio,
      public.txt(p_datos, 'marca', 80),
      public.txt(p_datos, 'modelo', 80),
      public.txt(p_datos, 'version', 120),
      NULLIF(p_datos ->> 'anio', '')::integer,
      public.txt(p_datos, 'color', 60),
      NULLIF(p_datos ->> 'kilometraje', '')::integer,
      public.txt(p_datos, 'nro_chasis', 60),
      public.txt(p_datos, 'nro_motor', 60),
      v_tenencia,
      public.txt(p_datos, 'consignante_nombre', 150),
      public.txt(p_datos, 'consignante_contacto', 150),
      public.txt(p_datos, 'descripcion', 500)
    )
    RETURNING id INTO v_id;
  ELSE
    -- Solo se pisan los campos que vienen con algo.
    UPDATE public.vehiculos SET
      marca = CASE WHEN public.txt(p_datos, 'marca', 80) <> '' THEN public.txt(p_datos, 'marca', 80) ELSE marca END,
      modelo = CASE WHEN public.txt(p_datos, 'modelo', 80) <> '' THEN public.txt(p_datos, 'modelo', 80) ELSE modelo END,
      version = CASE WHEN public.txt(p_datos, 'version', 120) <> '' THEN public.txt(p_datos, 'version', 120) ELSE version END,
      anio = COALESCE(NULLIF(p_datos ->> 'anio', '')::integer, anio),
      color = CASE WHEN public.txt(p_datos, 'color', 60) <> '' THEN public.txt(p_datos, 'color', 60) ELSE color END,
      kilometraje = COALESCE(NULLIF(p_datos ->> 'kilometraje', '')::integer, kilometraje),
      nro_chasis = CASE WHEN public.txt(p_datos, 'nro_chasis', 60) <> '' THEN public.txt(p_datos, 'nro_chasis', 60) ELSE nro_chasis END,
      nro_motor = CASE WHEN public.txt(p_datos, 'nro_motor', 60) <> '' THEN public.txt(p_datos, 'nro_motor', 60) ELSE nro_motor END,
      tenencia = COALESCE(NULLIF(p_datos ->> 'tenencia', ''), tenencia),
      consignante_nombre = CASE WHEN public.txt(p_datos, 'consignante_nombre', 150) <> '' THEN public.txt(p_datos, 'consignante_nombre', 150) ELSE consignante_nombre END,
      consignante_contacto = CASE WHEN public.txt(p_datos, 'consignante_contacto', 150) <> '' THEN public.txt(p_datos, 'consignante_contacto', 150) ELSE consignante_contacto END,
      descripcion = CASE WHEN public.txt(p_datos, 'descripcion', 500) <> '' THEN public.txt(p_datos, 'descripcion', 500) ELSE descripcion END
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

-- Actualiza campo por campo: lo que no viene en p_datos no se toca.
CREATE OR REPLACE FUNCTION public.actualizar_vehiculo(p_id bigint, p_datos jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  clave text;
  permitidos text[] := ARRAY['marca','modelo','version','anio','color','kilometraje',
                             'nro_chasis','nro_motor','tenencia','consignante_nombre',
                             'consignante_contacto','descripcion'];
BEGIN
  FOR clave IN SELECT jsonb_object_keys(p_datos) LOOP
    IF NOT (clave = ANY (permitidos)) THEN CONTINUE; END IF;

    IF clave IN ('anio', 'kilometraje') THEN
      EXECUTE format('UPDATE public.vehiculos SET %I = $1 WHERE id = $2', clave)
        USING NULLIF(p_datos ->> clave, '')::integer, p_id;
    ELSIF clave = 'tenencia' THEN
      IF (p_datos ->> clave) NOT IN ('propio', 'consigna') THEN
        RAISE EXCEPTION 'El origen del auto tiene que ser propio o consigna.' USING ERRCODE = '22023';
      END IF;
      UPDATE public.vehiculos SET tenencia = p_datos ->> clave WHERE id = p_id;
    ELSE
      EXECUTE format('UPDATE public.vehiculos SET %I = $1 WHERE id = $2', clave)
        USING left(COALESCE(p_datos ->> clave, ''), 500), p_id;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- Checklist de documentacion
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generar_checklist(p_venta_id bigint, p_vehiculo_id bigint, p_rol text)
RETURNS void
LANGUAGE sql
AS $$
  INSERT INTO public.documentos (venta_id, vehiculo_id, rol, tipo)
  SELECT p_venta_id, p_vehiculo_id, p_rol, tipo
  FROM unnest(public.tipos_documento()) AS tipo
  ON CONFLICT (venta_id, vehiculo_id, tipo) DO NOTHING;
$$;

-- ---------------------------------------------------------------------
-- Crear una venta (todo o nada)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.crear_venta(p_datos jsonb)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_vehiculo_id bigint;
  v_venta_id bigint;
  v_vendedor uuid;
  permuta jsonb;
  v_permuta_id bigint;
  v_dominio_vendido text;
  dominios text[] := ARRAY[]::text[];
  d text;
BEGIN
  PERFORM public.exigir_miembro();

  v_vendedor := NULLIF(p_datos ->> 'vendedor_id', '')::uuid;
  IF v_vendedor IS NULL THEN
    RAISE EXCEPTION 'Tenes que elegir quien vendio el auto.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.perfiles WHERE id = v_vendedor) THEN
    RAISE EXCEPTION 'El vendedor elegido no existe.' USING ERRCODE = '22023';
  END IF;
  IF public.txt(p_datos, 'cliente_nombre', 150) = '' THEN
    RAISE EXCEPTION 'El nombre del cliente es obligatorio.' USING ERRCODE = '22023';
  END IF;

  v_dominio_vendido := public.normalizar_dominio(p_datos -> 'vehiculo' ->> 'dominio');

  -- Las permutas se revisan antes de tocar nada.
  FOR permuta IN SELECT * FROM jsonb_array_elements(COALESCE(p_datos -> 'permutas', '[]'::jsonb)) LOOP
    d := public.normalizar_dominio(permuta ->> 'dominio');
    IF d = v_dominio_vendido THEN
      RAISE EXCEPTION 'La permuta no puede tener el mismo dominio que el auto vendido.' USING ERRCODE = '22023';
    END IF;
    IF d = ANY (dominios) THEN
      RAISE EXCEPTION 'Hay dos permutas con el mismo dominio en la misma venta.' USING ERRCODE = '22023';
    END IF;
    dominios := dominios || d;
  END LOOP;

  v_vehiculo_id := public.guardar_vehiculo(p_datos -> 'vehiculo');

  IF EXISTS (
    SELECT 1 FROM public.ventas WHERE vehiculo_id = v_vehiculo_id AND estado <> 'cancelado'
  ) THEN
    RAISE EXCEPTION 'El dominio % ya figura en una venta abierta. Si es un error, cancela esa venta antes de cargar una nueva.', v_dominio_vendido
      USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.ventas (
    fecha_venta, vendedor_id, vehiculo_id, cliente_nombre, cliente_documento,
    cliente_telefono, cliente_email, precio_venta, moneda, forma_pago, sena,
    estado, fecha_entrega_estimada, fecha_entrega_real, detalles, creado_por
  ) VALUES (
    COALESCE(NULLIF(p_datos ->> 'fecha_venta', '')::date, current_date),
    v_vendedor,
    v_vehiculo_id,
    public.txt(p_datos, 'cliente_nombre', 150),
    public.txt(p_datos, 'cliente_documento', 40),
    public.txt(p_datos, 'cliente_telefono', 60),
    lower(public.txt(p_datos, 'cliente_email', 200)),
    NULLIF(p_datos ->> 'precio_venta', '')::numeric,
    COALESCE(NULLIF(p_datos ->> 'moneda', ''), 'ARS'),
    public.txt(p_datos, 'forma_pago', 120),
    NULLIF(p_datos ->> 'sena', '')::numeric,
    COALESCE(NULLIF(p_datos ->> 'estado', ''), 'pendiente'),
    NULLIF(p_datos ->> 'fecha_entrega_estimada', '')::date,
    NULLIF(p_datos ->> 'fecha_entrega_real', '')::date,
    left(COALESCE(p_datos ->> 'detalles', ''), 4000),
    auth.uid()
  )
  RETURNING id INTO v_venta_id;

  PERFORM public.generar_checklist(v_venta_id, v_vehiculo_id, 'venta');

  FOR permuta IN SELECT * FROM jsonb_array_elements(COALESCE(p_datos -> 'permutas', '[]'::jsonb)) LOOP
    v_permuta_id := public.guardar_vehiculo(permuta);
    INSERT INTO public.permutas (venta_id, vehiculo_id, valor_tomado, moneda, observaciones)
    VALUES (
      v_venta_id, v_permuta_id,
      NULLIF(permuta ->> 'valor_tomado', '')::numeric,
      COALESCE(NULLIF(permuta ->> 'moneda', ''), 'ARS'),
      public.txt(permuta, 'observaciones', 500)
    );
    PERFORM public.generar_checklist(v_venta_id, v_permuta_id, 'permuta');
  END LOOP;

  -- El historial lo escriben los disparadores; aca solo se mejora el resumen.
  PERFORM public.anotar('venta', v_venta_id::text, v_venta_id, 'crear',
    format('Se cargo la venta de %s a %s', v_dominio_vendido, public.txt(p_datos, 'cliente_nombre', 150)));

  RETURN v_venta_id;
END;
$$;

-- ---------------------------------------------------------------------
-- Editar una venta campo por campo
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.actualizar_venta(p_id bigint, p_datos jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  clave text;
  v_vehiculo_id bigint;
  textos text[] := ARRAY['cliente_nombre','cliente_documento','cliente_telefono',
                         'cliente_email','forma_pago','detalles'];
  fechas text[] := ARRAY['fecha_venta','fecha_entrega_estimada','fecha_entrega_real'];
  numeros text[] := ARRAY['precio_venta','sena'];
  listas text[] := ARRAY['estado','moneda'];
BEGIN
  PERFORM public.exigir_miembro();

  SELECT vehiculo_id INTO v_vehiculo_id FROM public.ventas WHERE id = p_id;
  IF v_vehiculo_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro la venta.' USING ERRCODE = 'P0002';
  END IF;

  FOR clave IN SELECT jsonb_object_keys(p_datos) LOOP
    IF clave = 'vehiculo' THEN
      PERFORM public.actualizar_vehiculo(v_vehiculo_id, p_datos -> 'vehiculo');

    ELSIF clave = 'vendedor_id' THEN
      UPDATE public.ventas SET vendedor_id = (p_datos ->> clave)::uuid WHERE id = p_id;

    ELSIF clave = ANY (textos) THEN
      EXECUTE format('UPDATE public.ventas SET %I = $1 WHERE id = $2', clave)
        USING left(COALESCE(p_datos ->> clave, ''), 4000), p_id;

    ELSIF clave = ANY (fechas) THEN
      EXECUTE format('UPDATE public.ventas SET %I = $1 WHERE id = $2', clave)
        USING NULLIF(p_datos ->> clave, '')::date, p_id;

    ELSIF clave = ANY (numeros) THEN
      EXECUTE format('UPDATE public.ventas SET %I = $1 WHERE id = $2', clave)
        USING NULLIF(p_datos ->> clave, '')::numeric, p_id;

    ELSIF clave = ANY (listas) THEN
      EXECUTE format('UPDATE public.ventas SET %I = $1 WHERE id = $2', clave)
        USING p_datos ->> clave, p_id;
    END IF;
  END LOOP;
END;
$$;

-- ---------------------------------------------------------------------
-- Permutas
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.agregar_permuta(p_venta_id bigint, p_datos jsonb)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_vehiculo_id bigint;
  v_vendido text;
BEGIN
  PERFORM public.exigir_miembro();

  SELECT v.dominio INTO v_vendido
  FROM public.ventas ve JOIN public.vehiculos v ON v.id = ve.vehiculo_id
  WHERE ve.id = p_venta_id;

  IF v_vendido IS NULL THEN
    RAISE EXCEPTION 'No se encontro la venta.' USING ERRCODE = 'P0002';
  END IF;
  IF public.normalizar_dominio(p_datos ->> 'dominio') = v_vendido THEN
    RAISE EXCEPTION 'La permuta no puede tener el mismo dominio que el auto vendido.' USING ERRCODE = '22023';
  END IF;

  v_vehiculo_id := public.guardar_vehiculo(p_datos);

  IF EXISTS (SELECT 1 FROM public.permutas WHERE venta_id = p_venta_id AND vehiculo_id = v_vehiculo_id) THEN
    RAISE EXCEPTION 'Esa permuta ya esta vinculada a esta venta.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.permutas (venta_id, vehiculo_id, valor_tomado, moneda, observaciones)
  VALUES (
    p_venta_id, v_vehiculo_id,
    NULLIF(p_datos ->> 'valor_tomado', '')::numeric,
    COALESCE(NULLIF(p_datos ->> 'moneda', ''), 'ARS'),
    public.txt(p_datos, 'observaciones', 500)
  );

  PERFORM public.generar_checklist(p_venta_id, v_vehiculo_id, 'permuta');
  RETURN v_vehiculo_id;
END;
$$;

-- Devuelve las rutas de los archivos borrados, para sacarlos de Storage.
CREATE OR REPLACE FUNCTION public.quitar_permuta(p_permuta_id bigint)
RETURNS text[]
LANGUAGE plpgsql
AS $$
DECLARE
  v_venta_id bigint;
  v_vehiculo_id bigint;
  v_rutas text[];
BEGIN
  PERFORM public.exigir_miembro();

  SELECT venta_id, vehiculo_id INTO v_venta_id, v_vehiculo_id
  FROM public.permutas WHERE id = p_permuta_id;

  IF v_venta_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro la permuta.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(array_agg(a.ruta), ARRAY[]::text[]) INTO v_rutas
  FROM public.archivos a
  JOIN public.documentos d ON d.id = a.documento_id
  WHERE d.venta_id = v_venta_id AND d.vehiculo_id = v_vehiculo_id;

  DELETE FROM public.documentos WHERE venta_id = v_venta_id AND vehiculo_id = v_vehiculo_id;
  DELETE FROM public.permutas WHERE id = p_permuta_id;

  RETURN v_rutas;
END;
$$;

CREATE OR REPLACE FUNCTION public.borrar_venta(p_id bigint)
RETURNS text[]
LANGUAGE plpgsql
AS $$
DECLARE
  v_rutas text[];
  v_copia jsonb;
BEGIN
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede borrar una venta.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(a.ruta), ARRAY[]::text[]) INTO v_rutas
  FROM public.archivos a
  JOIN public.documentos d ON d.id = a.documento_id
  WHERE d.venta_id = p_id;

  -- Copia completa de la operacion, para poder reconstruirla si hizo falta.
  SELECT jsonb_build_object(
    'venta', to_jsonb(v),
    'vehiculo', to_jsonb(ve),
    'permutas', COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM public.permutas p WHERE p.venta_id = v.id), '[]'::jsonb),
    'documentos', COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM public.documentos d WHERE d.venta_id = v.id), '[]'::jsonb),
    'notas', COALESCE((SELECT jsonb_agg(to_jsonb(n)) FROM public.notas n WHERE n.venta_id = v.id), '[]'::jsonb)
  ) INTO v_copia
  FROM public.ventas v JOIN public.vehiculos ve ON ve.id = v.vehiculo_id
  WHERE v.id = p_id;

  IF v_copia IS NULL THEN
    RAISE EXCEPTION 'No se encontro la venta.' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.ventas WHERE id = p_id;

  PERFORM public.anotar('venta', p_id::text, p_id, 'borrar',
    format('Se borro la venta #%s de %s', p_id, v_copia -> 'vehiculo' ->> 'dominio'),
    v_copia, NULL);

  RETURN v_rutas;
END;
$$;

-- ===== 04-consultas.sql =====
-- Engel · Consultas que arma la base y consume la web
-- =====================================================================
-- Devuelven JSON ya armado para que la pantalla no tenga que hacer diez
-- pedidos por cada venta.

CREATE OR REPLACE FUNCTION public.etiqueta_documento(p_tipo text)
RETURNS text LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE p_tipo
    WHEN 'titulo' THEN 'Titulo'
    WHEN 'dominio' THEN 'Informe de dominio'
    WHEN 'multas' THEN 'Multas'
    WHEN 'patentes' THEN 'Patentes'
    WHEN 'form_08' THEN 'Formulario 08'
    WHEN 'cedula' THEN 'Cedula'
    WHEN 'verificacion_policial' THEN 'Verificacion policial'
    WHEN 'vtv' THEN 'VTV'
    ELSE p_tipo
  END
$$;

CREATE OR REPLACE FUNCTION public.orden_documento(p_tipo text)
RETURNS integer LANGUAGE sql IMMUTABLE
AS $$ SELECT COALESCE(array_position(public.tipos_documento(), p_tipo), 99) $$;

-- ---------------------------------------------------------------------
-- Documentacion de una venta, agrupada por auto
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.documentacion_de_venta(p_venta_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(jsonb_agg(grupo ORDER BY (grupo ->> 'rol') <> 'venta', grupo ->> 'dominio'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'vehiculo_id', v.id,
      'dominio', v.dominio,
      'rol', min(d.rol),
      'tenencia', min(v.tenencia),
      'descripcion', COALESCE(
        NULLIF(trim(concat_ws(' ', min(v.marca), min(v.modelo), min(v.anio)::text)), ''),
        min(v.descripcion)
      ),
      'total', count(*),
      'listos', count(*) FILTER (WHERE d.estado IN ('ok', 'no_aplica')),
      'items', jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'venta_id', d.venta_id,
          'vehiculo_id', d.vehiculo_id,
          'rol', d.rol,
          'tipo', d.tipo,
          'etiqueta', public.etiqueta_documento(d.tipo),
          'estado', d.estado,
          'observaciones', d.observaciones,
          'actualizado_en', d.actualizado_en,
          'actualizado_por_nombre', pa.nombre,
          'dominio', v.dominio,
          'archivos', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', a.id,
              'nombre_original', a.nombre_original,
              'ruta', a.ruta,
              'mime', a.mime,
              'tamano', a.tamano,
              'subido_en', a.subido_en,
              'subido_por', a.subido_por,
              'subido_por_nombre', ps.nombre
            ) ORDER BY a.id DESC)
            FROM public.archivos a
            LEFT JOIN public.perfiles ps ON ps.id = a.subido_por
            WHERE a.documento_id = d.id
          ), '[]'::jsonb)
        ) ORDER BY public.orden_documento(d.tipo)
      )
    ) AS grupo
    FROM public.documentos d
    JOIN public.vehiculos v ON v.id = d.vehiculo_id
    LEFT JOIN public.perfiles pa ON pa.id = d.actualizado_por
    WHERE d.venta_id = p_venta_id
    GROUP BY v.id
  ) AS grupos;
$$;

-- ---------------------------------------------------------------------
-- Ficha completa de una venta
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.venta_completa(p_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT to_jsonb(v)
    || jsonb_build_object(
      'vendedor_nombre', pv.nombre,
      'vendedor_email', pv.email,
      'creado_por_nombre', pc.nombre,
      'vehiculo', to_jsonb(ve),
      'permutas', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'valor_tomado', p.valor_tomado,
            'moneda', p.moneda,
            'observaciones', p.observaciones,
            'creado_en', p.creado_en,
            'vehiculo_id', vp.id,
            'dominio', vp.dominio,
            'marca', vp.marca,
            'modelo', vp.modelo,
            'version', vp.version,
            'anio', vp.anio,
            'color', vp.color,
            'kilometraje', vp.kilometraje,
            'nro_chasis', vp.nro_chasis,
            'nro_motor', vp.nro_motor,
            'descripcion', vp.descripcion
          ) ORDER BY p.id)
        FROM public.permutas p JOIN public.vehiculos vp ON vp.id = p.vehiculo_id
        WHERE p.venta_id = v.id
      ), '[]'::jsonb),
      'notas', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', n.id, 'texto', n.texto, 'creado_en', n.creado_en,
            'usuario_id', n.usuario_id, 'autor', pn.nombre
          ) ORDER BY n.id DESC)
        FROM public.notas n LEFT JOIN public.perfiles pn ON pn.id = n.usuario_id
        WHERE n.venta_id = v.id
      ), '[]'::jsonb),
      'documentacion', public.documentacion_de_venta(v.id)
    )
  FROM public.ventas v
  JOIN public.vehiculos ve ON ve.id = v.vehiculo_id
  JOIN public.perfiles pv ON pv.id = v.vendedor_id
  LEFT JOIN public.perfiles pc ON pc.id = v.creado_por
  WHERE v.id = p_id;
$$;

-- ---------------------------------------------------------------------
-- Listado de ventas con filtros
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.listar_ventas(p_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_q text := NULLIF(trim(COALESCE(p_filtros ->> 'q', '')), '');
  v_q_dominio text := public.normalizar_dominio(COALESCE(p_filtros ->> 'q', ''));
  v_estado text := NULLIF(p_filtros ->> 'estado', '');
  v_vendedor uuid := NULLIF(p_filtros ->> 'vendedor_id', '')::uuid;
  v_tenencia text := NULLIF(p_filtros ->> 'tenencia', '');
  v_desde date := NULLIF(p_filtros ->> 'desde', '')::date;
  v_hasta date := NULLIF(p_filtros ->> 'hasta', '')::date;
  v_vencidas boolean := COALESCE(p_filtros ->> 'entrega_vencida', '') IN ('true', '1');
  v_limite integer := LEAST(GREATEST(COALESCE(NULLIF(p_filtros ->> 'limite', '')::integer, 50), 1), 500);
  v_pagina integer := GREATEST(COALESCE(NULLIF(p_filtros ->> 'pagina', '')::integer, 1), 1);
  v_resultado jsonb;
BEGIN
  WITH filtradas AS (
    SELECT v.id, v.fecha_venta
    FROM public.ventas v
    JOIN public.vehiculos ve ON ve.id = v.vehiculo_id
    JOIN public.perfiles pv ON pv.id = v.vendedor_id
    WHERE (v_q IS NULL OR (
            ve.dominio LIKE '%' || v_q_dominio || '%'
            OR ve.marca ILIKE '%' || v_q || '%'
            OR ve.modelo ILIKE '%' || v_q || '%'
            OR ve.descripcion ILIKE '%' || v_q || '%'
            OR v.cliente_nombre ILIKE '%' || v_q || '%'
            OR v.cliente_documento ILIKE '%' || v_q || '%'
            OR pv.nombre ILIKE '%' || v_q || '%'
            OR EXISTS (
              SELECT 1 FROM public.permutas p JOIN public.vehiculos vp ON vp.id = p.vehiculo_id
              WHERE p.venta_id = v.id AND vp.dominio LIKE '%' || v_q_dominio || '%'
            )))
      AND (v_estado IS NULL OR v.estado = v_estado)
      AND (v_vendedor IS NULL OR v.vendedor_id = v_vendedor)
      AND (v_tenencia IS NULL OR ve.tenencia = v_tenencia)
      AND (v_desde IS NULL OR v.fecha_venta >= v_desde)
      AND (v_hasta IS NULL OR v.fecha_venta <= v_hasta)
      AND (NOT v_vencidas OR (
            v.fecha_entrega_estimada IS NOT NULL
            AND v.fecha_entrega_estimada < current_date
            AND v.estado NOT IN ('entregado', 'cancelado')))
  ),
  pagina AS (
    SELECT id FROM filtradas
    ORDER BY fecha_venta DESC, id DESC
    LIMIT v_limite OFFSET (v_pagina - 1) * v_limite
  ),
  filas AS (
    SELECT
      v.fecha_venta,
      v.id,
      jsonb_build_object(
        'id', v.id, 'fecha_venta', v.fecha_venta, 'estado', v.estado,
        'precio_venta', v.precio_venta, 'moneda', v.moneda, 'forma_pago', v.forma_pago,
        'cliente_nombre', v.cliente_nombre, 'cliente_telefono', v.cliente_telefono,
        'fecha_entrega_estimada', v.fecha_entrega_estimada,
        'fecha_entrega_real', v.fecha_entrega_real,
        'detalles', v.detalles, 'creado_en', v.creado_en,
        'vendedor_id', v.vendedor_id, 'vendedor_nombre', pv.nombre,
        'vehiculo_id', ve.id, 'dominio', ve.dominio, 'marca', ve.marca, 'modelo', ve.modelo,
        'version', ve.version, 'anio', ve.anio, 'color', ve.color, 'kilometraje', ve.kilometraje,
        'tenencia', ve.tenencia, 'consignante_nombre', ve.consignante_nombre,
        'descripcion', ve.descripcion,
        'cantidad_permutas', (SELECT count(*) FROM public.permutas p WHERE p.venta_id = v.id),
        'documentos_total', (SELECT count(*) FROM public.documentos d WHERE d.venta_id = v.id),
        'documentos_listos', (SELECT count(*) FROM public.documentos d
                                WHERE d.venta_id = v.id AND d.estado IN ('ok', 'no_aplica'))
      ) AS fila
    FROM pagina pg
    JOIN public.ventas v ON v.id = pg.id
    JOIN public.vehiculos ve ON ve.id = v.vehiculo_id
    JOIN public.perfiles pv ON pv.id = v.vendedor_id
  )
  SELECT jsonb_build_object(
    'total', (SELECT count(*) FROM filtradas),
    'pagina', v_pagina,
    'limite', v_limite,
    'paginas', GREATEST(ceil((SELECT count(*) FROM filtradas)::numeric / v_limite)::integer, 1),
    'ventas', COALESCE((SELECT jsonb_agg(fila ORDER BY fecha_venta DESC, id DESC) FROM filas), '[]'::jsonb)
  )
  INTO v_resultado;

  RETURN v_resultado;
END;
$$;

-- Todas las ventas que cumplen el filtro, sin paginar (para exportar).
CREATE OR REPLACE FUNCTION public.listar_ventas_completo(p_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT public.listar_ventas(p_filtros || jsonb_build_object('limite', 500, 'pagina', 1)) -> 'ventas';
$$;

-- ---------------------------------------------------------------------
-- Buscar por dominio
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.buscar_dominio(p_dominio text)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_object(
    'vehiculo', to_jsonb(v),
    'ventas', COALESCE((
      SELECT jsonb_agg(fila ORDER BY fila ->> 'fecha_venta' DESC)
      FROM (
        SELECT jsonb_build_object(
          'id', ve.id, 'fecha_venta', ve.fecha_venta, 'estado', ve.estado,
          'cliente_nombre', ve.cliente_nombre,
          'fecha_entrega_estimada', ve.fecha_entrega_estimada,
          'vendedor_nombre', p.nombre, 'rol', 'venta'
        ) AS fila
        FROM public.ventas ve JOIN public.perfiles p ON p.id = ve.vendedor_id
        WHERE ve.vehiculo_id = v.id
        UNION ALL
        SELECT jsonb_build_object(
          'id', ve.id, 'fecha_venta', ve.fecha_venta, 'estado', ve.estado,
          'cliente_nombre', ve.cliente_nombre,
          'fecha_entrega_estimada', ve.fecha_entrega_estimada,
          'vendedor_nombre', p.nombre, 'rol', 'permuta'
        )
        FROM public.permutas pe
        JOIN public.ventas ve ON ve.id = pe.venta_id
        JOIN public.perfiles p ON p.id = ve.vendedor_id
        WHERE pe.vehiculo_id = v.id
      ) AS todas
    ), '[]'::jsonb),
    'documentos', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', d.id, 'venta_id', d.venta_id, 'rol', d.rol, 'tipo', d.tipo,
          'etiqueta', public.etiqueta_documento(d.tipo), 'estado', d.estado,
          'observaciones', d.observaciones, 'actualizado_en', d.actualizado_en,
          'archivos', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'id', a.id, 'nombre_original', a.nombre_original, 'ruta', a.ruta,
              'mime', a.mime, 'tamano', a.tamano, 'subido_en', a.subido_en
            ) ORDER BY a.id DESC)
            FROM public.archivos a WHERE a.documento_id = d.id
          ), '[]'::jsonb)
        ) ORDER BY d.venta_id, public.orden_documento(d.tipo))
      FROM public.documentos d WHERE d.vehiculo_id = v.id
    ), '[]'::jsonb)
  )
  FROM public.vehiculos v
  WHERE v.dominio = public.normalizar_dominio(p_dominio);
$$;

-- ---------------------------------------------------------------------
-- Panel de documentacion pendiente
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.panel_documentacion(
  p_solo_pendientes boolean DEFAULT true,
  p_q text DEFAULT ''
)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(jsonb_agg(fila ORDER BY orden_nulo, entrega, venta_id DESC), '[]'::jsonb)
  FROM (
    SELECT
      jsonb_build_object(
        'venta_id', d.venta_id, 'vehiculo_id', d.vehiculo_id, 'rol', min(d.rol),
        'dominio', min(ve.dominio), 'marca', min(ve.marca), 'modelo', min(ve.modelo),
        'anio', min(ve.anio), 'tenencia', min(ve.tenencia), 'descripcion', min(ve.descripcion),
        'estado_venta', min(v.estado), 'fecha_venta', min(v.fecha_venta),
        'fecha_entrega_estimada', min(v.fecha_entrega_estimada),
        'cliente_nombre', min(v.cliente_nombre), 'vendedor_nombre', min(p.nombre),
        'total', count(*),
        'listos', count(*) FILTER (WHERE d.estado IN ('ok', 'no_aplica')),
        'pendientes', count(*) FILTER (WHERE d.estado = 'pendiente'),
        'en_tramite', count(*) FILTER (WHERE d.estado = 'en_tramite'),
        'archivos', (SELECT count(*) FROM public.archivos a
                       JOIN public.documentos d2 ON d2.id = a.documento_id
                      WHERE d2.venta_id = d.venta_id AND d2.vehiculo_id = d.vehiculo_id)
      ) AS fila,
      d.venta_id,
      min(v.fecha_entrega_estimada) AS entrega,
      CASE WHEN min(v.fecha_entrega_estimada) IS NULL THEN 1 ELSE 0 END AS orden_nulo
    FROM public.documentos d
    JOIN public.vehiculos ve ON ve.id = d.vehiculo_id
    JOIN public.ventas v ON v.id = d.venta_id
    JOIN public.perfiles p ON p.id = v.vendedor_id
    WHERE v.estado <> 'cancelado'
    GROUP BY d.venta_id, d.vehiculo_id
    HAVING (NOT p_solo_pendientes OR count(*) FILTER (WHERE d.estado IN ('ok', 'no_aplica')) < count(*))
       AND (COALESCE(trim(p_q), '') = ''
            OR min(ve.dominio) LIKE '%' || public.normalizar_dominio(p_q) || '%'
            OR concat_ws(' ', min(ve.marca), min(ve.modelo), min(ve.descripcion), min(v.cliente_nombre))
               ILIKE '%' || trim(p_q) || '%')
  ) AS filas;
$$;

-- ---------------------------------------------------------------------
-- Numeros generales (sin totales por vendedor, a proposito)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.estadisticas()
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_object(
    'ventas_totales', (SELECT count(*) FROM public.ventas),
    'entregadas', (SELECT count(*) FROM public.ventas WHERE estado = 'entregado'),
    'activas', (SELECT count(*) FROM public.ventas WHERE estado NOT IN ('entregado', 'cancelado')),
    'entregas_vencidas', (SELECT count(*) FROM public.ventas
                            WHERE fecha_entrega_estimada IS NOT NULL
                              AND fecha_entrega_estimada < current_date
                              AND estado NOT IN ('entregado', 'cancelado')),
    'ventas_del_mes', (SELECT count(*) FROM public.ventas
                         WHERE fecha_venta >= date_trunc('month', current_date)),
    'documentos_pendientes', (SELECT count(*) FROM public.documentos d
                                JOIN public.ventas v ON v.id = d.venta_id
                               WHERE d.estado = 'pendiente' AND v.estado <> 'cancelado'),
    'porTenencia', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('tenencia', tenencia, 'cantidad', cantidad))
      FROM (
        SELECT ve.tenencia, count(*) AS cantidad
        FROM public.ventas v JOIN public.vehiculos ve ON ve.id = v.vehiculo_id
        WHERE v.estado <> 'cancelado'
        GROUP BY ve.tenencia
      ) AS t
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
-- Historial y copia completa
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.historial_venta(p_id bigint)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id, 'entidad', a.entidad, 'entidad_id', a.entidad_id,
      'accion', a.accion, 'resumen', a.resumen,
      'usuario_nombre', a.usuario_nombre, 'creado_en', a.creado_en
    ) ORDER BY a.id DESC), '[]'::jsonb)
  FROM public.auditoria a
  WHERE a.venta_id = p_id;
$$;

-- Copia de toda la informacion, para bajarla y guardarla aparte.
CREATE OR REPLACE FUNCTION public.exportar_todo()
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT jsonb_build_object(
    'exportado_en', now(),
    'perfiles', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.perfiles t), '[]'::jsonb),
    'vehiculos', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.vehiculos t), '[]'::jsonb),
    'ventas', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.ventas t), '[]'::jsonb),
    'permutas', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.permutas t), '[]'::jsonb),
    'documentos', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.documentos t), '[]'::jsonb),
    'archivos', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.archivos t), '[]'::jsonb),
    'notas', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.notas t), '[]'::jsonb),
    'auditoria', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.auditoria t), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
-- Permisos: solo quien inicio sesion puede llamar a estas funciones
-- ---------------------------------------------------------------------

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'crear_venta(jsonb)', 'actualizar_venta(bigint, jsonb)',
    'agregar_permuta(bigint, jsonb)', 'quitar_permuta(bigint)', 'borrar_venta(bigint)',
    'venta_completa(bigint)', 'listar_ventas(jsonb)', 'listar_ventas_completo(jsonb)',
    'buscar_dominio(text)', 'panel_documentacion(boolean, text)', 'estadisticas()',
    'historial_venta(bigint)', 'exportar_todo()', 'documentacion_de_venta(bigint)',
    'guardar_vehiculo(jsonb)', 'actualizar_vehiculo(bigint, jsonb)',
    'generar_checklist(bigint, bigint, text)', 'normalizar_dominio(text)', 'dominio_valido(text)',
    'etiqueta_documento(text)', 'es_miembro()', 'es_admin()'
  ]
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

-- ===== 05-almacenamiento.sql =====
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

-- ===== 06-permisos.sql =====
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
