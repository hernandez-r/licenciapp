import { addDays, eachDateInclusive, isWeekend, parseDate, toDateKey } from './date-utils.js';

export const DEFAULT_TYPES = [
  {
    id: 'reglamentaria', name: 'Reglamentaria', unit: 'days', counting: 'business',
    excludeHolidays: true, hoursPerDay: 8, color: '#3366ff', active: true,
    conflictGroup: 'absence', allowOverlap: false, initial: 20
  },
  {
    id: 'dias-corridos', name: 'Días corridos', unit: 'days', counting: 'calendar',
    excludeHolidays: false, hoursPerDay: 8, color: '#7c3aed', active: true,
    conflictGroup: 'absence', allowOverlap: false, initial: 10
  },
  {
    id: 'franquicias', name: 'Franquicias', unit: 'hours', counting: 'business',
    excludeHolidays: true, hoursPerDay: 8, color: '#e8790b', active: true,
    conflictGroup: 'absence', allowOverlap: false, initial: 40
  },
  {
    id: 'excepcion', name: 'Excepción', unit: 'days', counting: 'business',
    excludeHolidays: true, hoursPerDay: 8, color: '#099268', active: true,
    conflictGroup: 'absence', allowOverlap: false, initial: 5
  }
];

export function normalizeRule(type) {
  if (!type?.id || !type?.name) throw new Error('El tipo de licencia no es válido.');
  if (!['days', 'hours'].includes(type.unit)) throw new Error('La unidad debe ser días u horas.');
  if (!['business', 'calendar'].includes(type.counting)) throw new Error('El cómputo debe ser hábil o corrido.');
  const hoursPerDay = Number(type.hoursPerDay);
  if (!Number.isFinite(hoursPerDay) || hoursPerDay <= 0) throw new Error('La equivalencia horaria debe ser mayor a cero.');
  return {
    id: type.id,
    name: type.name,
    unit: type.unit,
    counting: type.counting,
    excludeHolidays: Boolean(type.excludeHolidays),
    hoursPerDay,
    color: type.color || '#3366ff',
    conflictGroup: type.conflictGroup || 'absence',
    allowOverlap: Boolean(type.allowOverlap)
  };
}

export function isCountedDate(date, rule, holidaySet = new Set()) {
  const key = toDateKey(date);
  if (rule.counting === 'business' && isWeekend(key)) return false;
  if (rule.excludeHolidays && holidaySet.has(key)) return false;
  return true;
}

export function countedDates(startDate, endDate, type, holidays = []) {
  const rule = normalizeRule(type);
  const holidaySet = new Set(holidays.map(item => typeof item === 'string' ? item : item.date));
  return eachDateInclusive(startDate, endDate).filter(date => isCountedDate(date, rule, holidaySet));
}

export function nextReturnDate(endDate, type, holidays = []) {
  const rule = normalizeRule(type);
  const holidaySet = new Set(holidays.map(item => typeof item === 'string' ? item : item.date));
  let cursor = addDays(endDate, 1);
  while (!isCountedDate(cursor, rule, holidaySet)) cursor = addDays(cursor, 1);
  return toDateKey(cursor);
}

export function calculateRange({ startDate, endDate, type, holidays = [], hours = null }) {
  const rule = normalizeRule(type);
  const allDates = eachDateInclusive(startDate, endDate);
  const dates = countedDates(startDate, endDate, rule, holidays);
  if (!dates.length) throw new Error('El período no contiene días computables.');

  let consumedUnits;
  let equivalentDays;
  let residualHours = 0;
  if (rule.unit === 'hours') {
    consumedUnits = Number(hours);
    if (!Number.isFinite(consumedUnits) || consumedUnits <= 0) throw new Error('Ingresá una cantidad de horas válida.');
    equivalentDays = Math.floor(consumedUnits / rule.hoursPerDay);
    residualHours = consumedUnits % rule.hoursPerDay;
  } else {
    consumedUnits = dates.length;
    equivalentDays = consumedUnits;
  }

  return {
    startDate: toDateKey(startDate),
    endDate: toDateKey(endDate),
    returnDate: nextReturnDate(endDate, rule, holidays),
    calendarDates: allDates,
    countedDates: dates,
    consumedUnits,
    equivalentDays,
    residualHours,
    unit: rule.unit,
    rulesSnapshot: rule
  };
}

export function calculateEndDate({ startDate, quantity, type, holidays = [] }) {
  const rule = normalizeRule(type);
  if (rule.unit !== 'days') throw new Error('El cálculo por cantidad está disponible para licencias medidas en días.');
  const target = Number(quantity);
  if (!Number.isInteger(target) || target <= 0) throw new Error('La cantidad debe ser un entero mayor a cero.');
  const holidaySet = new Set(holidays.map(item => typeof item === 'string' ? item : item.date));
  let cursor = parseDate(startDate);
  let count = 0;
  let guard = 0;
  while (count < target) {
    if (isCountedDate(cursor, rule, holidaySet)) count += 1;
    if (count < target) cursor = addDays(cursor, 1);
    if (++guard > 3700) throw new Error('No fue posible calcular la fecha final.');
  }
  return calculateRange({ startDate, endDate: toDateKey(cursor), type: rule, holidays });
}

export function remainingBalance(balance, consumedUnits) {
  const available = Number(balance?.initial || 0) + Number(balance?.adjustmentTotal || 0) - Number(balance?.consumed || 0);
  const result = available - Number(consumedUnits || 0);
  if (result < 0) throw new Error('El saldo disponible es insuficiente.');
  return result;
}

export function findOverlap(candidate, licenses, typeById = new Map()) {
  const rule = normalizeRule(candidate.rulesSnapshot || typeById.get(candidate.typeId));
  if (rule.allowOverlap) return null;
  const start = parseDate(candidate.startDate);
  const end = parseDate(candidate.endDate);
  return licenses.find(item => {
    if (item.status !== 'confirmed' || item.id === candidate.id) return false;
    const itemRule = item.rulesSnapshot || typeById.get(item.typeId);
    if (!itemRule || itemRule.allowOverlap || itemRule.conflictGroup !== rule.conflictGroup) return false;
    return start <= parseDate(item.endDate) && end >= parseDate(item.startDate);
  }) || null;
}
