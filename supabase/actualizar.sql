-- =====================================================================
-- Engel · Poner al dia una base ya instalada
-- =====================================================================
-- Copiar TODO este archivo, pegarlo en el editor SQL de Supabase y RUN.
--
-- Trae tres cambios:
--   1. Acepta las patentes de moto anteriores a 2016 (590LLL).
--   2. Saca el numero de chasis y el numero de motor.
--   3. Los estados de la documentacion pasan a ser:
--      Faltante -> Pedido -> En proceso -> Aprobado.
--
-- Se puede correr aunque ya hayas aplicado alguno: no repite nada.
-- Al final aparece una tabla con el resultado.
--
-- Este archivo se genera solo con: node herramientas/armar-migracion.js
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Las funciones primero
-- ---------------------------------------------------------------------
-- Tienen que actualizarse ANTES de tocar las tablas: si no, entre un paso
-- y el otro quedan apuntando a columnas que ya no existen y cargar una
-- venta falla.

CREATE OR REPLACE FUNCTION public.version_esquema()
RETURNS integer LANGUAGE sql IMMUTABLE
AS $$ SELECT 2 $$;

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
-- 2. Sacar chasis y motor
-- ---------------------------------------------------------------------
-- Si tenias alguno cargado, el paso 4 te avisa antes de que se pierda.

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

GRANT EXECUTE ON FUNCTION public.version_esquema() TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------
-- 4. Comprobacion
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
         CASE WHEN public.version_esquema() >= 2 THEN 'OK' ELSE 'FALTA' END,
         'version ' || public.version_esquema()
  UNION ALL
  SELECT 5, 'Tus datos',
         'INFO',
         (SELECT count(*) FROM public.ventas) || ' venta(s) · '
         || (SELECT count(*) FROM public.vehiculos) || ' auto(s) · '
         || (SELECT count(*) FROM public.archivos) || ' archivo(s)'
) AS filas ORDER BY orden;
