-- =====================================================================
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
  -- Orden de trabajo: faltante -> pedido -> en proceso -> aprobado.
  estado          text NOT NULL DEFAULT 'faltante'
                  CHECK (estado IN ('faltante', 'pedido', 'en_proceso', 'aprobado')),
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
