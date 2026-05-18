import { useState, useEffect } from 'react';
import { WifiOff, RefreshCw, CheckCircle } from 'lucide-react';
import { getPendingCount } from '../services/offline';

export default function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [justSynced, setJustSynced] = useState(false);

  useEffect(() => {
    const onOnline = () => { setOnline(true); triggerSync(); };
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    const interval = setInterval(async () => {
      const count = await getPendingCount();
      setPendingCount(count);
    }, 5000);

    // Listen for SW sync messages
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type === 'SYNC_START') setSyncing(true);
        if (e.data?.type === 'SYNC_DONE') {
          setSyncing(false);
          setJustSynced(true);
          setTimeout(() => setJustSynced(false), 3000);
        }
      });
    }

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(interval);
    };
  }, []);

  async function triggerSync() {
    setSyncing(true);
    try {
      if ('serviceWorker' in navigator && 'SyncManager' in window) {
        const reg = await navigator.serviceWorker.ready;
        await reg.sync.register('fleetops-sync');
      }
    } catch {}
    setTimeout(() => setSyncing(false), 2000);
  }

  if (online && pendingCount === 0 && !justSynced) return null;

  return (
    <div className={`fixed top-0 left-0 right-0 z-[100] px-4 py-2 flex items-center justify-center gap-3 text-xs font-mono font-bold
      ${!online ? 'bg-danger/90 text-white' : justSynced ? 'bg-success/90 text-white' : 'bg-amber-600/90 text-white'}`}>
      {!online ? (
        <>
          <WifiOff size={13} />
          OFFLINE MODE — {pendingCount} operation{pendingCount !== 1 ? 's' : ''} queued
        </>
      ) : justSynced ? (
        <>
          <CheckCircle size={13} />
          SYNC COMPLETE — all operations uploaded
        </>
      ) : (
        <>
          <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'SYNCING...' : `${pendingCount} PENDING SYNC`}
          {!syncing && (
            <button onClick={triggerSync} className="underline ml-1">
              sync now
            </button>
          )}
        </>
      )}
    </div>
  );
}
