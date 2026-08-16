import { AlertTriangle, CloudOff, Loader2, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  clearFailed, dismissFailed, flush, getSnapshot, startOfflineQueue, subscribe,
  type QueueSnapshot,
} from './offlineQueue.js';

/**
 * Reactive view of the offline queue. Also starts the queue's flush triggers,
 * so simply rendering the banner is enough to make sync work on that screen.
 */
export function useOfflineQueue(): QueueSnapshot {
  const [snap, setSnap] = useState<QueueSnapshot>(getSnapshot);

  useEffect(() => {
    startOfflineQueue();
    const unsub = subscribe(setSnap);
    // The snapshot can have moved between the initial useState and here.
    setSnap(getSnapshot());
    return unsub;
  }, []);

  return snap;
}

/**
 * Connectivity + sync status for the field screens.
 *
 * Deliberately renders nothing when there's nothing to say — a permanent
 * "you are online" chip is noise on a 5-inch screen that a worker is holding
 * in one hand. It appears only when the worker's mental model might otherwise
 * be wrong: offline, work waiting to sync, or something that needs redoing.
 */
export function OfflineBanner() {
  const { pending, failed, online, syncing } = useOfflineQueue();

  if (online && !syncing && pending.length === 0 && failed.length === 0) return null;

  return (
    <div className="px-4 pt-2 space-y-2">
      {(!online || pending.length > 0 || syncing) && (
        <div
          className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 border"
          style={!online
            ? { background: 'rgba(255,176,32,.1)', borderColor: 'rgba(255,176,32,.3)' }
            : { background: 'rgba(55,230,255,.08)', borderColor: 'rgba(55,230,255,.25)' }}
        >
          {syncing
            ? <Loader2 size={15} className="text-cds-cyan animate-spin flex-shrink-0" />
            : !online
              ? <CloudOff size={15} className="text-cds-amber flex-shrink-0" />
              : <RefreshCw size={15} className="text-cds-cyan flex-shrink-0" />}

          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold" style={{ color: online ? '#37e6ff' : '#ffb020' }}>
              {syncing ? 'Syncing…' : !online ? 'Offline' : 'Waiting to sync'}
            </div>
            <div className="text-[10px] font-mono text-text-2 mt-0.5">
              {pending.length > 0
                ? `${pending.length} action${pending.length === 1 ? '' : 's'} saved on this device`
                : 'Work is saved here and will sync automatically'}
            </div>
          </div>

          {online && !syncing && pending.length > 0 && (
            <button
              onClick={() => { void flush(); }}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border cursor-pointer flex-shrink-0"
              style={{ color: '#37e6ff', background: 'rgba(55,230,255,.12)', borderColor: 'rgba(55,230,255,.3)' }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {failed.length > 0 && (
        <div className="rounded-xl px-3 py-2.5 border border-cds-red/30 bg-cds-red/[.08]">
          <div className="flex items-center gap-2.5">
            <AlertTriangle size={15} className="text-cds-red flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-cds-red">
                {failed.length} action{failed.length === 1 ? '' : 's'} could not be saved
              </div>
              <div className="text-[10px] font-mono text-text-2 mt-0.5">Needs to be redone</div>
            </div>
            {failed.length > 1 && (
              <button
                onClick={clearFailed}
                className="text-[10px] font-mono text-text-2 underline cursor-pointer flex-shrink-0"
              >
                Clear all
              </button>
            )}
          </div>
          <div className="mt-2 space-y-1.5">
            {failed.map(f => (
              <div key={f.id} className="flex items-start gap-2 rounded-lg bg-black/25 px-2.5 py-1.5">
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono font-bold text-text-1">
                    {f.label} · {f.kind}
                  </div>
                  <div className="text-[10px] text-text-2 mt-0.5 break-words">{f.reason}</div>
                </div>
                <button
                  onClick={() => dismissFailed(f.id)}
                  className="w-5 h-5 rounded flex items-center justify-center text-text-2 hover:text-text-0 cursor-pointer flex-shrink-0"
                  aria-label="Dismiss"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
