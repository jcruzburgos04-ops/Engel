'use strict';

// Documentacion que se controla para cada auto de una operacion.
// El orden define como se muestra el checklist en la web.
const TIPOS_DOCUMENTO = [
  { tipo: 'titulo', etiqueta: 'Titulo' },
  { tipo: 'dominio', etiqueta: 'Informe de dominio' },
  { tipo: 'multas', etiqueta: 'Multas' },
  { tipo: 'patentes', etiqueta: 'Patentes' },
  { tipo: 'form_08', etiqueta: 'Formulario 08' },
  { tipo: 'cedula', etiqueta: 'Cedula' },
  { tipo: 'verificacion_policial', etiqueta: 'Verificacion policial' },
  { tipo: 'vtv', etiqueta: 'VTV' }
];

const TIPOS_VALIDOS = new Set(TIPOS_DOCUMENTO.map((d) => d.tipo));

const ESTADOS_DOCUMENTO = ['pendiente', 'en_tramite', 'ok', 'no_aplica'];

function etiquetaDocumento(tipo) {
  const encontrado = TIPOS_DOCUMENTO.find((d) => d.tipo === tipo);
  return encontrado ? encontrado.etiqueta : tipo;
}

module.exports = { TIPOS_DOCUMENTO, TIPOS_VALIDOS, ESTADOS_DOCUMENTO, etiquetaDocumento };
