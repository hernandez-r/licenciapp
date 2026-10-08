const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(value) {
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  if (!DATE_RE.test(value ?? '')) throw new Error(`Fecha inválida: ${value}`);
  const [year, month, day] = value.split('-').map(Number);
  const result = new Date(year, month - 1, day);
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) {
    throw new Error(`Fecha inválida: ${value}`);
  }
  return result;
}

export function toDateKey(value) {
  const date = parseDate(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addDays(value, amount) {
  const date = parseDate(value);
  date.setDate(date.getDate() + amount);
  return date;
}

export function compareDates(a, b) {
  return parseDate(a).getTime() - parseDate(b).getTime();
}

export function eachDateInclusive(start, end) {
  const first = parseDate(start);
  const last = parseDate(end);
  if (first > last) throw new Error('La fecha final no puede ser anterior a la inicial.');
  const dates = [];
  for (let cursor = first; cursor <= last; cursor = addDays(cursor, 1)) {
    dates.push(toDateKey(cursor));
  }
  return dates;
}

export function isWeekend(value) {
  const day = parseDate(value).getDay();
  return day === 0 || day === 6;
}

export function todayKey() {
  return toDateKey(new Date());
}
