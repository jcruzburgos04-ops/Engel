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
--   4 = infracciones: multas por auto, paginas de consulta y pagos
--   5 = infracciones por municipio: cantidad por dominio, sin cargar una por una
--   6 = infracciones: quien las resuelve y detalles
--   7 = el menu cuenta autos con multas, no multas
--   8 = autos en stock con su documentacion, sin necesidad de venta
CREATE OR REPLACE FUNCTION public.version_esquema()
RETURNS integer LANGUAGE sql IMMUTABLE
AS $$ SELECT 8 $$;

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

-- Arma el checklist de un auto. Si p_venta_id viene vacio, es el checklist
-- de stock. Si el auto ya tenia checklist de stock y ahora entra en una venta
-- (vendido o como permuta), ese mismo checklist pasa a la venta, con todo lo
-- que ya tenia cargado: no se duplica ni se pierde nada.
CREATE OR REPLACE FUNCTION public.generar_checklist(p_venta_id bigint, p_vehiculo_id bigint, p_rol text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_venta_id IS NULL THEN
    INSERT INTO public.documentos (venta_id, vehiculo_id, rol, tipo)
    SELECT NULL, p_vehiculo_id, 'stock', tipo
    FROM unnest(public.tipos_documento()) AS tipo
    ON CONFLICT (vehiculo_id, tipo) WHERE venta_id IS NULL DO NOTHING;
    RETURN;
  END IF;

  UPDATE public.documentos d
  SET venta_id = p_venta_id, rol = p_rol
  WHERE d.vehiculo_id = p_vehiculo_id AND d.venta_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.documentos o
                     WHERE o.venta_id = p_venta_id AND o.vehiculo_id = p_vehiculo_id AND o.tipo = d.tipo);

  INSERT INTO public.documentos (venta_id, vehiculo_id, rol, tipo)
  SELECT p_venta_id, p_vehiculo_id, p_rol, tipo
  FROM unnest(public.tipos_documento()) AS tipo
  ON CONFLICT (venta_id, vehiculo_id, tipo) DO NOTHING;
END;
$$;

-- Cuando un auto sale de una venta (se borra la venta o se quita la
-- permuta), su documentacion vuelve al stock en vez de borrarse: el auto
-- sigue existiendo y sus papeles tambien. Si el checklist estaba sin tocar
-- (todo faltante, sin archivos ni observaciones), simplemente se descarta.
-- Si el auto ya tenia checklist de stock, se juntan: los archivos pasan al de
-- stock y no se pierde ninguno.
CREATE OR REPLACE FUNCTION public.devolver_a_stock(p_venta_id bigint, p_vehiculo_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  doc record;
  v_stock bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.documentos d
    WHERE d.venta_id = p_venta_id AND d.vehiculo_id = p_vehiculo_id
      AND (d.estado <> 'faltante' OR d.observaciones <> ''
           OR EXISTS (SELECT 1 FROM public.archivos a WHERE a.documento_id = d.id))
  ) THEN
    DELETE FROM public.documentos WHERE venta_id = p_venta_id AND vehiculo_id = p_vehiculo_id;
    RETURN;
  END IF;

  FOR doc IN
    SELECT * FROM public.documentos WHERE venta_id = p_venta_id AND vehiculo_id = p_vehiculo_id
  LOOP
    SELECT id INTO v_stock FROM public.documentos
    WHERE vehiculo_id = p_vehiculo_id AND venta_id IS NULL AND tipo = doc.tipo;

    IF v_stock IS NULL THEN
      UPDATE public.documentos SET venta_id = NULL, rol = 'stock' WHERE id = doc.id;
    ELSE
      UPDATE public.archivos SET documento_id = v_stock WHERE documento_id = doc.id;
      UPDATE public.documentos s SET
        estado = CASE WHEN s.estado = 'faltante' THEN doc.estado ELSE s.estado END,
        observaciones = concat_ws(' | ', NULLIF(s.observaciones, ''), NULLIF(doc.observaciones, ''))
      WHERE s.id = v_stock;
      DELETE FROM public.documentos WHERE id = doc.id;
    END IF;
  END LOOP;
END;
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

-- La documentacion de la permuta vuelve al stock (ver devolver_a_stock).
-- Devuelve las rutas de los archivos borrados, para sacarlos de Storage:
-- ahora ninguno, porque los archivos se conservan.
CREATE OR REPLACE FUNCTION public.quitar_permuta(p_permuta_id bigint)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_venta_id bigint;
  v_vehiculo_id bigint;
BEGIN
  PERFORM public.exigir_miembro();

  SELECT venta_id, vehiculo_id INTO v_venta_id, v_vehiculo_id
  FROM public.permutas WHERE id = p_permuta_id;

  IF v_venta_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro la permuta.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.devolver_a_stock(v_venta_id, v_vehiculo_id);
  DELETE FROM public.permutas WHERE id = p_permuta_id;

  RETURN ARRAY[]::text[];
END;
$$;

-- Los autos de la venta (el vendido y las permutas) vuelven al stock con su
-- documentacion y sus archivos (ver devolver_a_stock). Devuelve las rutas de
-- archivos a borrar de Storage: ninguna, porque se conservan.
CREATE OR REPLACE FUNCTION public.borrar_venta(p_id bigint)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_copia jsonb;
  v_vehiculo bigint;
BEGIN
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo un administrador puede borrar una venta.' USING ERRCODE = '42501';
  END IF;

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

  FOR v_vehiculo IN SELECT DISTINCT vehiculo_id FROM public.documentos WHERE venta_id = p_id LOOP
    PERFORM public.devolver_a_stock(p_id, v_vehiculo);
  END LOOP;

  DELETE FROM public.ventas WHERE id = p_id;

  PERFORM public.anotar('venta', p_id::text, p_id, 'borrar',
    format('Se borro la venta #%s de %s', p_id, v_copia -> 'vehiculo' ->> 'dominio'),
    v_copia, NULL);

  RETURN ARRAY[]::text[];
END;
$$;

-- ---------------------------------------------------------------------
-- Autos en stock (sin vender)
-- ---------------------------------------------------------------------

-- Da de alta uno o varios autos en stock, con su checklist de documentacion.
--   {"autos": [{"dominio": "AB123CD", "marca": "...", "modelo": "...", "anio": 2019,
--               "tenencia": "propio", "consignante_nombre": "..."}, ...]}
-- Un auto que ya estaba en stock no se duplica. Uno que esta en una venta
-- abierta no se puede agregar (su documentacion esta en la venta).
CREATE OR REPLACE FUNCTION public.agregar_a_stock(p_datos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_auto jsonb;
  v_vehiculo bigint;
  v_dominio text;
  v_venta bigint;
  v_agregados text[] := ARRAY[]::text[];
  v_ya_estaban text[] := ARRAY[]::text[];
BEGIN
  PERFORM public.exigir_miembro();

  IF jsonb_typeof(p_datos -> 'autos') IS DISTINCT FROM 'array' OR jsonb_array_length(p_datos -> 'autos') = 0 THEN
    RAISE EXCEPTION 'Indica al menos un auto.' USING ERRCODE = '22023';
  END IF;

  FOR v_auto IN SELECT * FROM jsonb_array_elements(p_datos -> 'autos') LOOP
    v_dominio := public.normalizar_dominio(v_auto ->> 'dominio');

    SELECT ve.id INTO v_venta
    FROM public.ventas ve JOIN public.vehiculos v ON v.id = ve.vehiculo_id
    WHERE v.dominio = v_dominio AND ve.estado NOT IN ('cancelado', 'entregado')
    LIMIT 1;
    IF v_venta IS NULL THEN
      SELECT pe.venta_id INTO v_venta
      FROM public.permutas pe
      JOIN public.ventas ve ON ve.id = pe.venta_id
      JOIN public.vehiculos v ON v.id = pe.vehiculo_id
      WHERE v.dominio = v_dominio AND ve.estado NOT IN ('cancelado', 'entregado')
        AND EXISTS (SELECT 1 FROM public.documentos d WHERE d.venta_id = ve.id AND d.vehiculo_id = v.id)
      LIMIT 1;
    END IF;
    IF v_venta IS NOT NULL THEN
      RAISE EXCEPTION 'El % esta en la venta #%, que sigue abierta: su documentacion se carga ahi.',
        v_dominio, v_venta USING ERRCODE = '22023';
    END IF;

    -- guardar_vehiculo valida el dominio y no pisa los datos que ya habia.
    v_vehiculo := public.guardar_vehiculo(v_auto);

    IF EXISTS (SELECT 1 FROM public.documentos WHERE vehiculo_id = v_vehiculo AND venta_id IS NULL) THEN
      v_ya_estaban := v_ya_estaban || v_dominio;
    ELSE
      PERFORM public.generar_checklist(NULL, v_vehiculo, 'stock');
      PERFORM public.anotar('stock', v_dominio, NULL, 'crear', format('Se agrego %s al stock', v_dominio));
      v_agregados := v_agregados || v_dominio;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('agregados', to_jsonb(v_agregados), 'ya_estaban', to_jsonb(v_ya_estaban));
END;
$$;

-- Saca un auto del stock (por ejemplo, porque se fue sin pasar por una venta
-- cargada aca). Borra su checklist de stock y devuelve las rutas de sus
-- archivos para sacarlos de Storage. Queda una copia completa en el
-- historial. Si hay archivos cargados, solo lo puede hacer un administrador.
CREATE OR REPLACE FUNCTION public.quitar_de_stock(p_vehiculo_id bigint)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_rutas text[];
  v_copia jsonb;
  v_dominio text;
BEGIN
  PERFORM public.exigir_miembro();

  SELECT dominio INTO v_dominio FROM public.vehiculos WHERE id = p_vehiculo_id;
  IF v_dominio IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.documentos WHERE vehiculo_id = p_vehiculo_id AND venta_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Ese auto no esta en stock.' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(array_agg(a.ruta), ARRAY[]::text[]) INTO v_rutas
  FROM public.archivos a JOIN public.documentos d ON d.id = a.documento_id
  WHERE d.vehiculo_id = p_vehiculo_id AND d.venta_id IS NULL;

  IF cardinality(v_rutas) > 0 AND NOT public.es_admin() THEN
    RAISE EXCEPTION 'Este auto tiene archivos cargados: solo un administrador lo puede sacar del stock.'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'vehiculo', (SELECT to_jsonb(v) FROM public.vehiculos v WHERE v.id = p_vehiculo_id),
    'documentos', COALESCE((SELECT jsonb_agg(to_jsonb(d)) FROM public.documentos d
                             WHERE d.vehiculo_id = p_vehiculo_id AND d.venta_id IS NULL), '[]'::jsonb),
    'archivos', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM public.archivos a
                           JOIN public.documentos d ON d.id = a.documento_id
                           WHERE d.vehiculo_id = p_vehiculo_id AND d.venta_id IS NULL), '[]'::jsonb)
  ) INTO v_copia;

  DELETE FROM public.documentos WHERE vehiculo_id = p_vehiculo_id AND venta_id IS NULL;

  PERFORM public.anotar('stock', v_dominio, NULL, 'borrar',
    format('Se saco %s del stock', v_dominio), v_copia, NULL);

  RETURN v_rutas;
END;
$$;

-- ---------------------------------------------------------------------
-- Infracciones
-- ---------------------------------------------------------------------

-- Carga cuantas infracciones tiene un dominio en uno o varios municipios.
--   {"dominio": "AB123CD", "marca": "...", "modelo": "...",
--    "filas": [{"municipio": "CABA", "cantidad": 3, "monto": "85000", "estado": "impaga",
--               "responsable": "Gestoria Lopez", "detalles": "..."}, ...]}
-- Si ese municipio ya estaba cargado para el auto, se actualiza (no se
-- duplica). Si el dominio no estaba en el sistema (un auto en stock), se da
-- de alta. Devuelve cuantos municipios se guardaron.
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

-- Deja asentado que alguien reviso una pagina de consulta para un dominio.
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
