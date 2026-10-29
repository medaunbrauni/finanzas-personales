// node deuda.test.mjs
import assert from 'node:assert';
import { simular, interesMensual } from './deuda.js';

// Interés Banorte oct-26: saldo base 347,259.11 al 41.03% × 28 días = 11,081.81 (sin IVA)
assert.ok(Math.abs(347259.11 * 0.4103 / 360 * 28 - 11081.81) < 1);
assert.ok(Math.abs(interesMensual(1000, 36) - 34.8) < 1e-9);

const deudas = [
  { nombre: 'A', saldo: 10000, tasa: 50, minimo: 500 },
  { nombre: 'B', saldo: 5000, tasa: 20, minimo: 250 },
];
const av = simular(deudas, () => 3000, 'avalancha');
const bo = simular(deudas, () => 3000, 'bola');
assert.ok(av.libre && bo.libre);
assert.ok(av.interesTotal < bo.interesTotal, 'avalancha paga menos interés');
assert.ok(bo.liquidadas[1].mes < av.liquidadas[1].mes, 'bola liquida primero la chica');
assert.strictEqual(deudas[0].saldo, 10000, 'no muta la entrada');

const corto = simular(deudas, () => 500);
assert.ok(corto.faltante, 'detecta que no alcanza para mínimos');
console.log('ok');
