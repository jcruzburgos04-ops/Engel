-- =====================================================================
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
--   5. Infracciones: cuantas multas tiene cada auto en cada municipio,
--      paginas de consulta y seguimiento del pago.
--   6. Infracciones: quien las resuelve y detalles.
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

-- Si ya habias corrido la version anterior de esta actualizacion, las multas
-- estaban cargadas una por una. Pasan a ser una fila por auto y municipio,
-- con la cantidad: se suman las de un mismo lugar y el acta, la fecha y la
-- descripcion quedan escritas en las observaciones.
DO $infracciones_por_municipio$
DECLARE
  grupo record;
BEGIN
  IF to_regclass('public.infracciones') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.infracciones ADD COLUMN IF NOT EXISTS cantidad integer NOT NULL DEFAULT 1;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'infracciones' AND column_name = 'acta') THEN
    EXECUTE $sql$
      UPDATE public.infracciones SET observaciones = concat_ws(' · ',
        NULLIF(observaciones, ''),
        CASE WHEN acta <> '' THEN 'Acta ' || acta END,
        CASE WHEN fecha IS NOT NULL THEN 'del ' || to_char(fecha, 'DD/MM/YYYY') END,
        NULLIF(descripcion, ''))
      WHERE acta <> '' OR fecha IS NOT NULL OR descripcion <> ''
    $sql$;
    ALTER TABLE public.infracciones DROP COLUMN acta, DROP COLUMN fecha, DROP COLUMN descripcion;
  END IF;

  UPDATE public.infracciones SET jurisdiccion = 'Sin especificar' WHERE btrim(jurisdiccion) = '';

  -- Un solo renglon por auto y municipio. Si alguna seguia pendiente, el
  -- renglon cuenta y suma solo las pendientes; las ya pagadas quedan
  -- anotadas en las observaciones.
  FOR grupo IN
    SELECT vehiculo_id, lower(btrim(jurisdiccion)) AS lugar, min(id) AS queda,
           CASE WHEN bool_or(estado IN ('impaga', 'en_gestion'))
                THEN (sum(cantidad) FILTER (WHERE estado IN ('impaga', 'en_gestion')))::integer
                ELSE sum(cantidad)::integer END AS cantidad,
           CASE WHEN bool_or(estado IN ('impaga', 'en_gestion'))
                THEN sum(monto) FILTER (WHERE estado IN ('impaga', 'en_gestion'))
                ELSE sum(monto) END AS monto,
           (array_agg(estado ORDER BY CASE estado WHEN 'impaga' THEN 0 WHEN 'en_gestion' THEN 1
                                                  WHEN 'pagada' THEN 2 ELSE 3 END))[1] AS estado,
           concat_ws(' | ',
             string_agg(NULLIF(observaciones, ''), ' | ' ORDER BY id),
             CASE WHEN bool_or(estado IN ('impaga', 'en_gestion'))
                       AND count(*) FILTER (WHERE estado NOT IN ('impaga', 'en_gestion')) > 0
                  THEN 'Ademas: ' || count(*) FILTER (WHERE estado NOT IN ('impaga', 'en_gestion'))
                       || ' ya pagada(s) o anulada(s)' END) AS observaciones
    FROM public.infracciones
    GROUP BY vehiculo_id, lower(btrim(jurisdiccion))
    HAVING count(*) > 1
  LOOP
    UPDATE public.infracciones_archivos a SET infraccion_id = grupo.queda
    FROM public.infracciones i
    WHERE a.infraccion_id = i.id AND i.vehiculo_id = grupo.vehiculo_id
      AND lower(btrim(i.jurisdiccion)) = grupo.lugar AND i.id <> grupo.queda;

    DELETE FROM public.infracciones
    WHERE vehiculo_id = grupo.vehiculo_id AND lower(btrim(jurisdiccion)) = grupo.lugar AND id <> grupo.queda;

    UPDATE public.infracciones
    SET cantidad = grupo.cantidad, monto = grupo.monto, estado = grupo.estado,
        observaciones = COALESCE(grupo.observaciones, '')
    WHERE id = grupo.queda;
  END LOOP;

  ALTER TABLE public.infracciones ALTER COLUMN jurisdiccion DROP DEFAULT;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'infracciones_jurisdiccion_check') THEN
    ALTER TABLE public.infracciones ADD CONSTRAINT infracciones_jurisdiccion_check
      CHECK (btrim(jurisdiccion) <> '');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'infracciones_cantidad_check') THEN
    ALTER TABLE public.infracciones ADD CONSTRAINT infracciones_cantidad_check CHECK (cantidad >= 1);
  END IF;
END
$infracciones_por_municipio$;

-- La carga de a una multa ya no se usa.
DROP FUNCTION IF EXISTS public.guardar_infraccion(jsonb);

-- ---------------------------------------------------------------------
-- Infracciones (multas de transito) de cada auto
-- ---------------------------------------------------------------------

-- Paginas de consulta de multas de cada municipio o provincia. La direccion
-- puede llevar {dominio}: si la pagina acepta la patente en el link, se
-- completa sola. Si no, la web copia la patente para pegarla.
CREATE TABLE IF NOT EXISTS public.portales_infracciones (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre         text NOT NULL CHECK (btrim(nombre) <> ''),
  url            text NOT NULL CHECK (url ~* '^https?://'),
  notas          text NOT NULL DEFAULT '',
  orden          integer NOT NULL DEFAULT 0,
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);

-- Las multas de cada auto, agrupadas por municipio: no se carga una por una,
-- sino cuantas tiene el dominio en cada lugar. Una fila por auto y municipio.
CREATE TABLE IF NOT EXISTS public.infracciones (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehiculo_id     bigint NOT NULL REFERENCES public.vehiculos (id),
  portal_id       bigint REFERENCES public.portales_infracciones (id) ON DELETE SET NULL,
  -- El municipio o provincia. Queda escrito aunque se borre la pagina.
  jurisdiccion    text NOT NULL
                  CONSTRAINT infracciones_jurisdiccion_check CHECK (btrim(jurisdiccion) <> ''),
  cantidad        integer NOT NULL DEFAULT 1
                  CONSTRAINT infracciones_cantidad_check CHECK (cantidad >= 1),
  -- Total adeudado en ese municipio, si se sabe.
  monto           numeric(14, 2) CHECK (monto IS NULL OR monto >= 0),
  -- impaga -> en gestion (descargo, plan de pago) -> pagada. Anulada si se
  -- cayeron o prescribieron.
  estado          text NOT NULL DEFAULT 'impaga'
                  CHECK (estado IN ('impaga', 'en_gestion', 'pagada', 'anulada')),
  fecha_pago      date,
  -- Quien se ocupa de resolverlas (alguien del equipo, un gestor…).
  responsable     text NOT NULL DEFAULT '',
  -- Detalles libres: se muestran solo si se piden.
  observaciones   text NOT NULL DEFAULT '',
  creado_por      uuid REFERENCES public.perfiles (id),
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  actualizado_por uuid REFERENCES public.perfiles (id)
);

-- Para las bases que ya tenian la tabla de antes.
ALTER TABLE public.infracciones ADD COLUMN IF NOT EXISTS responsable text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_infracciones_vehiculo ON public.infracciones (vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_infracciones_estado ON public.infracciones (estado);
-- Un mismo municipio no se repite en el mismo auto (sin importar mayusculas).
CREATE UNIQUE INDEX IF NOT EXISTS idx_infracciones_auto_municipio
  ON public.infracciones (vehiculo_id, lower(btrim(jurisdiccion)));

-- Comprobantes de pago.
CREATE TABLE IF NOT EXISTS public.infracciones_archivos (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  infraccion_id   bigint NOT NULL REFERENCES public.infracciones (id) ON DELETE CASCADE,
  nombre_original text NOT NULL,
  ruta            text NOT NULL,
  mime            text NOT NULL DEFAULT 'application/octet-stream',
  tamano          bigint NOT NULL DEFAULT 0,
  subido_por      uuid REFERENCES public.perfiles (id),
  subido_en       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_infracciones_archivos ON public.infracciones_archivos (infraccion_id);

-- Registro de cada vez que alguien reviso una pagina de consulta. Sirve para
-- distinguir "no tiene multas" de "nadie se fijo todavia".
CREATE TABLE IF NOT EXISTS public.consultas_infracciones (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dominio        text NOT NULL,
  portal_id      bigint NOT NULL REFERENCES public.portales_infracciones (id) ON DELETE CASCADE,
  resultado      text NOT NULL CHECK (resultado IN ('sin_infracciones', 'con_infracciones')),
  consultado_por uuid REFERENCES public.perfiles (id),
  consultado_en  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_consultas_infracciones
  ON public.consultas_infracciones (dominio, portal_id, consultado_en DESC);

-- ---------------------------------------------------------------------
-- 1. Las funciones
-- ---------------------------------------------------------------------
-- Tienen que actualizarse ANTES de tocar las columnas viejas: si no, entre
-- un paso y el otro quedan apuntando a columnas que ya no existen y cargar
-- una venta falla.

CREATE OR REPLACE FUNCTION public.version_esquema()
RETURNS integer LANGUAGE sql IMMUTABLE
AS $$ SELECT 6 $$;

-- Estados de un documento, en el orden en que avanza el tramite.
CREATE OR REPLACE FUNCTION public.estados_documento()
RETURNS text[] LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY['faltante','pedido','en_proceso','aprobado']::text[] $$;

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
    RAISE EXCEPTION 'El dominio "%" no tiene un formato valido. Autos: AAA123 o AB123CD. Motos: 123ABC o A123BCD.', p_datos ->> 'dominio'
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
      dominio, marca, modelo, version, anio, color, kilometraje,
      tenencia, consignante_nombre, consignante_contacto, descripcion
    ) VALUES (
      v_dominio,
      public.txt(p_datos, 'marca', 80),
      public.txt(p_datos, 'modelo', 80),
      public.txt(p_datos, 'version', 120),
      NULLIF(p_datos ->> 'anio', '')::integer,
      public.txt(p_datos, 'color', 60),
      NULLIF(p_datos ->> 'kilometraje', '')::integer,
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
      tenencia = COALESCE(NULLIF(p_datos ->> 'tenencia', ''), tenencia),
      consignante_nombre = CASE WHEN public.txt(p_datos, 'consignante_nombre', 150) <> '' THEN public.txt(p_datos, 'consignante_nombre', 150) ELSE consignante_nombre END,
      consignante_contacto = CASE WHEN public.txt(p_datos, 'consignante_contacto', 150) <> '' THEN public.txt(p_datos, 'consignante_contacto', 150) ELSE consignante_contacto END,
      descripcion = CASE WHEN public.txt(p_datos, 'descripcion', 500) <> '' THEN public.txt(p_datos, 'descripcion', 500) ELSE descripcion END
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.dominio_valido(p_dominio text)
RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$
  SELECT public.normalizar_dominio(p_dominio) ~ (
    '^('
    || '[A-Z]{3}[0-9]{3}'          -- auto viejo:  AAA123
    || '|[A-Z]{2}[0-9]{3}[A-Z]{2}' -- auto Mercosur: AB123CD
    || '|[0-9]{3}[A-Z]{3}'         -- moto vieja:  123ABC
    || '|[A-Z][0-9]{3}[A-Z]{3}'    -- moto Mercosur: A123BCD
    || ')$'
  )
$$;

CREATE OR REPLACE FUNCTION public.estados_documento()
RETURNS text[] LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY['faltante','pedido','en_proceso','aprobado']::text[] $$;

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
    RAISE EXCEPTION 'El dominio "%" no tiene un formato valido. Autos: AAA123 o AB123CD. Motos: 123ABC o A123BCD.', p_datos ->> 'dominio'
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
      dominio, marca, modelo, version, anio, color, kilometraje,
      tenencia, consignante_nombre, consignante_contacto, descripcion
    ) VALUES (
      v_dominio,
      public.txt(p_datos, 'marca', 80),
      public.txt(p_datos, 'modelo', 80),
      public.txt(p_datos, 'version', 120),
      NULLIF(p_datos ->> 'anio', '')::integer,
      public.txt(p_datos, 'color', 60),
      NULLIF(p_datos ->> 'kilometraje', '')::integer,
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
      tenencia = COALESCE(NULLIF(p_datos ->> 'tenencia', ''), tenencia),
      consignante_nombre = CASE WHEN public.txt(p_datos, 'consignante_nombre', 150) <> '' THEN public.txt(p_datos, 'consignante_nombre', 150) ELSE consignante_nombre END,
      consignante_contacto = CASE WHEN public.txt(p_datos, 'consignante_contacto', 150) <> '' THEN public.txt(p_datos, 'consignante_contacto', 150) ELSE consignante_contacto END,
      descripcion = CASE WHEN public.txt(p_datos, 'descripcion', 500) <> '' THEN public.txt(p_datos, 'descripcion', 500) ELSE descripcion END
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

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
    RAISE EXCEPTION 'El dominio "%" no tiene un formato valido. Autos: AAA123 o AB123CD. Motos: 123ABC o A123BCD.', p_datos ->> 'dominio'
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
      dominio, marca, modelo, version, anio, color, kilometraje,
      tenencia, consignante_nombre, consignante_contacto, descripcion
    ) VALUES (
      v_dominio,
      public.txt(p_datos, 'marca', 80),
      public.txt(p_datos, 'modelo', 80),
      public.txt(p_datos, 'version', 120),
      NULLIF(p_datos ->> 'anio', '')::integer,
      public.txt(p_datos, 'color', 60),
      NULLIF(p_datos ->> 'kilometraje', '')::integer,
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
      tenencia = COALESCE(NULLIF(p_datos ->> 'tenencia', ''), tenencia),
      consignante_nombre = CASE WHEN public.txt(p_datos, 'consignante_nombre', 150) <> '' THEN public.txt(p_datos, 'consignante_nombre', 150) ELSE consignante_nombre END,
      consignante_contacto = CASE WHEN public.txt(p_datos, 'consignante_contacto', 150) <> '' THEN public.txt(p_datos, 'consignante_contacto', 150) ELSE consignante_contacto END,
      descripcion = CASE WHEN public.txt(p_datos, 'descripcion', 500) <> '' THEN public.txt(p_datos, 'descripcion', 500) ELSE descripcion END
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.actualizar_vehiculo(p_id bigint, p_datos jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  clave text;
  permitidos text[] := ARRAY['marca','modelo','version','anio','color','kilometraje',
                             'tenencia','consignante_nombre','consignante_contacto',
                             'descripcion'];
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
      'listos', count(*) FILTER (WHERE d.estado = 'aprobado'),
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

CREATE OR REPLACE FUNCTION public.sugerir_dominios(p_q text, p_limite integer DEFAULT 8)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(jsonb_agg(fila ORDER BY empieza, dominio), '[]'::jsonb)
  FROM (
    SELECT
      v.dominio,
      CASE WHEN v.dominio LIKE public.normalizar_dominio(p_q) || '%' THEN 0 ELSE 1 END AS empieza,
      jsonb_build_object(
        'dominio', v.dominio,
        'descripcion', NULLIF(btrim(concat_ws(' ', v.marca, v.modelo)), ''),
        'anio', v.anio,
        'tenencia', v.tenencia,
        'documentos', (SELECT count(*) FROM public.documentos d WHERE d.vehiculo_id = v.id),
        'aprobados', (SELECT count(*) FROM public.documentos d
                       WHERE d.vehiculo_id = v.id AND d.estado = 'aprobado')
      ) AS fila
    FROM public.vehiculos v
    WHERE public.normalizar_dominio(p_q) <> ''
      AND v.dominio LIKE '%' || public.normalizar_dominio(p_q) || '%'
    ORDER BY empieza, v.dominio
    LIMIT LEAST(GREATEST(COALESCE(p_limite, 8), 1), 25)
  ) AS s;
$$;

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
                                WHERE d.venta_id = v.id AND d.estado = 'aprobado')
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
        'listos', count(*) FILTER (WHERE d.estado = 'aprobado'),
        'faltantes', count(*) FILTER (WHERE d.estado = 'faltante'),
        'pedidos', count(*) FILTER (WHERE d.estado = 'pedido'),
        'en_proceso', count(*) FILTER (WHERE d.estado = 'en_proceso'),
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
    HAVING (NOT p_solo_pendientes OR count(*) FILTER (WHERE d.estado = 'aprobado') < count(*))
       AND (COALESCE(trim(p_q), '') = ''
            OR min(ve.dominio) LIKE '%' || public.normalizar_dominio(p_q) || '%'
            OR concat_ws(' ', min(ve.marca), min(ve.modelo), min(ve.descripcion), min(v.cliente_nombre))
               ILIKE '%' || trim(p_q) || '%')
  ) AS filas;
$$;

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
    -- Todo lo que todavia no esta aprobado cuenta como pendiente.
    'documentos_pendientes', (SELECT count(*) FROM public.documentos d
                                JOIN public.ventas v ON v.id = d.venta_id
                               WHERE d.estado <> 'aprobado' AND v.estado <> 'cancelado'),
    -- Multas que todavia hay que pagar o resolver.
    'infracciones_abiertas', (SELECT COALESCE(sum(cantidad), 0) FROM public.infracciones
                                WHERE estado IN ('impaga', 'en_gestion')),
    'infracciones_monto_abierto', (SELECT COALESCE(sum(monto), 0) FROM public.infracciones
                                     WHERE estado IN ('impaga', 'en_gestion')),
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
    'portales_infracciones', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.portales_infracciones t), '[]'::jsonb),
    'infracciones', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.infracciones t), '[]'::jsonb),
    'infracciones_archivos', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.infracciones_archivos t), '[]'::jsonb),
    'consultas_infracciones', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.consultas_infracciones t), '[]'::jsonb),
    'auditoria', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM public.auditoria t), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.guardar_infracciones(p_datos jsonb)
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  v_vehiculo bigint;
  v_fila jsonb;
  v_portal bigint;
  v_municipio text;
  v_cantidad_texto text;
  v_monto_texto text;
  v_estado text;
  v_responsable text;
  v_detalles text;
  v_guardadas integer := 0;
BEGIN
  IF NOT public.es_miembro() THEN
    RAISE EXCEPTION 'No tenes permisos para cargar infracciones.' USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_datos -> 'filas') IS DISTINCT FROM 'array' OR jsonb_array_length(p_datos -> 'filas') = 0 THEN
    RAISE EXCEPTION 'Indica al menos un municipio con su cantidad de infracciones.' USING ERRCODE = '22023';
  END IF;

  -- guardar_vehiculo valida el dominio y no pisa los datos que ya habia.
  v_vehiculo := public.guardar_vehiculo(jsonb_build_object(
    'dominio', p_datos ->> 'dominio',
    'marca', p_datos ->> 'marca',
    'modelo', p_datos ->> 'modelo'
  ));

  FOR v_fila IN SELECT * FROM jsonb_array_elements(p_datos -> 'filas') LOOP
    v_portal := NULLIF(v_fila ->> 'portal_id', '')::bigint;
    v_municipio := public.txt(v_fila, 'municipio', 120);
    v_cantidad_texto := COALESCE(NULLIF(trim(v_fila ->> 'cantidad'), ''), '1');
    v_monto_texto := NULLIF(trim(v_fila ->> 'monto'), '');
    v_estado := COALESCE(NULLIF(v_fila ->> 'estado', ''), 'impaga');
    v_responsable := public.txt(v_fila, 'responsable', 120);
    v_detalles := public.txt(v_fila, 'detalles', 2000);

    -- Con la pagina elegida, el municipio es su nombre; con el nombre
    -- escrito, se busca si coincide con alguna pagina cargada.
    IF v_portal IS NOT NULL AND v_municipio = '' THEN
      SELECT nombre INTO v_municipio FROM public.portales_infracciones WHERE id = v_portal;
    ELSIF v_portal IS NULL AND v_municipio <> '' THEN
      SELECT id INTO v_portal FROM public.portales_infracciones
      WHERE lower(btrim(nombre)) = lower(v_municipio) LIMIT 1;
    END IF;

    IF COALESCE(v_municipio, '') = '' THEN
      RAISE EXCEPTION 'Falta el municipio en una de las filas.' USING ERRCODE = '22023';
    END IF;
    IF v_cantidad_texto !~ '^[0-9]+$' OR v_cantidad_texto::integer < 1 THEN
      RAISE EXCEPTION 'La cantidad de infracciones en % tiene que ser un numero mayor a cero.', v_municipio
        USING ERRCODE = '22023';
    END IF;
    IF v_monto_texto IS NOT NULL AND v_monto_texto !~ '^[0-9]+(\.[0-9]{1,2})?$' THEN
      RAISE EXCEPTION 'El monto de % ("%") no es un numero valido.', v_municipio, v_monto_texto
        USING ERRCODE = '22023';
    END IF;
    IF v_estado NOT IN ('impaga', 'en_gestion', 'pagada', 'anulada') THEN
      RAISE EXCEPTION 'Estado de infraccion desconocido: %', v_estado USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.infracciones (
      vehiculo_id, portal_id, jurisdiccion, cantidad, monto, estado,
      responsable, observaciones, creado_por, actualizado_por
    ) VALUES (
      v_vehiculo, v_portal, v_municipio, v_cantidad_texto::integer, v_monto_texto::numeric,
      v_estado, v_responsable, v_detalles, auth.uid(), auth.uid()
    )
    ON CONFLICT (vehiculo_id, lower(btrim(jurisdiccion))) DO UPDATE SET
      cantidad = EXCLUDED.cantidad,
      monto = COALESCE(EXCLUDED.monto, public.infracciones.monto),
      estado = EXCLUDED.estado,
      portal_id = COALESCE(EXCLUDED.portal_id, public.infracciones.portal_id),
      -- Quien resuelve y los detalles solo se pisan si vienen escritos.
      responsable = COALESCE(NULLIF(EXCLUDED.responsable, ''), public.infracciones.responsable),
      observaciones = COALESCE(NULLIF(EXCLUDED.observaciones, ''), public.infracciones.observaciones),
      actualizado_por = auth.uid();

    v_guardadas := v_guardadas + 1;
  END LOOP;

  RETURN v_guardadas;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_consulta_infracciones(
  p_dominio text,
  p_portal_id bigint,
  p_resultado text
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT public.dominio_valido(p_dominio) THEN
    RAISE EXCEPTION 'El dominio "%" no tiene un formato valido.', p_dominio USING ERRCODE = '22023';
  END IF;
  IF p_resultado NOT IN ('sin_infracciones', 'con_infracciones') THEN
    RAISE EXCEPTION 'Resultado de consulta desconocido: %', p_resultado USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.consultas_infracciones (dominio, portal_id, resultado, consultado_por)
  VALUES (public.normalizar_dominio(p_dominio), p_portal_id, p_resultado, auth.uid());
END;
$$;

CREATE OR REPLACE FUNCTION public.infracciones_de_dominio(p_dominio text)
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  WITH d AS (SELECT public.normalizar_dominio(p_dominio) AS dominio),
  v AS (SELECT ve.* FROM public.vehiculos ve, d WHERE ve.dominio = d.dominio),
  i AS (SELECT inf.* FROM public.infracciones inf JOIN v ON v.id = inf.vehiculo_id)
  SELECT jsonb_build_object(
    'dominio', (SELECT dominio FROM d),
    'vehiculo', (SELECT jsonb_build_object(
                   'id', v.id, 'dominio', v.dominio, 'marca', v.marca, 'modelo', v.modelo,
                   'anio', v.anio, 'tenencia', v.tenencia) FROM v),
    'infracciones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'portal_id', i.portal_id, 'municipio', i.jurisdiccion,
        'cantidad', i.cantidad, 'monto', i.monto, 'estado', i.estado,
        'fecha_pago', i.fecha_pago, 'observaciones', i.observaciones,
        'responsable', i.responsable,
        'actualizado_en', i.actualizado_en,
        'actualizado_por_nombre', (SELECT nombre FROM public.perfiles p
                                    WHERE p.id = COALESCE(i.actualizado_por, i.creado_por)),
        'archivos', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', a.id, 'nombre_original', a.nombre_original, 'ruta', a.ruta,
            'mime', a.mime, 'tamano', a.tamano, 'subido_en', a.subido_en
          ) ORDER BY a.id DESC)
          FROM public.infracciones_archivos a WHERE a.infraccion_id = i.id
        ), '[]'::jsonb)
      ) ORDER BY CASE WHEN i.estado IN ('impaga', 'en_gestion') THEN 0 ELSE 1 END, i.jurisdiccion)
      FROM i
    ), '[]'::jsonb),
    'portales', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', po.id, 'nombre', po.nombre, 'url', po.url, 'notas', po.notas,
        'ultima_consulta', (
          SELECT jsonb_build_object(
            'resultado', c.resultado, 'consultado_en', c.consultado_en,
            'consultado_por_nombre', (SELECT nombre FROM public.perfiles p WHERE p.id = c.consultado_por))
          FROM public.consultas_infracciones c, d
          WHERE c.portal_id = po.id AND c.dominio = d.dominio
          ORDER BY c.consultado_en DESC LIMIT 1)
      ) ORDER BY po.orden, po.nombre)
      FROM public.portales_infracciones po WHERE po.activo
    ), '[]'::jsonb),
    'resumen', jsonb_build_object(
      'abiertas', (SELECT COALESCE(sum(cantidad), 0) FROM i WHERE estado IN ('impaga', 'en_gestion')),
      'monto_abierto', (SELECT COALESCE(sum(monto), 0) FROM i WHERE estado IN ('impaga', 'en_gestion')),
      'municipios_abiertos', (SELECT count(*) FROM i WHERE estado IN ('impaga', 'en_gestion')),
      'total', (SELECT COALESCE(sum(cantidad), 0) FROM i)
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.listar_infracciones(p_filtro text DEFAULT 'abiertas', p_q text DEFAULT '')
RETURNS jsonb
LANGUAGE sql STABLE
AS $$
  WITH base AS (
    SELECT i.*, (i.estado IN ('impaga', 'en_gestion')) AS abierta
    FROM public.infracciones i
  ),
  autos AS (
    SELECT
      v.id, v.dominio, v.marca, v.modelo, v.anio,
      COALESCE(sum(b.cantidad) FILTER (WHERE b.abierta), 0) AS abiertas,
      COALESCE(sum(b.monto) FILTER (WHERE b.abierta), 0) AS monto_abierto,
      sum(b.cantidad) AS total,
      max(b.actualizado_en) AS actualizado_en,
      jsonb_agg(jsonb_build_object(
        'municipio', b.jurisdiccion, 'cantidad', b.cantidad,
        'monto', b.monto, 'estado', b.estado, 'responsable', b.responsable
      ) ORDER BY b.abierta DESC, b.jurisdiccion) AS municipios,
      string_agg(DISTINCT NULLIF(btrim(b.responsable), ''), ', ') AS responsables
    FROM base b JOIN public.vehiculos v ON v.id = b.vehiculo_id
    GROUP BY v.id
  ),
  buscados AS (
    SELECT * FROM autos a
    WHERE btrim(COALESCE(p_q, '')) = ''
       OR (public.normalizar_dominio(p_q) <> '' AND a.dominio LIKE '%' || public.normalizar_dominio(p_q) || '%')
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(a.municipios) m
                   WHERE m ->> 'municipio' ILIKE '%' || btrim(p_q) || '%'
                      OR m ->> 'responsable' ILIKE '%' || btrim(p_q) || '%')
  )
  SELECT jsonb_build_object(
    'filas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'dominio', a.dominio,
        'vehiculo', NULLIF(btrim(concat_ws(' ', a.marca, a.modelo, a.anio::text)), ''),
        'abiertas', a.abiertas, 'monto_abierto', a.monto_abierto, 'total', a.total,
        'municipios', a.municipios, 'responsables', a.responsables,
        'actualizado_en', a.actualizado_en
      ) ORDER BY (a.abiertas > 0) DESC, a.abiertas DESC, a.dominio)
      FROM buscados a
      WHERE CASE COALESCE(NULLIF(p_filtro, ''), 'abiertas')
              WHEN 'abiertas' THEN a.abiertas > 0
              WHEN 'pagadas' THEN a.abiertas = 0
              ELSE true
            END
    ), '[]'::jsonb),
    'resumen', jsonb_build_object(
      'abiertas', (SELECT COALESCE(sum(abiertas), 0) FROM buscados),
      'monto_abierto', (SELECT COALESCE(sum(monto_abierto), 0) FROM buscados),
      'autos_con_abiertas', (SELECT count(*) FROM buscados WHERE abiertas > 0),
      'autos_al_dia', (SELECT count(*) FROM buscados WHERE abiertas = 0)
    )
  );
$$;

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

GRANT SELECT, INSERT, UPDATE, DELETE ON
  public.portales_infracciones, public.infracciones, public.infracciones_archivos
TO authenticated;
GRANT SELECT, INSERT ON public.consultas_infracciones TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
REVOKE ALL ON public.portales_infracciones, public.infracciones,
  public.infracciones_archivos, public.consultas_infracciones FROM anon;

REVOKE ALL ON FUNCTION public.sugerir_dominios(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sugerir_dominios(text, integer) TO authenticated;
REVOKE ALL ON FUNCTION public.guardar_infracciones(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_infracciones(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.registrar_consulta_infracciones(text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_consulta_infracciones(text, bigint, text) TO authenticated;
REVOKE ALL ON FUNCTION public.infracciones_de_dominio(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.infracciones_de_dominio(text) TO authenticated;
REVOKE ALL ON FUNCTION public.listar_infracciones(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_infracciones(text, text) TO authenticated;
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
         CASE WHEN public.version_esquema() >= 6 THEN 'OK' ELSE 'FALTA' END,
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
              AND EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = 'public' AND table_name = 'infracciones'
                             AND column_name = 'responsable')
              THEN 'OK' ELSE 'FALTA' END,
         'por municipio, con quien las resuelve y detalles'
  UNION ALL
  SELECT 7, 'Tus datos',
         'INFO',
         (SELECT count(*) FROM public.ventas) || ' venta(s) · '
         || (SELECT count(*) FROM public.vehiculos) || ' auto(s) · '
         || (SELECT count(*) FROM public.archivos) || ' archivo(s)'
) AS filas ORDER BY orden;
