import { useState, useRef } from 'react';
import { ChevronDown, ChevronUp, Plus, Upload, Loader2, X, Package } from 'lucide-react';
import { StatusBadge, FilterChip } from './components.js';
import {
  useBookings, useCreateBooking, useCustomers,
  useExtractBooking, useBookingContainers,
} from './hooks.js';
import { LoadingState } from './CDSDashboard.js';

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? '—');

const LIFECYCLE = [
  { label: 'Pending',   color: '#64748b' },
  { label: 'Assigned',  color: '#ff7a00' },
  { label: 'Clamped',   color: '#33d6a8' },
  { label: 'Dispatched',color: '#37e6ff' },
  { label: 'In Transit',color: '#37e6ff' },
  { label: 'At Port',   color: '#ffb020' },
  { label: 'Awaiting',  color: '#ffb020' },
  { label: 'Unclamped', color: '#a78bfa' },
  { label: 'Delivered', color: '#33d6a8' },
  { label: 'Completed', color: '#22c55e' },
];

const STATUS_STAGE: Record<string, number> = {
  pending: 0, assigned: 1, in_transit: 4, at_port: 5, delivered: 8, completed: 9,
};

const BOOKING_FIELDS: { key: string; label: string; type?: string; required?: boolean; placeholder?: string }[] = [
  { key: 'reference', label: 'Reference', required: true, placeholder: 'e.g. PO-2026-001' },
  { key: 'pickup_location', label: 'Pickup Location', required: true, placeholder: 'e.g. Mombasa Port' },
  { key: 'delivery_location', label: 'Delivery Location', required: true, placeholder: 'e.g. Nairobi ICD' },
  { key: 'commodity', label: 'Commodity', required: true, placeholder: 'e.g. Tea, Electronics' },
  { key: 'shipping_line', label: 'Shipping Line', placeholder: 'e.g. Maersk, MSC' },
  { key: 'vessel', label: 'Vessel', placeholder: 'Vessel name' },
  { key: 'voyage', label: 'Voyage', placeholder: 'Voyage number' },
  { key: 'eta', label: 'ETA', type: 'date' },
  { key: 'notes', label: 'Notes', placeholder: 'Additional notes…' },
];

const ISO_TYPES = ['20GP', '40GP', '40HC', '45HC', '20RF', '40RF', '20OT', '40OT'];
type CRow = { container_number: string; iso_type: string; seal_number: string; weight_kg: string };

function LifecycleBar({ stage }: { stage: number }) {
  return (
    <div className="flex items-center gap-0 mt-2">
      {LIFECYCLE.map((lc, i) => {
        const done = i < stage;
        const active = i === stage;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-0.5" title={lc.label}>
            <div className="w-full h-[3px] rounded-full" style={{
              background: done || active ? lc.color : 'rgba(255,255,255,.07)',
              opacity: active ? 1 : done ? 0.7 : 1,
            }} />
            {active && (
              <div className="w-1.5 h-1.5 rounded-full -mt-[5px]" style={{ background: lc.color, boxShadow: `0 0 6px ${lc.color}` }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function BookingContainers({ bookingId }: { bookingId: string }) {
  const { data, isLoading } = useBookingContainers(bookingId);
  const containers = (data?.data ?? []) as Row[];

  if (isLoading) return (
    <div className="flex items-center gap-2 py-3 text-[11px] text-white/40 font-mono">
      <Loader2 size={12} className="animate-spin" /> Loading containers…
    </div>
  );
  if (!containers.length) return (
    <div className="py-3 text-[11px] text-white/30 font-mono italic">No containers assigned yet.</div>
  );

  return (
    <div className="space-y-2 mt-2">
      {containers.map((c, i) => {
        const stage = STATUS_STAGE[s(c['status'])] ?? 0;
        const lc = LIFECYCLE[stage]!;
        return (
          <div key={s(c['id'] ?? i)} className="rounded-lg border border-white/[.06] bg-white/[.02] px-3 py-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono font-bold text-[12px] text-cds-orange">{s(c['container_number']) || '—'}</span>
              <span className="text-[10px] font-mono text-white/50 bg-white/[.05] px-1.5 py-0.5 rounded">{s(c['iso_type'])}</span>
              {s(c['seal_number']) !== '—' && <span className="text-[10px] text-white/40">SL: {s(c['seal_number'])}</span>}
              {c['weight_kg'] != null && <span className="text-[10px] text-white/40">{s(c['weight_kg'])} kg</span>}
              <span className="ml-auto text-[9px] font-mono tracking-wider px-1.5 py-0.5 rounded"
                style={{ background: lc.color + '20', color: lc.color }}>
                {lc.label.toUpperCase()}
              </span>
            </div>
            <LifecycleBar stage={stage} />
            <div className="flex justify-between mt-1">
              <span className="text-[8px] font-mono text-white/20">PENDING</span>
              <span className="text-[8px] font-mono text-white/20">COMPLETED</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function BookingCard({ booking }: { booking: Row }) {
  const [open, setOpen] = useState(false);
  const cnt = Number(booking['container_count'] ?? 0);
  const delivered = Number(booking['delivered_count'] ?? 0);
  const progress = cnt > 0 ? Math.round((delivered / cnt) * 100) : 0;
  const eta = booking['eta'] ? new Date(s(booking['eta'])).toLocaleDateString([], { month: 'short', day: 'numeric' }) : null;

  return (
    <div className="rounded-xl border border-white/[.07] bg-white/[.02] overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[.03] transition-colors cursor-pointer border-none bg-transparent"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-[13px] text-cds-orange">{s(booking['booking_number'])}</span>
            <span className="text-[11px] text-white/60 truncate">{s(booking['customer_name'])}</span>
            {cnt > 0 && (
              <span className="ml-1 flex items-center gap-1 text-[10px] font-mono text-white/40">
                <Package size={10} />
                {delivered}/{cnt}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[10px] text-white/40 font-mono truncate">{s(booking['reference'])}</span>
            {booking['commodity'] != null && <span className="text-[10px] text-white/30 truncate">{s(booking['commodity'])}</span>}
          </div>
          {cnt > 0 && (
            <div className="mt-1.5 h-1 rounded-full bg-white/[.06] overflow-hidden" style={{ maxWidth: 160 }}>
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#ff7a00,#33d6a8)' }} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <StatusBadge status={s(booking['status'])} />
          {eta && <span className="text-[10px] text-white/35 font-mono hidden sm:block">{eta}</span>}
          {open ? <ChevronUp size={15} className="text-white/30" /> : <ChevronDown size={15} className="text-white/30" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-white/[.05]">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 mt-3 mb-3">
            {([
              ['Pickup', booking['pickup_location']],
              ['Delivery', booking['delivery_location']],
              ['Shipping Line', booking['shipping_line']],
              ['Vessel', booking['vessel']],
              ['Voyage', booking['voyage']],
              ['ETA', booking['eta'] ? new Date(s(booking['eta'])).toLocaleDateString() : null],
            ] as [string, unknown][]).map(([label, val]) => val != null ? (
              <div key={label}>
                <div className="text-[9px] font-mono text-white/25 uppercase tracking-wider">{label}</div>
                <div className="text-[11px] text-white/75 mt-0.5">{String(val)}</div>
              </div>
            ) : null)}
          </div>
          <div className="text-[10px] font-semibold text-white/40 uppercase tracking-wider mb-1">
            Containers {cnt > 0 ? `(${cnt})` : ''}
          </div>
          <BookingContainers bookingId={s(booking['id'])} />
        </div>
      )}
    </div>
  );
}

export function BookingsView() {
  const { data, isLoading } = useBookings();
  const { data: customers } = useCustomers();
  const createBooking = useCreateBooking();
  const extractBooking = useExtractBooking();
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<Record<string, string>>({});
  const [customerId, setCustomerId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [containers, setContainers] = useState<CRow[]>([]);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  if (isLoading) return <LoadingState />;
  const all = (data?.data ?? []) as Row[];
  const customerList = (customers?.data ?? []) as Row[];
  const statuses = ['all', 'pending', 'active', 'completed', 'cancelled'];

  const rows = all.filter(r => {
    if (filter !== 'all' && r['status'] !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return [r['booking_number'], r['reference'], r['customer_name'], r['commodity']]
        .some(v => String(v ?? '').toLowerCase().includes(q));
    }
    return true;
  });

  const updateCtr = (i: number, p: Partial<CRow>) => setContainers(prev => prev.map((r, idx) => idx === i ? { ...r, ...p } : r));
  const removeCtr = (i: number) => setContainers(prev => prev.filter((_, idx) => idx !== i));
  const addCtr = () => setContainers(prev => [...prev, { container_number: '', iso_type: '20GP', seal_number: '', weight_kg: '' }]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    setError(''); setWarning('');
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = ((reader.result as string).split(',')[1]) ?? '';
      extractBooking.mutate({ data: b64, mediaType: file.type || 'image/jpeg' }, {
        onSuccess: ({ data: ex, containers: exC, partial, extracted_count, total_fields }) => {
          const up: Record<string, string> = {};
          for (const [k, v] of Object.entries(ex)) { if (v != null) up[k] = String(v); }
          setForm(p => ({ ...p, ...up }));
          if (Array.isArray(exC) && exC.length > 0) {
            setContainers(exC.map((c: Record<string, unknown>) => ({
              container_number: String(c['container_number'] ?? ''),
              iso_type: String(c['iso_type'] ?? '20GP'),
              seal_number: String(c['seal_number'] ?? ''),
              weight_kg: c['weight_kg'] != null ? String(c['weight_kg']) : '',
            })));
          }
          if (partial) setWarning(`Partially readable — ${extracted_count}/${total_fields} fields extracted. Verify and complete missing fields.`);
        },
        onError: (e: unknown) => {
          const ax = e as { response?: { status?: number; data?: { error?: string; message?: string } }; message?: string };
          const r = ax.response;
          if (r?.data?.error === 'extraction_not_configured') {
            setError('Document reading is not set up on the server — no AI provider key is configured. Fill in manually for now.');
          } else if (r?.data?.message) {
            setError(`Could not read the document — ${r.data.message}`);
          } else if (r?.data?.error) {
            setError(`Could not read the document — ${r.data.error} (${r.status}). Fill in manually.`);
          } else {
            setError(`Could not extract from document — ${ax.message || 'unknown error'}. Fill in manually.`);
          }
        },
      });
    };
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault(); setError(''); setWarning('');
    if (!customerId && !customerName.trim()) { setError('Please select or enter a customer'); return; }
    const payload: Record<string, unknown> = customerId
      ? { customer_id: customerId }
      : { customer_name: customerName.trim() };
    for (const f of BOOKING_FIELDS) { const v = form[f.key]; if (v) payload[f.key] = v; }
    if (containers.length > 0) {
      payload['containers'] = containers.map(c => ({
        container_number: c.container_number || null, iso_type: c.iso_type || '20GP',
        seal_number: c.seal_number || null, weight_kg: c.weight_kg ? Number(c.weight_kg) : null,
      }));
    }
    createBooking.mutate(payload, {
      onSuccess: () => { setShowForm(false); setForm({}); setCustomerId(''); setCustomerName(''); setContainers([]); },
      onError: (err: unknown) => {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setError(msg ?? 'Failed to create booking.');
      },
    });
  };

  const reset = () => { setShowForm(false); setForm({}); setCustomerId(''); setCustomerName(''); setContainers([]); setError(''); setWarning(''); };

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-base font-bold text-text-0">Bookings</h2>
          <p className="text-[11px] text-text-2 font-mono mt-0.5">{rows.length} of {all.length} bookings</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search bookings…"
            className="h-8 px-3 rounded-lg bg-white/[.04] border border-white/[.08] text-white text-[12px] outline-none focus:border-[#F0B429]/40 placeholder:text-white/25 transition-colors"
            style={{ width: 200 }}
          />
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3.5 h-9 rounded-lg text-[12px] font-semibold border-none cursor-pointer transition-all hover:brightness-110"
            style={{ background: 'linear-gradient(135deg, #ff7a00, #F0B429)', color: '#0c0e12' }}
          >
            <Plus size={15} strokeWidth={2.5} /> New Booking
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {statuses.map(st => (
          <FilterChip key={st} label={st === 'all' ? 'All' : st.charAt(0).toUpperCase() + st.slice(1)} active={filter === st} onClick={() => setFilter(st)} />
        ))}
      </div>

      <div className="space-y-2">
        {rows.map(r => <BookingCard key={s(r['id'])} booking={r} />)}
        {rows.length === 0 && (
          <div className="text-center py-16 text-text-2 font-mono text-sm">No bookings found</div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) reset(); }}>
          <form onSubmit={handleSubmit} className="w-full max-w-lg mx-4 rounded-2xl border border-white/[.08] bg-[#12141a] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[.06]">
              <div>
                <h3 className="text-[15px] font-bold text-white">New Booking</h3>
                <p className="text-[10px] text-white/40 font-mono mt-0.5">Fill in details or upload a shipping document</p>
              </div>
              <div className="flex items-center gap-2">
                <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleFile} />
                <button type="button" onClick={() => fileRef.current?.click()} disabled={extractBooking.isPending}
                  className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[11px] font-semibold border border-white/[.12] bg-white/[.04] text-white/60 hover:text-white/90 cursor-pointer disabled:opacity-50 transition-colors">
                  {extractBooking.isPending ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {extractBooking.isPending ? 'Extracting…' : 'Upload Doc'}
                </button>
                <button type="button" onClick={reset} className="w-8 h-8 rounded-lg bg-white/[.04] border border-white/[.06] text-white/40 hover:text-white/70 flex items-center justify-center cursor-pointer transition-colors">
                  <X size={15} />
                </button>
              </div>
            </div>
            <div className="px-5 py-4 max-h-[60vh] overflow-y-auto space-y-3">
              <div>
                <label className="block text-[11px] font-medium text-white/50 mb-1">Customer<span className="text-cds-orange ml-0.5">*</span></label>
                {customerList.length > 0 ? (
                  <div className="space-y-1.5">
                    <select value={customerId} onChange={e => { setCustomerId(e.target.value); if (e.target.value) setCustomerName(''); }}
                      className="w-full h-9 px-3 rounded-lg bg-white/[.04] border border-white/[.08] text-white text-[13px] outline-none focus:border-[#F0B429]/50 transition-colors cursor-pointer">
                      <option value="">Select customer…</option>
                      {customerList.map(c => <option key={s(c['id'])} value={s(c['id'])}>{s(c['company_name'])}</option>)}
                    </select>
                    {!customerId && (
                      <input type="text" placeholder="…or type a new customer name" value={customerName}
                        onChange={e => setCustomerName(e.target.value)}
                        className="w-full h-9 px-3 rounded-lg bg-white/[.04] border border-white/[.08] text-white text-[13px] outline-none focus:border-[#F0B429]/50 transition-colors placeholder:text-white/20" />
                    )}
                  </div>
                ) : (
                  <input type="text" required placeholder="Customer / company name" value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    className="w-full h-9 px-3 rounded-lg bg-white/[.04] border border-white/[.08] text-white text-[13px] outline-none focus:border-[#F0B429]/50 transition-colors placeholder:text-white/20" />
                )}
              </div>
              {BOOKING_FIELDS.map(f => (
                <div key={f.key}>
                  <label className="block text-[11px] font-medium text-white/50 mb-1">
                    {f.label}{f.required && <span className="text-cds-orange ml-0.5">*</span>}
                  </label>
                  <input type={f.type ?? 'text'} required={f.required} placeholder={f.placeholder}
                    value={form[f.key] ?? ''} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                    className="w-full h-9 px-3 rounded-lg bg-white/[.04] border border-white/[.08] text-white text-[13px] outline-none focus:border-[#F0B429]/50 transition-colors placeholder:text-white/20" />
                </div>
              ))}
              <div className="pt-1">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">
                    Containers{containers.length > 0 && <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: '#ff7a0022', color: '#ff7a00' }}>{containers.length}</span>}
                  </label>
                  <button type="button" onClick={addCtr} className="flex items-center gap-1 px-2.5 h-6 rounded text-[10px] font-semibold bg-white/[.04] border border-white/[.08] text-white/50 hover:text-white/80 cursor-pointer transition-colors">
                    <Plus size={10} strokeWidth={2.5} /> Add
                  </button>
                </div>
                {containers.length === 0
                  ? <p className="text-[10px] text-white/25 font-mono italic">No containers — add manually or upload a document.</p>
                  : (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-[1fr_72px_72px_60px_20px] gap-1 mb-0.5">
                        {['Container #', 'Type', 'Seal #', 'kg', ''].map(h => <span key={h} className="text-[9px] font-medium text-white/30 uppercase tracking-wider">{h}</span>)}
                      </div>
                      {containers.map((c, i) => (
                        <div key={i} className="grid grid-cols-[1fr_72px_72px_60px_20px] gap-1 items-center">
                          <input type="text" placeholder="MSCU1234560" value={c.container_number} onChange={e => updateCtr(i, { container_number: e.target.value })} className="h-7 px-2 rounded bg-white/[.04] border border-white/[.07] text-white text-[11px] font-mono outline-none focus:border-[#F0B429]/40 placeholder:text-white/15 transition-colors" />
                          <select value={c.iso_type} onChange={e => updateCtr(i, { iso_type: e.target.value })} className="h-7 px-1 rounded bg-white/[.04] border border-white/[.07] text-white text-[10px] outline-none cursor-pointer transition-colors">
                            {ISO_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                          </select>
                          <input type="text" placeholder="Seal #" value={c.seal_number} onChange={e => updateCtr(i, { seal_number: e.target.value })} className="h-7 px-2 rounded bg-white/[.04] border border-white/[.07] text-white text-[11px] font-mono outline-none focus:border-[#F0B429]/40 placeholder:text-white/15 transition-colors" />
                          <input type="number" placeholder="0" value={c.weight_kg} onChange={e => updateCtr(i, { weight_kg: e.target.value })} className="h-7 px-2 rounded bg-white/[.04] border border-white/[.07] text-white text-[11px] outline-none focus:border-[#F0B429]/40 placeholder:text-white/15 transition-colors" />
                          <button type="button" onClick={() => removeCtr(i)} className="w-5 h-5 flex items-center justify-center rounded text-white/25 hover:text-red-400 hover:bg-red-400/10 cursor-pointer transition-colors"><X size={11} /></button>
                        </div>
                      ))}
                    </div>
                  )}
              </div>
            </div>
            <div className="px-5 py-4 border-t border-white/[.06] space-y-2">
              {warning && <p className="text-[11px] font-mono px-1" style={{ color: '#ffb020' }}>{warning}</p>}
              {error && <p className="text-[11px] text-red-400 font-mono px-1">{error}</p>}
              <div className="flex items-center justify-end gap-2">
                <button type="button" onClick={reset} className="px-4 h-9 rounded-lg text-[12px] font-medium text-white/50 bg-white/[.04] border border-white/[.06] cursor-pointer hover:text-white/70 transition-colors">Cancel</button>
                <button type="submit" disabled={createBooking.isPending}
                  className="px-5 h-9 rounded-lg text-[12px] font-semibold border-none cursor-pointer transition-all hover:brightness-110 disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #ff7a00, #F0B429)', color: '#0c0e12' }}>
                  {createBooking.isPending ? 'Creating…' : 'Create Booking'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
