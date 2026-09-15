'use strict';

const express = require('express');

const consultas = require('../lib/consultas');
const vehiculosRepo = require('../lib/vehiculos');
const { requiereSesion } = require('../lib/auth');
const { normalizarDominio } = require('../lib/dominio');
const { asyncHandler, badRequest } = require('../lib/errores');

const router = express.Router();

router.use(requiereSesion);

// Buscador por dominio: el caso "paso algo, busco la patente y bajo los papeles".
router.get(
  '/dominio/:dominio',
  asyncHandler((req, res) => {
    const dominio = normalizarDominio(req.params.dominio);
    if (!dominio) throw badRequest('Ingresa un dominio para buscar.');

    const resultado = consultas.buscarPorDominio(dominio);
    if (!resultado) {
      return res.status(404).json({
        error: `No hay ningun auto cargado con el dominio ${dominio}.`,
        dominio
      });
    }
    return res.json(resultado);
  })
);

router.get(
  '/vehiculos',
  asyncHandler((req, res) => {
    res.json({ vehiculos: vehiculosRepo.listar({ q: req.query.q || '', limite: req.query.limite }) });
  })
);

router.get(
  '/estadisticas',
  asyncHandler((_req, res) => {
    res.json(consultas.estadisticas());
  })
);

module.exports = router;
