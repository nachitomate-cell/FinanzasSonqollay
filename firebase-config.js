// ── Configuración de Firebase ──────────────────────────────────────────────
// Por defecto la app corre en MODO LOCAL (datos en este dispositivo) y no
// necesita nada de esto. Para activar la NUBE (sincronización + push), reemplazá
// los valores nulos por los de tu proyecto (Firebase Console → Tus apps → Web).
//
// Nota: la config web de Firebase NO es secreta (la seguridad va por las reglas
// de Firestore), por eso este archivo se versiona. Si preferís no versionarla,
// agregalo a .gitignore.

export const firebaseConfig = null;
// Ejemplo (descomentar y completar para usar la nube):
// export const firebaseConfig = {
//   apiKey: "…", authDomain: "…", projectId: "…",
//   storageBucket: "…", messagingSenderId: "…", appId: "…"
// };

// Solo para recordatorios push (FCM): Firebase Console → Cloud Messaging →
// Web Push certificates. Si queda vacío, se usan notificaciones locales.
export const VAPID_KEY = "";
