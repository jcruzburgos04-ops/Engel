'use strict';

// Normaliza la patente: mayusculas y sin espacios ni guiones.
// Acepta el formato viejo (AAA123) y el nuevo del Mercosur (AB123CD).
function normalizarDominio(valor) {
  return String(valor || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

const FORMATO_VIEJO = /^[A-Z]{3}\d{3}$/;
const FORMATO_MERCOSUR = /^[A-Z]{2}\d{3}[A-Z]{2}$/;
const FORMATO_MOTO = /^[A-Z]\d{3}[A-Z]{3}$/;

function dominioEsValido(dominio) {
  const d = normalizarDominio(dominio);
  return FORMATO_VIEJO.test(d) || FORMATO_MERCOSUR.test(d) || FORMATO_MOTO.test(d);
}

// Version legible para mostrar en pantalla: AB 123 CD / AAA 123.
function formatearDominio(dominio) {
  const d = normalizarDominio(dominio);
  if (FORMATO_VIEJO.test(d)) return `${d.slice(0, 3)} ${d.slice(3)}`;
  if (FORMATO_MERCOSUR.test(d)) return `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`;
  return d;
}

module.exports = { normalizarDominio, dominioEsValido, formatearDominio };
