// Reemplazo de @supabase/supabase-js para las pruebas automatizadas.
// Implementa la misma forma de llamada que usa la web, apuntando al
// servidor de pruebas. No se publica: solo lo carga Playwright.

const SERVIDOR = globalThis.__ENGEL_SERVIDOR_FALSO__ || 'http://127.0.0.1:5555';
const LLAVE_TOKEN = 'engel:token-prueba';

// Igual que supabase-js: la sesion entera (token + usuario) se guarda del
// lado del navegador, asi getSession() no necesita pedir nada por la red.
let sesionEnMemoria = null;

function sesion() {
  if (sesionEnMemoria) return sesionEnMemoria;
  try {
    const guardada = localStorage.getItem(LLAVE_TOKEN);
    sesionEnMemoria = guardada ? JSON.parse(guardada) : null;
  } catch {
    sesionEnMemoria = null;
  }
  return sesionEnMemoria;
}

function token() {
  const s = sesion();
  return s ? s.access_token : null;
}

function guardarSesion(valor) {
  sesionEnMemoria = valor || null;
  try {
    if (valor) localStorage.setItem(LLAVE_TOKEN, JSON.stringify(valor));
    else localStorage.removeItem(LLAVE_TOKEN);
  } catch {
    // Sin localStorage la sesion dura lo que dure la pagina.
  }
}

// Muy de vez en cuando un POST al servidor de pruebas se pierde en el camino
// y nunca vuelve: el servidor no lo registra siquiera. Es una limitacion del
// doble (un servidor HTTP minimo de Node contra Chromium), no de la web: en
// produccion esto va por HTTPS contra Supabase.
// Para que las pruebas no fallen por eso, se corta a los 8 segundos y se
// reintenta una vez, avisando por consola para que no pase desapercibido.
const ESPERA_MS = 8000;

async function pedirUnaVez(ruta, cuerpo) {
  const corte = new AbortController();
  const reloj = setTimeout(() => corte.abort(), ESPERA_MS);
  try {
    const respuesta = await fetch(`${SERVIDOR}/${ruta}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cuerpo, token: token() }),
      signal: corte.signal
    });
    return await respuesta.json();
  } finally {
    clearTimeout(reloj);
  }
}

async function pedir(ruta, cuerpo = {}) {
  try {
    return await pedirUnaVez(ruta, cuerpo);
  } catch (error) {
    console.warn(`[doble de pruebas] se perdio el pedido a ${ruta} (${error.name}); se reintenta`);
    return pedirUnaVez(ruta, cuerpo);
  }
}

// Constructor de consultas con la misma cadena de metodos que supabase-js.
function consulta(tabla) {
  const estado = { tabla, accion: 'select', columnas: '*', filtros: [], orden: [], valores: null, conflicto: null };
  let modo = 'muchos';

  const api = {
    select(columnas = '*') {
      if (estado.accion === 'select') estado.columnas = columnas;
      return api;
    },
    eq(columna, valor) {
      estado.filtros.push({ columna, valor });
      return api;
    },
    order(columna, opciones = {}) {
      estado.orden.push({ columna, ascendente: opciones.ascending !== false });
      return api;
    },
    insert(valores) {
      estado.accion = 'insert';
      estado.valores = valores;
      return api;
    },
    upsert(valores, opciones = {}) {
      estado.accion = 'upsert';
      estado.valores = valores;
      estado.conflicto = opciones.onConflict || null;
      return api;
    },
    update(valores) {
      estado.accion = 'update';
      estado.valores = valores;
      return api;
    },
    delete() {
      estado.accion = 'delete';
      return api;
    },
    single() {
      modo = 'uno';
      return api;
    },
    maybeSingle() {
      modo = 'quizas';
      return api;
    },
    async then(resolver, rechazar) {
      try {
        const { data, error } = await pedir('tabla', estado);
        if (error) return resolver({ data: null, error });

        const filas = data || [];
        if (modo === 'uno') {
          if (filas.length !== 1) {
            return resolver({ data: null, error: { message: 'No se encontro el registro', code: 'PGRST116' } });
          }
          return resolver({ data: filas[0], error: null });
        }
        if (modo === 'quizas') return resolver({ data: filas[0] || null, error: null });
        return resolver({ data: filas, error: null });
      } catch (fallo) {
        if (rechazar) return rechazar(fallo);
        return resolver({ data: null, error: { message: fallo.message } });
      }
    }
  };
  return api;
}

function deposito() {
  return {
    async upload(ruta, archivo, opciones = {}) {
      const buffer = await archivo.arrayBuffer();
      let binario = '';
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 1) binario += String.fromCharCode(bytes[i]);
      return pedir('storage/upload', {
        ruta,
        contenido: btoa(binario),
        tipo: opciones.contentType || archivo.type || 'application/octet-stream'
      });
    },
    async download(ruta) {
      const { data, error } = await pedir('storage/download', { ruta });
      if (error) return { data: null, error };
      const binario = atob(data.contenido);
      const bytes = new Uint8Array(binario.length);
      for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
      return { data: new Blob([bytes]), error: null };
    },
    async remove(rutas) {
      return pedir('storage/remove', { rutas });
    },
    async createSignedUrl(ruta) {
      return { data: { signedUrl: `${SERVIDOR}/descarga?ruta=${encodeURIComponent(ruta)}` }, error: null };
    }
  };
}

export function createClient() {
  return {
    from: consulta,
    storage: { from: deposito },

    async rpc(funcion, argumentos) {
      return pedir('rpc', { funcion, argumentos });
    },

    auth: {
      async signInWithPassword({ email, password }) {
        const { data, error } = await pedir('auth/signin', { email, password });
        if (error) return { data: null, error };
        guardarSesion(data.session);
        return { data, error: null };
      },
      async signUp({ email, password, options = {} }) {
        const { data, error } = await pedir('auth/signup', {
          email,
          password,
          nombre: (options.data || {}).nombre
        });
        if (error) return { data: null, error };
        guardarSesion(data.session);
        return { data, error: null };
      },
      async signOut() {
        await pedir('auth/signout');
        guardarSesion(null);
        return { error: null };
      },
      // Sin red: la sesion ya esta guardada del lado del navegador.
      async getSession() {
        const s = sesion();
        return { data: { session: s || null }, error: null };
      },
      async getUser() {
        const s = sesion();
        return { data: { user: (s && s.user) || null }, error: null };
      },
      async updateUser({ password }) {
        return pedir('auth/update', { password });
      },
      async resetPasswordForEmail() {
        return pedir('auth/recuperar');
      }
    }
  };
}

export default { createClient };
