import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut
} from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js';

let auth;
let db;
let authorizedUid;

export async function initializeFirebase() {
  let configModule;
  try {
    configModule = await import('../config/firebase-config.js');
  } catch {
    throw new Error('Falta js/config/firebase-config.js. Crealo a partir del archivo de ejemplo.');
  }
  if (!configModule.firebaseConfig?.projectId || configModule.firebaseConfig.apiKey === 'REEMPLAZAR') {
    throw new Error('Completá la configuración de Firebase antes de continuar.');
  }
  authorizedUid = configModule.authorizedUid;
  const app = initializeApp(configModule.firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  return { auth, db, authorizedUid };
}

export function observeSession(callback) {
  return onAuthStateChanged(auth, user => {
    if (user && user.uid !== authorizedUid) {
      signOut(auth);
      callback(null, new Error('Esta cuenta de Google no está autorizada.'));
      return;
    }
    callback(user, null);
  });
}

export async function connectGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  if (result.user.uid !== authorizedUid) {
    await signOut(auth);
    throw new Error('Esta cuenta de Google no está autorizada.');
  }
  return result.user;
}

export function disconnect() {
  return signOut(auth);
}
