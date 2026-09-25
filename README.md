# Engel · Administracion de ventas

Web para cargar y seguir las ventas de vehiculos de la concesionaria. La usan
todos los vendedores desde la computadora o el celular, entrando a un link.

**Es gratis.** No hay servidor que pagar: la web son archivos sueltos que
publica cualquier hosting gratuito, y los datos y la documentacion viven en
Supabase, que tiene un plan gratuito con 500 MB de base y 1 GB de archivos.

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
- **Fecha de entrega estimada**: la web avisa las entregas proximas y las
  vencidas.
- **Detalles extras**: notas de la operacion con autor y fecha.
- **Infracciones**: cuantas multas tiene cada auto (vendido, permuta o en
  stock) en cada municipio, y si se pagaron. Un boton por municipio abre su
  pagina de consulta con el dominio listo para pegar.
- **Nada se pierde**: todo cambio se guarda solo, se reintenta si falla y
  queda registrado en un historial con el antes y el despues.

## Quien puede entrar

El link es publico, el contenido no. Para entrar hacen falta dos cosas:

1. Que un administrador haya **invitado tu email** desde la solapa Equipo.
2. Que hayas creado tu cuenta con **ese mismo email**, eligiendo tu contrasena.

Quien se registra sin invitacion crea una cuenta pero **no ve absolutamente
nada**: ni una venta, ni un auto, ni un archivo. Eso no depende de que la web
lo esconda, lo impide la base de datos.

---

## Ponerla en marcha (una sola vez, unos 15 minutos)

### 1. Crear el proyecto en Supabase

1. Entrar a <https://supabase.com> y crear una cuenta (gratis, sin tarjeta).
2. **New project**. Elegir un nombre, una contrasena para la base (guardala) y
   la region mas cercana (por ejemplo *South America (Sao Paulo)*).
3. Esperar un par de minutos a que termine de crearse.

### 2. Crear las tablas

1. En el menu de la izquierda: **SQL Editor** → **New query**.
2. Abrir el archivo [`supabase/instalar.sql`](supabase/instalar.sql) de este
   repositorio, copiar **todo** el contenido y pegarlo ahi.
3. Apretar **Run**.

Al terminar, abajo en **Results** aparece una tabla con el resultado:

| control | estado | detalle |
| --- | --- | --- |
| Tablas de datos | OK | 15 de 15 |
| Funciones del sistema | OK | 12 de 12 |
| Reglas de acceso a los datos | OK | 29 reglas |
| Deposito de documentacion | OK | creado |
| Reglas de acceso a los archivos | OK | 4 de 4 |
| **>>> RESULTADO** | **TODO LISTO** | Ya podes conectar la web |

Si en la fila de los archivos dijera que faltan, el detalle explica como
crearlas a mano desde **Storage → documentacion → Policies**. Todo lo demas
queda instalado igual.

Para comprobar esto en cualquier momento, sin reinstalar nada, se puede pegar
y correr [`supabase/verificar.sql`](supabase/verificar.sql).

Se puede volver a ejecutar cuando sea: no borra ni duplica nada.

#### Si la base ya estaba instalada de antes

Lo mejor es dejar activadas las **actualizaciones automaticas** (ver abajo):
asi la base se pone al dia sola cada vez que cambia el codigo.

A mano tambien se puede: **SQL Editor** → **New query**, pegar todo el
contenido de [`supabase/actualizar.sql`](supabase/actualizar.sql) y apretar
**Run**. Termina con una tabla de resultado, no borra datos y se puede correr
las veces que haga falta. Si la base se queda atras, la web lo avisa con una
barra roja arriba de todo.

#### Actualizaciones automaticas de la base (una sola vez, 5 minutos)

La web se publica sola en Netlify. Para que la base tambien se actualice sola,
GitHub necesita poder conectarse a Supabase. Se le da ese permiso con un
**secreto**: queda cifrado en GitHub, no aparece en el codigo (que es publico)
ni en los registros, y solo lo usa la tarea
[`actualizar-base.yml`](.github/workflows/actualizar-base.yml).

1. **La contrasena de la base.** Es la que se eligio al crear el proyecto de
   Supabase. Si no la tenes: **Project Settings → Database → Reset database
   password**, y guardala en un lugar seguro. No la mandes por chat ni la
   pegues en ningun archivo.
2. **La cadena de conexion.** En Supabase, boton **Connect** (arriba) →
   **Session pooler** → copiar la URI. Tiene esta forma:
   `postgresql://postgres.xxxxx:[YOUR-PASSWORD]@aws-0-....pooler.supabase.com:5432/postgres`.
   Reemplaza `[YOUR-PASSWORD]` por la contrasena (sin los corchetes). Tiene que
   ser la de **Session pooler**: la "Direct connection" no funciona desde
   GitHub.
3. **Guardarla en GitHub.** En el repositorio: **Settings → Secrets and
   variables → Actions → New repository secret**. Nombre: `SUPABASE_DB_URL`.
   Valor: la cadena del paso 2. **Add secret**.
4. **Probarla.** Solapa **Actions → Actualizar la base → Run workflow**. En un
   minuto aparece el resultado con la misma tabla que da el SQL Editor. Si
   algo falla, la base queda exactamente como estaba (todo corre en una sola
   transaccion).

Desde ahi, cada cambio en la carpeta `supabase/` se aplica solo. Sin el
secreto la tarea no hace nada: la base queda como esta y se puede seguir
actualizando a mano.

### 3. Conectar la web con la base

1. En Supabase, boton **Connect** (arriba) → pestaña **App Frameworks**: ahi
   aparecen las dos cosas. Tambien estan en **Project Settings → Data API**
   (Project URL) y **Project Settings → API Keys → Legacy API keys** (anon).
   La Project URL es `https://` + el codigo que aparece en la barra del
   navegador despues de `dashboard/project/` + `.supabase.co`.
2. Copiar **Project URL** y la clave **anon public** (o la *publishable*, que
   empieza con `sb_publishable_`: sirve igual).
3. Pegarlas en el archivo [`public/js/config.js`](public/js/config.js):

```js
export const config = {
  url: 'https://abcdefgh.supabase.co',
  clave: 'eyJhbGciOi...',
  ...
};
```

> La clave `anon` es publica a proposito: viaja en cada visita. Lo que protege
> los datos son los permisos de la base, no esta clave.

### 4. Publicar la web

Cualquiera de estas opciones es gratis y sirve igual:

**Netlify** (la mas simple)
1. Entrar a <https://app.netlify.com> → **Add new site** → **Import an
   existing project** y conectar este repositorio de GitHub.
2. No hay nada que configurar: el archivo `netlify.toml` ya dice que publique
   la carpeta `public`.
3. Netlify te da el link. Ese es el que se comparte.

**Cloudflare Pages**: conectar el repositorio, dejar vacio el comando de
compilacion y poner `public` como carpeta de salida.

**Vercel**: conectar el repositorio; el archivo `vercel.json` ya esta listo.

**GitHub Pages**: en Settings → Pages, publicar la rama y la carpeta `public`.

### 5. Primer ingreso

1. Abrir el link y elegir **Crear mi cuenta**.
2. **El primero que se registra queda como administrador.** Que sea la persona
   que va a administrar el sistema.
3. Desde **Equipo** → **Sumar a alguien**, invitar el email de cada companero.
4. Pasarles el link: cada uno elige **Crear mi cuenta** con el email invitado y
   arma su propia contrasena. Vos nunca ves las claves de los demas.

### 6. Una recomendacion antes de repartir el link

En Supabase, **Authentication** → **Providers** → **Email**, dejar activada la
confirmacion por correo. Asi nadie puede registrarse con un email que no es
suyo.

---

## Como se usa

1. **Cargar venta**: del auto alcanza con **dominio, marca, modelo y ano**, mas
   si es propio o esta en consigna. De la operacion, **fecha, quien vendio,
   estado, y nombre, celular y DNI del comprador**. Lo demas (precio, sena,
   forma de pago, entrega estimada, version, color, kilometraje) esta en las
   secciones "Mas datos", plegadas. Al guardar se generan solos los checklists
   de documentacion.
2. **Editar**: en la ficha de la venta se cambia cualquier dato directamente
   sobre el campo. No hay boton de guardar: se guarda solo.
3. **Documentacion**: cada documento pasa por cuatro estados, en este orden:
   **Faltante → Pedido → En proceso → Aprobado**. Solo los aprobados cuentan
   como terminados. Desde la ficha se sube el archivo de cada uno; al subirlo
   queda aprobado automaticamente. Tambien se puede cambiar el estado a mano y
   dejar una observacion.
4. **Documentacion pendiente**: la solapa Documentacion muestra todos los autos
   con papeles faltantes, ordenados por la entrega mas cercana.
5. **Buscar dominio**: se escribe la patente y aparece el auto, todas las
   operaciones donde figura (como vendido o como permuta) y el boton para bajar
   toda la documentacion en un ZIP.
6. **Infracciones**: ver la seccion siguiente.

### Infracciones

No se cargan una por una: por cada auto se anota **cuantas infracciones tiene
en cada municipio**. No importa de cuando son.

1. **Cargar las paginas de consulta una sola vez.** En la solapa
   Infracciones, abajo, "Agregar pagina": un nombre (CABA, Provincia, Pilar…)
   y el link de la pagina donde se consultan las multas, copiado de la barra
   del navegador.
2. **Cargar infracciones.** Boton "Cargar infracciones": el dominio y, en cada
   renglon, un municipio y la cantidad. Opcionalmente, **quien las resuelve**
   (sugiere los nombres del equipo, pero puede ser cualquiera, por ejemplo un
   gestor) y **detalles**, que quedan ocultos detras del boton "📝 Detalles".
   "Otro municipio" suma renglones. Si ese municipio ya estaba cargado para el
   auto, se actualiza la cantidad.
3. **Ver un auto.** Se escribe el dominio (sugiere mientras escribis) y aparece
   un renglon por municipio: el boton "Consultar", la cantidad, el estado,
   quien las resuelve y el comprobante. Los detalles se
   ven tocando "📝 Ver detalles" debajo del municipio. Todo se edita ahi mismo y se guarda
   solo. Al tocar "Consultar" se abre la pagina del municipio y **el dominio
   queda copiado**: en la pagina se toca el campo de la patente y se pega
   (Ctrl+V, o mantener apretado en el celular). El captcha lo completa la
   persona: esas paginas lo ponen justamente para que ningun programa pueda
   consultarlas solo.
4. **Anotar lo que se encontro.** En los municipios sin nada cargado: "No
   tiene" o "Tiene multas" (que abre la carga con ese municipio ya puesto).
   Queda registrado quien reviso y cuando, asi se sabe si un auto "no tiene
   multas" o si "nadie se fijo todavia".
5. **Seguir el pago.** Cada municipio pasa por **Impaga → En gestion →
   Pagada** (o Anulada). Al marcarlo pagado se anota sola la fecha de pago.
6. **El seguimiento general**, arriba en la solapa: un renglon por auto con
   sus municipios, cuantas multas hay por resolver y quien las resuelve. El numero
   rojo del menu cuenta las multas por resolver.

**Truco para que el dominio se complete solo:** algunas paginas muestran la
patente en el link despues de consultar (por ejemplo
`...consulta?dominio=AB123CD`). Si pasa eso, se guarda ese link cambiando la
patente por `{dominio}`: `...consulta?dominio={dominio}`. Desde ahi, el boton
abre la pagina con la patente ya puesta. La tabla de paginas indica cuales
"completan el dominio" y cuales lo copian.

## Que se guarda solo (y por que no se pierde nada)

La regla es simple: **no hay boton de "guardar" que alguien pueda olvidarse de
apretar**.

- **Cada campo, por separado.** Apenas terminas de escribir un dato (o salis
  del campo), se guarda y aparece "Guardado ✓" al lado. Como cada campo viaja
  solo, dos personas pueden editar la misma venta al mismo tiempo sin pisarse.
- **Si falla, se reintenta.** Los cambios pasan por una cola con esperas cada
  vez mas largas. Abajo a la derecha hay un cartel que dice si quedo algo
  pendiente.
- **Sin internet tambien.** La cola queda guardada en el navegador. Podes
  seguir trabajando sin conexion o cerrar el navegador: cuando la web vuelve a
  abrir, los cambios se mandan solos.
- **Borradores de lo que estas cargando.** Mientras completas una venta nueva,
  lo escrito se guarda como borrador (en el navegador al instante y en la base
  a los pocos segundos). Si cerras sin terminar, al volver te ofrece
  recuperarlo, incluso desde otra computadora. El borrador se borra recien
  cuando la base confirma la venta.
- **Aviso al cerrar** si quedara algo sin confirmar.
- **Archivos con reintento**: si se corta la conexion mientras sube un PDF, se
  reintenta solo sin tener que elegir el archivo de nuevo.

### Historial: el antes y el despues

Cada movimiento queda registrado con quien lo hizo, cuando, y **el valor
anterior**. Se ve con el boton **Historial** en la ficha de la venta.

Lo escriben disparadores de la base de datos, no la web: **nadie lo puede
falsear, editar ni borrar**, ni siquiera un administrador. Si alguien pisa un
dato por error, el valor viejo sigue estando. Y si se borra una venta, queda
una copia completa de toda la operacion.

### Varios usando la web al mismo tiempo

- Las escrituras van en transacciones: no se mezclan.
- Cargar una venta es todo o nada: nunca queda media venta cargada.
- Un mismo dominio no puede estar en dos ventas abiertas, y la base lo impide
  aunque dos personas lo intenten en el mismo segundo.
- La pantalla se actualiza sola: cada pocos segundos se fija si alguien
  (otra persona, vos desde otra pestana o vos mismo) cambio algo, y si cambio,
  la redibuja con lo nuevo. Nunca mientras estas escribiendo, con una ventana
  abierta, subiendo un archivo, con cambios sin guardar o cargando una venta
  nueva: en esos casos espera a que termines. Los filtros y lo que tenias
  desplegado quedan como estaban.
- Cuando se publica una version nueva de la web, las pestanas abiertas se
  recargan solas (con el mismo cuidado).

## Descargar la informacion

- **Ventas en CSV**: boton "Exportar CSV" en el listado. Respeta los filtros
  puestos y se abre en Excel o Google Sheets.
- **Documentacion en CSV**: boton "Exportar CSV" en la solapa Documentacion.
- **Documentacion de un auto**: boton "ZIP" en la ficha del dominio o en la
  venta.
- **Copia de todo**: en la solapa Equipo, "Descargar copia de todo" baja un
  archivo con toda la informacion (ventas, autos, permutas, documentacion,
  notas e historial). Conviene guardarla de vez en cuando.

Supabase ademas hace sus propias copias de seguridad diarias.

## Limites del plan gratuito

| Recurso | Limite | Alcanza para |
| --- | --- | --- |
| Base de datos | 500 MB | decenas de miles de ventas |
| Archivos | 1 GB | unos 250 autos con sus 8 documentos escaneados |
| Transferencia | 5 GB por mes | uso normal de un equipo chico |

Si algun dia queda corto, el plan pago de Supabase arranca en USD 25 por mes y
no hay que cambiar nada de la web. Mientras tanto, conviene bajar la copia
completa cada tanto y guardarla aparte.

> Los proyectos gratuitos de Supabase se pausan si no reciben ni una consulta
> durante 7 dias seguidos. Con uso diario eso no pasa; si llegara a pasar, se
> reactivan desde el panel con un boton.

---

## Para desarrollar

```bash
npm install          # solo herramientas de desarrollo
npm run dev          # web en http://localhost:4000
npm run check        # revisa la sintaxis y los imports de public/js
npm run prueba-sql   # 84 verificaciones del esquema contra PostgreSQL
npm run prueba-web   # recorre la web entera en un navegador de verdad
```

Las pruebas de SQL y de la web necesitan un PostgreSQL local:

```bash
sudo apt-get install -y postgresql-16
sudo -u postgres /usr/lib/postgresql/16/bin/initdb -D /var/lib/engel-pg -U engel --auth=trust
sudo -u postgres /usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/engel-pg -o "-p 5433 -k /tmp" start
```

### Como esta armado

```
public/                 La web (HTML, CSS y JavaScript sin compilar)
  js/config.js          Lo unico que hay que editar
  js/api.js             Todo lo que se guarda y se consulta
  js/guardado.js        Cola de guardado automatico con reintentos
  js/borradores.js      Formularios a medio completar
  js/campo-auto.js      Campos que se guardan solos
  js/sugeridor.js       Campo de dominio que sugiere mientras se escribe
  js/descargas.js       ZIP, CSV y copia completa, armados en el navegador
  js/sincronizacion.js  Aviso de cambios de otras personas
  js/vistas/            Una pantalla por archivo

supabase/
  instalar.sql          Todo junto, para pegar de una vez
  actualizar.sql        Para poner al dia una base ya instalada
  01-esquema.sql        Tablas e indices
  02-seguridad.sql      Permisos, invitaciones y historial automatico
  03-funciones.sql      Logica de negocio (validaciones y transacciones)
  04-consultas.sql      Consultas que arma la base
  05-almacenamiento.sql Deposito de archivos
  06-permisos.sql       Permisos de tabla
  pruebas/              Verificaciones del esquema

herramientas/
  servidor-local.js     Servidor estatico para desarrollar
  marcar-version.js     Anota la version publicada (para recargar pestanas)
  revisar-web.js        Revisa sintaxis e imports
  pruebas/              Doble de Supabase para probar sin tocar la nube
```

Sin framework ni paso de compilacion: el navegador carga los archivos de
`public/` tal como estan.

### Notas tecnicas

- Las validaciones y las transacciones viven en funciones de PostgreSQL, no en
  el navegador: no se pueden saltear desde la consola.
- Cada tabla tiene politicas de acceso (RLS). Sin sesion valida y perfil activo
  no se ve ni una fila, y lo mismo para los archivos.
- El historial lo escriben disparadores `AFTER INSERT/UPDATE/DELETE`, dentro de
  la misma transaccion que el cambio.
- Los dominios se normalizan a mayusculas sin espacios y se validan los cuatro
  formatos que circulan en el pais: autos `AAA123` (anterior a 2016) y
  `AB123CD` (Mercosur); motos `123ABC` (anterior a 2016) y `A123BCD` (Mercosur).
- Los archivos se guardan con un nombre unico por venta, auto y tipo de
  documento, asi dos personas que suben a la vez no se pisan.
- El ZIP y los CSV se arman en el navegador, sin servidor propio.

### Version anterior

Antes de pasar a Supabase, este mismo sistema funcionaba con un servidor Node y
SQLite. Sigue en el historial de git (commit `f91a865`) por si alguna vez se
quiere instalar en un servidor propio.
