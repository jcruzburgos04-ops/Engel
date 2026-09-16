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
- **Nada se pierde**: todo cambio se guarda solo, se reintenta si falla y
  queda registrado en un historial con el antes y el despues.

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

## Publicarla en internet (link publico)

La web queda en una direccion propia, tipo `https://engel-ventas.onrender.com`,
a la que entran desde cualquier computadora o celular. Cada uno ingresa con su
email y su contrasena: el link es publico, el contenido no, porque adentro hay
datos de clientes (documento, telefono, precios).

> Lo unico que no se puede saltear: **la base y los archivos tienen que vivir en
> un disco persistente**. Si el servicio no ofrece disco, cada actualizacion
> borra todo lo cargado.

### Opcion recomendada: Render

1. Entrar a <https://dashboard.render.com/blueprints> y elegir **New Blueprint**.
2. Conectar este repositorio de GitHub. Render lee el archivo `render.yaml` y
   configura todo solo: el disco, el HTTPS y la clave de sesiones.
3. Cuando lo pida, completar `ADMIN_EMAIL`, `ADMIN_PASSWORD` y `ADMIN_NOMBRE`:
   es el primer usuario con el que se entra.
4. Al terminar, Render muestra el link publico. Ese es el que se comparte.
5. Entrar, cambiar la contrasena (la web insiste hasta que se cambia) y dar de
   alta al resto del equipo desde la solapa **Equipo**.

El plan tiene que ser **starter o superior** (unos USD 7 por mes mas el disco):
el plan gratuito de Render no permite disco persistente.

### Opcion alternativa: Fly.io

Con el archivo `fly.toml` que ya esta en el repositorio:

```bash
fly launch --no-deploy --copy-config
fly volumes create engel_datos --size 5
fly secrets set SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
fly secrets set ADMIN_EMAIL=tuemail@engel.com ADMIN_PASSWORD=una-clave-larga
fly deploy
```

Queda en `https://<nombre-de-la-app>.fly.dev`.

### En un servidor propio o una VPS

1. Clonar el repositorio y correr `npm ci --omit=dev`.
2. Crear el `.env` con `SESSION_SECRET`, `ADMIN_EMAIL` y `ADMIN_PASSWORD`.
3. Levantarlo con `systemd` o `pm2` para que se reinicie solo.
4. Poner Nginx o Caddy adelante con HTTPS, y en el `.env` definir
   `SECURE_COOKIES=true` y `FORZAR_HTTPS=true`.

### Con Docker

```bash
export SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))")
export ADMIN_EMAIL=tuemail@engel.com
export ADMIN_PASSWORD=una-clave-larga
docker compose up -d
```

La base y la documentacion quedan en el volumen `engel-datos`, montado en
`/datos`.

### Antes de compartir el link

- Cambiar la contrasena del administrador (la web lo pide sola).
- Dar de alta a cada companero con su propio usuario: asi queda claro quien
  vendio cada auto y quien cargo cada papel.
- Confirmar que `SECURE_COOKIES=true` (Render y Fly ya lo dejan asi).

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
| `FORZAR_HTTPS` | Redirige de http a https (usar solo detras de un proxy con HTTPS) | `false` |
| `RESPALDO_CADA_MINUTOS` | Cada cuanto se hace una copia automatica de la base (`0` la desactiva) | `180` |
| `RESPALDOS_A_CONSERVAR` | Cuantas copias se guardan antes de borrar las viejas | `24` |

## Como se usa

1. **Equipo**: un administrador da de alta a cada vendedor con su email y su
   contrasena. Los vendedores cargan y editan ventas; los administradores
   ademas crean usuarios y pueden borrar ventas.
2. **Cargar venta**: se completa el auto que se vende (dominio, descripcion y
   si es propio o consigna), los datos de la operacion, la fecha de entrega
   estimada y, si hay, las permutas. Al guardar se generan solos los
   checklists de documentacion.
3. **Editar**: en la ficha de la venta se cambia cualquier dato directamente
   sobre el campo. No hay que apretar "guardar": se guarda solo.
4. **Documentacion**: desde la ficha de la venta se sube el archivo de cada
   documento. Al subir un archivo el item pasa a "Listo" automaticamente.
   Tambien se puede marcar a mano "En tramite" o "No aplica" y dejar una
   observacion.
5. **Documentacion pendiente**: la solapa "Documentacion" muestra todos los
   autos con papeles faltantes, ordenados por la entrega mas cercana.
6. **Buscar dominio**: se escribe la patente y aparece el auto, todas las
   operaciones donde figura (como vendido o como permuta) y el boton para
   bajar toda la documentacion en un ZIP.

## Que se guarda solo (y por que no se pierde nada)

La regla es simple: **no hay boton de "guardar" que alguien pueda olvidarse de
apretar**. Todo se guarda solo.

- **Cada campo, por separado.** En la ficha de una venta, apenas terminas de
  escribir un dato (o salis del campo), se guarda y aparece "Guardado ✓" al
  lado. Como cada campo viaja solo, dos personas pueden editar la misma venta
  al mismo tiempo sin pisarse.
- **Si falla, se reintenta.** Los cambios pasan por una cola que reintenta con
  esperas cada vez mas largas. Abajo a la derecha hay un cartel que dice si
  quedo algo pendiente.
- **Sin internet tambien.** La cola queda guardada en el navegador. Podes
  seguir trabajando sin conexion, cerrar el navegador o quedarte sin bateria:
  cuando la web vuelve a abrir, los cambios se mandan solos.
- **Borradores de lo que estas cargando.** Mientras completas una venta nueva,
  lo escrito se guarda como borrador (en el navegador al instante y en el
  servidor a los pocos segundos). Si cerras sin terminar, al volver te ofrece
  recuperarlo, incluso desde otra computadora. El borrador se borra recien
  cuando el servidor confirma la venta.
- **Aviso al cerrar.** Si quedara algo sin confirmar, el navegador avisa antes
  de cerrar la pestana.
- **Archivos con reintento.** Si se corta la conexion mientras sube un PDF,
  se reintenta solo varias veces sin tener que elegir el archivo de nuevo.

### Historial: el antes y el despues

Cada movimiento queda registrado con quien lo hizo, cuando, y **el valor
anterior**. Se ve con el boton **Historial** en la ficha de la venta.

Si alguien pisa un dato por error, el valor viejo sigue estando en el
historial. Y si se borra una venta, se guarda una copia completa de toda la
operacion (venta, auto, permutas, checklist y notas).

### Varios usando la web al mismo tiempo

- Las escrituras se hacen de a una y en transacciones: no se mezclan.
- La base usa `synchronous = FULL`, o sea que un cambio confirmado ya esta
  escrito en el disco. Un corte de luz no se lleva la ultima carga.
- Si otra persona carga algo mientras tenes la pagina abierta, aparece un
  cartel discreto ofreciendo actualizar. Nunca se te borra lo que estas
  escribiendo.
- Al apagar el servidor se cierra la base de forma ordenada.

### Respaldos automaticos

Cada 3 horas (configurable) se guarda una copia completa de la base en la
carpeta `respaldos`, conservando las ultimas 24. Se pueden ver y descargar
desde la solapa **Equipo**.

## Descargar la informacion

- **Ventas en CSV**: boton "Exportar CSV" en el listado. Respeta los filtros
  que esten aplicados y se abre en Excel o en Google Sheets.
- **Documentacion en CSV**: boton "Exportar CSV" en la solapa Documentacion.
- **Documentacion de un auto**: boton "ZIP" en la ficha del dominio o en la
  venta.
- **Base completa**: boton "Descargar base de datos" en la solapa Equipo (solo
  administradores). Guarda una copia del archivo SQLite.
- **Respaldos automaticos**: la lista de copias de las ultimas horas, tambien
  en la solapa Equipo, con un boton para bajar cualquiera de ellas.

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
public/
  js/guardado.js     Cola de guardado automatico con reintentos
  js/borradores.js   Formularios a medio completar
  js/campo-auto.js   Campos que se guardan solos
  js/sincronizacion.js  Aviso de cambios de otras personas
test/                Pruebas de la API y del guardado
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
- Las contrasenas se guardan con `bcrypt`, y las que pone un administrador
  quedan marcadas como provisorias hasta que la persona las cambia.
- Cada cambio se registra en la tabla `auditoria` con el antes y el despues,
  dentro de la misma transaccion que lo guarda. Si por algun motivo no se
  pudiera escribir, la linea se guarda en `historial-de-emergencia.log`.
- Los formularios a medio completar viven en la tabla `borradores`, uno por
  persona y por formulario.
- `npm test` corre el verificador de la web mas 48 pruebas de la API,
  incluidas las de escrituras en simultaneo.
