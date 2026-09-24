// Infracciones: las multas de cada auto y el seguimiento de los pagos.
//
// Las paginas de multas de los municipios tienen captcha, asi que no se
// pueden consultar solas. Lo que si se puede: guardar el link de cada una y
// que el boton "Consultar" la abra con el dominio ya copiado para pegarlo (o
// ya puesto, si esa pagina acepta la patente en el link).

import { api } from '../api.js';
import { campoAuto, campoAutoAncho } from '../campo-auto.js';
import { esperarGuardado } from '../guardado.js';
import { campoDominioSugerido } from '../sugeridor.js';
import { descargarArchivo } from '../descargas.js';
import {
  h, vaciar, avisar, confirmar, abrirModal, campo, campoAncho, opciones, vacio,
  fecha, fechaHora, tamano, etiquetaDominio, descripcionVehiculo,
  dominioEsValido, normalizarDominio, formatearDominio, leerMonto,
  copiarAlPortapapeles, linkDePortal, portalCompletaSolo,
  ESTADOS_INFRACCION, etiquetaEstadoInfraccion
} from '../util.js';
import { encabezado, navegar, estado, refrescarPendientes } from '../app.js';

const LISTA_ESTADOS = Object.entries(ESTADOS_INFRACCION).map(([valor, info]) => ({ valor, texto: info.texto }));

const FILTROS = [
  { valor: 'abiertas', texto: 'Por resolver (impagas y en gestion)' },
  { valor: 'impagas', texto: 'Solo impagas' },
  { valor: 'pagadas', texto: 'Pagadas' },
  { valor: 'todas', texto: 'Todas' }
];

// Montos sin el signo, como se escriben: "85.000" o "85.000,50".
function montoParaEditar(valor) {
  if (valor === null || valor === undefined || valor === '') return '';
  const n = Number(valor);
  const decimales = Number.isInteger(n) ? 0 : 2;
  return new Intl.NumberFormat('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).format(n);
}

const CAMPOS_NULOS = ['fecha', 'fecha_pago', 'monto'];

// Las multas pueden tener centavos: se muestran si los hay.
function pesos(valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  const n = Number(valor);
  const decimales = Number.isInteger(n) ? 0 : 2;
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', minimumFractionDigits: decimales, maximumFractionDigits: decimales
  }).format(n);
}

const AYUDA_MONTO = 'No se entiende el monto. Escribilo asi: 85.000 o 85000,50';

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
      title: completaSolo ? 'Abre la pagina con el dominio ya puesto' : `Abre la pagina y copia ${d} para pegarlo`,
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
    `🔎 Consultar en ${portal.nombre}`
  );
}

// ---------------------------------------------------------------------
// Alta de una multa
// ---------------------------------------------------------------------

export function abrirNuevaInfraccion({ dominio = '', portales = [], portalId = null, alGuardar } = {}) {
  const sugeridor = campoDominioSugerido({ placeholder: 'AB123CD' });
  sugeridor.entrada.value = normalizarDominio(dominio);
  sugeridor.entrada.required = true;

  const OTRO = 'otro';
  const selectorLugar = opciones(
    h('select', {}),
    [
      ...portales.map((p) => ({ valor: String(p.id), texto: p.nombre })),
      { valor: OTRO, texto: 'Otro lugar…' }
    ],
    portalId ? String(portalId) : (portales[0] ? String(portales[0].id) : OTRO)
  );
  const otroLugar = h('input', { placeholder: 'Municipio o provincia (ej. Pilar)' });
  const campoOtroLugar = campo('¿Cual?', otroLugar);
  const mostrarOtro = () => { campoOtroLugar.style.display = selectorLugar.value === OTRO ? '' : 'none'; };
  selectorLugar.addEventListener('change', mostrarOtro);
  mostrarOtro();

  const acta = h('input', { placeholder: 'Numero de acta o causa' });
  const fechaInfraccion = h('input', { type: 'date' });
  const monto = h('input', { inputMode: 'decimal', placeholder: '85.000' });
  const selectorEstado = opciones(h('select', {}), LISTA_ESTADOS, 'impaga');
  const descripcion = h('input', { placeholder: 'Ej. exceso de velocidad, estacionamiento' });
  const marca = h('input', { placeholder: 'Marca' });
  const modelo = h('input', { placeholder: 'Modelo' });

  const error = h('div', { class: 'aviso aviso--error', style: 'display:none' });
  const mostrarError = (texto) => { error.textContent = texto; error.style.display = ''; };

  const botonGuardar = h('button', { class: 'boton boton--primario', type: 'button' }, 'Guardar infraccion');

  const guardar = async () => {
    error.style.display = 'none';
    const d = normalizarDominio(sugeridor.entrada.value);
    if (!dominioEsValido(d)) {
      return mostrarError('Revisa el dominio. Autos: AAA123 o AB123CD. Motos: 123ABC o A123BCD.');
    }
    const montoLeido = leerMonto(monto.value);
    if (montoLeido === null) return mostrarError(AYUDA_MONTO);
    if (selectorLugar.value === OTRO && !otroLugar.value.trim()) {
      return mostrarError('Decinos donde es la multa (municipio o provincia).');
    }

    botonGuardar.disabled = true;
    botonGuardar.textContent = 'Guardando…';
    try {
      await api.crearInfraccion({
        dominio: d,
        portal_id: selectorLugar.value === OTRO ? null : Number(selectorLugar.value),
        jurisdiccion: selectorLugar.value === OTRO ? otroLugar.value.trim() : '',
        acta: acta.value.trim(),
        fecha: fechaInfraccion.value || null,
        monto: montoLeido,
        estado: selectorEstado.value,
        descripcion: descripcion.value.trim(),
        marca: marca.value.trim(),
        modelo: modelo.value.trim()
      });
      ref.cerrar();
      avisar(`Infraccion cargada para ${formatearDominio(d)}.`);
      await refrescarPendientes();
      if (alGuardar) alGuardar(d);
    } catch (err) {
      mostrarError(err.message);
      botonGuardar.disabled = false;
      botonGuardar.textContent = 'Guardar infraccion';
    }
    return undefined;
  };
  botonGuardar.addEventListener('click', guardar);

  const ref = abrirModal({
    titulo: 'Cargar infraccion',
    cuerpo: h(
      'div',
      {},
      error,
      h(
        'div',
        { class: 'campos' },
        campo('Dominio', sugeridor.contenedor),
        campo('Donde', selectorLugar),
        campoOtroLugar,
        campo('Monto', monto, 'En pesos'),
        campo('Fecha de la infraccion', fechaInfraccion),
        campo('Acta', acta),
        campo('Estado', selectorEstado),
        campoAncho('Que fue', descripcion)
      ),
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

  if (dominio) monto.focus();
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
// Listado general
// ---------------------------------------------------------------------

function indicador(valor, etiqueta, modificador = '') {
  return h(
    'div',
    { class: `indicador ${modificador}` },
    h('div', { class: 'indicador__valor' }, String(valor ?? 0)),
    h('div', { class: 'indicador__etiqueta' }, etiqueta)
  );
}

function tablaInfracciones(filas) {
  if (!filas.length) return vacio('No hay infracciones con ese filtro.', '✅');

  return h(
    'div',
    { class: 'tabla-scroll' },
    h(
      'table',
      {},
      h('thead', {}, h('tr', {},
        h('th', {}, 'Dominio'), h('th', {}, 'Auto'), h('th', {}, 'Donde'), h('th', {}, 'Acta'),
        h('th', {}, 'Fecha'), h('th', {}, 'Monto'), h('th', {}, 'Estado'), h('th', {}, 'Comprobante'))),
      h(
        'tbody',
        {},
        ...filas.map((f) =>
          h(
            'tr',
            { class: 'fila-link', onClick: () => navegar(`infracciones/${f.dominio}`) },
            h('td', {}, h('a', { href: `#/infracciones/${f.dominio}` }, etiquetaDominio(f.dominio))),
            h('td', {}, f.vehiculo || '—', f.descripcion ? h('div', { class: 'mini' }, f.descripcion) : null),
            h('td', {}, f.jurisdiccion || '—'),
            h('td', {}, f.acta || '—'),
            h('td', {}, fecha(f.fecha)),
            h('td', {}, pesos(f.monto)),
            h('td', {}, etiquetaEstadoInfraccion(f.estado),
              f.estado === 'pagada' && f.fecha_pago ? h('div', { class: 'mini' }, `el ${fecha(f.fecha_pago)}`) : null),
            h('td', {}, f.archivos ? `📄 ${f.archivos}` : h('span', { class: 'tenue' }, '—'))
          )
        )
      )
    )
  );
}

export async function vistaInfracciones() {
  const [listado, portales] = await Promise.all([api.listarInfracciones({ filtro: 'abiertas' }), api.portales()]);
  const contenedor = h('div', {});

  const irAlDominio = (valor) => {
    const d = normalizarDominio(valor);
    if (!dominioEsValido(d)) {
      avisar('Revisa el dominio. Autos: AAA123 o AB123CD. Motos: 123ABC o A123BCD.', 'error');
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
  const filtro = opciones(h('select', {}), FILTROS, 'abiertas');
  const texto = h('input', { type: 'search', placeholder: 'Buscar por dominio, municipio o acta' });

  function pintarListado(datos) {
    const r = datos.resumen || {};
    vaciar(indicadores).append(
      indicador(r.abiertas, 'Multas por resolver', r.abiertas ? 'indicador--alerta' : ''),
      indicador(pesos(r.monto_abierto || 0), 'Total adeudado', r.monto_abierto ? 'indicador--aviso' : ''),
      indicador(r.autos_con_abiertas, 'Autos con multas'),
      indicador(r.pagadas, 'Pagadas')
    );
    vaciar(cuerpoTabla).append(tablaInfracciones(datos.filas || []));
  }

  let pedido = 0;
  let reloj;
  async function recargarListado() {
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
      'Multas de cada auto y el seguimiento de los pagos',
      h('button', {
        class: 'boton boton--primario',
        type: 'button',
        onClick: async () => abrirNuevaInfraccion({
          portales: (await api.portales()).filter((p) => p.activo),
          alGuardar: (d) => navegar(`infracciones/${d}`)
        })
      }, '➕ Cargar infraccion')
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
        h('label', { class: 'etiqueta-campo' }, 'Consultar las multas de un auto'),
        h('div', { style: 'display:flex;gap:.5rem;align-items:stretch' },
          sugeridor.contenedor,
          h('button', { class: 'boton boton--primario', type: 'submit' }, 'Ver multas'))),
        h('p', { class: 'tenue', style: 'font-size:.85rem;margin:.5rem 0 0' },
          'Sirve aunque el auto no este cargado: vas a ver los botones para consultarlo en cada pagina.')
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

  setTimeout(() => sugeridor.entrada.focus(), 0);
  return contenedor;
}

// ---------------------------------------------------------------------
// Un dominio: consultar en cada pagina y seguir sus multas
// ---------------------------------------------------------------------

function tarjetaConsultas(datos, recargar, alTenerMultas) {
  const d = datos.dominio;

  if (!datos.portales.length) {
    return h(
      'section',
      { class: 'tarjeta' },
      h('div', { class: 'tarjeta__titulo' }, '🔎 Consultar multas'),
      h('div', { class: 'tarjeta__cuerpo' },
        vacio('Todavia no hay paginas de consulta cargadas.', '🌐'),
        h('p', { style: 'text-align:center' },
          h('a', { class: 'boton', href: '#/infracciones' }, 'Agregar paginas de consulta')))
    );
  }

  const registrar = async (portal, resultado) => {
    try {
      await api.registrarConsulta(d, portal.id, resultado);
      if (resultado === 'con_infracciones') alTenerMultas(portal);
      else avisar(`Anotado: ${formatearDominio(d)} sin multas en ${portal.nombre}.`);
      recargar();
    } catch (err) {
      avisar(err.message, 'error');
    }
  };

  const filas = datos.portales.map((portal) => {
    const ultima = portal.ultima_consulta;
    const textoUltima = ultima
      ? `${ultima.resultado === 'sin_infracciones' ? '✅ Sin multas' : '⚠️ Con multas'} · revisado por ${ultima.consultado_por_nombre || 'alguien'} el ${fechaHora(ultima.consultado_en)}`
      : 'Nadie lo reviso todavia';

    return h(
      'div',
      { class: 'portal' },
      h('div', { class: 'portal__boton' }, botonConsultar(portal, d, 'boton boton--primario')),
      h('div', { class: 'portal__estado' },
        h('div', { class: ultima ? '' : 'tenue' }, textoUltima),
        portal.notas ? h('div', { class: 'mini' }, portal.notas) : null),
      h(
        'div',
        { class: 'portal__acciones' },
        h('span', { class: 'mini' }, '¿Que encontraste?'),
        h('button', { class: 'boton boton--chico', type: 'button', onClick: () => registrar(portal, 'sin_infracciones') }, '✅ No tiene'),
        h('button', { class: 'boton boton--chico', type: 'button', onClick: () => registrar(portal, 'con_infracciones') }, '⚠️ Tiene multas')
      )
    );
  });

  return h(
    'section',
    { class: 'tarjeta' },
    h('div', { class: 'tarjeta__titulo' }, '🔎 Consultar multas',
      h('span', { class: 'tenue' }, `el boton abre la pagina y copia ${d} para pegarlo`)),
    h('div', { class: 'tarjeta__cuerpo' }, ...filas)
  );
}

function comprobantes(infraccion, recargar) {
  const entrada = h('input', { type: 'file', multiple: true, style: 'display:none' });
  const boton = h('button', { class: 'boton boton--chico', type: 'button', onClick: () => entrada.click() }, '⬆️ Subir comprobante');

  entrada.addEventListener('change', async () => {
    if (!entrada.files.length) return;
    const elegidos = [...entrada.files];
    boton.disabled = true;
    boton.textContent = 'Subiendo…';
    try {
      await api.subirComprobantes(infraccion.id, elegidos);
      avisar(`${elegidos.length} archivo(s) cargados.`);
      recargar();
    } catch (err) {
      avisar(`${err.message} El archivo no se subio: volve a intentarlo.`, 'error');
      boton.disabled = false;
      boton.textContent = '⬆️ Subir comprobante';
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

function tarjetaInfraccion(infraccion, portales, recargarCuandoSePueda, recargar) {
  // Cada campo se guarda solo, por separado, con la misma cola que el resto.
  const campoMulta = (etiqueta, control, nombre, extra = {}) =>
    (extra.ancho ? campoAutoAncho : campoAuto)({
      etiqueta,
      control,
      campo: nombre,
      operacion: 'editar_infraccion',
      clave: `infraccion:${infraccion.id}:${nombre}`,
      // Fechas y monto vacios van como "sin dato"; los textos, vacios.
      armarArgs: (valor) => ({
        id: infraccion.id,
        cambios: { [nombre]: valor === '' && CAMPOS_NULOS.includes(nombre) ? null : valor }
      }),
      ...extra
    });

  const selectorEstado = opciones(h('select', {}), LISTA_ESTADOS, infraccion.estado);
  const lugares = h('datalist', { id: `lugares-${infraccion.id}` },
    ...portales.map((p) => h('option', { value: p.nombre })));
  const textoLugar = (() => {
    const t = h('input', { value: infraccion.jurisdiccion || '', placeholder: 'Municipio o provincia' });
    t.setAttribute('list', `lugares-${infraccion.id}`);
    return t;
  })();
  const monto = h('input', { value: montoParaEditar(infraccion.monto), inputMode: 'decimal', placeholder: '85.000' });
  const descripcion = h('input', { value: infraccion.descripcion || '', placeholder: 'Que fue' });
  const observaciones = h('textarea', { rows: 2, placeholder: 'Ej. se pago con plan de cuotas, descargo presentado…' });
  observaciones.value = infraccion.observaciones || '';

  const borrar = async () => {
    const texto = `Vas a borrar la infraccion${infraccion.acta ? ` ${infraccion.acta}` : ''} de ${infraccion.jurisdiccion || 'este auto'}. Queda una copia en el historial.`;
    if (!(await confirmar(texto, { textoBoton: 'Borrar infraccion' }))) return;
    try {
      await api.borrarInfraccion(infraccion.id);
      avisar('Infraccion borrada.');
      await refrescarPendientes();
      recargar();
    } catch (err) {
      avisar(err.message, 'error');
    }
  };

  return h(
    'section',
    { class: `tarjeta infraccion infraccion--${infraccion.estado}` },
    h(
      'div',
      { class: 'tarjeta__titulo' },
      etiquetaEstadoInfraccion(infraccion.estado),
      h('span', {}, [infraccion.jurisdiccion, infraccion.acta && `acta ${infraccion.acta}`].filter(Boolean).join(' · ') || 'Infraccion'),
      h('strong', {}, pesos(infraccion.monto)),
      h('span', { class: 'derecha', style: 'display:flex;gap:.5rem;align-items:center' },
        h('span', { class: 'mini' }, `Cargada por ${infraccion.creado_por_nombre || 'alguien'} el ${fecha(infraccion.creado_en)}`),
        h('button', { class: 'boton boton--chico boton--peligro', type: 'button', onClick: borrar }, 'Borrar'))
    ),
    h(
      'div',
      { class: 'tarjeta__cuerpo' },
      lugares,
      h(
        'div',
        { class: 'campos' },
        campoMulta('Estado', selectorEstado, 'estado', { alConfirmar: recargarCuandoSePueda }),
        campoMulta('Monto', monto, 'monto', {
          leerValor: (el) => { const m = leerMonto(el.value); return m === null ? null : m; },
          validar: (valor) => (valor === null ? AYUDA_MONTO : ''),
          alConfirmar: recargarCuandoSePueda
        }),
        campoMulta('Fecha de la infraccion', h('input', { type: 'date', value: infraccion.fecha || '' }), 'fecha'),
        campoMulta('Fecha de pago', h('input', { type: 'date', value: infraccion.fecha_pago || '' }), 'fecha_pago',
          { ayuda: 'Se completa sola al marcarla pagada' }),
        campoMulta('Donde', textoLugar, 'jurisdiccion'),
        campoMulta('Acta', h('input', { value: infraccion.acta || '' }), 'acta'),
        campoMulta('Que fue', descripcion, 'descripcion', { ancho: true }),
        campoMulta('Observaciones', observaciones, 'observaciones', { ancho: true })
      ),
      comprobantes(infraccion, recargar)
    )
  );
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
    if (contenedor.isConnected || !contenedor.childNodes.length) vaciar(contenedor).append(...pintar(datos));
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
    const nueva = (portal) => abrirNuevaInfraccion({
      dominio: d,
      portales: datos.portales,
      portalId: portal ? portal.id : null,
      alGuardar: () => recargar()
    });

    const multas = datos.infracciones.length
      ? datos.infracciones.map((i) => tarjetaInfraccion(i, datos.portales, recargarCuandoSePueda, recargar))
      : [vacio(v ? 'Este auto no tiene infracciones cargadas.' : 'Este dominio todavia no esta cargado en el sistema. Si encontras multas, al cargarlas se da de alta.', '✅')];

    return [
      encabezado(
        h('span', { style: 'display:inline-flex;gap:.6rem;align-items:center;flex-wrap:wrap' },
          etiquetaDominio(d), v ? descripcionVehiculo(v) || 'Sin marca ni modelo' : 'Infracciones'),
        r.abiertas
          ? `${r.abiertas} multa(s) por resolver · ${pesos(r.monto_abierto)} adeudado`
          : (r.total ? 'Sin multas por resolver' : 'Infracciones y consulta de multas'),
        h('a', { class: 'boton', href: '#/infracciones' }, '← Todas las infracciones'),
        v ? h('a', { class: 'boton', href: `#/buscador/${d}` }, 'Ficha del dominio') : null,
        h('button', { class: 'boton boton--primario', type: 'button', onClick: () => nueva(null) }, '➕ Cargar infraccion')
      ),
      tarjetaConsultas(datos, recargar, (portal) => {
        avisar(`Anotado: ${formatearDominio(d)} tiene multas en ${portal.nombre}. Cargalas aca.`);
        nueva(portal);
      }),
      h('h2', { class: 'subtitulo' }, `Multas de este auto (${datos.infracciones.length})`),
      ...multas
    ];
  }

  const datos = await api.infraccionesDeDominio(d);
  contenedor.append(...pintar(datos));
  return contenedor;
}
