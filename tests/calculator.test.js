import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TYPES, calculateEndDate, calculateRange, findOverlap, remainingBalance
} from '../js/core/calculator.js';

const reglamentaria = DEFAULT_TYPES[0];
const corridos = DEFAULT_TYPES[1];
const franquicias = DEFAULT_TYPES[2];

test('reglamentaria incluye extremos y excluye fin de semana y feriado', () => {
  const result = calculateRange({
    startDate: '2026-10-08', endDate: '2026-10-13', type: reglamentaria,
    holidays: ['2026-10-12']
  });
  assert.deepEqual(result.countedDates, ['2026-10-08', '2026-10-09', '2026-10-13']);
  assert.equal(result.consumedUnits, 3);
  assert.equal(result.returnDate, '2026-10-14');
});

test('días corridos cuenta fines de semana y feriados entre meses', () => {
  const result = calculateRange({
    startDate: '2026-12-30', endDate: '2027-01-02', type: corridos,
    holidays: ['2027-01-01']
  });
  assert.equal(result.consumedUnits, 4);
  assert.equal(result.returnDate, '2027-01-03');
});

test('franquicias conserva equivalencia y horas residuales', () => {
  const result = calculateRange({
    startDate: '2026-10-08', endDate: '2026-10-08', type: franquicias, hours: 19
  });
  assert.equal(result.consumedUnits, 19);
  assert.equal(result.equivalentDays, 2);
  assert.equal(result.residualHours, 3);
});

test('cantidad de días calcula fecha final y regreso respetando feriados', () => {
  const result = calculateEndDate({
    startDate: '2026-10-08', quantity: 3, type: reglamentaria,
    holidays: ['2026-10-12']
  });
  assert.equal(result.endDate, '2026-10-13');
  assert.equal(result.returnDate, '2026-10-14');
});

test('no permite saldo negativo', () => {
  assert.throws(() => remainingBalance({ initial: 5, adjustmentTotal: 1, consumed: 2 }, 5), /insuficiente/);
  assert.equal(remainingBalance({ initial: 5, adjustmentTotal: 1, consumed: 2 }, 4), 0);
});

test('detecta superposición incompatible y omite canceladas', () => {
  const existing = [{
    id: 'a', typeId: reglamentaria.id, status: 'confirmed',
    startDate: '2026-10-08', endDate: '2026-10-10', rulesSnapshot: reglamentaria
  }];
  const candidate = {
    id: 'b', typeId: corridos.id, startDate: '2026-10-10', endDate: '2026-10-12', rulesSnapshot: corridos
  };
  assert.equal(findOverlap(candidate, existing)?.id, 'a');
  existing[0].status = 'cancelled';
  assert.equal(findOverlap(candidate, existing), null);
});

test('valida fechas inexistentes', () => {
  assert.throws(() => calculateRange({
    startDate: '2026-02-30', endDate: '2026-03-01', type: corridos
  }), /inválida/);
});
