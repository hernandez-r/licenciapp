import {
  Timestamp, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query,
  runTransaction, setDoc, writeBatch
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';
import { DEFAULT_TYPES } from '../core/calculator.js';

const SUBCOLLECTIONS = ['licenseTypes', 'balances', 'balanceAdjustments', 'holidays', 'licenses', 'calendarDays', 'movements'];

function userCollection(db, uid, name) {
  return collection(db, 'users', uid, name);
}

function clean(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  }
  return value;
}

export async function ensureDefaults(db, uid) {
  const typesSnapshot = await getDocs(userCollection(db, uid, 'licenseTypes'));
  if (!typesSnapshot.empty) return;
  const batch = writeBatch(db);
  for (const item of DEFAULT_TYPES) {
    const { initial, ...type } = item;
    batch.set(doc(db, 'users', uid, 'licenseTypes', item.id), {
      ...type, createdAt: Timestamp.now(), updatedAt: Timestamp.now()
    });
    batch.set(doc(db, 'users', uid, 'balances', item.id), {
      initial, adjustmentTotal: 0, consumed: 0, updatedAt: Timestamp.now()
    });
  }
  await batch.commit();
}

export function subscribeData(db, uid, onData, onError) {
  const state = Object.fromEntries(SUBCOLLECTIONS.map(name => [name, []]));
  const unsubscribers = SUBCOLLECTIONS.map(name => {
    const ref = name === 'movements'
      ? query(userCollection(db, uid, name), orderBy('createdAt', 'desc'))
      : userCollection(db, uid, name);
    return onSnapshot(ref, snapshot => {
      state[name] = snapshot.docs.map(item => ({ id: item.id, ...item.data() }));
      onData({ ...state });
    }, onError);
  });
  return () => unsubscribers.forEach(unsubscribe => unsubscribe());
}

export async function saveLicenseType(db, uid, type, initial = null) {
  const { id, ...typeData } = type;
  const ref = doc(db, 'users', uid, 'licenseTypes', id);
  const now = Timestamp.now();
  await setDoc(ref, { ...typeData, updatedAt: now, createdAt: type.createdAt || now }, { merge: true });
  if (initial !== null) {
    const balanceRef = doc(db, 'users', uid, 'balances', id);
    await setDoc(balanceRef, { initial: Number(initial), adjustmentTotal: 0, consumed: 0, updatedAt: now }, { merge: true });
  }
}

export async function addBalanceAdjustment(db, uid, { typeId, amount, reason }) {
  const balanceRef = doc(db, 'users', uid, 'balances', typeId);
  const adjustmentRef = doc(userCollection(db, uid, 'balanceAdjustments'));
  const movementRef = doc(userCollection(db, uid, 'movements'));
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(balanceRef);
    if (!snapshot.exists()) throw new Error('No existe saldo para ese tipo.');
    const balance = snapshot.data();
    const adjustmentTotal = Number(balance.adjustmentTotal || 0) + Number(amount);
    if (Number(balance.initial || 0) + adjustmentTotal - Number(balance.consumed || 0) < 0) {
      throw new Error('El ajuste dejaría el saldo en negativo.');
    }
    const createdAt = Timestamp.now();
    transaction.update(balanceRef, { adjustmentTotal, updatedAt: createdAt });
    transaction.set(adjustmentRef, { typeId, amount: Number(amount), reason, createdAt });
    transaction.set(movementRef, { typeId, kind: 'balance_adjustment', delta: Number(amount), reason, createdAt });
  });
}

export function saveHoliday(db, uid, holiday) {
  const ref = doc(db, 'users', uid, 'holidays', holiday.date);
  return setDoc(ref, {
    date: holiday.date,
    name: holiday.name,
    createdAt: holiday.createdAt || Timestamp.now(),
    updatedAt: Timestamp.now()
  }, { merge: true });
}

export function removeHoliday(db, uid, date) {
  return deleteDoc(doc(db, 'users', uid, 'holidays', date));
}

function balanceAfter(balance, delta) {
  const consumed = Number(balance.consumed || 0) + delta;
  const available = Number(balance.initial || 0) + Number(balance.adjustmentTotal || 0) - consumed;
  if (available < 0) throw new Error('El saldo disponible es insuficiente.');
  if (consumed < 0) throw new Error('El saldo consumido no puede ser negativo.');
  return consumed;
}

function lockId(group, date) {
  return `${group}__${date}`;
}

export async function persistLicense(db, uid, draft, previous = null) {
  const licenseRef = previous
    ? doc(db, 'users', uid, 'licenses', previous.id)
    : doc(userCollection(db, uid, 'licenses'));
  const movementRef = doc(userCollection(db, uid, 'movements'));
  const oldTypeId = previous?.typeId;
  const restorationMovementRef = oldTypeId && oldTypeId !== draft.typeId
    ? doc(userCollection(db, uid, 'movements')) : null;
  const newBalanceRef = doc(db, 'users', uid, 'balances', draft.typeId);
  const oldBalanceRef = oldTypeId && oldTypeId !== draft.typeId
    ? doc(db, 'users', uid, 'balances', oldTypeId) : null;
  const newLocks = draft.rulesSnapshot.allowOverlap ? [] : draft.calculation.calendarDates.map(date => ({
    date, ref: doc(db, 'users', uid, 'calendarDays', lockId(draft.rulesSnapshot.conflictGroup, date))
  }));
  const oldLocks = previous && !previous.rulesSnapshot.allowOverlap
    ? previous.calculation.calendarDates.map(date => doc(db, 'users', uid, 'calendarDays', lockId(previous.rulesSnapshot.conflictGroup, date)))
    : [];

  await runTransaction(db, async transaction => {
    const newBalanceSnapshot = await transaction.get(newBalanceRef);
    const oldBalanceSnapshot = oldBalanceRef ? await transaction.get(oldBalanceRef) : null;
    const storedLicense = previous ? await transaction.get(licenseRef) : null;
    const lockSnapshots = await Promise.all(newLocks.map(item => transaction.get(item.ref)));

    if (!newBalanceSnapshot.exists()) throw new Error('No existe saldo para el tipo seleccionado.');
    if (previous && (!storedLicense.exists() || storedLicense.data().status !== 'confirmed')) {
      throw new Error('La licencia ya no se puede modificar.');
    }
    lockSnapshots.forEach((snapshot, index) => {
      if (snapshot.exists() && snapshot.data().licenseId !== licenseRef.id) {
        throw new Error(`Existe otra licencia incompatible el ${newLocks[index].date}.`);
      }
    });

    if (oldBalanceRef) {
      const restored = balanceAfter(oldBalanceSnapshot.data(), -Number(previous.consumedUnits));
      transaction.update(oldBalanceRef, { consumed: restored, updatedAt: Timestamp.now() });
      const consumed = balanceAfter(newBalanceSnapshot.data(), Number(draft.consumedUnits));
      transaction.update(newBalanceRef, { consumed, updatedAt: Timestamp.now() });
    } else {
      const delta = Number(draft.consumedUnits) - Number(previous?.consumedUnits || 0);
      const consumed = balanceAfter(newBalanceSnapshot.data(), delta);
      transaction.update(newBalanceRef, { consumed, updatedAt: Timestamp.now() });
    }

    const newLockPaths = new Set(newLocks.map(item => item.ref.path));
    oldLocks.filter(ref => !newLockPaths.has(ref.path)).forEach(ref => transaction.delete(ref));
    newLocks.forEach(item => transaction.set(item.ref, {
      date: item.date, licenseId: licenseRef.id, conflictGroup: draft.rulesSnapshot.conflictGroup
    }));

    const now = Timestamp.now();
    transaction.set(licenseRef, {
      ...draft,
      status: 'confirmed',
      createdAt: previous?.createdAt || now,
      updatedAt: now
    });
    transaction.set(movementRef, {
      typeId: draft.typeId,
      licenseId: licenseRef.id,
      kind: previous ? 'license_modified' : 'license_confirmed',
      delta: previous && oldTypeId === draft.typeId
        ? Number(previous.consumedUnits) - Number(draft.consumedUnits)
        : -Number(draft.consumedUnits),
      previousConsumedUnits: Number(previous?.consumedUnits || 0),
      createdAt: now
    });
    if (restorationMovementRef) {
      transaction.set(restorationMovementRef, {
        typeId: oldTypeId,
        licenseId: licenseRef.id,
        kind: 'license_modified',
        delta: Number(previous.consumedUnits),
        reason: 'Reintegro por cambio de tipo',
        createdAt: now
      });
    }
  });
  return licenseRef.id;
}

export async function cancelLicense(db, uid, license) {
  const licenseRef = doc(db, 'users', uid, 'licenses', license.id);
  const balanceRef = doc(db, 'users', uid, 'balances', license.typeId);
  const movementRef = doc(userCollection(db, uid, 'movements'));
  const locks = license.rulesSnapshot.allowOverlap ? [] : license.calculation.calendarDates.map(date =>
    doc(db, 'users', uid, 'calendarDays', lockId(license.rulesSnapshot.conflictGroup, date))
  );
  await runTransaction(db, async transaction => {
    const [stored, balance] = await Promise.all([transaction.get(licenseRef), transaction.get(balanceRef)]);
    if (!stored.exists() || stored.data().status !== 'confirmed') throw new Error('La licencia ya no está confirmada.');
    const consumed = balanceAfter(balance.data(), -Number(license.consumedUnits));
    const now = Timestamp.now();
    transaction.update(balanceRef, { consumed, updatedAt: now });
    transaction.update(licenseRef, { status: 'cancelled', cancelledAt: now, updatedAt: now });
    locks.forEach(ref => transaction.delete(ref));
    transaction.set(movementRef, {
      typeId: license.typeId, licenseId: license.id, kind: 'license_cancelled',
      delta: Number(license.consumedUnits), createdAt: now
    });
  });
}

export async function exportBackup(db, uid) {
  const data = { schemaVersion: 1, exportedAt: new Date().toISOString(), collections: {} };
  for (const name of SUBCOLLECTIONS) {
    const snapshot = await getDocs(userCollection(db, uid, name));
    data.collections[name] = snapshot.docs.map(item => ({ id: item.id, ...clean(item.data()) }));
  }
  return data;
}

function revive(value) {
  if (Array.isArray(value)) return value.map(revive);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, revive(item)]));
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return Timestamp.fromDate(date);
  }
  return value;
}

export async function importBackup(db, uid, backup) {
  if (backup?.schemaVersion !== 1 || !backup.collections) throw new Error('El respaldo no tiene un formato compatible.');
  const records = SUBCOLLECTIONS.flatMap(name =>
    (backup.collections[name] || []).map(({ id, ...data }) => ({ name, id, data: revive(data) }))
  );
  for (let index = 0; index < records.length; index += 450) {
    const batch = writeBatch(db);
    records.slice(index, index + 450).forEach(item => {
      batch.set(doc(db, 'users', uid, item.name, item.id), item.data);
    });
    await batch.commit();
  }
}
