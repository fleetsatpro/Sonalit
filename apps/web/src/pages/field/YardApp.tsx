import { Link } from '@tanstack/react-router';
import {
  ArrowLeft, ArrowRight, Building2, Check, ChevronRight, CloudOff, Lock, Loader2,
  MapPin, Package, Phone, StickyNote, Truck, UserRound, X,
} from 'lucide-react';
import { useState } from 'react';

import { useYardQueue, useBookingContainers, useClampBookingContainer } from '../cds/hooks.js';

import { OfflineBanner, useOfflineQueue } from './OfflineBanner.js';
import { enqueue, isOnline } from './offlineQueue.js';
import { ClampResult, type IssuedTracking } from './TrackingQr.js';

type Row = Record<string, unknown>;
const s = (v: unknown) => v == null ? '' : String(v);

export default function YardApp() {
  const [pick, setPick] = useState<Row | null>(null);
  const [target, setTarget] = useState<Row | null>(null);

  if (target && pick) return (
    <ClampForm
      booking={pick}
      container={target}
      onClose={() => setTarget(null)}
      onDone={() => { setTarget(null); }}
    />
  );
  if (pick) return <ContainerPick booking={pick} onBack={() => setPick(null)} onPick={setTarget} />;
  return <BookingPick onPick={setPick} />;
}

// Three fixed steps of the yard flow — always visible so a worker mid-shift
// knows how far into a clamp they are, and that going "back" costs nothing.
const STEPS = ['Booking', 'Container', 'Clamp'] as const;

function StepBar({ step }: { step: 0 | 1 | 2 }) {
  return (
    <div className="flex items-center gap-1.5 px-4 pb-3">
      {STEPS.map((label, i) => (
        <div key={label} className="flex-1 flex items-center gap-1.5">
          <div className="flex flex-col items-center gap-1 flex-shrink-0">
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold font-mono transition-colors"
              style={i < step
                ? { background: '#33d6a8', color: '#062018' }
                : i === step
                  ? { background: '#ff7a00', color: '#170d00', boxShadow: '0 0 0 3px rgba(255,122,0,.2)' }
                  : { background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.35)' }}
            >
              {i < step ? <Check size={11} strokeWidth={3} /> : i + 1}
            </div>
            <span className="text-[9px] font-mono uppercase tracking-wide"
              style={{ color: i === step ? '#ff7a00' : 'rgba(255,255,255,.35)' }}>
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className="h-px flex-1 -mt-3.5" style={{ background: i < step ? '#33d6a8' : 'rgba(255,255,255,.08)' }} />
          )}
        </div>
      ))}
    </div>
  );
}

// `back` is either a route (leaving the flow, e.g. to /field) or a callback
// (stepping back within the flow, e.g. container-pick -> booking-pick) —
// same button, different meaning depending on which step is showing it.
function TopBar({ title, back, subtitle, step }: {
  title: string; back: string | (() => void); subtitle?: string; step: 0 | 1 | 2;
}) {
  const backButtonCls = 'w-9 h-9 rounded-lg bg-white/[.05] border border-white/10 text-text-1 flex items-center justify-center flex-shrink-0';
  return (
    <header className="sticky top-0 z-10 bg-ink-0/95 backdrop-blur border-b border-white/[.06]">
      <div className="px-4 py-3 flex items-center gap-3">
        {typeof back === 'string'
          ? <Link to={back} className={backButtonCls}><ArrowLeft size={16} /></Link>
          : <button onClick={back} className={`${backButtonCls} cursor-pointer`}><ArrowLeft size={16} /></button>}
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-text-0 leading-tight truncate">{title}</div>
          {subtitle && <div className="text-[11px] text-text-2 font-mono mt-0.5 truncate">{subtitle}</div>}
        </div>
      </div>
      <StepBar step={step} />
      {/* Lives in the shared bar so every step of the flow reports sync state,
          not just the first screen — a worker who queued a clamp two steps ago
          should still be able to see that it hasn't gone anywhere yet. */}
      <OfflineBanner />
    </header>
  );
}

function BookingPick({ onPick }: { onPick: (b: Row) => void }) {
  const { data, isLoading, error } = useYardQueue();
  const rows = (data?.data ?? []) as Row[];

  return (
    <div className="min-h-screen bg-ink-0 text-text-0">
      <TopBar title="Select booking" back="/field" subtitle="Bookings with containers pending clamp" step={0} />
      <div className="p-4 space-y-2.5">
        {isLoading && <Center><Loader2 className="animate-spin text-text-2" /></Center>}
        {error && <Empty text="Could not load bookings. Pull down or retry." />}
        {!isLoading && !error && rows.length === 0 && <Empty text="No bookings pending clamp right now." good />}
        {rows.map(b => {
          const pending = Number(b['pending_containers'] ?? 0);
          const total = Number(b['total_containers'] ?? 0);
          const done = total > 0 ? total - pending : 0;
          return (
            <button
              key={s(b['booking_id'])}
              onClick={() => onPick(b)}
              className="w-full text-left rounded-2xl border border-white/[.08] bg-white/[.03] px-4 py-3.5 active:scale-[.985] transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[13px] font-bold text-cds-orange">{s(b['booking_number'])}</span>
                    <span className="text-[11px] text-text-1 truncate">{s(b['customer_name'])}</span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-text-2">
                    <MapPin size={11} className="flex-shrink-0" />
                    <span className="truncate">{s(b['pickup_location'])}</span>
                    <ArrowRight size={10} className="flex-shrink-0 text-text-2/60" />
                    <span className="truncate">{s(b['delivery_location'])}</span>
                  </div>
                </div>
                <ChevronRight size={18} className="text-text-2 flex-shrink-0" />
              </div>
              <div className="flex items-center gap-2 mt-3">
                <div className="flex-1 h-1.5 rounded-full bg-white/[.06] overflow-hidden">
                  <div className="h-full rounded-full bg-cds-orange transition-all" style={{ width: total > 0 ? `${(done / total) * 100}%` : '0%' }} />
                </div>
                <span className="text-[10px] font-mono text-text-2 flex items-center gap-1 flex-shrink-0">
                  <Package size={10} /> {pending} pending · {total} total
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ContainerPick({ booking, onBack, onPick }: { booking: Row; onBack: () => void; onPick: (c: Row) => void }) {
  const bookingId = s(booking['booking_id']);
  const { data, isLoading } = useBookingContainers(bookingId, { offline: true });
  const rows = (data?.data ?? []) as Row[];
  const pending = rows.filter(c => s(c['status']) === 'pending');

  return (
    <div className="min-h-screen bg-ink-0 text-text-0">
      <TopBar title={s(booking['booking_number'])} back={onBack} subtitle={s(booking['customer_name'])} step={1} />

      <div className="p-4 space-y-2.5">
        {isLoading && <Center><Loader2 className="animate-spin text-text-2" /></Center>}
        {!isLoading && pending.length === 0 && (
          <Empty text="All containers on this booking are already clamped." good />
        )}
        {pending.map(c => (
          <button
            key={s(c['id'])}
            onClick={() => onPick(c)}
            className="w-full text-left rounded-2xl border border-cds-orange/25 bg-cds-orange/[.05] px-4 py-3.5 active:scale-[.985] transition-all flex items-center gap-3"
          >
            <div className="w-11 h-11 rounded-xl bg-cds-orange/15 border border-cds-orange/30 flex items-center justify-center flex-shrink-0">
              <Package size={18} className="text-cds-orange" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[14px] font-bold text-cds-orange">
                  {s(c['container_number']) || 'No number'}
                </span>
                <span className="text-[9px] font-mono font-bold text-text-1 bg-white/[.08] px-1.5 py-0.5 rounded uppercase">
                  {s(c['iso_type'])}
                </span>
              </div>
              <div className="text-[11px] text-text-2 mt-1">
                {s(c['seal_number']) && <>Seal {s(c['seal_number'])} · </>}
                {c['weight_kg'] != null && <>{s(c['weight_kg'])} kg</>}
              </div>
            </div>
            <ChevronRight size={18} className="text-cds-orange flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

function ClampForm({ booking, container, onClose, onDone }: {
  booking: Row; container: Row; onClose: () => void; onDone: () => void;
}) {
  const clamp = useClampBookingContainer();
  const offline = !useOfflineQueue().online;
  const [lockSerial, setLockSerial] = useState('');
  const [transporter, setTransporter] = useState('');
  const [truckReg, setTruckReg] = useState('');
  const [trailerReg, setTrailerReg] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<null | 'submitted' | 'queued'>(null);
  // Issued exactly once by the server; there is no way to fetch it again.
  const [tracking, setTracking] = useState<IssuedTracking | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!lockSerial.trim() || !truckReg.trim() || !driverName.trim()) {
      setError('E-lock serial, truck reg and driver name are required.');
      return;
    }
    const bookingId = s(booking['booking_id']);
    const containerId = s(container['id']);
    const label = s(container['container_number']) || 'Container';

    const doSubmit = (lat?: number, lng?: number) => {
      const payload = {
        lock_serial: lockSerial.trim(),
        transporter_name: transporter.trim() || null,
        truck_reg: truckReg.trim(),
        trailer_reg: trailerReg.trim() || null,
        driver_name: driverName.trim(),
        driver_phone: driverPhone.trim() || null,
        notes: notes.trim() || null,
        lat, lng,
      };

      const queueIt = () => {
        enqueue({ kind: 'clamp', bookingId, containerId, label, payload });
        setSuccess('queued');
      };

      // Known-offline: don't bother firing a request that can only fail, and
      // don't make the worker wait out a timeout to find that out.
      if (!isOnline()) { queueIt(); return; }

      clamp.mutate({ bookingId, cid: containerId, ...payload }, {
        onSuccess: (res: unknown) => {
          const issued = (res as { data?: { tracking?: IssuedTracking | null } })?.data?.tracking ?? null;
          setTracking(issued);
          setSuccess('submitted');
          // No auto-dismiss. The driver's code is shown once and cannot be
          // re-opened, so the worker closes this screen deliberately — a 1.1s
          // timer used to destroy it before anyone could scan.
        },
        onError: (err: unknown) => {
          const ax = err as { response?: { data?: { error?: string } } };
          // No response at all means the request never landed (dead zone,
          // timeout) — that's queueable. A real HTTP error is a genuine
          // rejection and must be shown, not silently retried forever.
          if (!ax.response) { queueIt(); return; }
          setError(ax.response.data?.error || 'Could not submit clamp.');
        },
      });
    };
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        p => doSubmit(p.coords.latitude, p.coords.longitude),
        () => doSubmit(),
        { timeout: 4000, maximumAge: 30000 }
      );
    } else doSubmit();
  };

  if (success) return (
    <ClampResult
      mode={success}
      label={s(container['container_number']) || 'Container'}
      tracking={tracking}
      onDone={onDone}
    />
  );

  return (
    <div className="min-h-screen bg-ink-0 text-text-0">
      <header className="sticky top-0 z-10 bg-ink-0/95 backdrop-blur border-b border-white/[.06]">
        <div className="px-4 py-3 flex items-center gap-3">
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg bg-white/[.05] border border-white/10 text-text-1 flex items-center justify-center cursor-pointer"
          >
            <X size={16} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold text-text-0 truncate">Clamp e-lock</div>
            <div className="text-[10px] font-mono text-text-2 truncate">
              {s(booking['booking_number'])} · {s(container['container_number']) || '(no number)'}
            </div>
          </div>
        </div>
        <StepBar step={2} />
      </header>

      <form onSubmit={submit} className="p-4 space-y-4 pb-32">
        <FieldSection label="Lock &amp; vehicle">
          <IconField icon={<Lock size={14} />} label="E-Lock serial *" value={lockSerial} onChange={setLockSerial}
            placeholder="e.g. SL-000123" autoCapitalize="characters" autoFocus />
          <IconField icon={<Building2 size={14} />} label="Transporter" value={transporter} onChange={setTransporter}
            placeholder="Company name" />
          <div className="grid grid-cols-2 gap-2.5">
            <IconField icon={<Truck size={14} />} label="Truck (horse) reg *" value={truckReg} onChange={setTruckReg}
              placeholder="KAA 123A" autoCapitalize="characters" />
            <IconField icon={<Truck size={14} />} label="Trailer reg" value={trailerReg} onChange={setTrailerReg}
              placeholder="KAA 456B" autoCapitalize="characters" />
          </div>
        </FieldSection>

        <FieldSection label="Driver">
          <IconField icon={<UserRound size={14} />} label="Driver name *" value={driverName} onChange={setDriverName}
            placeholder="Full name" />
          <IconField icon={<Phone size={14} />} label="Driver phone" value={driverPhone} onChange={setDriverPhone}
            placeholder="+254…" inputMode="tel" />
        </FieldSection>

        <FieldSection label="Notes">
          <div className="relative">
            <StickyNote size={14} className="absolute left-3 top-3 text-text-2 pointer-events-none" />
            <textarea
              value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full min-h-[68px] pl-9 pr-3 py-2.5 rounded-lg bg-white/[.04] border border-white/[.08] text-text-0 text-[14px] outline-none focus:border-cds-orange/50 transition-colors"
              placeholder="Optional — condition, discrepancies, anything unusual"
            />
          </div>
        </FieldSection>

        {error && (
          <p className="text-[12px] text-cds-red font-mono bg-cds-red/10 border border-cds-red/25 rounded-lg px-3 py-2">{error}</p>
        )}
      </form>

      <div className="fixed left-0 right-0 bottom-0 bg-ink-0 border-t border-white/[.06] p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <button
          onClick={submit as unknown as (e: React.MouseEvent<HTMLButtonElement>) => void}
          disabled={clamp.isPending}
          className="w-full h-14 rounded-xl text-[14px] font-bold border-none disabled:opacity-50 transition-all active:brightness-110 flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg, #ff7a00, #F0B429)', color: '#0c0e12' }}
        >
          {clamp.isPending
            ? <Loader2 size={16} className="animate-spin" />
            : offline ? <CloudOff size={16} strokeWidth={2.5} /> : <Check size={16} strokeWidth={2.5} />}
          {/* Say up front where this is going. Finding out only afterwards
              that it was saved rather than sent is a nasty surprise on a
              custody record. */}
          {clamp.isPending ? 'Submitting…' : offline ? 'Save on device' : 'Confirm clamp'}
        </button>
      </div>
    </div>
  );
}

function FieldSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold font-mono uppercase tracking-widest text-cds-orange/80 mb-2">{label}</div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function IconField({ icon, label, value, onChange, ...rest }: {
  icon: React.ReactNode; label: string; value: string; onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-text-2 mb-1">{label}</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-2 pointer-events-none">{icon}</span>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full h-11 pl-9 pr-3 rounded-lg bg-white/[.04] border border-white/[.08] text-text-0 text-[15px] outline-none focus:border-cds-orange/50 transition-colors"
          {...rest}
        />
      </div>
    </div>
  );
}

function Empty({ text, good }: { text: string; good?: boolean }) {
  return (
    <div className="py-16 flex flex-col items-center gap-2.5 text-center">
      {good && (
        <div className="w-11 h-11 rounded-full bg-cds-teal/15 border border-cds-teal/30 flex items-center justify-center">
          <Check size={18} className="text-cds-teal" strokeWidth={2.5} />
        </div>
      )}
      <p className="text-[12px] font-mono text-text-2 max-w-[240px]">{text}</p>
    </div>
  );
}
function Center({ children }: { children: React.ReactNode }) {
  return <div className="py-16 flex justify-center">{children}</div>;
}
