-- Pruebas del esquema: negocio, permisos y historial.
\set ON_ERROR_STOP on
\set QUIET on
SET client_min_messages TO notice;

-- Los resultados de las consultas no interesan: lo que se lee son los avisos.
\o /dev/null

CREATE OR REPLACE FUNCTION verificar(p_nombre text, p_condicion boolean)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_condicion THEN
    RAISE NOTICE '  ok  %', p_nombre;
  ELSE
    RAISE EXCEPTION 'FALLA: %', p_nombre;
  END IF;
END $$;

-- Ejecuta algo esperando que falle, y verifica el mensaje.
CREATE OR REPLACE FUNCTION debe_fallar(p_nombre text, p_sql text, p_texto text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
DECLARE mensaje text;
BEGIN
  BEGIN
    EXECUTE p_sql;
    RAISE EXCEPTION 'FALLA: % — se esperaba un error y no hubo ninguno', p_nombre;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'FALLA:%' THEN RAISE; END IF;
      mensaje := SQLERRM;
    WHEN OTHERS THEN
      mensaje := SQLERRM;
  END;
  IF p_texto <> '' AND position(lower(p_texto) IN lower(mensaje)) = 0 THEN
    RAISE EXCEPTION 'FALLA: % — el error decia "%" y se esperaba "%"', p_nombre, mensaje, p_texto;
  END IF;
  RAISE NOTICE '  ok  % (rechazado: %)', p_nombre, left(mensaje, 60);
END $$;

\echo ''
\echo '== Alta de usuarios por invitacion =='

-- El primero que se registra queda como administrador.
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'jefe@engel.com');

SELECT verificar('el primer usuario queda como administrador activo',
  (SELECT rol = 'admin' AND activo FROM public.perfiles WHERE email = 'jefe@engel.com'));

-- Alguien que no fue invitado se registra pero queda inactivo.
INSERT INTO auth.users (id, email) VALUES
  ('99999999-9999-9999-9999-999999999999', 'intruso@otrolado.com');

SELECT verificar('quien no fue invitado queda inactivo',
  (SELECT NOT activo FROM public.perfiles WHERE email = 'intruso@otrolado.com'));

-- El admin invita a dos vendedores.
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
INSERT INTO public.invitaciones (email, nombre, rol) VALUES
  ('lucia@engel.com', 'Lucia Fernandez', 'vendedor'),
  ('martin@engel.com', 'Martin Alvarez', 'vendedor');

INSERT INTO auth.users (id, email) VALUES
  ('22222222-2222-2222-2222-222222222222', 'lucia@engel.com'),
  ('33333333-3333-3333-3333-333333333333', 'martin@engel.com');

SELECT verificar('el invitado entra activo y con su nombre',
  (SELECT activo AND nombre = 'Lucia Fernandez' FROM public.perfiles WHERE email = 'lucia@engel.com'));

SELECT verificar('la invitacion queda marcada como usada',
  (SELECT usada_en IS NOT NULL FROM public.invitaciones WHERE email = 'lucia@engel.com'));

\echo ''
\echo '== Dominios =='

SELECT verificar('normaliza el dominio', public.normalizar_dominio('ab 123-cd') = 'AB123CD');
SELECT verificar('acepta el formato viejo', public.dominio_valido('AAA123'));
SELECT verificar('acepta el formato Mercosur', public.dominio_valido('ab123cd'));
SELECT verificar('acepta patente de moto', public.dominio_valido('A123BCD'));
SELECT verificar('rechaza cualquier cosa', NOT public.dominio_valido('NO-ES-UN-DOMINIO'));

\echo ''
\echo '== Cargar una venta con permuta =='

SET request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

SELECT public.crear_venta(jsonb_build_object(
  'fecha_venta', '2026-09-01',
  'vendedor_id', '22222222-2222-2222-2222-222222222222',
  'cliente_nombre', 'Maria Gomez',
  'cliente_telefono', '11 5555 5555',
  'precio_venta', 15000000,
  'moneda', 'ARS',
  'fecha_entrega_estimada', '2026-09-20',
  'detalles', 'Entrega con service al dia.',
  'vehiculo', jsonb_build_object(
    'dominio', 'ab 123 cd', 'marca', 'Toyota', 'modelo', 'Corolla',
    'version', 'XEI', 'anio', 2021, 'color', 'Gris', 'kilometraje', 48000,
    'tenencia', 'consigna', 'consignante_nombre', 'Carlos Ruiz',
    'descripcion', 'Corolla XEI gris'),
  'permutas', jsonb_build_array(jsonb_build_object(
    'dominio', 'AAA111', 'marca', 'Volkswagen', 'modelo', 'Gol', 'anio', 2014,
    'valor_tomado', 4000000, 'observaciones', 'Entra con la VTV vencida.'))
)) AS venta_id \gset

SELECT verificar('normaliza el dominio al guardar',
  (SELECT dominio = 'AB123CD' FROM public.vehiculos v JOIN public.ventas ve ON ve.vehiculo_id = v.id WHERE ve.id = :venta_id));

SELECT verificar('guarda que el auto esta en consigna',
  (SELECT v.tenencia = 'consigna' AND v.consignante_nombre = 'Carlos Ruiz'
     FROM public.vehiculos v JOIN public.ventas ve ON ve.vehiculo_id = v.id WHERE ve.id = :venta_id));

SELECT verificar('vincula la permuta a la venta',
  (SELECT count(*) = 1 FROM public.permutas WHERE venta_id = :venta_id));

SELECT verificar('genera 8 documentos para el auto vendido',
  (SELECT count(*) = 8 FROM public.documentos WHERE venta_id = :venta_id AND rol = 'venta'));

SELECT verificar('genera 8 documentos para la permuta',
  (SELECT count(*) = 8 FROM public.documentos WHERE venta_id = :venta_id AND rol = 'permuta'));

\echo ''
\echo '== Validaciones =='

SELECT debe_fallar('rechaza un dominio invalido',
  $$ SELECT public.crear_venta('{"vendedor_id":"22222222-2222-2222-2222-222222222222","cliente_nombre":"X","vehiculo":{"dominio":"CUALQUIERA"}}'::jsonb) $$,
  'no tiene un formato valido');

SELECT debe_fallar('rechaza el mismo dominio en dos ventas abiertas',
  $$ SELECT public.crear_venta('{"vendedor_id":"22222222-2222-2222-2222-222222222222","cliente_nombre":"X","vehiculo":{"dominio":"AB123CD"}}'::jsonb) $$,
  'ya figura en una venta abierta');

SELECT debe_fallar('rechaza permuta con el dominio del auto vendido',
  $$ SELECT public.crear_venta('{"vendedor_id":"22222222-2222-2222-2222-222222222222","cliente_nombre":"X","vehiculo":{"dominio":"CD456EF"},"permutas":[{"dominio":"CD456EF"}]}'::jsonb) $$,
  'mismo dominio que el auto vendido');

SELECT debe_fallar('rechaza dos permutas con el mismo dominio',
  $$ SELECT public.crear_venta('{"vendedor_id":"22222222-2222-2222-2222-222222222222","cliente_nombre":"X","vehiculo":{"dominio":"CD456EF"},"permutas":[{"dominio":"AAA222"},{"dominio":"AAA222"}]}'::jsonb) $$,
  'dos permutas con el mismo dominio');

SELECT debe_fallar('exige el nombre del cliente',
  $$ SELECT public.crear_venta('{"vendedor_id":"22222222-2222-2222-2222-222222222222","cliente_nombre":"","vehiculo":{"dominio":"CD456EF"}}'::jsonb) $$,
  'nombre del cliente');

SELECT debe_fallar('exige el consignante si el auto esta en consigna',
  $$ SELECT public.crear_venta('{"vendedor_id":"22222222-2222-2222-2222-222222222222","cliente_nombre":"X","vehiculo":{"dominio":"CD456EF","tenencia":"consigna"}}'::jsonb) $$,
  'consignante');

\echo ''
\echo '== Guardado campo por campo =='

SELECT public.actualizar_venta(:venta_id, '{"cliente_telefono":"11 7777 8888"}'::jsonb);

SELECT verificar('guardar un campo no pisa el resto de la venta',
  (SELECT cliente_telefono = '11 7777 8888' AND cliente_nombre = 'Maria Gomez' AND precio_venta = 15000000
     FROM public.ventas WHERE id = :venta_id));

SELECT public.actualizar_venta(:venta_id, '{"vehiculo":{"color":"Negro"}}'::jsonb);

SELECT verificar('guardar un campo del auto no borra los demas',
  (SELECT v.color = 'Negro' AND v.marca = 'Toyota' AND v.modelo = 'Corolla'
          AND v.version = 'XEI' AND v.anio = 2021 AND v.kilometraje = 48000
          AND v.descripcion = 'Corolla XEI gris'
     FROM public.vehiculos v JOIN public.ventas ve ON ve.vehiculo_id = v.id WHERE ve.id = :venta_id));

SELECT public.actualizar_venta(:venta_id, '{"vehiculo":{"nro_chasis":""}}'::jsonb);
SELECT verificar('se puede vaciar un campo a proposito',
  (SELECT v.nro_chasis = '' AND v.marca = 'Toyota'
     FROM public.vehiculos v JOIN public.ventas ve ON ve.vehiculo_id = v.id WHERE ve.id = :venta_id));

\echo ''
\echo '== Historial =='

SELECT verificar('la creacion de la venta quedo registrada',
  (SELECT count(*) >= 1 FROM public.auditoria
    WHERE venta_id = :venta_id AND accion = 'crear' AND entidad = 'venta'));

SELECT verificar('el historial dice quien lo hizo',
  (SELECT usuario_nombre = 'Lucia Fernandez' FROM public.auditoria
    WHERE venta_id = :venta_id ORDER BY id DESC LIMIT 1));

SELECT verificar('el historial guarda el valor anterior',
  (SELECT count(*) >= 1 FROM public.auditoria
    WHERE venta_id = :venta_id AND resumen LIKE '%11 5555 5555%' AND resumen LIKE '%11 7777 8888%'));

SELECT verificar('guardar lo mismo no ensucia el historial',
  (WITH antes AS (SELECT count(*) AS n FROM public.auditoria WHERE venta_id = :venta_id),
        _ AS (SELECT public.actualizar_venta(:venta_id, '{"cliente_telefono":"11 7777 8888"}'::jsonb))
   SELECT (SELECT n FROM antes) = (SELECT count(*) FROM public.auditoria WHERE venta_id = :venta_id)));

SELECT verificar('el contador de cambios avanza',
  (SELECT version > 0 FROM public.estado_datos WHERE id = 1));

\echo ''
\echo '== Documentacion =='

UPDATE public.documentos SET estado = 'ok'
WHERE venta_id = :venta_id AND rol = 'venta' AND tipo = 'titulo';

INSERT INTO public.archivos (documento_id, nombre_original, ruta, mime, tamano, subido_por)
SELECT id, 'titulo.pdf', 'ventas/1/titulo.pdf', 'application/pdf', 1024,
       '22222222-2222-2222-2222-222222222222'
FROM public.documentos WHERE venta_id = :venta_id AND rol = 'venta' AND tipo = 'titulo';

SELECT verificar('la documentacion viene agrupada por auto',
  (SELECT jsonb_array_length(public.documentacion_de_venta(:venta_id)) = 2));

SELECT verificar('el auto vendido va primero',
  (SELECT public.documentacion_de_venta(:venta_id) -> 0 ->> 'rol' = 'venta'));

SELECT verificar('cada auto trae sus 8 documentos en orden',
  (SELECT jsonb_array_length(public.documentacion_de_venta(:venta_id) -> 0 -> 'items') = 8
      AND public.documentacion_de_venta(:venta_id) -> 0 -> 'items' -> 0 ->> 'tipo' = 'titulo'
      AND public.documentacion_de_venta(:venta_id) -> 0 -> 'items' -> 7 ->> 'tipo' = 'vtv'));

SELECT verificar('el archivo aparece colgado de su documento',
  (SELECT public.documentacion_de_venta(:venta_id) -> 0 -> 'items' -> 0 -> 'archivos' -> 0 ->> 'nombre_original' = 'titulo.pdf'));

SELECT verificar('cuenta cuantos documentos estan listos',
  (SELECT (public.documentacion_de_venta(:venta_id) -> 0 ->> 'listos')::int = 1));

\echo ''
\echo '== Ficha completa y listado =='

SELECT verificar('la ficha trae vendedor, auto, permutas y documentacion',
  (SELECT public.venta_completa(:venta_id) ->> 'vendedor_nombre' = 'Lucia Fernandez'
      AND public.venta_completa(:venta_id) -> 'vehiculo' ->> 'dominio' = 'AB123CD'
      AND jsonb_array_length(public.venta_completa(:venta_id) -> 'permutas') = 1
      AND jsonb_array_length(public.venta_completa(:venta_id) -> 'documentacion') = 2));

SELECT verificar('el listado encuentra por el dominio de la permuta',
  (SELECT (public.listar_ventas('{"q":"AAA111"}'::jsonb) ->> 'total')::int = 1));

SELECT verificar('el listado encuentra por el nombre del cliente',
  (SELECT (public.listar_ventas('{"q":"Maria"}'::jsonb) ->> 'total')::int = 1));

SELECT verificar('el listado filtra por estado',
  (SELECT (public.listar_ventas('{"estado":"entregado"}'::jsonb) ->> 'total')::int = 0));

SELECT verificar('el listado cuenta las permutas y la documentacion',
  (SELECT (public.listar_ventas('{}'::jsonb) -> 'ventas' -> 0 ->> 'cantidad_permutas')::int = 1
      AND (public.listar_ventas('{}'::jsonb) -> 'ventas' -> 0 ->> 'documentos_total')::int = 16));

\echo ''
\echo '== Buscar por dominio =='

SELECT verificar('encuentra el auto vendido',
  (SELECT public.buscar_dominio('ab123cd') -> 'vehiculo' ->> 'dominio' = 'AB123CD'
      AND public.buscar_dominio('ab123cd') -> 'ventas' -> 0 ->> 'rol' = 'venta'));

SELECT verificar('encuentra la permuta por su propio dominio',
  (SELECT public.buscar_dominio('AAA111') -> 'ventas' -> 0 ->> 'rol' = 'permuta'));

SELECT verificar('devuelve los archivos para descargar',
  (SELECT count(*) = 1 FROM jsonb_array_elements(public.buscar_dominio('AB123CD') -> 'documentos') d
    WHERE jsonb_array_length(d -> 'archivos') > 0));

SELECT verificar('un dominio que no existe devuelve vacio',
  (SELECT public.buscar_dominio('ZZ999ZZ') IS NULL));

\echo ''
\echo '== Panel de documentacion y numeros =='

SELECT verificar('el panel muestra los autos con papeles pendientes',
  (SELECT jsonb_array_length(public.panel_documentacion(true, '')) = 2));

SELECT verificar('el panel cuenta los archivos cargados',
  (SELECT count(*) = 1 FROM jsonb_array_elements(public.panel_documentacion(true, '')) f
    WHERE (f ->> 'archivos')::int = 1));

SELECT verificar('las estadisticas no traen totales por vendedor',
  (SELECT NOT (public.estadisticas() ? 'porVendedor')));

SELECT verificar('las estadisticas traen los numeros generales',
  (SELECT (public.estadisticas() ->> 'ventas_totales')::int = 1
      AND (public.estadisticas() ->> 'documentos_pendientes')::int = 15));

\echo ''
\echo '== Permutas =='

SELECT public.agregar_permuta(:venta_id, '{"dominio":"BBB222","marca":"Chevrolet","valor_tomado":3100000}'::jsonb);

SELECT verificar('se puede sumar otra permuta despues',
  (SELECT count(*) = 2 FROM public.permutas WHERE venta_id = :venta_id));

SELECT debe_fallar('no se puede vincular dos veces la misma permuta',
  format($$ SELECT public.agregar_permuta(%s, '{"dominio":"BBB222"}'::jsonb) $$, :venta_id),
  'ya esta vinculada');

SELECT public.quitar_permuta((SELECT id FROM public.permutas WHERE venta_id = :venta_id ORDER BY id DESC LIMIT 1));

SELECT verificar('al quitar la permuta se borra su checklist',
  (SELECT count(*) = 1 FROM public.permutas WHERE venta_id = :venta_id)
  AND (SELECT count(*) = 16 FROM public.documentos WHERE venta_id = :venta_id));
