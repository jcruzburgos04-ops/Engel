'use strict';

const { badRequest } = require('./errores');

function textoRequerido(valor, campo, maxLargo = 200) {
  const texto = String(valor == null ? '' : valor).trim();
  if (!texto) throw badRequest(`El campo "${campo}" es obligatorio.`);
  if (texto.length > maxLargo) {
    throw badRequest(`El campo "${campo}" no puede superar los ${maxLargo} caracteres.`);
  }
  return texto;
}

function textoOpcional(valor, maxLargo = 200) {
  const texto = String(valor == null ? '' : valor).trim();
  return texto.slice(0, maxLargo);
}

function numeroOpcional(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero)) throw badRequest(`El campo "${campo}" tiene que ser un numero.`);
  if (numero < 0) throw badRequest(`El campo "${campo}" no puede ser negativo.`);
  return numero;
}

function enteroOpcional(valor, campo, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const numero = numeroOpcional(valor, campo);
  if (numero === null) return null;
  const entero = Math.trunc(numero);
  if (entero < min || entero > max) {
    throw badRequest(`El campo "${campo}" tiene que estar entre ${min} y ${max}.`);
  }
  return entero;
}

const FECHA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function fechaOpcional(valor, campo) {
  if (valor === undefined || valor === null || valor === '') return null;
  const texto = String(valor).slice(0, 10);
  if (!FECHA_ISO.test(texto) || Number.isNaN(Date.parse(texto))) {
    throw badRequest(`El campo "${campo}" tiene que ser una fecha valida (AAAA-MM-DD).`);
  }
  return texto;
}

function fechaRequerida(valor, campo) {
  const fecha = fechaOpcional(valor, campo);
  if (!fecha) throw badRequest(`El campo "${campo}" es obligatorio.`);
  return fecha;
}

function unoDe(valor, opciones, campo, porDefecto) {
  if (valor === undefined || valor === null || valor === '') {
    if (porDefecto !== undefined) return porDefecto;
    throw badRequest(`El campo "${campo}" es obligatorio.`);
  }
  const texto = String(valor).trim();
  if (!opciones.includes(texto)) {
    throw badRequest(`El campo "${campo}" tiene que ser uno de: ${opciones.join(', ')}.`);
  }
  return texto;
}

function emailOpcional(valor, campo = 'email') {
  const texto = textoOpcional(valor, 200);
  if (!texto) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto)) {
    throw badRequest(`El campo "${campo}" no tiene un formato de email valido.`);
  }
  return texto.toLowerCase();
}

function idRequerido(valor, campo) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero <= 0) {
    throw badRequest(`El campo "${campo}" es obligatorio.`);
  }
  return numero;
}

module.exports = {
  textoRequerido,
  textoOpcional,
  numeroOpcional,
  enteroOpcional,
  fechaOpcional,
  fechaRequerida,
  unoDe,
  emailOpcional,
  idRequerido
};
