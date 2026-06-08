// ── Configuración de Firebase (proyecto finanzas-sonqollay) ────────────────
// La config web de Firebase NO es secreta (va en el cliente igual); por eso se
// versiona. El secreto es la clave del Admin SDK (gitignored), no esto.

export const firebaseConfig = {
  apiKey: "AIzaSyD59-qa-5DMBHkFVQGncfEcU8VlMBRDFD4",
  authDomain: "finanzas-sonqollay.firebaseapp.com",
  projectId: "finanzas-sonqollay",
  storageBucket: "finanzas-sonqollay.firebasestorage.app",
  messagingSenderId: "276067603430",
  appId: "1:276067603430:web:9f927c20cff55dda223c27",
  measurementId: "G-S09LVLNKH6"
};

// Clave VAPID (Web Push) para recordatorios push. Firebase Console →
// Configuración del proyecto → Cloud Messaging → "Certificados push web" →
// copiar el par de claves y pegarlo acá. Si queda vacío, se usan
// notificaciones locales del navegador (no push con la app cerrada).
export const VAPID_KEY = "";
