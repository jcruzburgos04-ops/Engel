// Infracciones: cuantas multas tiene cada auto en cada municipio, y el
// seguimiento de si se pagaron. No se cargan una por una: por dominio se
// anota la cantidad en cada municipio (y el total, si se sabe).
//
// Las paginas de multas de los municipios tienen captcha, asi que no se
// pueden consultar solas. Lo que si se puede: guardar el link de cada una y
// que el boton "Consultar" la abra con el dominio ya copiado para pegarlo (o
// ya puesto, si esa pagina acepta la patente en el link).

import { api } from '../api.js';
import { campoAuto } from '../campo-auto.js';
import { esperarGuardado } from '../guardado.js';
import { campoDominioSugerido } from '../sugeridor.js';
import { descargarArchivo } from '../descargas.js';
import {
  h, vaciar, avisar, confirmar, abrirModal, campo, campoAncho, opciones, vacio,
  fecha, fechaHora, tamano, etiquetaDominio, descripcionVehiculo,
  dominioEsValido, normalizarDominio, formatearDominio,
  copiarAlPortapapeles, linkDePortal, portalCompletaSolo,
  ESTADOS_INFRACCION, mientrasTrabaja, recordar, recordado
} from '../util.js';
import { encabezado, navegar, estado, refrescarPendientes } from '../app.js';

const LISTA_ESTADOS = Object.entries(ESTADOS_INFRACCION).map(([valor, info]) => ({ valor, texto: info.texto }));

const FILTROS = [
  { valor: 'abiertas', texto: 'Con multas por resolver' },
  { valor: 'pagadas', texto: 'Al dia (todo pagado)' },
  { valor: 'todas', texto: 'Todos' }
];

const AYUDA_DOMINIO = 'Revisa el dominio. Autos: AAA123 o AB123CD. Motos: 123ABC o A123BCD.';
function leerCantidad(texto) {
  const t = String(texto ?? '').trim();
  return /^\d+$/.test(t) && Number(t) >= 1 ? Number(t) : null;
}

// ---------------------------------------------------------------------
// Boton que abre la pagina del municipio con el dominio listo para pegar
// ---------------------------------------------------------------------

function botonConsultar(portal, dominio, clase = 'boton') {
  const d = normalizarDominio(dominio);
  const completaSolo = portalCompletaSolo(portal.url);

  // Es un link comun (no window.open) para que el navegador no lo bloquee
  // como ventana emergente. El dominio se copia en el mismo clic, antes de
  // que se abra la otra pestana.
  return h(
    'a',
    {
      class: clase,
      href: linkDePortal(portal.url, d),
      target: '_blank',
      rel: 'noopener noreferrer',
      title: completaSolo
        ? `Abre la pagina de ${portal.nombre} con el dominio ya puesto`
        : `Abre la pagina de ${portal.nombre} y copia ${d} para pegarlo`,
      'aria-label': `Consultar en ${portal.nombre}`,
      onClick: () => {
        const copiado = copiarAlPortapapeles(d);
        if (completaSolo) {
          avisar(`Se abrio ${portal.nombre} con el dominio ${formatearDominio(d)} ya puesto.`);
        } else if (copiado) {
          avisar(`Dominio ${d} copiado. En la pagina toca el campo de la patente y pega (Ctrl+V, o mantene apretado en el celular).`);
        } else {
          avisar(`No se pudo copiar solo: escribi ${d} en la pagina de ${portal.nombre}.`, 'error');
        }
      }
    },
    '🔎 Consultar'
  );
}


// Boton que muestra u oculta los detalles. Mientras estan ocultos, el boton
// avisa si hay algo escrito.
// `contenedor` es lo que se muestra u oculta (por defecto, el mismo texto).
function botonDetalles(area, { contenedor = area, alCambiar } = {}) {
  const boton = h('button', { class: 'boton boton--chico boton--detalles', type: 'button' });
  const pintar = () => {
    const hay = area.value.trim() !== '';
    boton.textContent = contenedor.hidden ? (hay ? '📝 Ver detalles' : '📝 Detalles') : '📝 Ocultar detalles';
    boton.classList.toggle('boton--con-detalles', hay);
    boton.setAttribute('aria-expanded', String(!contenedor.hidden));
  };
  boton.addEventListener('click', () => {
    contenedor.hidden = !contenedor.hidden;
    if (!contenedor.hidden) area.focus();
    if (alCambiar) alCambiar(!contenedor.hidden);
    pintar();
  });
  area.addEventListener('input', pintar);
  pintar();
  return boton;
}

// ---------------------------------------------------------------------
// Cargar: un dominio y cuantas infracciones tiene en cada municipio
// ---------------------------------------------------------------------

export function abrirCargaInfracciones({ dominio = '', portales = [], municipio = '', alGuardar } = {}) {
  const sugeridor = campoDominioSugerido({ placeholder: 'AB123CD' });
  sugeridor.entrada.value = normalizarDominio(dominio);

  // Los municipios conocidos se sugieren al escribir, pero se puede poner
  // cualquier otro.
  const idLista = `municipios-${Date.now()}`;
  const conocidos = h('datalist', { id: idLista }, ...portales.map((p) => h('option', { value: p.nombre })));

  // Quien las resuelve: se sugieren los nombres del equipo, pero se puede
  // escribir cualquiera (un gestor, por ejemplo).
  const idEquipo = `equipo-${Date.now()}`;
  const equipo = h('datalist', { id: idEquipo });
  api.usuarios()
    .then(({ usuarios }) => equipo.append(...usuarios.map((u) => h('option', { value: u.nombre }))))
    .catch(() => {});

  const filas = h('div', { class: 'carga-municipios' });

  function agregarFila(nombre = '') {
    const municipioInput = h('input', { value: nombre, placeholder: 'Municipio (ej. CABA, Pilar)', class: 'carga__municipio' });
    municipioInput.setAttribute('list', idLista);
    const cantidad = h('input', { type: 'number', min: 1, step: 1, value: '1', inputMode: 'numeric', class: 'carga__cantidad' });
    const responsable = h('input', { placeholder: 'Quien las resuelve (opcional)', class: 'carga__responsable' });
    responsable.setAttribute('list', idEquipo);
    const detalles = h('textarea', { rows: 2, placeholder: 'Detalles (opcional)', class: 'carga__detalles', hidden: true });

    const bloque = h(
      'div',
      { class: 'carga__bloque' },
      h(
        'div',
        { class: 'carga__fila' },
        h('label', {}, h('span', { class: 'carga__rotulo' }, 'Municipio'), municipioInput),
        h('label', {}, h('span', { class: 'carga__rotulo' }, 'Infracciones'), cantidad),
        h('button', {
          class: 'boton boton--chico',
          type: 'button',
          title: 'Quitar este municipio',
          onClick: () => { if (filas.children.length > 1) bloque.remove(); }
        }, '×')
      ),
      h(
        'div',
        { class: 'carga__extra' },
        responsable,
        botonDetalles(detalles)
      ),
      detalles
    );
    bloque.leer = () => ({
      municipio: municipioInput.value.trim(),
      cantidad: cantidad.value,
      responsable: responsable.value.trim(),
      detalles: detalles.value.trim()
    });
    filas.append(bloque);
    return { municipioInput, cantidad };
  }

  const primera = agregarFila(municipio);

  const marca = h('input', { placeholder: 'Marca' });
  const modelo = h('input', { placeholder: 'Modelo' });
  const error = h('div', { class: 'aviso aviso--error', style: 'display:none' });
  const mostrarError = (texto) => { error.textContent = texto; error.style.display = ''; };
  const botonGuardar = h('button', { class: 'boton boton--primario', type: 'button' }, 'Guardar');

  botonGuardar.addEventListener('click', async () => {
    error.style.display = 'none';
    const d = normalizarDominio(sugeridor.entrada.value);
    if (!dominioEsValido(d)) return mostrarError(AYUDA_DOMINIO);

    const cargadas = [];
    for (const fila of filas.children) {
      const { municipio: m, cantidad, responsable, detalles } = fila.leer();
      if (!m && !responsable && !detalles) continue; // renglon vacio: se ignora
      if (!m) return mostrarError('Falta el municipio en uno de los renglones.');
      const n = leerCantidad(cantidad);
      if (n === null) return mostrarError(`La cantidad de infracciones en ${m} tiene que ser un numero mayor a cero.`);
      cargadas.push({ municipio: m, cantidad: n, responsable, detalles });
    }
    if (!cargadas.length) return mostrarError('Pone al menos un municipio con su cantidad de infracciones.');

    botonGuardar.disabled = true;
    botonGuardar.textContent = 'Guardando…';
    try {
      await api.guardarInfracciones({ dominio: d, filas: cargadas, marca: marca.value.trim(), modelo: modelo.value.trim() });
      ref.cerrar();
      const total = cargadas.reduce((suma, f) => suma + f.cantidad, 0);
      avisar(`${formatearDominio(d)}: ${total} infraccion(es) en ${cargadas.length} municipio(s).`);
      await refrescarPendientes();
      if (alGuardar) alGuardar(d);
    } catch (err) {
      mostrarError(err.message);
      botonGuardar.disabled = false;
      botonGuardar.textContent = 'Guardar';
    }
    return undefined;
  });

  const ref = abrirModal({
    titulo: 'Cargar infracciones',
    cuerpo: h(
      'div',
      {},
      error,
      conocidos,
      equipo,
      h('div', { class: 'campos' }, campo('Dominio', sugeridor.contenedor)),
      h('p', { class: 'tenue', style: 'font-size:.85rem;margin:.9rem 0 .4rem' },
        'Cuantas infracciones tiene en cada municipio. Si el municipio ya estaba cargado para este auto, se actualiza.'),
      filas,
      h('button', { class: 'boton boton--chico', type: 'button', style: 'margin-top:.5rem',
        onClick: () => agregarFila().municipioInput.focus() }, '➕ Otro municipio'),
      h(
        'details',
        { class: 'mas-datos' },
        h('summary', {}, 'Si el auto todavia no esta cargado (opcional)'),
        h('div', { class: 'campos' }, campo('Marca', marca), campo('Modelo', modelo))
      )
    ),
    acciones: [
      h('button', { class: 'boton', type: 'button', onClick: () => ref.cerrar() }, 'Cancelar'),
      botonGuardar
    ]
  });

  // El foco va a lo primero que falta completar.
  if (!dominio) sugeridor.entrada.focus();
  else if (!municipio) primera.municipioInput.focus();
  else primera.cantidad.select();
  return ref;
}

// ---------------------------------------------------------------------
// Paginas de consulta
// ---------------------------------------------------------------------

function abrirEditorPortal(portal, alGuardar) {
  const nombre = h('input', { value: portal?.nombre || '', placeholder: 'CABA, Provincia de Buenos Aires, Pilar…' });
  const url = h('input', { value: portal?.url || '', placeholder: 'https://…', inputMode: 'url' });
  const notas = h('input', { value: portal?.notas || '', placeholder: 'Ej. pide captcha, elegir "Dominio"' });
  const orden = h('input', { type: 'number', value: portal?.orden ?? 0, style: 'max-width:7rem' });
  const error = h('div', { class: 'aviso aviso--error', style: 'display:none' });

  const guardar = async () => {
    error.style.display = 'none';
    try {
      await api.guardarPortal({
        id: portal?.id,
        nombre: nombre.value,
        url: url.value,
        notas: notas.value,
        orden: orden.value,
        activo: portal ? portal.activo : true
      });
      ref.cerrar();
      avisar(portal ? 'Pagina actualizada.' : 'Pagina agregada.');
      alGuardar();
    } catch (err) {
      error.textContent = err.message;
      error.style.display = '';
    }
  };

  const ref = abrirModal({
    titulo: portal ? 'Editar pagina de consulta' : 'Agregar pagina de consulta',
    cuerpo: h(
      'div',
      {},
      error,
      h(
        'div',
        { class: 'campos' },
        campo('Nombre', nombre, 'Como aparece en el boton "Consultar en …"'),
        campo('Orden', orden, 'Las de numero mas chico van primero'),
        campoAncho('Link', url,
          'Copialo entero de la barra del navegador, estando en la pagina donde se consultan las multas.'),
        campoAncho('Notas', notas)
      ),
      h(
        'p',
        { class: 'tenue', style: 'font-size:.85rem;margin:.75rem 0 0' },
        'Truco: si al consultar una patente en esa pagina el link del navegador cambia y la muestra ' +
          '(por ejemplo "…?dominio=AB123CD"), pega ese link y cambia la patente por {dominio}. ' +
          'Asi la pagina se abre con el dominio ya puesto. Si no, el boton copia el dominio para pegarlo.'
      )
    ),
    acciones: [
      h('button', { class: 'boton', type: 'button', onClick: () => ref.cerrar() }, 'Cancelar'),
      h('button', { class: 'boton boton--primario', type: 'button', onClick: guardar }, 'Guardar')
    ]
  });
}

function seccionPortales(portales, alCambiar) {
  const esAdmin = estado.usuario && estado.usuario.rol === 'admin';

  const filas = portales.map((p) =>
    h(
      'tr',
      { class: p.activo ? '' : 'fila--apagada' },
      h('td', {}, h('strong', {}, p.nombre), p.notas ? h('div', { class: 'mini' }, p.notas) : null),
      h('td', { class: 'celda-link' }, h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.url)),
      h('td', {}, portalCompletaSolo(p.url)
        ? h('span', { class: 'etiqueta etiqueta--ok' }, 'Completa el dominio')
        : h('span', { class: 'etiqueta' }, 'Copia el dominio')),
      h('td', {}, p.activo ? 'Si' : 'No'),
      h(
        'td',
        { class: 'acciones' },
        h('button', { class: 'boton boton--chico', type: 'button', onClick: () => abrirEditorPortal(p, alCambiar) }, 'Editar'),
        h(
          'button',
          {
            class: 'boton boton--chico',
            type: 'button',
            onClick: async () => {
              try {
                await api.guardarPortal({ ...p, activo: !p.activo });
                alCambiar();
              } catch (err) {
                avisar(err.message, 'error');
              }
            }
          },
          p.activo ? 'Desactivar' : 'Activar'
        ),
        esAdmin
          ? h(
              'button',
              {
                class: 'boton boton--chico boton--peligro',
                type: 'button',
                onClick: async () => {
                  if (!(await confirmar(`Vas a borrar la pagina "${p.nombre}". Las multas cargadas no se borran.`, { textoBoton: 'Borrar' }))) return;
                  try {
                    await api.borrarPortal(p.id);
                    avisar('Pagina borrada.');
                    alCambiar();
                  } catch (err) {
                    avisar(err.message, 'error');
                  }
                }
              },
              'Borrar'
            )
          : null
      )
    )
  );

  return h(
    'section',
    { class: 'tarjeta', id: 'paginas-de-consulta' },
    h(
      'div',
      { class: 'tarjeta__titulo' },
      '🌐 Paginas de consulta de multas',
      h('span', { class: 'tenue' }, 'las de cada municipio o provincia'),
      h('span', { class: 'derecha' },
        h('button', { class: 'boton boton--chico', type: 'button', onClick: () => abrirEditorPortal(null, alCambiar) }, '➕ Agregar pagina'))
    ),
    portales.length
      ? h('div', { class: 'tabla-scroll' },
          h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, 'Nombre'), h('th', {}, 'Link'), h('th', {}, 'Dominio'), h('th', {}, 'Activa'), h('th', {}))),
            h('tbody', {}, ...filas)))
      : h('div', { class: 'tarjeta__cuerpo' },
          vacio('Todavia no hay paginas. Agrega las que usan para consultar multas (CABA, Provincia, cada municipio) y van a aparecer como botones en cada auto.', '🌐'))
  );
}


// ---------------------------------------------------------------------
// Listado general: un renglon por auto
// ---------------------------------------------------------------------

function indicador(valor, etiqueta, modificador = '') {
  return h(
    'div',
    { class: `indicador ${modificador}` },
    h('div', { class: 'indicador__valor' }, String(valor ?? 0)),
    h('div', { class: 'indicador__etiqueta' }, etiqueta)
  );
}

function chipMunicipio(m) {
  const info = ESTADOS_INFRACCION[m.estado] || { clase: '' };
  const titulo = [info.texto || m.estado, m.responsable ? `resuelve ${m.responsable}` : '']
    .filter(Boolean).join(' · ');
  return h('span', { class: `etiqueta ${info.clase}`, title: titulo },
    `${m.municipio} · ${m.cantidad}`);
}

function tablaAutos(filas) {
  if (!filas.length) return vacio('No hay autos con ese filtro.', '✅');

  return h(
    'div',
    { class: 'tabla-scroll' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'Dominio'), h('th', {}, 'Auto'), h('th', {}, 'Infracciones por municipio'),
        h('th', {}, 'Por resolver'), h('th', {}, 'Quien las resuelve'),
        h('th', {}, 'Actualizado'))),
      h(
        'tbody',
        {},
        ...filas.map((f) =>
          h(
            'tr',
            { class: 'fila-link', onClick: () => navegar(`infracciones/${f.dominio}`) },
            h('td', {}, h('a', { href: `#/infracciones/${f.dominio}` }, etiquetaDominio(f.dominio))),
            h('td', {}, f.vehiculo || '—'),
            h('td', {}, h('div', { class: 'chips' }, ...f.municipios.map(chipMunicipio))),
            h('td', {}, f.abiertas ? h('strong', {}, String(f.abiertas)) : h('span', { class: 'etiqueta etiqueta--ok' }, 'Al dia')),
            h('td', {}, f.responsables || h('span', { class: 'tenue' }, '—')),
            h('td', { class: 'mini' }, fecha(f.actualizado_en))
          )
        )
      )
    )
  );
}

export async function vistaInfracciones() {
  const [listado, portales] = await Promise.all([
    api.listarInfracciones({ filtro: recordado('infracciones:filtro', 'abiertas'), q: recordado('infracciones:texto', '') }),
    api.portales()
  ]);
  const contenedor = h('div', {});

  const irAlDominio = (valor) => {
    const d = normalizarDominio(valor);
    if (!dominioEsValido(d)) {
      avisar(AYUDA_DOMINIO, 'error');
      return;
    }
    navegar(`infracciones/${d}`);
  };

  const sugeridor = campoDominioSugerido({
    placeholder: 'AB123CD',
    style: 'font-size:1.15rem;padding:.7rem .9rem',
    alElegir: irAlDominio
  });

  const indicadores = h('div', { class: 'grilla grilla--tarjetas', style: 'margin-bottom:1.25rem' });
  const cuerpoTabla = h('div', {});
  const filtro = opciones(h('select', {}), FILTROS, recordado('infracciones:filtro', 'abiertas'));
  const texto = h('input', { type: 'search', placeholder: 'Buscar por dominio, municipio o quien resuelve', value: recordado('infracciones:texto', '') });

  function pintarListado(datos) {
    const r = datos.resumen || {};
    vaciar(indicadores).append(
      indicador(r.abiertas, 'Multas por resolver', r.abiertas ? 'indicador--alerta' : ''),
      indicador(r.autos_con_abiertas, 'Autos con multas'),
      indicador(r.autos_al_dia, 'Autos al dia')
    );
    vaciar(cuerpoTabla).append(tablaAutos(datos.filas || []));
  }

  let pedido = 0;
  let reloj;
  async function recargarListado() {
    recordar('infracciones:filtro', filtro.value);
    recordar('infracciones:texto', texto.value);
    const mio = ++pedido;
    try {
      const datos = await api.listarInfracciones({ filtro: filtro.value, q: texto.value.trim() });
      if (mio === pedido) pintarListado(datos);
    } catch (err) {
      if (mio === pedido) vaciar(cuerpoTabla).append(h('div', { class: 'aviso aviso--error' }, err.message));
    }
  }
  filtro.addEventListener('change', recargarListado);
  texto.addEventListener('input', () => { clearTimeout(reloj); reloj = setTimeout(recargarListado, 300); });

  const zonaPortales = h('div', {});
  async function recargarPortales() {
    try {
      vaciar(zonaPortales).append(seccionPortales(await api.portales(), recargarPortales));
    } catch (err) {
      avisar(err.message, 'error');
    }
  }

  pintarListado(listado);
  zonaPortales.append(seccionPortales(portales, recargarPortales));

  contenedor.append(
    encabezado(
      'Infracciones',
      'Cuantas multas tiene cada auto en cada municipio, y si se pagaron',
      h('button', {
        class: 'boton boton--primario',
        type: 'button',
        onClick: async () => abrirCargaInfracciones({
          portales: (await api.portales()).filter((p) => p.activo),
          alGuardar: (d) => navegar(`infracciones/${d}`)
        })
      }, '➕ Cargar infracciones')
    ),
    h(
      'section',
      { class: 'tarjeta' },
      h(
        'div',
        { class: 'tarjeta__cuerpo' },
        h('form', {
          onSubmit: (e) => { e.preventDefault(); sugeridor.cerrar(); irAlDominio(sugeridor.entrada.value); }
        },
        h('label', { class: 'etiqueta-campo' }, 'Ver o consultar las multas de un auto'),
        h('div', { style: 'display:flex;gap:.5rem;align-items:stretch' },
          sugeridor.contenedor,
          h('button', { class: 'boton boton--primario', type: 'submit' }, 'Ver multas'))),
        h('p', { class: 'tenue', style: 'font-size:.85rem;margin:.5rem 0 0' },
          'Sirve aunque el auto no este cargado: vas a ver los botones para consultarlo en cada municipio.')
      )
    ),
    indicadores,
    h(
      'section',
      { class: 'tarjeta' },
      h('div', { class: 'tarjeta__titulo' }, '🚨 Seguimiento',
        h('span', { class: 'derecha', style: 'display:flex;gap:.5rem;flex-wrap:wrap' }, texto, filtro)),
      cuerpoTabla
    ),
    zonaPortales
  );

  return contenedor;
}

// ---------------------------------------------------------------------
// Un dominio: un renglon por municipio
// ---------------------------------------------------------------------

function comprobantes(infraccion, recargar) {
  const entrada = h('input', { type: 'file', multiple: true, style: 'display:none' });
  const boton = h('button', { class: 'boton boton--chico', type: 'button', onClick: () => entrada.click() }, '⬆️ Subir');

  entrada.addEventListener('change', async () => {
    if (!entrada.files.length) return;
    const elegidos = [...entrada.files];
    boton.disabled = true;
    boton.textContent = 'Subiendo…';
    try {
      await mientrasTrabaja(api.subirComprobantes(infraccion.id, elegidos));
      avisar(`${elegidos.length} archivo(s) cargados.`);
      recargar();
    } catch (err) {
      avisar(`${err.message} El archivo no se subio: volve a intentarlo.`, 'error');
      boton.disabled = false;
      boton.textContent = '⬆️ Comprobante';
    }
    entrada.value = '';
  });

  const chips = infraccion.archivos.map((archivo) =>
    h(
      'span',
      { class: 'archivo', title: `${archivo.nombre_original} · ${tamano(archivo.tamano)} · ${fechaHora(archivo.subido_en)}` },
      h('a', {
        href: '#',
        onClick: async (e) => {
          e.preventDefault();
          try {
            await descargarArchivo(archivo);
          } catch (err) {
            avisar(err.message, 'error');
          }
        }
      }, `📄 ${archivo.nombre_original}`),
      h('button', {
        type: 'button',
        title: 'Borrar archivo',
        onClick: async () => {
          if (!(await confirmar(`Vas a borrar "${archivo.nombre_original}".`, { textoBoton: 'Borrar archivo' }))) return;
          try {
            await api.borrarComprobante(archivo.id);
            recargar();
          } catch (err) {
            avisar(err.message, 'error');
          }
        }
      }, '×')
    )
  );

  return h('div', { class: 'doc-item__archivos', style: 'align-items:center' }, boton, entrada, ...chips);
}


// Junta las paginas de consulta con lo cargado: cada municipio aparece una
// sola vez, tenga o no infracciones.
function renglonesPorMunicipio(datos) {
  const renglones = datos.portales.map((portal) => ({ nombre: portal.nombre, portal, infraccion: null }));
  for (const infraccion of datos.infracciones) {
    const mismo = renglones.find((r) =>
      (infraccion.portal_id && r.portal && r.portal.id === infraccion.portal_id) ||
      r.nombre.trim().toLowerCase() === infraccion.municipio.trim().toLowerCase());
    if (mismo && !mismo.infraccion) mismo.infraccion = infraccion;
    else renglones.push({ nombre: infraccion.municipio, portal: null, infraccion });
  }
  // Primero los que tienen algo por resolver, despues el resto.
  const peso = (r) => (!r.infraccion ? 1 : ['impaga', 'en_gestion'].includes(r.infraccion.estado) ? 0 : 2);
  return renglones.sort((a, b) => peso(a) - peso(b));
}

function textoUltimaConsulta(portal) {
  const ultima = portal && portal.ultima_consulta;
  if (!ultima) return portal ? 'Nadie lo reviso todavia' : '';
  return `${ultima.resultado === 'sin_infracciones' ? '✅ Sin multas' : '⚠️ Con multas'} · ${ultima.consultado_por_nombre || 'alguien'}, ${fechaHora(ultima.consultado_en)}`;
}

function tablaMunicipios(datos, { recargar, recargarCuandoSePueda, cargar, equipo = [] }) {
  const d = datos.dominio;
  const renglones = renglonesPorMunicipio(datos);
  const idEquipo = `equipo-${d}`;
  const listaEquipo = h('datalist', { id: idEquipo }, ...equipo.map((nombre) => h('option', { value: nombre })));

  if (!renglones.length) {
    return vacio('Todavia no hay municipios. Agrega las paginas de consulta en la solapa Infracciones, o carga un municipio con "Cargar infracciones".', '🌐');
  }

  const registrar = async (portal, resultado) => {
    try {
      await api.registrarConsulta(d, portal.id, resultado);
      if (resultado === 'con_infracciones') cargar(portal.nombre);
      else avisar(`Anotado: ${formatearDominio(d)} sin multas en ${portal.nombre}.`);
      recargar();
    } catch (err) {
      avisar(err.message, 'error');
    }
  };

  const campoMulta = (infraccion, control, nombre, extra = {}) =>
    campoAuto({
      control,
      campo: nombre,
      operacion: 'editar_infraccion',
      clave: `infraccion:${infraccion.id}:${nombre}`,
      armarArgs: (valor) => ({
        id: infraccion.id,
        cambios: { [nombre]: valor }
      }),
      alConfirmar: recargarCuandoSePueda,
      ...extra
    });

  const filas = renglones.map(({ nombre, portal, infraccion }) => {
    const celdaMunicipio = h('td', {},
      h('strong', {}, nombre),
      portal ? h('div', { class: 'mini' }, textoUltimaConsulta(portal)) : null,
      portal && portal.notas ? h('div', { class: 'mini' }, portal.notas) : null);
    const celdaConsultar = h('td', {}, portal ? botonConsultar(portal, d, 'boton boton--chico') : h('span', { class: 'mini' }, 'Sin pagina'));

    if (!infraccion) {
      return h(
        'tr',
        { class: 'municipio municipio--vacio' },
        celdaMunicipio,
        celdaConsultar,
        h('td', { colSpan: 4 },
          h('div', { class: 'municipio__preguntar' },
            h('span', { class: 'mini' }, '¿Que encontraste?'),
            h('button', { class: 'boton boton--chico', type: 'button', onClick: () => registrar(portal, 'sin_infracciones') }, '✅ No tiene'),
            h('button', { class: 'boton boton--chico', type: 'button', onClick: () => registrar(portal, 'con_infracciones') }, '⚠️ Tiene multas'))),
        h('td', {})
      );
    }

    const cantidad = h('input', { type: 'number', min: 1, step: 1, value: String(infraccion.cantidad), inputMode: 'numeric', class: 'municipio__cantidad' });
    const selectorEstado = opciones(h('select', {}), LISTA_ESTADOS, infraccion.estado);
    const responsable = h('input', { value: infraccion.responsable || '', placeholder: '—', class: 'municipio__responsable' });
    responsable.setAttribute('list', idEquipo);

    // Los detalles van en un renglon aparte, oculto hasta que se pide verlo.
    const detalles = h('textarea', { rows: 3, placeholder: 'Detalles: tramite, gestor, plan de pago, a quien se llamo…' });
    detalles.value = infraccion.observaciones || '';
    const claveAbierto = `infracciones:detalles:${infraccion.id}`;
    const filaDetalles = h(
      'tr',
      { class: 'municipio__fila-detalles', hidden: !recordado(claveAbierto, false) },
      h('td', { colSpan: 7 }, campoMulta(infraccion, detalles, 'observaciones', { alConfirmar: undefined }))
    );
    const verDetalles = botonDetalles(detalles, {
      contenedor: filaDetalles,
      alCambiar: (abierto) => recordar(claveAbierto, abierto)
    });
    celdaMunicipio.append(h('div', { class: 'municipio__detalles' }, verDetalles));

    const quitar = async () => {
      if (!(await confirmar(`Vas a quitar ${nombre} de las infracciones de ${formatearDominio(d)}. Queda una copia en el historial.`, { textoBoton: 'Quitar' }))) return;
      try {
        await api.borrarInfraccion(infraccion.id);
        avisar(`${nombre} quitado.`);
        recargar();
      } catch (err) {
        avisar(err.message, 'error');
      }
    };

    return [h(
      'tr',
      { class: `municipio municipio--${infraccion.estado}` },
      celdaMunicipio,
      celdaConsultar,
      h('td', {}, campoMulta(infraccion, cantidad, 'cantidad', {
        leerValor: (el) => leerCantidad(el.value),
        validar: (valor) => (valor === null ? 'Tiene que ser 1 o mas. Si ya no tiene, marcala pagada o quitala.' : '')
      })),
      h('td', {}, campoMulta(infraccion, selectorEstado, 'estado'),
        infraccion.estado === 'pagada' && infraccion.fecha_pago ? h('div', { class: 'mini' }, `el ${fecha(infraccion.fecha_pago)}`) : null),
      h('td', {}, campoMulta(infraccion, responsable, 'responsable')),
      h('td', {}, comprobantes(infraccion, recargar)),
      h('td', { class: 'acciones' },
        h('button', { class: 'boton boton--chico', type: 'button', title: 'Quitar este municipio', onClick: quitar }, 'Quitar'))
    ), filaDetalles];
  });

  return h(
    'div',
    { class: 'tabla-scroll' },
    listaEquipo,
    h(
      'table',
      { class: 'tabla-municipios' },
      h('thead', {}, h('tr', {},
        h('th', {}, 'Municipio'), h('th', {}, 'Consultar'), h('th', {}, 'Infracciones'),
        h('th', {}, 'Estado'), h('th', {}, 'Quien las resuelve'),
        h('th', {}, 'Comprobante'), h('th', {}))),
      h('tbody', {}, ...filas)
    )
  );
}

// Nombres del equipo para sugerir en "Quien las resuelve". Se piden una vez.
let nombresDelEquipo = [];
let pedidoEquipo = null;
function cargarNombresDelEquipo() {
  if (!pedidoEquipo) {
    pedidoEquipo = api.usuarios()
      .then(({ usuarios }) => { nombresDelEquipo = usuarios.map((u) => u.nombre).filter(Boolean); })
      .catch(() => { pedidoEquipo = null; });
  }
  return pedidoEquipo;
}

export async function vistaInfraccionesDominio({ dominio }) {
  const d = normalizarDominio(dominio);
  if (!dominioEsValido(d)) {
    return h('div', {},
      encabezado('Infracciones'),
      h('div', { class: 'aviso aviso--error' }, `"${dominio}" no es un dominio valido. Autos: AAA123 o AB123CD. Motos: 123ABC o A123BCD.`),
      h('a', { class: 'boton', href: '#/infracciones' }, 'Volver'));
  }

  const contenedor = h('div', {});

  async function recargar() {
    const datos = await api.infraccionesDeDominio(d);
    await refrescarPendientes();
    if (contenedor.isConnected) vaciar(contenedor).append(...pintar(datos));
  }

  // Redibujar borraria lo que se este escribiendo: se espera a que no haya
  // ningun campo con el foco y a que todo este guardado.
  let reloj;
  function recargarCuandoSePueda() {
    clearTimeout(reloj);
    reloj = setTimeout(async function intentar() {
      const activo = document.activeElement;
      const escribiendo = activo && ['INPUT', 'TEXTAREA'].includes(activo.tagName);
      if (escribiendo || !contenedor.isConnected) {
        if (contenedor.isConnected) reloj = setTimeout(intentar, 1500);
        return;
      }
      await esperarGuardado(5000);
      if (contenedor.isConnected) recargar();
    }, 600);
  }

  function pintar(datos) {
    const v = datos.vehiculo;
    const r = datos.resumen || {};
    const cargar = (municipio = '') => abrirCargaInfracciones({
      dominio: d,
      portales: datos.portales,
      municipio,
      alGuardar: () => recargar()
    });

    let resumen = 'Infracciones y consulta de multas';
    if (r.abiertas) resumen = `${r.abiertas} multa(s) por resolver en ${r.municipios_abiertos} municipio(s)`;
    else if (r.total) resumen = 'Sin multas por resolver';

    return [
      encabezado(
        h('span', { style: 'display:inline-flex;gap:.6rem;align-items:center;flex-wrap:wrap' },
          etiquetaDominio(d), v ? descripcionVehiculo(v) || 'Sin marca ni modelo' : 'Infracciones'),
        resumen,
        h('a', { class: 'boton', href: '#/infracciones' }, '← Todos los autos'),
        v ? h('a', { class: 'boton', href: `#/buscador/${d}` }, 'Ficha del dominio') : null
      ),
      h(
        'section',
        { class: 'tarjeta' },
        h('div', { class: 'tarjeta__titulo' }, '🚨 Infracciones por municipio',
          h('span', { class: 'tenue' }, `"Consultar" abre la pagina y copia ${d} para pegarlo`),
          h('span', { class: 'derecha' },
            h('button', { class: 'boton boton--primario boton--chico', type: 'button', onClick: () => cargar('') }, '➕ Agregar municipio'))),
        tablaMunicipios(datos, { recargar, recargarCuandoSePueda, cargar, equipo: nombresDelEquipo })
      ),
      v ? null : h('p', { class: 'tenue', style: 'font-size:.85rem' },
        'Este dominio todavia no esta cargado en el sistema. Si le cargas infracciones, se da de alta.')
    ].filter(Boolean);
  }

  const [datos] = await Promise.all([api.infraccionesDeDominio(d), cargarNombresDelEquipo()]);
  contenedor.append(...pintar(datos));
  return contenedor;
}
