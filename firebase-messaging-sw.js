/* Service worker de Firebase Cloud Messaging (push web).
   Requiere firebase-config-compat.js (copialo de firebase-config-compat.example.js).
   Solo se usa en Modo nube; en Modo local los recordatorios son notificaciones del navegador. */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

try {
  importScripts('./firebase-config-compat.js'); // define self.firebaseConfig
  firebase.initializeApp(self.firebaseConfig);
  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const n = payload.notification || {};
    self.registration.showNotification(n.title || 'Finanzas Sonqollay', {
      body: n.body || 'Tenés cobros o pagos pendientes.',
      icon: 'logo.png',
      badge: 'logo.png',
    });
  });
} catch (e) {
  // Sin config: el SW queda inerte (Modo local).
}
