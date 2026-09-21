-- =====================================================================
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

-- La version del esquema la puede consultar cualquiera: es solo un numero y
-- sirve para avisar en la pantalla de ingreso si la base quedo atrasada.
GRANT EXECUTE ON FUNCTION public.version_esquema() TO anon, authenticated;
