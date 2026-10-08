function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);
}

export function formatAmount(value, unit) {
  const number = Number(value || 0);
  const formatted = new Intl.NumberFormat('es-UY', { maximumFractionDigits: 2 }).format(number);
  return `${formatted} ${unit === 'hours' ? 'h' : number === 1 ? 'día' : 'días'}`;
}

export function renderBalanceCards(element, types, balances) {
  const balanceMap = new Map(balances.map(item => [item.id, item]));
  element.innerHTML = types.filter(item => item.active).map(type => {
    const balance = balanceMap.get(type.id) || {};
    const total = Number(balance.initial || 0) + Number(balance.adjustmentTotal || 0);
    const remaining = total - Number(balance.consumed || 0);
    const percent = total > 0 ? Math.max(0, Math.min(100, remaining / total * 100)) : 0;
    const residual = type.unit === 'hours'
      ? ` · ${Math.floor(remaining / type.hoursPerDay)} días + ${remaining % type.hoursPerDay} h`
      : '';
    return `<article class="balance-card" style="--card-color:${escapeHtml(type.color)}">
      <div class="d-flex justify-content-between align-items-start mb-3"><span class="icon"><i class="bi bi-hourglass-split"></i></span><span class="name">${escapeHtml(type.name)}</span></div>
      <div class="amount">${formatAmount(remaining, type.unit)}</div>
      <div class="meta mt-2">de ${formatAmount(total, type.unit)}${residual}</div>
      <div class="progress mt-3" style="height:4px"><div class="progress-bar" style="width:${percent}%;background:${escapeHtml(type.color)}"></div></div>
    </article>`;
  }).join('') || '<p class="text-secondary">No hay tipos de licencia activos.</p>';
}

export function renderResult(element, calculation, remaining) {
  if (!calculation) {
    element.innerHTML = '<div class="empty-result"><i class="bi bi-stars"></i><span>Completá las fechas para ver la simulación.</span></div>';
    return;
  }
  const unit = calculation.unit;
  const equivalent = unit === 'hours'
    ? `<span>Equivalencia<strong>${calculation.equivalentDays} días + ${calculation.residualHours} h</strong></span>`
    : `<span>Días de calendario<strong>${calculation.calendarDates.length}</strong></span>`;
  element.innerHTML = `<div class="result-main"><div><div class="result-label">Se consumirán</div><div class="result-number">${formatAmount(calculation.consumedUnits, unit)}</div></div><i class="bi bi-arrow-right fs-4 text-primary"></i><div class="text-end"><div class="result-label">Saldo resultante</div><strong>${formatAmount(remaining, unit)}</strong></div></div><div class="result-details"><span>Fecha final<strong>${formatDate(calculation.endDate)}</strong></span><span>Regreso previsto<strong>${formatDate(calculation.returnDate)}</strong></span>${equivalent}<span>Días computados<strong>${calculation.countedDates.length}</strong></span></div>`;
}

export function renderTypes(element, types) {
  element.innerHTML = types.map(type => `<div class="stack-item"><div class="d-flex align-items-center gap-2"><span class="swatch" style="--item-color:${escapeHtml(type.color)}"></span><div><strong>${escapeHtml(type.name)}</strong><small>${type.unit === 'hours' ? 'Horas' : 'Días'} · ${type.counting === 'business' ? 'hábiles' : 'corridos'}${type.active ? '' : ' · inactivo'}</small></div></div><button class="btn btn-sm btn-light edit-type" data-id="${escapeHtml(type.id)}"><i class="bi bi-pencil"></i></button></div>`).join('') || '<p class="text-secondary small">Sin tipos configurados.</p>';
}

export function renderBalancesAdmin(element, types, balances) {
  const typeMap = new Map(types.map(item => [item.id, item]));
  element.innerHTML = balances.map(balance => {
    const type = typeMap.get(balance.id);
    const available = Number(balance.initial || 0) + Number(balance.adjustmentTotal || 0) - Number(balance.consumed || 0);
    return `<div class="stack-item"><div><strong>${escapeHtml(type?.name || balance.id)}</strong><small>Inicial ${formatAmount(balance.initial, type?.unit)} · Ajustes ${formatAmount(balance.adjustmentTotal, type?.unit)} · Consumido ${formatAmount(balance.consumed, type?.unit)}</small></div><strong>${formatAmount(available, type?.unit)}</strong></div>`;
  }).join('') || '<p class="text-secondary small">Sin saldos.</p>';
}

export function renderHolidays(element, holidays) {
  const sorted = [...holidays].sort((a, b) => a.date.localeCompare(b.date));
  element.innerHTML = sorted.map(item => `<div class="stack-item"><div><strong>${escapeHtml(item.name)}</strong><small>${formatDate(item.date)}</small></div><button class="btn btn-sm btn-light text-danger delete-holiday" data-date="${item.date}" aria-label="Eliminar"><i class="bi bi-trash3"></i></button></div>`).join('') || '<p class="text-secondary small">No hay feriados configurados.</p>';
}

const MOVEMENT_LABELS = {
  license_confirmed: 'Licencia confirmada', license_modified: 'Licencia modificada',
  license_cancelled: 'Licencia cancelada', balance_adjustment: 'Ajuste de saldo'
};

export function renderHistory(element, movements, types) {
  const typeMap = new Map(types.map(item => [item.id, item]));
  element.innerHTML = movements.map(item => {
    const date = item.createdAt?.toDate ? item.createdAt.toDate() : new Date(item.createdAt);
    return `<div class="timeline-item"><strong>${MOVEMENT_LABELS[item.kind] || escapeHtml(item.kind)}</strong><p>${escapeHtml(typeMap.get(item.typeId)?.name || item.typeId)} · ${item.delta > 0 ? '+' : ''}${item.delta} · ${new Intl.DateTimeFormat('es-UY', { dateStyle: 'medium', timeStyle: 'short' }).format(date)}</p></div>`;
  }).join('') || '<p class="text-secondary small">Todavía no hay movimientos.</p>';
}

export function fillTypeSelect(select, types, selected = null) {
  const previous = selected || select.value;
  select.innerHTML = types.filter(item => item.active).map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');
  if (types.some(item => item.id === previous && item.active)) select.value = previous;
}

export function formatDate(value) {
  if (!value) return '—';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('es-UY', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(year, month - 1, day));
}
