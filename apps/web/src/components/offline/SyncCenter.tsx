/**
 * Sync Center — one screen that tells the truth about what this device has and
 * has not delivered.
 *
 * The language here is the point. "Delivered", "Confirmed" and "Completed" are
 * reserved for things Sonalit has actually accepted; anything still on the
 * device says so in those words. A worker who reads "Saved on device" knows
 * they are not done. A worker who reads "Delivered" when nothing left the phone
 * has been lied to, and will find out at the worst possible moment.
 *
 * Retry and Dismiss are offered only where they are meaningful — a permanent
 * rejection or a conflict, both of which a person can act on. Nothing here lets
 * an ordinary user reach into the queue's internals.
 */
import {
  AlertTriangle, Check, CloudOff, Loader2, RefreshCw, Trash2, Wifi, WifiOff,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  dismissEntry, getOfflineStatus, listForUser, retryEntry,
  subscribeOfflineStatus, syncNow, type OfflineStatus,
} from '../../lib/offline/index.js';

import type { ConnectivityState, OutboxEntry, OutboxStatus } from '../../lib/offline/types.js';

// ── Status vocabulary ────────────────────────────────────────────────────────

/**
 * Exported and unit-tested: this mapping is the promise the app makes to the
 * person holding the device, and it must not drift.
 */
export const STATUS_LABEL: Record<OutboxStatus, string> = {
  PENDING: 'Saved on device',
  SYNCING: 'Synchronising',
  ACKNOWLEDGED: 'Confirmed by Sonalit',
  FAILED_RETRYABLE: 'Waiting to retry',
  FAILED_PERMANENT: 'Not accepted by Sonalit',
  CONFLICT: 'Needs review',
};

const STATUS_TONE: Record<OutboxStatus, string> = {
  PENDING: 'text-cds-amber',
  SYNCING: 'text-cds-cyan',
  ACKNOWLEDGED: 'text-cds-teal',
  FAILED_RETRYABLE: 'text-cds-amber',
  FAILED_PERMANENT: 'text-cds-red',
  CONFLICT: 'text-cds-orange',
};

export const CONNECTIVITY_LABEL: Record<ConnectivityState, string> = {
  UNKNOWN: 'Checking connection',
  ONLINE: 'Online',
  // Named for what the worker experiences, not for the state machine.
  DEGRADED: 'Weak connection',
  OFFLINE: 'Offline',
  SYNCING: 'Synchronising',
};

function ago(ms: number | null): string {
  if (ms == null) return 'never';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ── Compact chip, for app chrome ─────────────────────────────────────────────

/**
 * Renders nothing when there is nothing to say. A permanent "you are online"
 * badge is noise on a five-inch screen held in one hand; the chip appears only
 * when the worker's mental model might otherwise be wrong.
 */
export function ConnectivityChip({ onClick }: { onClick?: () => void }) {
  const [status, setStatus] = useState<OfflineStatus | null>(null);

  const refresh = useCallback(() => {
    void getOfflineStatus().then(setStatus);
  }, []);

  useEffect(() => {
    refresh();
    return subscribeOfflineStatus(refresh);
  }, [refresh]);

  if (!status) return null;

  const state = status.connectivity.state;
  const queued = status.queue
    ? status.queue.pending + status.queue.syncing + status.queue.failedRetryable
    : 0;
  const needsAttention = (status.queue?.failedPermanent ?? 0) + (status.queue?.conflict ?? 0);

  if (state === 'ONLINE' && queued === 0 && needsAttention === 0) return null;

  const tone =
    needsAttention > 0 ? 'text-cds-red border-cds-red/30 bg-cds-red/[.08]'
      : state === 'OFFLINE' ? 'text-cds-amber border-cds-amber/30 bg-cds-amber/[.08]'
        : 'text-cds-cyan border-cds-cyan/25 bg-cds-cyan/[.08]';

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ${tone}`}
      aria-label={`${CONNECTIVITY_LABEL[state]}${queued ? `, ${queued} waiting to sync` : ''}`}
    >
      {state === 'OFFLINE' ? <CloudOff size={13} />
        : state === 'SYNCING' ? <Loader2 size={13} className="animate-spin" />
          : needsAttention > 0 ? <AlertTriangle size={13} />
            : <RefreshCw size={13} />}
      <span>{CONNECTIVITY_LABEL[state]}</span>
      {queued > 0 && <span className="font-mono opacity-80">{queued}</span>}
    </button>
  );
}

// ── Full panel ───────────────────────────────────────────────────────────────

export default function SyncCenter({ userId }: { userId: string }) {
  const [status, setStatus] = useState<OfflineStatus | null>(null);
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void getOfflineStatus().then(setStatus);
    void listForUser(userId).then(setEntries);
  }, [userId]);

  useEffect(() => {
    refresh();
    return subscribeOfflineStatus(refresh);
  }, [refresh]);

  const onSyncNow = useCallback(async () => {
    setBusy(true);
    try { await syncNow(); } finally { setBusy(false); refresh(); }
  }, [refresh]);

  if (!status) return null;

  const c = status.connectivity;
  const q = status.queue;

  // Acknowledged history is deliberately last and collapsed: the queue is for
  // what still needs attention, not a log to scroll past.
  const active = entries.filter(e => e.status !== 'ACKNOWLEDGED');
  const done = entries.filter(e => e.status === 'ACKNOWLEDGED');

  return (
    <div className="space-y-4">
      {status.blocked && (
        <div className="rounded-xl border border-cds-red/30 bg-cds-red/[.08] px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-cds-red">
            <AlertTriangle size={15} />
            Synchronisation paused
          </div>
          <p className="mt-1 text-[12px] text-text-1">{status.blocked.message}</p>
          <p className="mt-1 text-[11px] font-mono text-text-2">
            Work already recorded on this device is kept and will sync once this is resolved.
          </p>
        </div>
      )}

      {!status.storageAvailable && (
        <div className="rounded-xl border border-cds-amber/30 bg-cds-amber/[.08] px-4 py-3 text-[12px] text-text-1">
          This browser will not let Sonalit store data on the device, so offline
          working is unavailable here. Everything still works while you have a
          connection.
        </div>
      )}

      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <header className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {c.state === 'OFFLINE' ? <WifiOff size={16} className="text-cds-amber" />
              : <Wifi size={16} className={c.state === 'DEGRADED' ? 'text-cds-amber' : 'text-cds-teal'} />}
            <span className="text-[13px] font-semibold text-text-1">
              {CONNECTIVITY_LABEL[c.state]}
            </span>
          </div>
          <button
            onClick={() => { void onSyncNow(); }}
            disabled={busy || c.state === 'OFFLINE'}
            className="flex items-center gap-1.5 rounded-lg border border-cds-cyan/30 bg-cds-cyan/[.12] px-2.5 py-1 text-[11px] font-semibold text-cds-cyan disabled:opacity-40 cursor-pointer"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Sync now
          </button>
        </header>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] font-mono sm:grid-cols-3">
          <Stat label="Last sync" value={ago(c.lastSuccessfulSyncAt ? Date.now() - c.lastSuccessfulSyncAt : null)} />
          <Stat label="Waiting" value={String((q?.pending ?? 0) + (q?.failedRetryable ?? 0))} />
          <Stat label="Sending" value={String(q?.syncing ?? 0)} />
          <Stat label="Needs review" value={String(q?.conflict ?? 0)} tone={q?.conflict ? 'text-cds-orange' : undefined} />
          <Stat label="Not accepted" value={String(q?.failedPermanent ?? 0)} tone={q?.failedPermanent ? 'text-cds-red' : undefined} />
          <Stat label="GPS buffered" value={String(status.gpsBuffered)} />
          {/* Realtime is reported separately because it fails on its own: live
              updates can be dead while everything else is healthy, and the map
              must not claim LIVE in that state. */}
          <Stat label="Live updates" value={c.realtimeConnected ? 'connected' : 'not connected'} />
          <Stat label="Latency" value={c.latencyMs == null ? 'unknown' : `${Math.round(c.latencyMs)}ms`} />
          <Stat label="Oldest waiting" value={q?.oldestPendingAgeMs ? ago(q.oldestPendingAgeMs) : '—'} />
        </dl>
      </section>

      {active.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-mono uppercase tracking-wider text-text-2">
            On this device ({active.length})
          </h3>
          {active.map(e => (
            <EntryRow key={e.id} entry={e} onChanged={refresh} />
          ))}
        </section>
      )}

      {active.length === 0 && (
        <p className="rounded-xl border border-white/10 bg-black/20 px-4 py-6 text-center text-[12px] text-text-2">
          Everything recorded on this device has been confirmed by Sonalit.
        </p>
      )}

      {done.length > 0 && (
        <details className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
          <summary className="cursor-pointer text-[11px] font-mono uppercase tracking-wider text-text-2">
            Confirmed ({done.length})
          </summary>
          <div className="mt-2 space-y-1.5">
            {done.slice(0, 50).map(e => (
              <div key={e.id} className="flex items-center gap-2 text-[11px]">
                <Check size={12} className="flex-shrink-0 text-cds-teal" />
                <span className="truncate text-text-1">{e.label}</span>
                <span className="ml-auto flex-shrink-0 font-mono text-text-2">
                  {e.acknowledgedAt ? ago(Date.now() - e.acknowledgedAt) : ''}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string | undefined }) {
  return (
    <div>
      <dt className="text-text-2">{label}</dt>
      <dd className={`font-semibold ${tone ?? 'text-text-1'}`}>{value}</dd>
    </div>
  );
}

function EntryRow({ entry, onChanged }: { entry: OutboxEntry; onChanged: () => void }) {
  const canRetry = entry.status === 'FAILED_PERMANENT' || entry.status === 'CONFLICT';
  const canDismiss = canRetry;

  return (
    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5">
      <div className="flex items-start gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-text-1">{entry.label}</div>
          <div className={`mt-0.5 text-[11px] font-mono ${STATUS_TONE[entry.status]}`}>
            {STATUS_LABEL[entry.status]}
            {entry.attempts > 0 && entry.status === 'FAILED_RETRYABLE' && (
              <span className="text-text-2"> · attempt {entry.attempts}</span>
            )}
          </div>
          {entry.lastErrorMessage && (
            <p className="mt-1 break-words text-[11px] text-text-2">{entry.lastErrorMessage}</p>
          )}
        </div>

        {canRetry && (
          <button
            onClick={() => { void retryEntry(entry.id).then(onChanged); }}
            className="flex-shrink-0 rounded-lg border border-cds-cyan/30 bg-cds-cyan/[.12] px-2 py-1 text-[10px] font-semibold text-cds-cyan cursor-pointer"
          >
            Retry
          </button>
        )}
        {canDismiss && (
          <button
            onClick={() => { void dismissEntry(entry.id).then(onChanged); }}
            aria-label="Discard this action"
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-text-2 hover:text-cds-red cursor-pointer"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
