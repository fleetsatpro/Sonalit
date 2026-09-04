/**
 * Yard departures — the screen that closes the gap between "clamped" and "gone".
 *
 * THE PROBLEM IT SOLVES
 * A clamp creates the trip at 'locked' and nothing ever moved it on. A driver
 * who scans the QR now departs on his own telemetry, but a driver who does not
 * — the contractor's man with a locked-down phone, the one who waved the code
 * away at the gate — leaves a trip that says "in the yard" for the rest of its
 * life. Every transit metric derived from departed_at stayed null, and the
 * control room read a truck on the road as still staged.
 *
 * So the yard gets the say. They are the ones who watched it go.
 *
 * `scanned` is the whole reason this list is sorted the way it is: an unscanned
 * truck is the crew's problem and a scanned one usually is not, because it will
 * drop off this list by itself within a couple of minutes of the gate. Putting
 * the unscanned ones first means the crew acts on the trucks that need a human
 * and ignores the ones that don't.
 *
 * Offline-capable for the same reason the clamp is: the gate is where the
 * signal dies, and a departure the worker believes they recorded must not
 * evaporate. The queued action carries the time it was TAKEN, not the time it
 * eventually syncs, so a truck that left at 06:10 and synced at 09:00 is still
 * recorded as having left at 06:10.
 */
import { Link } from '@tanstack/react-router';
import {
  ArrowLeft, Check, CloudOff, Loader2, QrCode, Truck, TriangleAlert, UserRound, X,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { useAwaitingDeparture, useMarkDeparted } from '../cds/hooks.js';

import { OfflineBanner } from './OfflineBanner.js';
import { enqueue, isOnline } from './offlineQueue.js';

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? '' : String(v));

function waitedFor(since: unknown): string {
  const t = since ? new Date(String(since)).getTime() : NaN;
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m in yard`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ${mins % 60}m in yard`;
  return `${Math.floor(h / 24)}d ${h % 24}h in yard`;
}

export default function DeparturesApp() {
  const { data, isLoading, error } = useAwaitingDeparture();
  const [confirm, setConfirm] = useState<Row | null>(null);

  // Unscanned first, then longest-waiting. A truck with no tracking is the only
  // one that can never leave this list on its own.
  const rows = useMemo(() => {
    const list = (data?.data ?? []) as Row[];
    return [...list].sort((a, b) => {
      const as = a['scanned'] === true ? 1 : 0;
      const bs = b['scanned'] === true ? 1 : 0;
      if (as !== bs) return as - bs;
      return new Date(s(a['clamped_at'])).getTime() - new Date(s(b['clamped_at'])).getTime();
    });
  }, [data]);

  if (confirm) return <ConfirmDeparture trip={confirm} onClose={() => setConfirm(null)} />;

  const unscanned = rows.filter(r => r['scanned'] !== true).length;

  return (
    <div className="min-h-screen bg-ink-0 text-text-0">
      <header className="sticky top-0 z-10 bg-ink-0/95 backdrop-blur border-b border-white/[.06]">
        <div className="px-4 py-3 flex items-center gap-3">
          <Link to="/field"
            className="w-9 h-9 rounded-lg bg-white/[.05] border border-white/10 text-text-1 flex items-center justify-center flex-shrink-0">
            <ArrowLeft size={16} />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold leading-tight truncate">Awaiting departure</div>
            <div className="text-[11px] text-text-2 font-mono mt-0.5 truncate">
              {rows.length} clamped · {unscanned} not tracking
            </div>
          </div>
        </div>
        <OfflineBanner />
      </header>

      <main className="px-4 py-4 space-y-2.5">
        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-16 text-text-2 text-[12px] font-mono">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        )}
        {error && !isLoading && (
          <div className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-[12px] text-danger">
            Could not load the departure list. It will retry on its own.
          </div>
        )}
        {!isLoading && !error && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-16 text-text-2">
            <Check size={22} className="text-ok" />
            <div className="text-[12px] font-mono">Nothing waiting to leave.</div>
          </div>
        )}
        {rows.map(r => (
          <TripCard key={s(r['trip_id'])} row={r} onMark={() => setConfirm(r)} />
        ))}
      </main>
    </div>
  );
}

function TripCard({ row, onMark }: { row: Row; onMark: () => void }) {
  const scanned = row['scanned'] === true;
  return (
    <div className="rounded-xl border border-white/[.08] bg-white/[.03] px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold truncate">
            {s(row['container_number']) || s(row['trip_number'])}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-text-2">
            <span className="inline-flex items-center gap-1"><Truck size={11} />{s(row['vehicle_reg']) || '—'}</span>
            <span className="inline-flex items-center gap-1"><UserRound size={11} />{s(row['driver_name']) || '—'}</span>
          </div>
          <div className="mt-1 text-[11px] font-mono text-text-2 truncate">
            {[s(row['destination']), waitedFor(row['clamped_at'])].filter(Boolean).join(' · ')}
          </div>
        </div>
        {/* Not decoration: this badge is the crew's instruction. Tracking means
            the trip will depart itself; no tracking means it never will. */}
        <span
          className="flex-shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-mono uppercase tracking-wide"
          style={scanned
            ? { background: 'rgba(51,214,168,.12)', color: '#33d6a8' }
            : { background: 'rgba(255,122,0,.14)', color: '#ff9d3d' }}
        >
          {scanned ? <QrCode size={10} /> : <TriangleAlert size={10} />}
          {scanned ? 'Tracking' : 'No scan'}
        </span>
      </div>
      <button
        onClick={onMark}
        className="mt-3 w-full h-11 rounded-lg font-bold text-[13px] active:scale-[.99] transition-transform cursor-pointer"
        style={{ background: 'linear-gradient(135deg, #ff7a00, #F0B429)', color: '#170d00' }}
      >
        Mark departed
      </button>
    </div>
  );
}

function ConfirmDeparture({ trip, onClose }: { trip: Row; onClose: () => void }) {
  const mark = useMarkDeparted();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const offline = !isOnline();
  const tripId = s(trip['trip_id']);
  const label = s(trip['container_number']) || s(trip['trip_number']) || 'trip';

  const submit = () => {
    setError(null);
    // The moment of departure is now, whichever path this takes. Letting the
    // server default it would date an offline departure to whenever the tablet
    // next found signal, which for a gate in a dead zone can be hours.
    const at = new Date().toISOString();
    if (offline) {
      enqueue({
        kind: 'depart',
        bookingId: '', containerId: '',
        label,
        url: `/trips/${tripId}/depart`,
        payload: { at, note: note.trim() || null },
      });
      setQueued(true);
      return;
    }
    mark.mutate({ tripId, at, note: note.trim() || undefined }, {
      onSuccess: onClose,
      onError: (err) => {
        const ax = err as { response?: { data?: { error?: string } } };
        setError(ax.response?.data?.error || 'Could not mark this departure.');
      },
    });
  };

  if (queued) {
    return (
      <div className="min-h-screen bg-ink-0 text-text-0 flex flex-col items-center justify-center px-6 gap-4">
        <CloudOff size={30} className="text-warn" />
        <div className="text-[15px] font-bold text-center">Saved on this device</div>
        <p className="text-[12px] font-mono text-text-2 text-center max-w-[280px]">
          {label} will be marked as departed at the time you tapped, as soon as this
          tablet has signal again.
        </p>
        <button onClick={onClose}
          className="mt-2 h-11 px-6 rounded-lg bg-white/[.06] border border-white/10 text-[13px] font-bold cursor-pointer">
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-0 text-text-0">
      <header className="sticky top-0 z-10 bg-ink-0/95 backdrop-blur border-b border-white/[.06] px-4 py-3 flex items-center gap-3">
        <button onClick={onClose}
          className="w-9 h-9 rounded-lg bg-white/[.05] border border-white/10 text-text-1 flex items-center justify-center cursor-pointer">
          <X size={16} />
        </button>
        <div className="min-w-0">
          <div className="text-[15px] font-bold leading-tight truncate">Confirm departure</div>
          <div className="text-[11px] font-mono text-text-2 mt-0.5 truncate">{label}</div>
        </div>
      </header>

      <main className="px-4 py-5 space-y-4">
        <div className="rounded-xl border border-white/[.08] bg-white/[.03] px-4 py-3 space-y-1.5 text-[12px] font-mono text-text-2">
          <div className="flex justify-between gap-3"><span>Truck</span><span className="text-text-0">{s(trip['vehicle_reg']) || '—'}</span></div>
          <div className="flex justify-between gap-3"><span>Driver</span><span className="text-text-0">{s(trip['driver_name']) || '—'}</span></div>
          <div className="flex justify-between gap-3"><span>Lock</span><span className="text-text-0">{s(trip['lock_serial']) || '—'}</span></div>
          <div className="flex justify-between gap-3"><span>Destination</span><span className="text-text-0 truncate max-w-[55%]">{s(trip['destination']) || '—'}</span></div>
        </div>

        {trip['scanned'] === true && (
          // Worth saying out loud: marking a tracked truck departed is not
          // wrong, but it is usually unnecessary, and a crew that marks
          // everything by hand stops noticing which trucks actually need them.
          <div className="rounded-xl border border-white/[.08] bg-white/[.03] px-4 py-3 text-[11px] font-mono text-text-2">
            This driver is already sending location. It will normally mark itself
            departed a few minutes after the gate.
          </div>
        )}

        <label className="block">
          <span className="text-[11px] font-mono uppercase tracking-wide text-text-2">Note (optional)</span>
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="e.g. left via north gate"
            className="mt-1.5 w-full h-11 rounded-lg bg-white/[.04] border border-white/10 px-3 text-[13px] outline-none focus:border-white/25"
          />
        </label>

        {error && (
          <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>
        )}

        <button
          onClick={submit}
          disabled={mark.isPending || !tripId}
          className="w-full h-12 rounded-lg font-bold text-[14px] disabled:opacity-60 active:scale-[.99] transition-transform cursor-pointer inline-flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg, #ff7a00, #F0B429)', color: '#170d00' }}
        >
          {mark.isPending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} strokeWidth={3} />}
          {mark.isPending ? 'Marking…' : offline ? 'Save on device' : 'Confirm departure'}
        </button>
      </main>
    </div>
  );
}
