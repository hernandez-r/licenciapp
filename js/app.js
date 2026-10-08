import { initializeFirebase, observeSession, connectGoogle, disconnect } from './services/auth-service.js';
import {
  addBalanceAdjustment, cancelLicense, ensureDefaults, exportBackup, importBackup,
  persistLicense, removeHoliday, saveHoliday, saveLicenseType, subscribeData
} from './services/firestore-service.js';
import { calculateEndDate, calculateRange, findOverlap, remainingBalance } from './core/calculator.js';
import { todayKey } from './core/date-utils.js';
import { createCalendar, goToDate, updateCalendar } from './ui/calendar.js';
import {
  fillTypeSelect, renderBalanceCards, renderBalancesAdmin, renderHistory,
  renderHolidays, renderResult, renderTypes
} from './ui/render.js';

const $ = selector => document.querySelector(selector);
const state = {
  db: null, uid: null, unsubscribe: null, calculation: null,
  data: { licenseTypes: [], balances: [], balanceAdjustments: [], holidays: [], licenses: [], movements: [] }
};

const elements = {
  authGate: $('#authGate'), authMessage: $('#authMessage'), login: $('#loginButton'),
  logout: $('#logoutButton'), sync: $('#syncStatus'), form: $('#licenseForm'),
  type: $('#licenseType'), start: $('#startDate'), end: $('#endDate'), hours: $('#hours'),
  quantity: $('#quantity'), notes: $('#notes'), licenseId: $('#licenseId'),
  result: $('#calculationResult'), error: $('#formError'), cancel: $('#cancelLicenseButton'),
  formTitle: $('#formTitle'), hoursGroup: $('#hoursGroup'), endGroup: $('#endDateGroup'),
  quantityGroup: $('#quantityGroup')
};

function setSync(label, status = '') {
  elements.sync.className = `sync-pill ${status}`;
  elements.sync.innerHTML = `<span class="sync-dot"></span>${label}`;
}

function showError(error) {
  elements.error.textContent = error?.message || String(error);
  elements.error.classList.remove('d-none');
}

function clearError() {
  elements.error.classList.add('d-none');
  elements.error.textContent = '';
}

function toast(message) {
  $('#toastMessage').textContent = message;
  bootstrap.Toast.getOrCreateInstance($('#appToast')).show();
}

function selectedType() {
  return state.data.licenseTypes.find(item => item.id === elements.type.value);
}

function selectedBalance() {
  return state.data.balances.find(item => item.id === elements.type.value) || {};
}

function mode() {
  return document.querySelector('input[name="calcMode"]:checked').value;
}

function runCalculation() {
  clearError();
  const type = selectedType();
  if (!type || !elements.start.value) {
    state.calculation = null;
    renderResult(elements.result, null);
    return null;
  }
  try {
    const holidays = state.data.holidays.map(item => item.date);
    let calculation;
    if (mode() === 'quantity' && type.unit === 'days') {
      calculation = calculateEndDate({
        startDate: elements.start.value, quantity: Number(elements.quantity.value), type, holidays
      });
      elements.end.value = calculation.endDate;
    } else {
      if (!elements.end.value) return null;
      calculation = calculateRange({
        startDate: elements.start.value, endDate: elements.end.value, type, holidays,
        hours: type.unit === 'hours' ? Number(elements.hours.value) : null
      });
    }
    const previous = state.data.licenses.find(item => item.id === elements.licenseId.value);
    const balance = selectedBalance();
    const restoredBalance = previous?.typeId === type.id
      ? { ...balance, consumed: Number(balance.consumed || 0) - Number(previous.consumedUnits || 0) }
      : balance;
    const remaining = remainingBalance(restoredBalance, calculation.consumedUnits);
    const overlap = findOverlap({
      id: previous?.id, typeId: type.id, startDate: calculation.startDate,
      endDate: calculation.endDate, rulesSnapshot: calculation.rulesSnapshot
    }, state.data.licenses);
    if (overlap) throw new Error('El período se superpone con otra licencia confirmada.');
    state.calculation = calculation;
    renderResult(elements.result, calculation, remaining);
    return calculation;
  } catch (error) {
    state.calculation = null;
    renderResult(elements.result, null);
    showError(error);
    return null;
  }
}

function updateMode() {
  const type = selectedType();
  const hourly = type?.unit === 'hours';
  if (hourly) $('#rangeMode').checked = true;
  $('#quantityMode').disabled = hourly;
  elements.hoursGroup.classList.toggle('d-none', !hourly);
  const quantityMode = mode() === 'quantity' && !hourly;
  elements.endGroup.classList.toggle('d-none', quantityMode);
  elements.quantityGroup.classList.toggle('d-none', !quantityMode);
  runCalculation();
}

function resetForm() {
  elements.form.reset();
  elements.licenseId.value = '';
  elements.start.value = todayKey();
  elements.end.value = todayKey();
  elements.formTitle.textContent = 'Nueva licencia';
  $('#saveButton').innerHTML = '<i class="bi bi-check2-circle me-2"></i>Confirmar licencia';
  $('#saveButton').disabled = false;
  elements.cancel.classList.add('d-none');
  state.calculation = null;
  clearError();
  updateMode();
}

function editLicense(id) {
  const item = state.data.licenses.find(license => license.id === id);
  if (!item) return;
  elements.licenseId.value = item.id;
  elements.type.value = item.typeId;
  elements.start.value = item.startDate;
  elements.end.value = item.endDate;
  elements.hours.value = item.rulesSnapshot.unit === 'hours' ? item.consumedUnits : '';
  elements.notes.value = item.notes || '';
  $('#rangeMode').checked = true;
  elements.formTitle.textContent = item.status === 'cancelled' ? 'Licencia cancelada' : 'Modificar licencia';
  $('#saveButton').innerHTML = '<i class="bi bi-check2-circle me-2"></i>Guardar cambios';
  elements.cancel.classList.toggle('d-none', item.status !== 'confirmed');
  $('#saveButton').disabled = item.status !== 'confirmed';
  updateMode();
  $('#licenseEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderAll() {
  const { licenseTypes, balances, holidays, licenses, movements } = state.data;
  renderBalanceCards($('#balanceCards'), licenseTypes, balances);
  renderTypes($('#typesList'), licenseTypes);
  renderBalancesAdmin($('#balancesAdmin'), licenseTypes, balances);
  renderHolidays($('#holidaysList'), holidays);
  renderHistory($('#historyList'), movements, licenseTypes);
  fillTypeSelect(elements.type, licenseTypes);
  fillTypeSelect($('#adjustmentType'), licenseTypes);
  updateCalendar(licenses, holidays, licenseTypes);
  updateMode();
}

async function startSession(user) {
  state.uid = user.uid;
  elements.authGate.classList.add('hidden');
  elements.logout.classList.remove('d-none');
  setSync('Sincronizando');
  await ensureDefaults(state.db, state.uid);
  state.unsubscribe?.();
  state.unsubscribe = subscribeData(state.db, state.uid, data => {
    state.data = data;
    renderAll();
    setSync('Sincronizado', 'online');
  }, error => {
    setSync('Error de sincronización', 'error');
    showError(error);
  });
}

function stopSession(error = null) {
  state.unsubscribe?.();
  state.unsubscribe = null;
  state.uid = null;
  elements.authGate.classList.remove('hidden');
  elements.logout.classList.add('d-none');
  if (error) elements.authMessage.textContent = error.message;
  setSync('Desconectado');
}

async function handleSave(event) {
  event.preventDefault();
  const calculation = runCalculation();
  if (!calculation) return;
  const previous = state.data.licenses.find(item => item.id === elements.licenseId.value) || null;
  const draft = {
    typeId: selectedType().id,
    startDate: calculation.startDate,
    endDate: calculation.endDate,
    returnDate: calculation.returnDate,
    consumedUnits: calculation.consumedUnits,
    notes: elements.notes.value.trim(),
    rulesSnapshot: calculation.rulesSnapshot,
    calculation
  };
  try {
    $('#saveButton').disabled = true;
    setSync('Guardando');
    await persistLicense(state.db, state.uid, draft, previous);
    resetForm();
    toast(previous ? 'Licencia modificada.' : 'Licencia confirmada.');
  } catch (error) {
    showError(error);
    setSync('No se pudo guardar', 'error');
  } finally {
    $('#saveButton').disabled = false;
  }
}

function resetTypeForm() {
  $('#typeForm').reset();
  $('#typeId').value = '';
  $('#typeColor').value = '#3366ff';
  $('#typeHoursPerDay').value = 8;
  $('#typeConflictGroup').value = 'absence';
  $('#typeActive').checked = true;
  $('#typeExcludeHolidays').checked = true;
  $('#typeInitial').disabled = false;
  $('#typeFormTitle').textContent = 'Agregar tipo';
}

function slugify(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function bindEvents() {
  elements.login.addEventListener('click', async () => {
    try {
      elements.login.disabled = true;
      elements.authMessage.textContent = 'Abriendo Google…';
      await connectGoogle();
    } catch (error) {
      elements.authMessage.textContent = error.message;
    } finally { elements.login.disabled = false; }
  });
  elements.logout.addEventListener('click', disconnect);
  elements.form.addEventListener('submit', handleSave);
  $('#simulateButton').addEventListener('click', runCalculation);
  $('#clearFormButton').addEventListener('click', resetForm);
  $('#newLicenseButton').addEventListener('click', () => { resetForm(); $('#licenseEditor').scrollIntoView({ behavior: 'smooth' }); });
  [elements.type, elements.start, elements.end, elements.hours, elements.quantity].forEach(item => item.addEventListener('change', item === elements.type ? updateMode : runCalculation));
  document.querySelectorAll('input[name="calcMode"]').forEach(item => item.addEventListener('change', updateMode));
  elements.cancel.addEventListener('click', async () => {
    const license = state.data.licenses.find(item => item.id === elements.licenseId.value);
    if (!license || !window.confirm('¿Cancelar esta licencia y reintegrar su saldo?')) return;
    try { await cancelLicense(state.db, state.uid, license); resetForm(); toast('Licencia cancelada y saldo reintegrado.'); }
    catch (error) { showError(error); }
  });

  $('#typesList').addEventListener('click', event => {
    const button = event.target.closest('.edit-type');
    if (!button) return;
    const type = state.data.licenseTypes.find(item => item.id === button.dataset.id);
    const balance = state.data.balances.find(item => item.id === type.id);
    $('#typeId').value = type.id; $('#typeName').value = type.name; $('#typeColor').value = type.color;
    $('#typeUnit').value = type.unit; $('#typeCounting').value = type.counting;
    $('#typeHoursPerDay').value = type.hoursPerDay; $('#typeConflictGroup').value = type.conflictGroup;
    $('#typeExcludeHolidays').checked = type.excludeHolidays; $('#typeAllowOverlap').checked = type.allowOverlap;
    $('#typeActive').checked = type.active; $('#typeInitial').value = balance?.initial || 0;
    $('#typeInitial').disabled = true; $('#typeFormTitle').textContent = 'Modificar tipo';
  });
  $('#clearTypeButton').addEventListener('click', resetTypeForm);
  $('#typeForm').addEventListener('submit', async event => {
    event.preventDefault();
    const existingId = $('#typeId').value;
    const type = {
      id: existingId || slugify($('#typeName').value), name: $('#typeName').value.trim(),
      color: $('#typeColor').value, unit: $('#typeUnit').value, counting: $('#typeCounting').value,
      hoursPerDay: Number($('#typeHoursPerDay').value), conflictGroup: $('#typeConflictGroup').value.trim() || 'absence',
      excludeHolidays: $('#typeExcludeHolidays').checked, allowOverlap: $('#typeAllowOverlap').checked,
      active: $('#typeActive').checked
    };
    try { await saveLicenseType(state.db, state.uid, type, existingId ? null : Number($('#typeInitial').value)); resetTypeForm(); toast('Tipo guardado.'); }
    catch (error) { window.alert(error.message); }
  });
  $('#adjustmentForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await addBalanceAdjustment(state.db, state.uid, {
        typeId: $('#adjustmentType').value, amount: Number($('#adjustmentAmount').value), reason: $('#adjustmentReason').value.trim()
      });
      event.target.reset(); toast('Ajuste registrado.');
    } catch (error) { window.alert(error.message); }
  });
  $('#holidayForm').addEventListener('submit', async event => {
    event.preventDefault();
    try { await saveHoliday(state.db, state.uid, { date: $('#holidayDate').value, name: $('#holidayName').value.trim() }); event.target.reset(); toast('Feriado guardado.'); }
    catch (error) { window.alert(error.message); }
  });
  $('#holidaysList').addEventListener('click', async event => {
    const button = event.target.closest('.delete-holiday');
    if (button && window.confirm('¿Eliminar este feriado?')) await removeHoliday(state.db, state.uid, button.dataset.date);
  });
  $('#exportButton').addEventListener('click', async () => {
    try {
      const data = await exportBackup(state.db, state.uid);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `licencias-${todayKey()}.json`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { window.alert(error.message); }
  });
  $('#importInput').addEventListener('change', async event => {
    const file = event.target.files[0];
    if (!file || !window.confirm('¿Importar este respaldo y combinarlo con los datos actuales?')) return;
    try { await importBackup(state.db, state.uid, JSON.parse(await file.text())); toast('Respaldo importado.'); }
    catch (error) { window.alert(error.message); }
    finally { event.target.value = ''; }
  });
}

async function main() {
  createCalendar($('#calendar'), {
    onSelect(start, end) { elements.start.value = start; elements.end.value = end; $('#rangeMode').checked = true; updateMode(); },
    onEventClick: editLicense
  });
  bindEvents();
  resetForm();
  try {
    const firebase = await initializeFirebase();
    state.db = firebase.db;
    observeSession((user, error) => user ? startSession(user).catch(stopSession) : stopSession(error));
  } catch (error) {
    elements.authMessage.textContent = error.message;
    elements.login.disabled = true;
    setSync('Configuración pendiente', 'error');
  }
}

main();
