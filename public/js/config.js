// =====================================================================
// Configuracion de la web — ESTE ES EL UNICO ARCHIVO QUE HAY QUE EDITAR
// =====================================================================
//
// Los dos valores salen del panel de Supabase (boton "Connect" arriba, o):
//   Project Settings → Data API → "Project URL"
//   Project Settings → API Keys → Legacy API keys → "anon public"
//
// La clave "anon" es publica a proposito: viaja en cada visita. Lo que
// protege los datos son las reglas de acceso de la base, no esta clave.
//
// NUNCA poner aca la clave "service_role" ni la contrasena de la base:
// esas saltean todas las reglas.

const valores = {
  url: 'https://auuxcwvpgghzzmmodrlf.supabase.co',
  clave: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF1dXhjd3ZwZ2doenptbW9kcmxmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNjAxODQsImV4cCI6MjEwNTgzNjE4NH0.TW_A9Gfe5dCl8YKTZsxJjm7KafKYczPp0-O4WBUOvqA'
};

// El panel de Supabase muestra la direccion de varias formas. Se acepta
// cualquiera: si viene con /rest/v1 o con barra al final, se acomoda sola.
function acomodarUrl(direccion) {
  return String(direccion || '')
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/rest\/v1$/i, '')
    .replace(/\/auth\/v1$/i, '')
    .replace(/\/+$/, '');
}

export const config = {
  url: acomodarUrl(valores.url),
  clave: String(valores.clave || '').trim(),

  // Nombre del deposito de archivos. Solo cambiarlo si lo renombraste.
  deposito: 'documentacion',

  // Tamano maximo por archivo, en MB. Tiene que coincidir con el limite
  // configurado en el deposito de Supabase.
  maxArchivoMb: 25
};

// Permite probar contra otra instalacion sin tocar este archivo:
// en la consola del navegador, localStorage.setItem('engel:url', '...')
try {
  config.url = acomodarUrl(localStorage.getItem('engel:url')) || config.url;
  config.clave = (localStorage.getItem('engel:clave') || '').trim() || config.clave;
} catch {
  // Sin localStorage se usan los valores de arriba.
}

export const estaConfigurado = () => Boolean(config.url && config.clave);
