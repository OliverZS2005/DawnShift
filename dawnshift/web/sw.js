// Service worker for the web version: keeps a copy of the app's own files so
// it opens fast and works as an installed app. Requests to AI services and
// other websites are never cached.
const VERSION = '__VERSION__';
const ASSETS = __ASSETS__;

self.addEventListener('install', (event) => {
  // The new SW stays in "waiting" until the page asks it to take over, so the
  // user can decide when to reload (see app.js: "A new version is available").
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  // Account and sync requests always go straight to the server.
  if (url.pathname.includes('/api/')) return;
  // Network first, so updates show up right away; the saved copy is the fallback.
  event.respondWith(
    // no-cache: always ask the server whether there's a newer version,
    // instead of using the browser's own saved copy.
    fetch(event.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || caches.match('./'))),
  );
});

// Clicking a notification brings Dawnshift back to the front, or opens it.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = all.find((c) => c.url.startsWith(self.location.origin));
    if (mine) { await mine.focus(); return; }
    await self.clients.openWindow('/');
  })());
});
