const DB_NAME = 'fleetops-offline';
const DB_VERSION = 1;

let db = null;

async function getDB() {
  if (db) return db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const database = e.target.result;
      if (!database.objectStoreNames.contains('queue')) {
        database.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

export async function queueOperation(operation, payload, token) {
  try {
    const database = await getDB();
    const tx = database.transaction('queue', 'readwrite');
    tx.objectStore('queue').add({ operation, payload, token, status: 'pending', createdAt: Date.now() });
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      const reg = await navigator.serviceWorker.ready;
      await reg.sync.register('fleetops-sync');
    }
  } catch (err) {
    console.error('Queue operation failed:', err);
  }
}

export async function getPendingCount() {
  try {
    const database = await getDB();
    return new Promise((resolve) => {
      const tx = database.transaction('queue', 'readonly');
      const req = tx.objectStore('queue').getAll();
      req.onsuccess = () => resolve(req.result.filter(r => r.status === 'pending').length);
      req.onerror = () => resolve(0);
    });
  } catch { return 0; }
}

export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js');
        console.log('SW registered:', reg.scope);
      } catch (err) {
        console.warn('SW registration failed:', err);
      }
    });
  }
}

export function useOnlineStatus() {
  return navigator.onLine;
}
