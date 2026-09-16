'use strict';

// Doble de Supabase para las pruebas automatizadas.
//
// Habla con el PostgreSQL local usando el MISMO esquema, las mismas funciones
// y las mismas politicas de acceso que se instalan en Supabase. Lo unico que
// se imita es la cascara: autenticacion, tablas y deposito de archivos.
//
// No se usa en produccion. Sirve para poder probar la web de verdad.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const PUERTO = Number(process.env.PUERTO_FALSO) || 5555;
const DEPOSITO = path.join(__dirname, 'deposito');
const CONEXION = {
  host: process.env.PGHOST || '/tmp',
  port: Number(process.env.PGPORT) || 5433,
  user: process.env.PGUSER || 'engel',
  database: process.env.PGDATABASE || 'engel_web'
};

fs.mkdirSync(DEPOSITO, { recursive: true });

// Las sesiones viven en memoria (duran lo que dura el proceso), pero las
// contrasenas van a la base: asi recrear la base deja todo como nuevo.
const sesiones = new Map(); // token -> { id, email }

// Un grupo de conexiones reusables con limite de espera. Abrir una conexion
// nueva por pedido, sin limite, dejaba pedidos colgados para siempre cuando
// varias pantallas consultaban a la vez.
const grupo = new Pool({
  ...CONEXION,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
  statement_timeout: 15000
});

grupo.on('error', (error) => console.error('[falso] error en el grupo de conexiones:', error.message));

async function conectar() {
  return grupo.connect();
}

// Corre una consulta con el rol y el usuario correctos, para que las
// politicas de acceso se apliquen igual que en Supabase.
async function comoUsuario(usuarioId, trabajo) {
  const cliente = await conectar();
  try {
    await cliente.query('BEGIN');
    await cliente.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [usuarioId || '']);
    await cliente.query('SET LOCAL ROLE authenticated');
    const resultado = await trabajo(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (error) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    cliente.release();
  }
}

function comillas(nombre) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(nombre)) throw new Error(`Identificador invalido: ${nombre}`);
  return `"${nombre}"`;
}

// Arma el SQL de una operacion de tabla, con parametros (nada concatenado).
function armarConsulta(pedido) {
  const { tabla, accion, columnas = '*', filtros = [], valores, orden = [], conflicto } = pedido;
  const t = comillas(tabla);
  const parametros = [];
  const p = (valor) => `$${parametros.push(valor)}`;

  // Se arma en el momento en que hace falta: si se arma antes quedan
  // parametros sin usar y Postgres no puede deducirles el tipo.
  const armarDonde = () =>
    filtros.length
      ? ' WHERE ' + filtros.map((f) => `${comillas(f.columna)} = ${p(f.valor)}`).join(' AND ')
      : '';

  if (accion === 'select') {
    const donde = armarDonde();
    const orden_sql = orden.length
      ? ' ORDER BY ' + orden.map((o) => `${comillas(o.columna)} ${o.ascendente ? 'ASC' : 'DESC'}`).join(', ')
      : '';
    return { texto: `SELECT ${columnas === '*' ? '*' : columnas} FROM ${t}${donde}${orden_sql}`, parametros };
  }

  if (accion === 'insert' || accion === 'upsert') {
    const filas = Array.isArray(valores) ? valores : [valores];
    const campos = Object.keys(filas[0]);
    const grupos = filas
      .map((fila) => `(${campos.map((c) => p(fila[c])).join(', ')})`)
      .join(', ');
    let texto = `INSERT INTO ${t} (${campos.map(comillas).join(', ')}) VALUES ${grupos}`;
    if (accion === 'upsert' && conflicto) {
      const llaves = conflicto.split(',').map((c) => comillas(c.trim())).join(', ');
      const set = campos
        .filter((c) => !conflicto.split(',').map((x) => x.trim()).includes(c))
        .map((c) => `${comillas(c)} = EXCLUDED.${comillas(c)}`)
        .join(', ');
      texto += ` ON CONFLICT (${llaves}) DO UPDATE SET ${set || campos.map((c) => `${comillas(c)} = EXCLUDED.${comillas(c)}`).join(', ')}`;
    }
    return { texto: `${texto} RETURNING *`, parametros };
  }

  if (accion === 'update') {
    const campos = Object.keys(valores);
    const set = campos.map((c) => `${comillas(c)} = ${p(valores[c])}`).join(', ');
    return { texto: `UPDATE ${t} SET ${set}${armarDonde()} RETURNING *`, parametros };
  }

  if (accion === 'delete') {
    return { texto: `DELETE FROM ${t}${armarDonde()} RETURNING *`, parametros };
  }

  throw new Error(`Accion desconocida: ${accion}`);
}

function responder(res, codigo, cuerpo) {
  res.writeHead(codigo, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': '*'
  });
  res.end(JSON.stringify(cuerpo));
}

function errorDe(error) {
  return { message: error.message, code: error.code || '' };
}

const RUTAS = {
  async 'auth/signup'({ email, password, nombre }) {
    const limpio = String(email).toLowerCase();
    if (String(password).length < 8) throw new Error('Password should be at least 8 characters');

    const cliente = await conectar();
    let usuario;
    try {
      const existe = await cliente.query('SELECT 1 FROM auth.claves WHERE email = $1', [limpio]);
      if (existe.rowCount) throw new Error('User already registered');

      const { rows } = await cliente.query(
        'INSERT INTO auth.users (email, raw_user_meta_data) VALUES ($1, $2) RETURNING id, email',
        [limpio, JSON.stringify({ nombre: nombre || '' })]
      );
      usuario = rows[0];
      await cliente.query('INSERT INTO auth.claves (email, clave) VALUES ($1, $2)', [limpio, password]);
    } finally {
      cliente.release();
    }

    const token = crypto.randomUUID();
    sesiones.set(token, usuario);
    return { user: usuario, session: { access_token: token, user: usuario } };
  },

  async 'auth/signin'({ email, password }) {
    const limpio = String(email).toLowerCase();

    const cliente = await conectar();
    let usuario;
    try {
      const guardada = await cliente.query('SELECT clave FROM auth.claves WHERE email = $1', [limpio]);
      if (!guardada.rowCount || guardada.rows[0].clave !== password) {
        throw new Error('Invalid login credentials');
      }
      const { rows } = await cliente.query('SELECT id, email FROM auth.users WHERE email = $1', [limpio]);
      usuario = rows[0];
    } finally {
      cliente.release();
    }
    if (!usuario) throw new Error('Invalid login credentials');

    const token = crypto.randomUUID();
    sesiones.set(token, usuario);
    return { user: usuario, session: { access_token: token, user: usuario } };
  },

  async 'auth/signout'({ token }) {
    sesiones.delete(token);
    return { ok: true };
  },

  async 'auth/session'({ token }) {
    const usuario = sesiones.get(token);
    return usuario
      ? { user: usuario, session: { access_token: token, user: usuario } }
      : { user: null, session: null };
  },

  async 'auth/update'({ token, password }) {
    const usuario = sesiones.get(token);
    if (!usuario) throw new Error('Not authenticated');
    if (password) {
      if (String(password).length < 8) throw new Error('Password should be at least 8 characters');
      const cliente = await conectar();
      try {
        await cliente.query('UPDATE auth.claves SET clave = $1 WHERE email = $2', [password, usuario.email]);
      } finally {
        cliente.release();
      }
    }
    return { user: usuario };
  },

  async 'auth/recuperar'() {
    return { ok: true };
  },

  async rpc({ token, funcion, argumentos }) {
    const usuario = sesiones.get(token);
    const nombres = Object.keys(argumentos || {});
    const lista = nombres.map((n, i) => `${comillas(n)} => $${i + 1}`).join(', ');
    const valores = nombres.map((n) => {
      const v = argumentos[n];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });

    return comoUsuario(usuario && usuario.id, async (cliente) => {
      const { rows, fields } = await cliente.query(
        `SELECT public.${comillas(funcion)}(${lista}) AS resultado`,
        valores
      );
      void fields;
      return rows[0] ? rows[0].resultado : null;
    });
  },

  async tabla(pedido) {
    const usuario = sesiones.get(pedido.token);
    const { texto, parametros } = armarConsulta(pedido);
    return comoUsuario(usuario && usuario.id, async (cliente) => {
      const { rows } = await cliente.query(texto, parametros);
      return rows;
    });
  },

  async 'storage/upload'({ token, ruta, contenido, tipo }) {
    const usuario = sesiones.get(token);
    if (!usuario) throw new Error('permission denied');

    const destino = path.join(DEPOSITO, ruta);
    if (!destino.startsWith(DEPOSITO)) throw new Error('Ruta invalida');
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, Buffer.from(contenido, 'base64'));

    return comoUsuario(usuario.id, async (cliente) => {
      await cliente.query(
        `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('documentacion', $1, $2)
         ON CONFLICT (bucket_id, name) DO NOTHING`,
        [ruta, usuario.id]
      );
      return { path: ruta, tipo };
    });
  },

  async 'storage/download'({ token, ruta }) {
    if (!sesiones.get(token)) throw new Error('permission denied');
    const destino = path.join(DEPOSITO, ruta);
    if (!destino.startsWith(DEPOSITO) || !fs.existsSync(destino)) throw new Error('Object not found');
    return { contenido: fs.readFileSync(destino).toString('base64') };
  },

  async 'storage/remove'({ token, rutas }) {
    if (!sesiones.get(token)) throw new Error('permission denied');
    for (const ruta of rutas || []) {
      const destino = path.join(DEPOSITO, ruta);
      if (destino.startsWith(DEPOSITO) && fs.existsSync(destino)) fs.unlinkSync(destino);
    }
    return { ok: true };
  }
};

// La web importa estos modulos por URL. En produccion salen de un CDN;
// en las pruebas los sirve este mismo servidor.
function servirModulo(res, codigo) {
  res.writeHead(200, {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(codigo);
}

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') return responder(res, 204, {});

    if (req.url.startsWith('/supabase-falso.js')) {
      return servirModulo(res, fs.readFileSync(path.join(__dirname, 'supabase-falso.js'), 'utf8'));
    }

    if (req.url.startsWith('/jszip.mjs')) {
      const umd = fs.readFileSync(require.resolve('jszip/dist/jszip.min.js'), 'utf8');
      return servirModulo(res, `const g = globalThis;\n${umd}\nexport default g.JSZip;`);
    }

    if (req.url.startsWith('/descarga')) {
      const ruta = decodeURIComponent(new URL(req.url, 'http://x').searchParams.get('ruta') || '');
      const destino = path.join(DEPOSITO, ruta);
      if (!destino.startsWith(DEPOSITO) || !fs.existsSync(destino)) {
        res.writeHead(404).end('No encontrado');
        return undefined;
      }
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }).end(fs.readFileSync(destino));
      return undefined;
    }

    let cuerpo = '';
    req.on('data', (parte) => { cuerpo += parte; });
    req.on('end', async () => {
      const ruta = req.url.replace(/^\/+/, '');
      const manejador = RUTAS[ruta];
      if (!manejador) return responder(res, 404, { error: { message: `Ruta desconocida: ${ruta}` } });

      try {
        const datos = await manejador(cuerpo ? JSON.parse(cuerpo) : {});
        return responder(res, 200, { data: datos === undefined ? null : datos, error: null });
      } catch (error) {
        return responder(res, 200, { data: null, error: errorDe(error) });
      }
    });
    return undefined;
  })
  .listen(PUERTO, () => console.log(`[falso] Supabase de pruebas en http://127.0.0.1:${PUERTO}`));
