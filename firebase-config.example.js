// ── Configuración de Firebase (OPCIONAL) ───────────────────────────────────
// La app funciona en "Modo local" (localStorage) sin tocar esto.
// Para sincronizar en la nube:
//   1. Copiá este archivo como  firebase-config.js
//   2. Pegá los valores de tu proyecto (Firebase Console → Configuración → Tus apps → Web)
//   3. Habilitá Authentication → método "Anónimo"
//   4. Creá Firestore Database y publicá las reglas de  firestore.rules
//
// firebase-config.js está en .gitignore (no se sube al repo).

export const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "TU_PROYECTO.firebaseapp.com",
  projectId: "TU_PROYECTO",
  storageBucket: "TU_PROYECTO.firebasestorage.app",
  messagingSenderId: "TU_SENDER_ID",
  appId: "TU_APP_ID"
};

// Solo si vas a usar recordatorios push (FCM):
// Firebase Console → Cloud Messaging → Web Push certificates → Key pair.
// Si la dejás vacía, los recordatorios usan notificaciones locales del navegador.
export const VAPID_KEY = "";
