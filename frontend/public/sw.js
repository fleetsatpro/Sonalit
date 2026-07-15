const CACHE_NAME = 'fleetops-v3';
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

// Background sync for queued operations
self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) {
    event.waitUntil(replayQueue());
  }
});

async function replayQueue() {
  const clients = await self.clients.matchAll();
  clients.forEach(client => client.postMessage({ type: 'SYNC_START' }));

  const db = await openDB();
  const ops = await getAllPending(db);

  for (const op of ops) {
    try {
      const res = await fetch('/api/v1/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${op.token}` },
        body: JSON.stringify({ operations: [op] }),
      });
      if (res.ok) await markDone(db, op.id);
    } catch {}
  }

  clients.forEach(client => client.postMessage({ type: 'SYNC_DONE', count: ops.length }));
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('fleetops-offline', 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllPending(db) {
  return new Promise((resolve) => {
    const tx = db.transaction('queue', 'readonly');
    const req = tx.objectStore('queue').getAll();
    req.onsuccess = () => resolve(req.result.filter(r => r.status === 'pending'));
  });
}

function markDone(db, id) {
  return new Promise((resolve) => {
    const tx = db.transaction('queue', 'readwrite');
    const store = tx.objectStore('queue');
    const req = store.get(id);
    req.onsuccess = () => {
      const item = req.result;
      if (item) { item.status = 'done'; store.put(item); }
      resolve();
    };
  });
}
