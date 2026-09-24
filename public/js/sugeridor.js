// Campo de dominio que sugiere los autos cargados mientras se escribe.
// Lo usan el buscador y las infracciones.

import { api } from './api.js';
import { h, vaciar, campoDominio, etiquetaDominio } from './util.js';

/**
 * - `alElegir(dominio)`: se llama al elegir una sugerencia (clic o Enter).
 * - `props`: se pasan al input (placeholder, style, etc.).
 *
 * Devuelve { contenedor, entrada, cerrar }.
 */
export function campoDominioSugerido({ alElegir, ...props } = {}) {
  const entrada = campoDominio({ ...props, onInput: () => pedir(entrada.value) });
  const lista = h('div', { class: 'sugerencias', role: 'listbox', hidden: true });
  const contenedor = h('div', { class: 'sugeridor' }, entrada, lista);

  let sugerencias = [];
  let marcada = -1;
  let reloj = null;
  let ultimoPedido = 0;

  function cerrar() {
    lista.hidden = true;
    marcada = -1;
  }

  function marcar(indice) {
    marcada = indice;
    [...lista.children].forEach((fila, i) => fila.classList.toggle('sugerencia--activa', i === marcada));
  }

  function elegir(sugerencia) {
    entrada.value = sugerencia.dominio;
    cerrar();
    if (alElegir) alElegir(sugerencia.dominio);
  }

  function dibujar() {
    vaciar(lista);
    if (!sugerencias.length) return cerrar();

    sugerencias.forEach((s, i) => {
      lista.append(
        h(
          'div',
          {
            class: 'sugerencia',
            role: 'option',
            // mousedown en vez de click: el click llega despues del blur y la
            // lista ya estaria cerrada.
            onMousedown: (e) => { e.preventDefault(); elegir(s); },
            onMouseenter: () => marcar(i)
          },
          etiquetaDominio(s.dominio),
          h('span', { class: 'sugerencia__texto' },
            [s.descripcion, s.anio].filter(Boolean).join(' · ') || 'Sin marca ni modelo'),
          h('span', { class: 'sugerencia__papeles' },
            s.documentos ? `${s.aprobados}/${s.documentos} papeles` : 'sin papeles')
        )
      );
    });

    marcar(-1);
    lista.hidden = false;
    return undefined;
  }

  // Se espera un momento entre tecla y tecla para no pedirle una consulta a
  // la base por cada letra.
  function pedir(valor) {
    clearTimeout(reloj);
    const texto = String(valor || '').replace(/[^A-Za-z0-9]/g, '');
    if (!texto) {
      sugerencias = [];
      cerrar();
      return;
    }

    reloj = setTimeout(async () => {
      const miPedido = ++ultimoPedido;
      const encontradas = await api.sugerirDominios(texto);
      // Si mientras tanto se siguio escribiendo, esta respuesta ya no sirve.
      if (miPedido !== ultimoPedido || entrada.value.replace(/[^A-Z0-9]/g, '') !== texto.toUpperCase()) return;
      sugerencias = encontradas;
      dibujar();
    }, 150);
  }

  entrada.addEventListener('keydown', (e) => {
    if (lista.hidden || !sugerencias.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      marcar((marcada + 1) % sugerencias.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      marcar(marcada <= 0 ? sugerencias.length - 1 : marcada - 1);
    } else if (e.key === 'Enter' && marcada >= 0) {
      e.preventDefault();
      elegir(sugerencias[marcada]);
    } else if (e.key === 'Escape') {
      cerrar();
    }
  });

  entrada.addEventListener('blur', () => cerrar());
  entrada.addEventListener('focus', () => { if (sugerencias.length) dibujar(); });

  return { contenedor, entrada, cerrar };
}
