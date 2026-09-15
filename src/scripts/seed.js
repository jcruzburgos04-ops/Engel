'use strict';

// Carga datos de ejemplo para probar la web. No usar sobre la base real:
// solo corre si todavia no hay ventas cargadas.

const bcrypt = require('bcryptjs');

const db = require('../db');
const ventasRepo = require('../lib/ventas');

const yaHayVentas = db.prepare('SELECT COUNT(*) AS n FROM ventas').get().n;
if (yaHayVentas > 0) {
  console.log(`[seed] La base ya tiene ${yaHayVentas} venta(s). No se toca nada.`);
  process.exit(0);
}

function crearUsuario(nombre, email, rol) {
  const existente = db.prepare('SELECT id FROM usuarios WHERE email = ? COLLATE NOCASE').get(email);
  if (existente) return existente.id;
  const info = db
    .prepare('INSERT INTO usuarios (nombre, email, password_hash, rol) VALUES (?, ?, ?, ?)')
    .run(nombre, email, bcrypt.hashSync('engel1234', 10), rol);
  return Number(info.lastInsertRowid);
}

function diasDesdeHoy(dias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

const admin = { id: crearUsuario('Administrador', 'admin@engel.com', 'admin'), rol: 'admin' };
const lucia = crearUsuario('Lucia Fernandez', 'lucia@engel.com', 'vendedor');
const martin = crearUsuario('Martin Alvarez', 'martin@engel.com', 'vendedor');

const ejemplos = [
  {
    fecha_venta: diasDesdeHoy(-12),
    vendedor_id: lucia,
    cliente_nombre: 'Maria Gomez',
    cliente_documento: '30.111.222',
    cliente_telefono: '11 4455 6677',
    precio_venta: 18500000,
    moneda: 'ARS',
    forma_pago: 'Permuta + transferencia',
    sena: 1500000,
    estado: 'en_preparacion',
    fecha_entrega_estimada: diasDesdeHoy(4),
    detalles: 'El cliente pidio que la entrega sea con el service al dia y las cubiertas nuevas.',
    vehiculo: {
      dominio: 'AB123CD',
      marca: 'Toyota',
      modelo: 'Corolla',
      version: 'XEI 2.0 CVT',
      anio: 2021,
      color: 'Gris plata',
      kilometraje: 48000,
      tenencia: 'propio',
      descripcion: 'Corolla XEI gris, unico dueno, service oficial completo.'
    },
    permutas: [
      {
        dominio: 'AAA111',
        marca: 'Volkswagen',
        modelo: 'Gol Trend',
        anio: 2014,
        color: 'Blanco',
        kilometraje: 132000,
        valor_tomado: 6200000,
        moneda: 'ARS',
        observaciones: 'Entra con la VTV vencida y una multa sin pagar.'
      }
    ]
  },
  {
    fecha_venta: diasDesdeHoy(-30),
    vendedor_id: martin,
    cliente_nombre: 'Jorge Benitez',
    cliente_documento: '27.888.999',
    cliente_telefono: '11 6677 8899',
    precio_venta: 26000,
    moneda: 'USD',
    forma_pago: 'Contado',
    estado: 'listo_entrega',
    fecha_entrega_estimada: diasDesdeHoy(-3),
    detalles: 'Auto en consigna. Falta que el titular firme el 08.',
    vehiculo: {
      dominio: 'AE456FG',
      marca: 'Ford',
      modelo: 'Ranger',
      version: 'XLT 3.2 4x4',
      anio: 2022,
      color: 'Azul',
      kilometraje: 35000,
      tenencia: 'consigna',
      consignante_nombre: 'Estudio Rossi SRL',
      consignante_contacto: '11 3344 5566',
      descripcion: 'Ranger XLT azul 4x4, con cobertor de caja.'
    },
    permutas: []
  },
  {
    fecha_venta: diasDesdeHoy(-60),
    vendedor_id: lucia,
    cliente_nombre: 'Silvina Paz',
    cliente_telefono: '11 2233 4455',
    precio_venta: 12900000,
    moneda: 'ARS',
    forma_pago: 'Financiado',
    estado: 'entregado',
    fecha_entrega_estimada: diasDesdeHoy(-45),
    fecha_entrega_real: diasDesdeHoy(-44),
    detalles: 'Operacion cerrada sin observaciones.',
    vehiculo: {
      dominio: 'CDE789',
      marca: 'Fiat',
      modelo: 'Cronos',
      version: 'Drive 1.3',
      anio: 2019,
      color: 'Rojo',
      kilometraje: 72000,
      tenencia: 'propio',
      descripcion: 'Cronos Drive rojo, muy buen estado general.'
    },
    permutas: [
      {
        dominio: 'BBB222',
        marca: 'Chevrolet',
        modelo: 'Corsa',
        anio: 2010,
        color: 'Gris',
        kilometraje: 189000,
        valor_tomado: 3100000,
        moneda: 'ARS',
        observaciones: 'Se tomo para reventa rapida.'
      }
    ]
  },
  {
    fecha_venta: diasDesdeHoy(-2),
    vendedor_id: martin,
    cliente_nombre: 'Pablo Duarte',
    cliente_telefono: '11 9988 7766',
    precio_venta: 21500000,
    moneda: 'ARS',
    forma_pago: 'Transferencia',
    estado: 'pendiente',
    fecha_entrega_estimada: diasDesdeHoy(15),
    detalles: 'Queda pendiente el informe de dominio.',
    vehiculo: {
      dominio: 'AF789HJ',
      marca: 'Peugeot',
      modelo: '208',
      version: 'Allure 1.6',
      anio: 2023,
      color: 'Negro',
      kilometraje: 12000,
      tenencia: 'propio',
      descripcion: '208 Allure negro, practicamente 0 km.'
    },
    permutas: []
  }
];

for (const ejemplo of ejemplos) {
  const id = ventasRepo.crear(ejemplo, admin);
  console.log(`[seed] Venta #${id} cargada (${ejemplo.vehiculo.dominio}).`);
}

// Deja algunos documentos ya resueltos para que el panel no arranque vacio.
const marcar = db.prepare(
  `UPDATE documentos SET estado = ?, actualizado_por = ?, actualizado_en = datetime('now')
   WHERE venta_id = ? AND tipo IN (${['titulo', 'cedula', 'vtv'].map(() => '?').join(',')})`
);
marcar.run('ok', admin.id, 1, 'titulo', 'cedula', 'vtv');
db.prepare(
  `UPDATE documentos SET estado = 'ok', actualizado_por = ? WHERE venta_id = 3`
).run(admin.id);

console.log('\n[seed] Listo. Usuarios de prueba (contrasena: engel1234):');
console.log('  admin@engel.com   (administrador)');
console.log('  lucia@engel.com   (vendedora)');
console.log('  martin@engel.com  (vendedor)');
