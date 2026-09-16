-- Pruebas de las politicas de acceso. Se corren con los roles reales
-- (anon y authenticated), que son los que usa Supabase desde el navegador.
\set ON_ERROR_STOP on
SET client_min_messages TO notice;
\o /dev/null

-- Cuenta filas visibles sin romper la prueba si el permiso las bloquea.
CREATE OR REPLACE FUNCTION visibles(p_tabla text)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE n integer;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I', p_tabla) INTO n;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN -1;
END $$;

\echo ''
\echo '== Sin iniciar sesion no se ve nada =='

SET ROLE anon;
SET request.jwt.claim.sub = '';

SELECT verificar('el visitante sin sesion no ve ninguna venta', visibles('ventas') <= 0);
SELECT verificar('el visitante sin sesion no ve ningun vehiculo', visibles('vehiculos') <= 0);
SELECT verificar('el visitante sin sesion no ve la documentacion', visibles('documentos') <= 0);
SELECT verificar('el visitante sin sesion no ve el historial', visibles('auditoria') <= 0);

SELECT debe_fallar('el visitante sin sesion no puede cargar una venta',
  $$ SELECT public.crear_venta('{"cliente_nombre":"X","vehiculo":{"dominio":"AB123CD"}}'::jsonb) $$);

SELECT debe_fallar('el visitante sin sesion no puede listar ventas',
  $$ SELECT public.listar_ventas('{}'::jsonb) $$);

RESET ROLE;

\echo ''
\echo '== Quien no fue invitado no ve nada =='

SET ROLE authenticated;
SET request.jwt.claim.sub = '99999999-9999-9999-9999-999999999999';

SELECT verificar('el usuario no habilitado no ve ventas', visibles('ventas') = 0);
SELECT verificar('el usuario no habilitado no ve vehiculos', visibles('vehiculos') = 0);
SELECT verificar('el usuario no habilitado no ve documentacion', visibles('documentos') = 0);
SELECT verificar('el usuario no habilitado no ve archivos', visibles('archivos') = 0);
SELECT verificar('el usuario no habilitado no ve el historial', visibles('auditoria') = 0);

SELECT debe_fallar('el usuario no habilitado no puede cargar una venta',
  $$ SELECT public.crear_venta('{"vendedor_id":"22222222-2222-2222-2222-222222222222","cliente_nombre":"X","vehiculo":{"dominio":"QQ111QQ"}}'::jsonb) $$,
  'no fue habilitado');

SELECT verificar('la ficha de una venta le vuelve vacia',
  (SELECT public.venta_completa(1) IS NULL));

RESET ROLE;

\echo ''
\echo '== El equipo si ve y edita =='

SET ROLE authenticated;
SET request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

SELECT verificar('el integrante del equipo ve las ventas', visibles('ventas') = 1);
SELECT verificar('el integrante del equipo ve la documentacion', visibles('documentos') = 16);
SELECT verificar('el integrante del equipo ve el historial', visibles('auditoria') > 0);
SELECT verificar('el integrante del equipo ve a sus companeros', visibles('perfiles') >= 3);

SELECT public.actualizar_venta(1, '{"forma_pago":"Transferencia"}'::jsonb);
SELECT verificar('el integrante del equipo puede editar',
  (SELECT forma_pago = 'Transferencia' FROM public.ventas WHERE id = 1));

\echo ''
\echo '== Cosas que solo puede hacer un administrador =='

SELECT debe_fallar('un vendedor no puede borrar una venta',
  $$ SELECT public.borrar_venta(1) $$, 'administrador');

SELECT verificar('un vendedor no ve las invitaciones', visibles('invitaciones') = 0);

SELECT debe_fallar('un vendedor no puede invitar a nadie',
  $$ INSERT INTO public.invitaciones (email) VALUES ('colado@otrolado.com') $$);

SELECT debe_fallar('un vendedor no puede darse permisos de administrador',
  $$ UPDATE public.perfiles SET rol = 'admin' WHERE id = '22222222-2222-2222-2222-222222222222' $$);

SELECT verificar('el vendedor sigue siendo vendedor',
  (SELECT rol = 'vendedor' FROM public.perfiles WHERE id = '22222222-2222-2222-2222-222222222222'));

\echo ''
\echo '== El historial no se puede falsear =='

SELECT debe_fallar('nadie puede escribir a mano en el historial',
  $$ INSERT INTO public.auditoria (entidad, accion, resumen) VALUES ('venta', 'editar', 'inventado') $$);

SELECT debe_fallar('nadie puede borrar el historial',
  $$ DELETE FROM public.auditoria $$);

SELECT debe_fallar('nadie puede tocar una linea del historial',
  $$ UPDATE public.auditoria SET resumen = 'cambiado' $$);

\echo ''
\echo '== Borradores: cada uno ve solo los suyos =='

INSERT INTO public.borradores (usuario_id, clave, contenido)
VALUES ('22222222-2222-2222-2222-222222222222', 'venta-nueva', '{"cliente_nombre":"Privado de Lucia"}'::jsonb);

SELECT verificar('cada uno ve su borrador', visibles('borradores') = 1);

SET request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
SELECT verificar('el companero no ve el borrador ajeno', visibles('borradores') = 0);

SELECT debe_fallar('no se puede guardar un borrador a nombre de otro',
  $$ INSERT INTO public.borradores (usuario_id, clave, contenido)
     VALUES ('22222222-2222-2222-2222-222222222222', 'trampa', '{}'::jsonb) $$);

RESET ROLE;

\echo ''
\echo '== El administrador si puede =='

SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

SELECT verificar('el administrador ve las invitaciones', visibles('invitaciones') = 2);

INSERT INTO public.invitaciones (email, nombre, rol) VALUES ('nuevo@engel.com', 'Nuevo', 'vendedor');
SELECT verificar('el administrador puede invitar', visibles('invitaciones') = 3);

UPDATE public.perfiles SET activo = false
WHERE id = '33333333-3333-3333-3333-333333333333';

SELECT verificar('el administrador puede dar de baja a alguien',
  (SELECT NOT activo FROM public.perfiles WHERE id = '33333333-3333-3333-3333-333333333333'));

RESET ROLE;

SET ROLE authenticated;
SET request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
SELECT verificar('quien fue dado de baja deja de ver los datos', visibles('ventas') = 0);
RESET ROLE;

\echo ''
\echo '== Borrar una venta guarda una copia completa =='

SET ROLE authenticated;
SET request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

SELECT public.borrar_venta(1);

SELECT verificar('la venta se borro', (SELECT count(*) = 0 FROM public.ventas WHERE id = 1));

SELECT verificar('queda la copia completa en el historial',
  (SELECT antes -> 'vehiculo' ->> 'dominio' = 'AB123CD'
      AND jsonb_array_length(antes -> 'documentos') = 16
     FROM public.auditoria
    WHERE venta_id = 1 AND accion = 'borrar' AND entidad = 'venta'
    ORDER BY id DESC LIMIT 1));

RESET ROLE;
