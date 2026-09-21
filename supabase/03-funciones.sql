-- =====================================================================
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

-- Los cuatro formatos que circulan en el pais:
--   AAA123    auto anterior a 2016
--   AB123CD   auto Mercosur (2016 en adelante)
--   123ABC    moto anterior a 2016
--   A123BCD   moto Mercosur (2016 en adelante)
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

-- Version del esquema. Sube con cada cambio que la web necesita si o si.
-- La web la consulta al arrancar: si la base quedo atras, avisa en vez de
-- dejar que salten errores sueltos al usar el sistema.
--   1 = primera instalacion
--   2 = patentes de moto, sin chasis/motor, estados nuevos de documentacion
--   3 = sugerencias de dominio mientras se escribe en el buscador
CREATE OR REPLACE FUNCTION public.version_esquema()
RETURNS integer LANGUAGE sql IMMUTABLE
AS $$ SELECT 3 $$;

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

-- Actualiza campo por campo: lo que no viene en p_datos no se toca.
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
