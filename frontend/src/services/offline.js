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

export async function queueOperation(operation, payload, token) {
  try {
    const database = await getDB();
    const tx = database.transaction('queue', 'readwrite');
    tx.objectStore('queue').add({ operation, payload, token, status: 'pending', createdAt: Date.now() });
  } catch (err) { console.error('Queue failed:', err); }
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
