import { Link } from '@tanstack/react-router';
import { ArrowLeft, Map as MapIcon, List as ListIcon, Loader2, Check, X, Truck, MapPin } from 'lucide-react';
import { useMemo, useState } from 'react';
import Map, { Marker, NavigationControl } from 'react-map-gl/maplibre';

import 'maplibre-gl/dist/maplibre-gl.css';
import { usePortQueue, useUnclampBookingContainer } from '../cds/hooks.js';

type Row = Record<string, unknown>;
const s = (v: unknown) => v == null ? '' : String(v);
const n = (v: unknown) => (typeof v === 'number' ? v : v != null ? Number(v) : NaN);

// Free OpenStreetMap raster tiles — no API key required.
const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
} as const;

// Map marker fill needs a raw hex (SVG/canvas styling, not a Tailwind class),
// so it's spelled out once here rather than repeated — same value as the
// cds-cyan token in tailwind.config.ts.
const CDS_CYAN = '#37e6ff';

export default function PortApp() {
  const [tab, setTab] = useState<'list' | 'map'>('list');
  const [selected, setSelected] = useState<Row | null>(null);
  const { data, isLoading } = usePortQueue();
  const rows = (data?.data ?? []) as Row[];

  const withGps = useMemo(
    () => rows.filter(r => !Number.isNaN(n(r['last_lat'])) && !Number.isNaN(n(r['last_lng']))),
    [rows]
  );

  const initialView = useMemo(() => {
    if (withGps.length === 0) return { longitude: 39.28, latitude: -4.05, zoom: 8 }; // Mombasa fallback
    const lats = withGps.map(r => n(r['last_lat']));
    const lngs = withGps.map(r => n(r['last_lng']));
    return {
      longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
      latitude:  (Math.min(...lats) + Math.max(...lats)) / 2,
      zoom: 8,
    };
  }, [withGps]);

  if (selected) return (
    <UnclampForm
      row={selected}
      onClose={() => setSelected(null)}
      onDone={() => setSelected(null)}
    />
  );

  return (
    <div className="min-h-screen bg-ink-0 text-text-0 flex flex-col">
      <header className="sticky top-0 z-10 bg-ink-0/95 backdrop-blur border-b border-white/[.06] px-4 py-3 flex items-center gap-3">
        <Link
          to="/field"
          className="w-9 h-9 rounded-lg bg-white/[.05] border border-white/10 text-text-1 flex items-center justify-center"
        >
          <ArrowLeft size={16} />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-text-0 leading-tight">Port ops</div>
          <div className="text-[11px] text-text-2 font-mono">{rows.length} containers in transit</div>
        </div>
        <div className="flex gap-0 border border-white/10 rounded-lg overflow-hidden">
          <button
            onClick={() => setTab('list')}
            className={`px-3 h-9 text-[11px] font-mono border-none ${tab === 'list' ? 'bg-white/[.10] text-text-0' : 'bg-transparent text-text-2'}`}
          >
            <ListIcon size={13} />
          </button>
          <button
            onClick={() => setTab('map')}
            className={`px-3 h-9 text-[11px] font-mono border-none ${tab === 'map' ? 'bg-white/[.10] text-text-0' : 'bg-transparent text-text-2'}`}
          >
            <MapIcon size={13} />
          </button>
        </div>
      </header>

      {tab === 'list' ? (
        <div className="flex-1 p-4 space-y-2">
          {isLoading && <Center><Loader2 className="animate-spin text-text-2" /></Center>}
          {!isLoading && rows.length === 0 && <Empty text="No containers in transit right now." />}
          {rows.map(r => <ContainerRow key={s(r['id'])} row={r} onOpen={() => setSelected(r)} />)}
        </div>
      ) : (
        <div className="flex-1 relative">
          <Map
            initialViewState={initialView}
            style={{ width: '100%', height: '100%', minHeight: 400 }}
            mapStyle={OSM_STYLE as unknown as maplibregl.StyleSpecification}
          >
            <NavigationControl position="top-right" showCompass={false} />
            {withGps.map(r => (
              <Marker
                key={s(r['id'])}
                longitude={n(r['last_lng'])}
                latitude={n(r['last_lat'])}
                anchor="bottom"
                onClick={e => { e.originalEvent.stopPropagation(); setSelected(r); }}
              >
                <div
                  className="w-9 h-9 -mb-2 rounded-full flex items-center justify-center cursor-pointer border-2"
                  style={{ background: CDS_CYAN, borderColor: '#08090b', boxShadow: '0 4px 12px rgba(55,230,255,.5)' }}
                >
                  <Truck size={16} color="#08090b" strokeWidth={2.5} />
                </div>
              </Marker>
            ))}
          </Map>
          {withGps.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="bg-black/70 backdrop-blur px-4 py-2 rounded-lg text-[12px] font-mono text-text-1">
                No live GPS fixes yet
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContainerRow({ row, onOpen }: { row: Row; onOpen: () => void }) {
  const seen = row['last_seen'] ? new Date(s(row['last_seen'])).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-xl border border-cds-cyan/25 bg-cds-cyan/[.05] px-4 py-3 active:brightness-125 transition-all"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-[14px] font-bold text-cds-cyan">
          {s(row['container_number']) || 'No number'}
        </span>
        <span className="text-[10px] font-mono text-text-1 bg-white/[.08] px-1.5 py-0.5 rounded">
          {s(row['iso_type'])}
        </span>
        <span className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded bg-cds-cyan/20 text-cds-cyan uppercase tracking-wider">
          {s(row['status']).replace('_', ' ')}
        </span>
      </div>
      <div className="text-[11px] text-text-1 mt-1 truncate">{s(row['booking_number'])} · {s(row['customer_name'])}</div>
      <div className="text-[10px] font-mono text-text-2 mt-1 flex items-center gap-3">
        {s(row['vehicle_reg']) && <span><Truck size={9} className="inline mr-0.5" />{s(row['vehicle_reg'])}</span>}
        {s(row['driver_name']) && <span>· {s(row['driver_name'])}</span>}
        {seen && <span className="ml-auto"><MapPin size={9} className="inline mr-0.5" />{seen}</span>}
      </div>
    </button>
  );
}

function UnclampForm({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const unclamp = useUnclampBookingContainer();
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const submit = () => {
    setError('');
    const bookingId = s(row['booking_id']);
    const doSubmit = (lat?: number, lng?: number) => {
      unclamp.mutate({
        bookingId,
        cid: s(row['id']),
        notes: notes.trim() || null,
        lat, lng,
      }, {
        onSuccess: () => { setSuccess(true); setTimeout(onDone, 900); },
        onError: (err: unknown) => {
          const m = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
          setError(m || 'Could not submit unclamp.');
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
    <div className="min-h-screen bg-ink-0 text-text-0 flex flex-col items-center justify-center p-6">
      <div className="w-16 h-16 rounded-full bg-cds-teal/20 border border-cds-teal/40 flex items-center justify-center mb-4">
        <Check size={32} className="text-cds-teal" strokeWidth={2.5} />
      </div>
      <div className="text-lg font-bold">Unclamped · Delivered</div>
      <div className="text-[12px] text-text-2 font-mono mt-1">Control room notified</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink-0 text-text-0">
      <header className="sticky top-0 z-10 bg-ink-0/95 backdrop-blur border-b border-white/[.06] px-4 py-3 flex items-center gap-3">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-lg bg-white/[.05] border border-white/10 text-text-1 flex items-center justify-center"
        >
          <X size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-bold text-text-0 truncate">Unclamp at port</div>
          <div className="text-[10px] font-mono text-text-2 truncate">
            {s(row['booking_number'])} · {s(row['container_number']) || '(no number)'}
          </div>
        </div>
      </header>

      <div className="p-4 space-y-3 pb-32">
        <div className="rounded-xl border border-white/[.08] bg-white/[.03] p-4 space-y-2">
          <InfoRow label="Container" value={s(row['container_number']) || '—'} mono />
          <InfoRow label="Type" value={s(row['iso_type']) || '—'} mono />
          <InfoRow label="Seal" value={s(row['seal_number']) || '—'} mono />
          <InfoRow label="Lock" value={s(row['lock_serial']) || '—'} mono />
          <InfoRow label="Truck" value={s(row['vehicle_reg']) || '—'} />
          <InfoRow label="Driver" value={`${s(row['driver_name']) || '—'}${row['driver_phone'] ? ` · ${  s(row['driver_phone'])}` : ''}`} />
          <InfoRow label="Customer" value={s(row['customer_name']) || '—'} />
        </div>

        <div>
          <label className="block text-[11px] font-medium text-text-2 mb-1">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. seal intact, minor scratch on top-left corner"
            className="w-full min-h-[90px] px-3 py-2 rounded-lg bg-white/[.04] border border-white/[.08] text-text-0 text-[14px] outline-none focus:border-cds-cyan/50"
          />
        </div>
        {error && <p className="text-[12px] text-cds-red font-mono">{error}</p>}
      </div>

      <div className="fixed left-0 right-0 bottom-0 bg-ink-0 border-t border-white/[.06] p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <button
          onClick={submit}
          disabled={unclamp.isPending}
          className="w-full h-12 rounded-xl text-[14px] font-bold border-none disabled:opacity-50 transition-all active:brightness-110 flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg, #37e6ff, #7ce8ff)', color: '#0c0e12' }}
        >
          {unclamp.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} strokeWidth={2.5} />}
          {unclamp.isPending ? 'Submitting…' : 'Confirm unclamp'}
        </button>
      </div>
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] font-mono text-text-2 uppercase tracking-wider w-20 flex-shrink-0">{label}</span>
      <span className={`text-[13px] text-text-1 ${mono ? 'font-mono' : ''} truncate`}>{value}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="py-16 text-center text-[12px] font-mono text-text-2">{text}</div>;
}
function Center({ children }: { children: React.ReactNode }) {
  return <div className="py-16 flex justify-center">{children}</div>;
}
