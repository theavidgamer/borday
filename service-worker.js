// Bump CACHE_VERSION on every deploy.
const CACHE_VERSION = 'ledger-v8';
const LOCAL = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
// Must match the URLs used in index.html exactly.
const CDN = [
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE_VERSION);
    // Add each file separately so one failure (e.g. a CDN) doesn't discard everything.
    await Promise.all([...LOCAL, ...CDN].map(u => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  if (sameOrigin) {
    // Stale-while-revalidate: instant offline load, updates fetched in the background.
    e.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then(res => {
        if (res && res.status === 200) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      if (cached) { e.waitUntil(network); return cached; }
      return (await network) || (await cache.match('./index.html')) || Response.error();
    })());
    return;
  }

  // CDN libraries: cache-first.
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && res.status === 200) caches.open(CACHE_VERSION).then(c => c.put(req, res.clone())).catch(() => {});
      return res;
    } catch (_) { return Response.error(); }
  })());
});
