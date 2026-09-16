// =====================================================================
// Configuracion de la web — ESTE ES EL UNICO ARCHIVO QUE HAY QUE EDITAR
// =====================================================================
//
// Los dos valores salen del panel de Supabase:
//   Project Settings → API → "Project URL" y "anon public"
//
// La clave "anon" es publica a proposito: viaja en cada visita. Lo que
// protege los datos son las politicas de la base, no esta clave.

export const config = {
  url: '',
  clave: '',

  // Nombre del deposito de archivos. Solo cambiarlo si lo renombraste.
  deposito: 'documentacion',

  // Tamano maximo por archivo, en MB. Tiene que coincidir con el limite
  // configurado en el deposito de Supabase.
  maxArchivoMb: 25
};

// Permite probar contra otra instalacion sin tocar este archivo:
// en la consola del navegador, localStorage.setItem('engel:url', '...')
try {
  config.url = localStorage.getItem('engel:url') || config.url;
  config.clave = localStorage.getItem('engel:clave') || config.clave;
} catch {
  // Sin localStorage se usan los valores de arriba.
}

export const estaConfigurado = () => Boolean(config.url && config.clave);
