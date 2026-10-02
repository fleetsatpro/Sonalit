const CACHE_NAME = 'fleetops-v4';
const STATIC_ASSETS = ['/', '/index.html'];
const SYNC_TAG = 'fleetops-sync';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.url.includes('/api/')) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      }).catch(() => cached || new Response('Offline', { status: 503 }));
    })
  );
});

// Legacy credential-bearing background queue deliberately retired.
// Current apps/web uses the tenant-bound Dexie outbox and performs authenticated,
// tenant-scoped sync in page context. Never replay historical bearer tokens here.
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('fleetops-offline');
      request.onsuccess = async () => {
        const clients = await self.clients.matchAll();
        clients.forEach(client => client.postMessage({ type: 'LEGACY_SYNC_RETIRED' }));
        resolve();
      };
      request.onerror = () => resolve();
      request.onblocked = () => resolve();
    }));
  }
});
