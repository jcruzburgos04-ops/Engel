-- =====================================================================
-- Engel · Actualizacion: aceptar las patentes de moto anteriores a 2016
-- =====================================================================
-- Pegar esto en el editor SQL de Supabase y apretar RUN.
-- Es chico y no toca ningun dato: solo cambia como se valida el dominio.
--
-- (Tambien queda incluido en instalar.sql, por si preferis correr todo.)

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

-- Comprobacion: las cuatro tienen que decir "acepta".
SELECT ejemplo, que_es,
       CASE WHEN public.dominio_valido(ejemplo) THEN 'acepta' ELSE 'RECHAZA' END AS resultado
FROM (VALUES
  ('AAA123',  'auto anterior a 2016'),
  ('AB123CD', 'auto Mercosur'),
  ('590LLL',  'moto anterior a 2016'),
  ('A123BCD', 'moto Mercosur'),
  ('DUKE390', 'invalido (tiene que rechazarlo)')
) AS t(ejemplo, que_es);
