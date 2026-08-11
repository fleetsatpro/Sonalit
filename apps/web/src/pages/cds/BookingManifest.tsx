import { useState } from 'react';
import { Search, Check } from 'lucide-react';
import { useBookingManifest, useUpdateBookingContainer } from './hooks.js';
import { LoadingState } from './CDSDashboard.js';

// The yard's working sheet: one row per container, not per booking.
//
// This deliberately mirrors the spreadsheet ops already run on, column for
// column and in the same order — the point of the screen is that someone who
// knows the sheet can read it without being retrained. Hence the dense rows,
// the monospace refs, and "0056hrs" rather than a localised time.
//
// Nineteen columns will not fit any laptop, so the table scrolls horizontally
// inside its own container while the header stays put. The identifying columns
// (date, vessel, booking ref) are the ones you scroll away from last, so they
// come first, matching the sheet.

type Row = Record<string, unknown>;

const str = (v: unknown) => (v == null || v === '' ? '' : String(v));

// The sheet writes times as a bare 24h clock with an "hrs" suffix — 0056hrs,
// 0314hrs. Locale formatting would make these unrecognisable to the people
// reading them, so format explicitly.
function hrs(v: unknown): string {
  if (!v) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}hrs`;
}

function shortDate(v: unknown): string {
  if (!v) return '';
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

const YARD_STATES = ['yard', 'inbound', 'outbound', 'complete'] as const;

const YARD_COLOR: Record<string, string> = {
  yard:     '#94a3b8',
  inbound:  '#37e6ff',
  outbound: '#ff7a00',
  complete: '#33d6a8',
};

const COLS: { key: string; label: string; w: number; render?: (r: Row) => string }[] = [
  { key: 'clamped_at',      label: 'DATE CLAMPED',       w: 108, render: r => shortDate(r['clamped_at']) },
  { key: 'vessel',          label: 'VESSEL',             w: 168 },
  { key: 'booking_number',  label: 'AW BOOKING REF NO',  w: 168 },
  { key: 'controller',      label: 'CONTROLLER',         w: 104 },
  { key: 'file_reference',  label: 'AW FILE REF NO',     w: 118 },
  { key: 'container_number',label: 'CONTAINER NO',       w: 130 },
  { key: 'seal_number',     label: 'SHIPPING SEAL',      w: 128 },
  { key: 'invoiced',        label: 'INVOICED',           w: 84 },
  { key: 'commodity',       label: 'COMMODITY',          w: 100 },
  { key: 'clamped_at_t',    label: 'TIME CLAMPED',       w: 106, render: r => hrs(r['clamped_at']) },
  { key: 'unclamped_at',    label: 'TIME UNCLAMPED',     w: 116, render: r => hrs(r['unclamped_at']) },
  { key: 'lock_number',     label: 'LOCK NO',            w: 96 },
  { key: 'terminal',        label: 'TERMINAL',           w: 90 },
  { key: 'yard_status',     label: 'LOCATION',           w: 100 },
  { key: 'transporter',     label: 'TRANSPORTER',        w: 112 },
  { key: 'horse_reg',       label: 'HORSE REG',          w: 100 },
  { key: 'trailer_reg',     label: 'TRAILER REG',        w: 100 },
  { key: 'driver_name',     label: 'DRIVER NAME',        w: 112 },
  { key: 'driver_contact',  label: 'DRIVER CONTACT',     w: 118 },
];

// Refs and registrations are read character by character when someone is
// checking a container against a physical plate, so they get a mono face.
const MONO = new Set([
  'booking_number', 'file_reference', 'container_number', 'seal_number',
  'lock_number', 'horse_reg', 'trailer_reg', 'driver_contact', 'commodity',
]);

function YardPill({ value }: { value: string }) {
  const v = value || 'yard';
  const color = YARD_COLOR[v] ?? '#94a3b8';
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide"
      style={{ color, background: `${color}1f`, border: `1px solid ${color}3d` }}>
      {v}
    </span>
  );
}

export function BookingManifest({ bookingId }: { bookingId?: string }) {
  const [search, setSearch] = useState('');
  const [yard, setYard] = useState<string>('');
  const { data, isLoading } = useBookingManifest({
    ...(bookingId ? { booking_id: bookingId } : {}),
    ...(yard ? { yard_status: yard } : {}),
    ...(search ? { search } : {}),
    limit: 200,
  } as never);
  const update = useUpdateBookingContainer();

  if (isLoading) return <LoadingState />;

  const rows = (data?.data ?? []) as Row[];
  const total = data?.total ?? rows.length;

  // Invoiced is the one column ops flip constantly while reconciling, so it is
  // a click rather than a trip through an edit dialog.
  const toggleInvoiced = (r: Row) => {
    update.mutate({
      bookingId: String(r['booking_id']),
      containerId: String(r['id']),
      patch: { invoiced: !r['invoiced'] },
    });
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Container, seal, booking, vessel…"
            className="pl-7 pr-3 py-1.5 rounded-lg bg-white/[.04] border border-white/10 text-[12px] text-text-0 placeholder:text-text-2 outline-none focus:border-white/25"
            style={{ width: 260 }}
          />
        </div>
        <button
          onClick={() => setYard('')}
          className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer"
          style={yard === ''
            ? { color: '#fff', background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.22)' }
            : { color: '#94a3b8', background: 'transparent', border: '1px solid rgba(255,255,255,.1)' }}>
          All
        </button>
        {YARD_STATES.map(st => {
          const on = yard === st;
          const color = YARD_COLOR[st];
          return (
            <button key={st} onClick={() => setYard(on ? '' : st)}
              className="px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase transition-colors cursor-pointer"
              style={on
                ? { color, background: `${color}24`, border: `1px solid ${color}59` }
                : { color: '#94a3b8', background: 'transparent', border: '1px solid rgba(255,255,255,.1)' }}>
              {st}
            </button>
          );
        })}
        <span className="text-[11px] text-text-2 font-mono ml-auto">
          {rows.length} of {total} containers
        </span>
      </div>

      <div className="rounded-xl border border-white/10 overflow-x-auto" style={{ maxHeight: '70vh' }}>
        <table className="border-collapse" style={{ minWidth: COLS.reduce((a, c) => a + c.w, 0) }}>
          <thead className="sticky top-0 z-10">
            <tr>
              {COLS.map(c => (
                <th key={c.key}
                  className="text-left px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-text-2 whitespace-nowrap"
                  style={{ width: c.w, minWidth: c.w, background: '#12161d', borderBottom: '1px solid rgba(255,255,255,.14)' }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={String(r['id'] ?? i)} className="hover:bg-white/[.04] transition-colors"
                style={{ borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                {COLS.map(c => {
                  if (c.key === 'yard_status') {
                    return <td key={c.key} className="px-2 py-1.5"><YardPill value={str(r['yard_status'])} /></td>;
                  }
                  if (c.key === 'invoiced') {
                    const on = Boolean(r['invoiced']);
                    return (
                      <td key={c.key} className="px-2 py-1.5">
                        <button onClick={() => toggleInvoiced(r)} disabled={update.isPending}
                          title={on ? 'Invoiced — click to clear' : 'Not invoiced — click to mark'}
                          className="w-4 h-4 rounded flex items-center justify-center transition-colors cursor-pointer"
                          style={{
                            background: on ? 'rgba(51,214,168,.18)' : 'transparent',
                            border: `1px solid ${on ? 'rgba(51,214,168,.6)' : 'rgba(255,255,255,.18)'}`,
                          }}>
                          {on && <Check size={11} strokeWidth={3} color="#33d6a8" />}
                        </button>
                      </td>
                    );
                  }
                  const value = c.render ? c.render(r) : str(r[c.key]);
                  return (
                    <td key={c.key}
                      className={`px-2 py-1.5 text-[11.5px] whitespace-nowrap ${MONO.has(c.key) ? 'font-mono' : ''} ${value ? 'text-text-0' : 'text-text-2'}`}
                      title={value || undefined}>
                      {value || '·'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="py-14 text-center text-[12px] text-text-2">
            No containers match. Containers appear here once a booking has them.
          </div>
        )}
      </div>
    </div>
  );
}
