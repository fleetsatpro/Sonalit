const DB_NAME = 'fleetops-offline';
let db = null;

async function getDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      if (!e.target.result.objectStoreNames.contains('queue'))
        e.target.result.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror  = () => reject(req.error);
  });
}

export async function queueOperation() {
  // Deprecated legacy queue: current apps/web uses the tenant-bound Dexie
  // outbox. Never persist bearer credentials in the legacy IndexedDB store.
  throw new Error('Legacy offline queue disabled; use the tenant-scoped outbox.');
}

export async function getPendingCount() {
  try {
    const database = await getDB();
    return new Promise((resolve) => {
      const tx = database.transaction('queue', 'readonly');
      const req = tx.objectStore('queue').getAll();
      req.onsuccess = () => resolve(req.result.filter(r => r.status === 'pending').length);
      req.onerror  = () => resolve(0);
    });
  } catch { return 0; }
}

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        await navigator.serviceWorker.register('/sw.js');
      } catch (err) { console.warn('SW failed:', err.message); }
    });
  }
}
