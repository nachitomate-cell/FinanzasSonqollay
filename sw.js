// Service worker — cache de shell para offline.
const CACHE = 'finanzas-sonqollay-v21';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c =>
      Promise.all(ASSETS.map(url => c.add(new Request(url, { cache: 'reload' })).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    const old = keys.filter(k => k !== CACHE);
    await Promise.all(old.map(k => caches.delete(k)));
    // Si había cachés viejos, hubo una actualización → avisar a las pestañas
    if (old.length) {
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach(c => c.postMessage({ type: 'SW_UPDATED' }));
    }
    await self.clients.claim();
  })());
});

// Clic en una notificación local → enfocar/abrir la app
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if ('focus' in c) return c.focus();
    if (self.clients.openWindow) return self.clients.openWindow('./');
  }));
});

const putCache = (req, res) => { if (res && res.ok && new URL(req.url).origin === self.location.origin) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); } };

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Solo http(s) (ignora chrome-extension, etc.)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // No interceptar: APIs externas ni archivos de config opcionales (pueden no existir → 404).
  if (
    url.hostname.endsWith('googleapis.com') ||
    url.hostname.endsWith('firebaseio.com') ||
    url.hostname === 'mindicador.cl' ||
    (url.hostname.endsWith('gstatic.com') && !url.pathname.includes('/firebasejs/')) ||
    /firebase-config(-compat)?\.js$/.test(url.pathname)
  ) return;

  // SDK de Firebase: stale-while-revalidate
  if (url.hostname.endsWith('gstatic.com') && url.pathname.includes('/firebasejs/')) {
    e.respondWith((async () => {
      const cached = await caches.match(e.request);
      const network = fetch(e.request).then(res => { putCache(e.request, res); return res; });
      return cached || network.catch(() => cached || Response.error());
    })());
    return;
  }

  // index.html: cache-first (misma versión del shell que app.js/styles.css → sin
  // desajustes que rompan el JS). Las versiones nuevas llegan al actualizar el SW
  // y se avisan con el banner "Nueva versión disponible".
  if (url.pathname === '/' || url.pathname.endsWith('/index.html')) {
    e.respondWith((async () => {
      const cached = (await caches.match(e.request)) || (await caches.match('./index.html')) || (await caches.match('./'));
      if (cached) { fetch(e.request).then(res => putCache(e.request, res)).catch(() => {}); return cached; }
      try { const res = await fetch(e.request); putCache(e.request, res); return res; }
      catch { return Response.error(); }
    })());
    return;
  }

  // Resto: cache-first, revalida en segundo plano; nunca resuelve a undefined.
  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) { fetch(e.request).then(res => putCache(e.request, res)).catch(() => {}); return cached; }
    try { const res = await fetch(e.request); putCache(e.request, res); return res; }
    catch { return Response.error(); }
  })());
});