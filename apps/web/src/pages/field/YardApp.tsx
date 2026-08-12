import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, ChevronRight, Package, Loader2, Check, X } from 'lucide-react';
import { useYardQueue, useBookingContainers, useClampBookingContainer } from '../cds/hooks.js';

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

function TopBar({ title, back, subtitle }: { title: string; back: string; subtitle?: string }) {
  return (
    <header className="sticky top-0 z-10 bg-[#0B111C]/95 backdrop-blur border-b border-white/[.06] px-4 py-3 flex items-center gap-3">
      <Link
        to={back}
        className="w-9 h-9 rounded-lg bg-white/[.05] border border-white/10 text-white/70 flex items-center justify-center"
      >
        <ArrowLeft size={16} />
      </Link>
      <div className="flex-1 min-w-0">
        <div className="text-[15px] font-bold text-white leading-tight truncate">{title}</div>
        {subtitle && <div className="text-[11px] text-white/40 font-mono mt-0.5 truncate">{subtitle}</div>}
      </div>
    </header>
  );
}

function BookingPick({ onPick }: { onPick: (b: Row) => void }) {
  const { data, isLoading, error } = useYardQueue();
  const rows = (data?.data ?? []) as Row[];

  return (
    <div className="min-h-screen bg-[#0B111C] text-white">
      <TopBar title="Select booking" back="/field" subtitle="Bookings with containers pending clamp" />
      <div className="p-4 space-y-2">
        {isLoading && <Center><Loader2 className="animate-spin text-white/40" /></Center>}
        {error && <Empty text="Could not load bookings. Pull down or retry." />}
        {!isLoading && !error && rows.length === 0 && <Empty text="No bookings pending clamp right now." />}
        {rows.map(b => (
          <button
            key={s(b['booking_id'])}
            onClick={() => onPick(b)}
            className="w-full text-left rounded-xl border border-white/[.08] bg-white/[.03] px-4 py-3 active:brightness-125 transition-all flex items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[13px] font-bold text-cds-orange">{s(b['booking_number'])}</span>
                <span className="text-[11px] text-white/60 truncate">{s(b['customer_name'])}</span>
              </div>
              <div className="text-[11px] text-white/50 mt-1 truncate">
                {s(b['pickup_location'])} → {s(b['delivery_location'])}
              </div>
              <div className="text-[10px] font-mono text-white/40 mt-1 flex items-center gap-2">
                <Package size={10} /> {s(b['pending_containers'])} pending · {s(b['total_containers'])} total
              </div>
            </div>
            <ChevronRight size={16} className="text-white/30" />
          </button>
        ))}
      </div>
    </div>
  );
}

function ContainerPick({ booking, onBack, onPick }: { booking: Row; onBack: () => void; onPick: (c: Row) => void }) {
  const bookingId = s(booking['booking_id']);
  const { data, isLoading } = useBookingContainers(bookingId);
  const rows = (data?.data ?? []) as Row[];
  const pending = rows.filter(c => s(c['status']) === 'pending');

  return (
    <div className="min-h-screen bg-[#0B111C] text-white">
      <header className="sticky top-0 z-10 bg-[#0B111C]/95 backdrop-blur border-b border-white/[.06] px-4 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-lg bg-white/[.05] border border-white/10 text-white/70 flex items-center justify-center"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-white truncate">{s(booking['booking_number'])}</div>
          <div className="text-[11px] text-white/40 font-mono truncate">{s(booking['customer_name'])}</div>
        </div>
      </header>

      <div className="p-4 space-y-2">
        {isLoading && <Center><Loader2 className="animate-spin text-white/40" /></Center>}
        {!isLoading && pending.length === 0 && (
          <Empty text="All containers on this booking are already clamped." />
        )}
        {pending.map(c => (
          <button
            key={s(c['id'])}
            onClick={() => onPick(c)}
            className="w-full text-left rounded-xl border border-cds-orange/30 bg-cds-orange/[.06] px-4 py-3 active:brightness-125 transition-all flex items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[14px] font-bold text-cds-orange">
                  {s(c['container_number']) || 'No number'}
                </span>
                <span className="text-[10px] font-mono text-white/60 bg-white/[.08] px-1.5 py-0.5 rounded">
                  {s(c['iso_type'])}
                </span>
              </div>
              <div className="text-[11px] text-white/50 mt-1">
                {s(c['seal_number']) && <>Seal {s(c['seal_number'])} · </>}
                {c['weight_kg'] != null && <>{s(c['weight_kg'])} kg</>}
              </div>
            </div>
            <ChevronRight size={16} className="text-cds-orange" />
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
  const [lockSerial, setLockSerial] = useState('');
  const [transporter, setTransporter] = useState('');
  const [truckReg, setTruckReg] = useState('');
  const [trailerReg, setTrailerReg] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!lockSerial.trim() || !truckReg.trim() || !driverName.trim()) {
      setError('E-lock serial, truck reg and driver name are required.');
      return;
    }
    const doSubmit = (lat?: number, lng?: number) => {
      clamp.mutate({
        bookingId: s(booking['booking_id']),
        cid: s(container['id']),
        lock_serial: lockSerial.trim(),
        transporter_name: transporter.trim() || null,
        truck_reg: truckReg.trim(),
        trailer_reg: trailerReg.trim() || null,
        driver_name: driverName.trim(),
        driver_phone: driverPhone.trim() || null,
        notes: notes.trim() || null,
        lat, lng,
      }, {
        onSuccess: () => {
          setSuccess(true);
          setTimeout(onDone, 900);
        },
        onError: (err: unknown) => {
          const m = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          setError(m || 'Could not submit clamp.');
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
    <div className="min-h-screen bg-[#0B111C] text-white flex flex-col items-center justify-center p-6">
      <div className="w-16 h-16 rounded-full bg-emerald-400/20 border border-emerald-400/40 flex items-center justify-center mb-4">
        <Check size={32} className="text-emerald-400" strokeWidth={2.5} />
      </div>
      <div className="text-lg font-bold">Clamped</div>
      <div className="text-[12px] text-white/50 font-mono mt-1">Trip created · CDS notified</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0B111C] text-white">
      <header className="sticky top-0 z-10 bg-[#0B111C]/95 backdrop-blur border-b border-white/[.06] px-4 py-3 flex items-center gap-3">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-lg bg-white/[.05] border border-white/10 text-white/70 flex items-center justify-center"
        >
          <X size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-white truncate">Clamp e-lock</div>
          <div className="text-[10px] font-mono text-white/40 truncate">
            {s(booking['booking_number'])} · {s(container['container_number']) || '(no number)'}
          </div>
        </div>
      </header>

      <form onSubmit={submit} className="p-4 space-y-3 pb-32">
        <Field label="E-Lock serial *" value={lockSerial} onChange={setLockSerial}
          placeholder="e.g. SL-000123" autoCapitalize="characters" autoFocus />
        <Field label="Transporter" value={transporter} onChange={setTransporter}
          placeholder="Company name" />
        <Field label="Truck (horse) reg *" value={truckReg} onChange={setTruckReg}
          placeholder="KAA 123A" autoCapitalize="characters" />
        <Field label="Trailer reg" value={trailerReg} onChange={setTrailerReg}
          placeholder="KAA 456B" autoCapitalize="characters" />
        <Field label="Driver name *" value={driverName} onChange={setDriverName}
          placeholder="Full name" />
        <Field label="Driver phone" value={driverPhone} onChange={setDriverPhone}
          placeholder="+254…" inputMode="tel" />
        <div>
          <label className="block text-[11px] font-medium text-white/50 mb-1">Notes</label>
          <textarea
            value={notes} onChange={e => setNotes(e.target.value)}
            className="w-full min-h-[68px] px-3 py-2 rounded-lg bg-white/[.04] border border-white/[.08] text-white text-[14px] outline-none focus:border-cds-orange/50"
            placeholder="Optional"
          />
        </div>
        {error && <p className="text-[12px] text-red-400 font-mono">{error}</p>}
      </form>

      <div className="fixed left-0 right-0 bottom-0 bg-[#0B111C] border-t border-white/[.06] p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <button
          onClick={submit as unknown as (e: React.MouseEvent<HTMLButtonElement>) => void}
          disabled={clamp.isPending}
          className="w-full h-12 rounded-xl text-[14px] font-bold border-none disabled:opacity-50 transition-all active:brightness-110 flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg, #ff7a00, #F0B429)', color: '#0c0e12' }}
        >
          {clamp.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} strokeWidth={2.5} />}
          {clamp.isPending ? 'Submitting…' : 'Confirm clamp'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, ...rest }: {
  label: string; value: string; onChange: (v: string) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  return (
    <div>
      <label className="block text-[11px] font-medium text-white/50 mb-1">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full h-11 px-3 rounded-lg bg-white/[.04] border border-white/[.08] text-white text-[15px] outline-none focus:border-cds-orange/50 transition-colors"
        {...rest}
      />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-16 text-center text-[12px] font-mono text-white/40">{text}</div>;
}
function Center({ children }: { children: React.ReactNode }) {
  return <div className="py-16 flex justify-center">{children}</div>;
}
