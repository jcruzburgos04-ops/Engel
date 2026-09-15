# Engel · Administracion de ventas

Web para cargar y seguir las ventas de vehiculos de la concesionaria. La usan
todos los vendedores desde la computadora o el celular, y todo queda guardado
en una base de datos que se puede consultar y descargar cuando haga falta.

## Que resuelve

- **Cargar la venta**: quien la vendio, que auto, si es propio o esta en
  consigna, el dominio y la descripcion para reconocerlo de un vistazo.
- **Permutas vinculadas**: el auto que entrega el comprador queda conectado a
  la venta que compra, con el valor que se le tomo.
- **Documentacion**: cada auto de la operacion genera automaticamente su
  checklist de 8 documentos —titulo, informe de dominio, multas, patentes,
  formulario 08, cedula, verificacion policial y VTV—. Se sube el archivo de
  cada uno y queda guardado para descargarlo despues.
- **Buscar por dominio**: si pasa algo con un auto, se busca la patente y se
  baja toda su documentacion en un ZIP.
- **Fecha de entrega estimada**: la web avisa las entregas proximas y las que
  ya estan vencidas.
- **Detalles extras**: notas de la operacion con autor y fecha.

## Arrancar en tu computadora

Hace falta [Node.js](https://nodejs.org) 18 o superior.

```bash
npm install
cp .env.example .env     # abrir el .env y cambiar SESSION_SECRET
npm start
```

Despues entrar a <http://localhost:3000>.

La primera vez se crea solo el usuario administrador con los datos del `.env`
(por defecto `admin@engel.com` / `engel1234`). **Cambiale la contrasena desde
la web apenas ingreses**, con el boton "Clave" abajo a la izquierda.

Para probarla con datos de ejemplo:

```bash
npm run seed
```

Crea cuatro ventas, dos permutas y tres usuarios (`admin@engel.com`,
`lucia@engel.com` y `martin@engel.com`, todos con la contrasena `engel1234`).
El script no toca nada si la base ya tiene ventas cargadas.

## Publicarla para todo el equipo

La aplicacion es un servidor Node con una base SQLite y una carpeta de
archivos. Lo unico importante es que **la base y los archivos vivan en un disco
que no se borre al actualizar**.

### Con Docker (lo mas simple)

```bash
export SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
export ADMIN_EMAIL=tuemail@engel.com
export ADMIN_PASSWORD=una-clave-larga
docker compose up -d
```

La base y la documentacion quedan en el volumen `engel-datos`, montado en
`/datos` dentro del contenedor.

### En un servidor propio o una VPS

1. Clonar el repositorio y correr `npm ci --omit=dev`.
2. Crear el `.env` con `SESSION_SECRET`, `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
3. Levantarlo con un gestor de procesos (`systemd`, `pm2`) para que se
   reinicie solo.
4. Poner un proxy con HTTPS adelante (Nginx, Caddy) y definir
   `SECURE_COOKIES=true` en el `.env`.

### En Render, Railway o similar

Sirve cualquier plataforma que corra Node y permita montar un disco
persistente. Configurar:

- Comando de arranque: `npm start`
- Disco persistente montado en, por ejemplo, `/datos`
- Variables: `DB_PATH=/datos/engel.db`, `UPLOAD_DIR=/datos/documentacion`,
  `SESSION_SECRET=...`, `SECURE_COOKIES=true`

> Sin disco persistente la informacion se pierde en cada despliegue.

## Configuracion

Todo se define en el archivo `.env` (ver `.env.example`):

| Variable | Para que sirve | Por defecto |
| --- | --- | --- |
| `PORT` | Puerto del servidor | `3000` |
| `SESSION_SECRET` | Clave con la que se firman las sesiones | obligatoria en produccion |
| `DB_PATH` | Archivo de la base de datos | `./data/engel.db` |
| `UPLOAD_DIR` | Carpeta de la documentacion cargada | `./uploads` |
| `MAX_FILE_MB` | Tamano maximo por archivo | `25` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` / `ADMIN_NOMBRE` | Administrador que se crea la primera vez | `admin@engel.com` / `engel1234` |
| `SECURE_COOKIES` | Poner en `true` si la web se sirve por HTTPS | `false` |

## Como se usa

1. **Equipo**: un administrador da de alta a cada vendedor con su email y su
   contrasena. Los vendedores cargan y editan ventas; los administradores
   ademas crean usuarios y pueden borrar ventas.
2. **Cargar venta**: se completa el auto que se vende (dominio, descripcion y
   si es propio o consigna), los datos de la operacion, la fecha de entrega
   estimada y, si hay, las permutas. Al guardar se generan solos los
   checklists de documentacion.
3. **Documentacion**: desde la ficha de la venta se sube el archivo de cada
   documento. Al subir un archivo el item pasa a "Listo" automaticamente.
   Tambien se puede marcar a mano "En tramite" o "No aplica" y dejar una
   observacion.
4. **Documentacion pendiente**: la solapa "Documentacion" muestra todos los
   autos con papeles faltantes, ordenados por la entrega mas cercana.
5. **Buscar dominio**: se escribe la patente y aparece el auto, todas las
   operaciones donde figura (como vendido o como permuta) y el boton para
   bajar toda la documentacion en un ZIP.

## Descargar la informacion

- **Ventas en CSV**: boton "Exportar CSV" en el listado. Respeta los filtros
  que esten aplicados y se abre en Excel o en Google Sheets.
- **Documentacion en CSV**: boton "Exportar CSV" en la solapa Documentacion.
- **Documentacion de un auto**: boton "ZIP" en la ficha del dominio o en la
  venta.
- **Base completa**: boton "Descargar base de datos" en la solapa Equipo (solo
  administradores). Guarda una copia del archivo SQLite.

### Copia de seguridad

Alcanza con copiar el archivo de la base (`DB_PATH`) y la carpeta de
documentacion (`UPLOAD_DIR`). Con Docker, ambos estan dentro del volumen:

```bash
docker run --rm -v engel-datos:/datos -v "$PWD":/backup alpine \
  tar czf /backup/engel-backup-$(date +%F).tar.gz -C /datos .
```

## Desarrollo

```bash
npm run dev    # servidor con recarga automatica
npm test       # pruebas end-to-end de la API
```

### Como esta armado

```
src/
  server.js          Servidor Express y manejo de errores
  config.js          Lectura del .env
  db.js              Conexion SQLite y creacion del esquema
  schema.sql         Tablas e indices
  lib/               Validaciones y logica de negocio
  routes/            Endpoints de la API
  scripts/seed.js    Datos de ejemplo
public/              La web (HTML, CSS y JavaScript sin compilar)
test/api.test.js     Pruebas de la API
```

Sin framework de frontend ni paso de compilacion: el navegador carga los
archivos de `public/` tal como estan.

### Notas tecnicas

- Los dominios se normalizan a mayusculas sin espacios y se valida el formato
  viejo (`AAA123`), el del Mercosur (`AB123CD`) y el de motos (`A123BCD`).
- Un mismo dominio no puede estar en dos ventas activas a la vez.
- Los archivos se guardan en disco con un nombre aleatorio; el nombre original
  queda en la base para la descarga.
- Las sesiones son cookies `HttpOnly` firmadas, con 12 horas de duracion.
- Las contrasenas se guardan con `bcrypt`.
