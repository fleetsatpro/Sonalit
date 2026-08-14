import { Link } from '@tanstack/react-router';
import {
  ArrowLeft, Check, ChevronRight, Hash, List as ListIcon, Loader2, Lock,
  Map as MapIcon, MapPin, Package, Phone, ShieldCheck, StickyNote, Truck,
  UserRound, X,
} from 'lucide-react';
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

// A GPS fix's age tells a port worker whether "last seen" is trustworthy —
// stale for long enough and the container may already be off the tracked
// vehicle. Mirrors the traffic-light convention used on the desktop live map.
function freshness(lastSeen: unknown): { label: string; color: string } | null {
  if (!lastSeen) return null;
  const ageMin = (Date.now() - new Date(s(lastSeen)).getTime()) / 60000;
  if (ageMin < 5) return { label: 'live', color: '#33d6a8' };
  if (ageMin < 30) return { label: `${Math.round(ageMin)}m ago`, color: '#ffb020' };
  return { label: 'stale', color: '#ff5c5c' };
}

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
          className="w-9 h-9 rounded-lg bg-white/[.05] border border-white/10 text-text-1 flex items-center justify-center flex-shrink-0"
        >
          <ArrowLeft size={16} />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-text-0 leading-tight">Port ops</div>
          <div className="text-[11px] font-mono text-text-2 flex items-center gap-1.5 mt-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cds-cyan animate-pulse-dot" />
            {rows.length} container{rows.length === 1 ? '' : 's'} in transit
          </div>
        </div>
        <div className="flex gap-0 border border-white/10 rounded-lg overflow-hidden flex-shrink-0">
          <button
            onClick={() => setTab('list')}
            className={`px-3 h-9 border-none cursor-pointer transition-colors ${tab === 'list' ? 'bg-cds-cyan/15 text-cds-cyan' : 'bg-transparent text-text-2'}`}
          >
            <ListIcon size={13} />
          </button>
          <button
            onClick={() => setTab('map')}
            className={`px-3 h-9 border-none cursor-pointer transition-colors ${tab === 'map' ? 'bg-cds-cyan/15 text-cds-cyan' : 'bg-transparent text-text-2'}`}
          >
            <MapIcon size={13} />
          </button>
        </div>
      </header>

      {tab === 'list' ? (
        <div className="flex-1 p-4 space-y-2.5">
          {isLoading && <Center><Loader2 className="animate-spin text-text-2" /></Center>}
          {!isLoading && rows.length === 0 && <Empty text="No containers in transit right now." good />}
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
          <div className="absolute top-3 left-3 bg-black/70 backdrop-blur px-3 py-1.5 rounded-full text-[11px] font-mono text-text-1 border border-white/10 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cds-cyan" />
            {withGps.length} live fix{withGps.length === 1 ? '' : 'es'}
          </div>
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
  const fresh = freshness(row['last_seen']);
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded-2xl border border-cds-cyan/25 bg-cds-cyan/[.05] px-4 py-3.5 active:scale-[.985] transition-all flex items-center gap-3"
    >
      <div className="w-11 h-11 rounded-xl bg-cds-cyan/15 border border-cds-cyan/30 flex items-center justify-center flex-shrink-0">
        <Package size={18} className="text-cds-cyan" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[14px] font-bold text-cds-cyan">
            {s(row['container_number']) || 'No number'}
          </span>
          <span className="text-[9px] font-mono font-bold text-text-1 bg-white/[.08] px-1.5 py-0.5 rounded uppercase">
            {s(row['iso_type'])}
          </span>
          {fresh && (
            <span className="ml-auto text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase flex items-center gap-1"
              style={{ color: fresh.color, background: `${fresh.color}1a` }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: fresh.color }} />
              {fresh.label}
            </span>
          )}
        </div>
        <div className="text-[11px] text-text-1 mt-1 truncate">{s(row['booking_number'])} · {s(row['customer_name'])}</div>
        <div className="text-[10px] font-mono text-text-2 mt-1 flex items-center gap-3">
          {s(row['vehicle_reg']) && <span className="flex items-center gap-1"><Truck size={9} />{s(row['vehicle_reg'])}</span>}
          {s(row['driver_name']) && <span className="truncate">{s(row['driver_name'])}</span>}
          {seen && <span className="ml-auto flex items-center gap-1 flex-shrink-0"><MapPin size={9} />{seen}</span>}
        </div>
      </div>
      <ChevronRight size={18} className="text-cds-cyan flex-shrink-0" />
    </button>
  );
}

const CONDITION_CHIPS = ['Seal intact', 'Minor damage', 'Missing seal', 'Wet cargo'] as const;

function UnclampForm({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const unclamp = useUnclampBookingContainer();
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const toggleTag = (tag: string) => setTags(prev => {
    const next = new Set(prev);
    if (next.has(tag)) next.delete(tag); else next.add(tag);
    return next;
  });

  const submit = () => {
    setError('');
    const bookingId = s(row['booking_id']);
    const tagPrefix = tags.size ? `[${Array.from(tags).join(', ')}] ` : '';
    const doSubmit = (lat?: number, lng?: number) => {
      unclamp.mutate({
        bookingId,
        cid: s(row['id']),
        notes: (tagPrefix + notes.trim()).trim() || null,
        lat, lng,
      }, {
        onSuccess: () => { setSuccess(true); setTimeout(onDone, 1100); },
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
    <div className="min-h-screen bg-ink-0 text-text-0 flex flex-col items-center justify-center p-6 relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 opacity-30"
        style={{ background: 'radial-gradient(circle at 50% 45%, rgba(55,230,255,.25), transparent 55%)' }} />
      <div className="relative w-20 h-20 rounded-full bg-cds-cyan/15 border-2 border-cds-cyan/50 flex items-center justify-center mb-5"
        style={{ boxShadow: '0 0 40px -8px rgba(55,230,255,.6)' }}>
        <Check size={38} className="text-cds-cyan" strokeWidth={2.5} />
      </div>
      <div className="relative text-xl font-bold">Unclamped · Delivered</div>
      <div className="relative text-[12px] font-mono text-text-2 mt-1.5">{s(row['container_number']) || 'Container'} released</div>
      <div className="relative text-[10px] font-mono text-text-2/60 mt-0.5">CDS control room notified</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink-0 text-text-0">
      <header className="sticky top-0 z-10 bg-ink-0/95 backdrop-blur border-b border-white/[.06] px-4 py-3 flex items-center gap-3">
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-lg bg-white/[.05] border border-white/10 text-text-1 flex items-center justify-center cursor-pointer flex-shrink-0"
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

      <div className="p-4 space-y-4 pb-32">
        <div className="flex items-center gap-3 rounded-2xl border border-cds-cyan/25 bg-cds-cyan/[.05] px-4 py-3.5">
          <div className="w-12 h-12 rounded-xl bg-cds-cyan/15 border border-cds-cyan/30 flex items-center justify-center flex-shrink-0">
            <Package size={20} className="text-cds-cyan" />
          </div>
          <div className="min-w-0">
            <div className="font-mono text-[15px] font-bold text-cds-cyan">{s(row['container_number']) || 'No number'}</div>
            <div className="text-[11px] text-text-2 mt-0.5 truncate">{s(row['customer_name'])}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/[.08] bg-white/[.03] p-4 space-y-2.5">
          <InfoRow icon={<Hash size={12} />} label="Type" value={s(row['iso_type']) || '—'} mono />
          <InfoRow icon={<ShieldCheck size={12} />} label="Seal" value={s(row['seal_number']) || '—'} mono />
          <InfoRow icon={<Lock size={12} />} label="Lock" value={s(row['lock_serial']) || '—'} mono />
          <InfoRow icon={<Truck size={12} />} label="Truck" value={s(row['vehicle_reg']) || '—'} />
          <InfoRow icon={<UserRound size={12} />} label="Driver" value={s(row['driver_name']) || '—'} />
          {row['driver_phone'] != null && <InfoRow icon={<Phone size={12} />} label="Phone" value={s(row['driver_phone'])} mono />}
        </div>

        <div>
          <div className="text-[10px] font-bold font-mono uppercase tracking-widest text-cds-cyan/80 mb-2">Condition check</div>
          <div className="flex flex-wrap gap-2">
            {CONDITION_CHIPS.map(tag => {
              const on = tags.has(tag);
              return (
                <button key={tag} type="button" onClick={() => toggleTag(tag)}
                  className="px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors cursor-pointer"
                  style={on
                    ? { color: '#37e6ff', background: 'rgba(55,230,255,.15)', borderColor: 'rgba(55,230,255,.4)' }
                    : { color: 'rgba(255,255,255,.45)', background: 'rgba(255,255,255,.03)', borderColor: 'rgba(255,255,255,.1)' }}>
                  {tag}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-medium text-text-2 mb-1">Notes</label>
          <div className="relative">
            <StickyNote size={14} className="absolute left-3 top-3 text-text-2 pointer-events-none" />
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional — anything the tags above don't cover"
              className="w-full min-h-[80px] pl-9 pr-3 py-2.5 rounded-lg bg-white/[.04] border border-white/[.08] text-text-0 text-[14px] outline-none focus:border-cds-cyan/50 transition-colors"
            />
          </div>
        </div>
        {error && (
          <p className="text-[12px] text-cds-red font-mono bg-cds-red/10 border border-cds-red/25 rounded-lg px-3 py-2">{error}</p>
        )}
      </div>

      <div className="fixed left-0 right-0 bottom-0 bg-ink-0 border-t border-white/[.06] p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <button
          onClick={submit}
          disabled={unclamp.isPending}
          className="w-full h-14 rounded-xl text-[14px] font-bold border-none disabled:opacity-50 transition-all active:brightness-110 flex items-center justify-center gap-2"
          style={{ background: 'linear-gradient(135deg, #37e6ff, #7ce8ff)', color: '#0c0e12' }}
        >
          {unclamp.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} strokeWidth={2.5} />}
          {unclamp.isPending ? 'Submitting…' : 'Confirm unclamp'}
        </button>
      </div>
    </div>
  );
}

function InfoRow({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-text-2 flex-shrink-0">{icon}</span>
      <span className="text-[10px] font-mono text-text-2 uppercase tracking-wider w-14 flex-shrink-0">{label}</span>
      <span className={`text-[13px] text-text-1 flex-1 min-w-0 ${mono ? 'font-mono' : ''} truncate`}>{value}</span>
    </div>
  );
}

function Empty({ text, good }: { text: string; good?: boolean }) {
  return (
    <div className="py-16 flex flex-col items-center gap-2.5 text-center">
      {good && (
        <div className="w-11 h-11 rounded-full bg-cds-cyan/15 border border-cds-cyan/30 flex items-center justify-center">
          <Check size={18} className="text-cds-cyan" strokeWidth={2.5} />
        </div>
      )}
      <p className="text-[12px] font-mono text-text-2 max-w-[240px]">{text}</p>
    </div>
  );
}
function Center({ children }: { children: React.ReactNode }) {
  return <div className="py-16 flex justify-center">{children}</div>;
}
