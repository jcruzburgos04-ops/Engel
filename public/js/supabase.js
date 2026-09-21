// Conexion con Supabase.
//
// La biblioteca se carga desde un CDN, asi la web sigue siendo un puñado de
// archivos estaticos que se pueden publicar gratis en cualquier lado.

import { config } from './config.js';

const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

let clientePromesa;

export function conectar() {
  if (!clientePromesa) {
    // Permite reemplazar la biblioteca en las pruebas automatizadas.
    const modulo = globalThis.__ENGEL_MODULO_SUPABASE__ || CDN;
    clientePromesa = import(/* @vite-ignore */ modulo).then(({ createClient }) =>
      createClient(config.url, config.clave, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'engel:sesion'
        }
      })
    );
  }
  return clientePromesa;
}

// Traduce los errores de Postgres y de Supabase a algo que se entienda.
export function traducirError(error) {
  if (!error) return new Error('Error desconocido.');

  const mensaje = String(error.message || error.error_description || error);
  const codigo = error.code || '';

  const conocidos = [
    // Pasa cuando la web ya se actualizo y el SQL todavia no: la base rechaza
    // valores que la web da por buenos. El mensaje de Postgres no se entiende.
    [
      /documentos_estado_check/i,
      'La base de datos todavia no conoce los estados nuevos de la documentacion. ' +
        'Hay que correr el archivo supabase/actualizar.sql en Supabase → SQL Editor.'
    ],
    [
      /violates check constraint/i,
      'La base de datos rechazo ese dato. Puede que este desactualizada: ' +
        'proba corriendo supabase/actualizar.sql en Supabase → SQL Editor.'
    ],
    [
      /could not find the function|function .* does not exist/i,
      'Falta una funcion en la base de datos. Hay que correr supabase/actualizar.sql ' +
        'en Supabase → SQL Editor.'
    ],
    [/Invalid login credentials/i, 'Email o contrasena incorrectos.'],
    [/Email not confirmed/i, 'Todavia no confirmaste tu email. Revisa tu correo.'],
    [/User already registered/i, 'Ya existe una cuenta con ese email. Proba iniciar sesion.'],
    [/Password should be at least/i, 'La contrasena tiene que tener al menos 8 caracteres.'],
    [/JWT expired|Invalid Refresh Token/i, 'Tu sesion vencio. Volve a ingresar.'],
    [/Failed to fetch|NetworkError|Load failed/i, 'No se pudo conectar. Revisa tu conexion a internet.'],
    [/row-level security|permission denied/i, 'No tenes permisos para esta accion.'],
    [/duplicate key|already exists/i, 'Ese registro ya existe.'],
    [/exceeded the maximum allowed size|Payload too large/i, 'El archivo es demasiado grande.'],
    [/mime type .* is not supported/i, 'Ese tipo de archivo no esta permitido.']
  ];

  for (const [patron, texto] of conocidos) {
    if (patron.test(mensaje)) {
      const traducido = new Error(texto);
      traducido.codigo = codigo;
      traducido.original = mensaje;
      return traducido;
    }
  }

  const salida = new Error(mensaje);
  salida.codigo = codigo;
  // Los errores que lanza la base con RAISE ya vienen en castellano.
  salida.esDelUsuario = ['22023', 'P0002', '23505', '42501'].includes(codigo);
  return salida;
}
