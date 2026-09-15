import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Activity, AlertTriangle, ArrowRight, Bell, CalendarClock, CheckCircle2,
  Clock3, FileText, MapPin, Package, RefreshCw, Search, ShieldCheck,
  TimerReset, Truck, Waves, XCircle,
} from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PortalShell, Badge, ProgressBar, fmtDateTime, relativeTime } from '../../components/portal/PortalPrimitives.js';

const API = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

interface ShipmentSummary {
  convoy_id: string;
  reference: string;
  status: string;
  origin: string | null;
  destination: string | null;
  eta: string | null;
  last_ping_at: string | null;
  progress_pct: number | null;
  exception_count: number;
  seal_status: 'intact' | 'compromised' | 'unverified' | null;
  current_location: { lat: number; lng: number } | null;
}

type Tab = 'active' | 'attention' | 'completed' | 'all';

function cx(parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function isActive(s: ShipmentSummary): boolean {
  return ['active','pending','in_transit','delayed','at_checkpoint'].includes(s.status);
}

function freshness(s: ShipmentSummary): 'live' | 'recent' | 'stale' | 'offline' {
  if (!s.last_ping_at) return 'offline';
  const age = Date.now() - new Date(s.last_ping_at).getTime();
  if (age < 120000) return 'live';
  if (age < 900000) return 'recent';
  if (age < 3600000) return 'stale';
  return 'offline';
}

function KPI({ label, value, meta, icon: Icon, tone = 'default' }: {
  label: string; value: React.ReactNode; meta: string; icon: React.ElementType;
  tone?: 'default' | 'green' | 'amber' | 'red' | 'blue';
}) {
  const toneClass = {
    default: 'border-white/[0.07]',
    green: 'border-emerald-500/25',
    amber: 'border-amber-500/25',
    red: 'border-red-500/25',
    blue: 'border-sky-500/25',
  }[tone];
  const iconClass = {
    default: 'text-orange-400',
    green: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
    blue: 'text-sky-400',
  }[tone];
  return (
    <div className={cx(['rounded-2xl border p-4 sm:p-5 bg-gradient-to-br from-white/[0.035] to-transparent', toneClass])}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">{label}</p>
          <p className="mono mt-2 text-2xl sm:text-3xl font-medium text-white">{value}</p>
          <p className="mt-1 text-[11px] text-white/35">{meta}</p>
        </div>
        <div className="h-9 w-9 rounded-xl border border-white/[0.07] bg-black/15 flex items-center justify-center">
          <Icon size={16} className={iconClass} />
        </div>
      </div>
    </div>
  );
}

function OverviewMap({ shipments, selected, onSelect }: {
  shipments: ShipmentSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!ref.current || map.current) return;
    const m = new maplibregl.Map({
      container: ref.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [28, -2],
      zoom: 3.2,
      attributionControl: false,
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !m.isStyleLoaded()) return;
    markers.current.forEach(x => x.remove());
    markers.current = [];
    const located = shipments.filter(s => s.current_location);
    if (!located.length) return;

    const bounds = new maplibregl.LngLatBounds();
    located.forEach(s => {
      const freshnessState = freshness(s);
      const el = document.createElement('button');
      el.type = 'button';
      el.title = s.reference;
      const alerting = s.exception_count > 0 || s.seal_status === 'compromised';
      el.style.cssText = 'width:18px;height:18px;border-radius:999px;border:2px solid rgba(255,255,255,.85);background:' +
        (alerting ? '#ef4444' : '#f97316') +
        ';box-shadow:0 0 0 5px rgba(249,115,22,.12),0 0 18px rgba(249,115,22,.45);cursor:pointer;';
      if (freshnessState === 'stale' || freshnessState === 'offline') el.style.opacity = '.6';
      el.onclick = () => onSelect(s.convoy_id);
      markers.current.push(new maplibregl.Marker({ element: el })
        .setLngLat([s.current_location!.lng, s.current_location!.lat])
        .addTo(m));
      bounds.extend([s.current_location!.lng, s.current_location!.lat]);
    });
    if (located.length > 1) m.fitBounds(bounds, { padding: 55, maxZoom: 6.5, duration: 450 });
    else m.easeTo({ center: [located[0].current_location!.lng, located[0].current_location!.lat], zoom: 6, duration: 450 });
  }, [shipments, onSelect]);

  return (
    <div className="relative h-[430px] sm:h-[520px] overflow-hidden rounded-2xl border border-white/[0.07] bg-[#08101a]">
      <div ref={ref} className="absolute inset-0" />
      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 pointer-events-none">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Live map</p>
          <p className="mt-1 text-sm font-semibold text-white/80">Cargo positions</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-[10px] text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Telemetry
        </span>
      </div>
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-2 pointer-events-none">
        <span className="rounded-full border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-white/45">Cargo</span>
        <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-1 text-[10px] text-red-300">Attention</span>
        <span className="rounded-full border border-white/10 bg-black/40 px-2 py-1 text-[10px] text-white/35">Stale</span>
      </div>
      {selected && (
        <div className="absolute top-14 right-4 max-w-[230px] rounded-xl border border-orange-500/25 bg-black/70 px-3 py-2 backdrop-blur-md pointer-events-none">
          <p className="text-[10px] uppercase tracking-[0.15em] text-orange-300/70">Selected shipment</p>
          <p className="text-xs text-white mt-0.5 truncate">{shipments.find(x => x.convoy_id === selected)?.reference ?? '—'}</p>
        </div>
      )}
    </div>
  );
}

function ShipmentRow({ shipment, selected, onSelect }: {
  shipment: ShipmentSummary; selected: boolean; onSelect: () => void;
}) {
  const navigate = useNavigate();
  const live = freshness(shipment);
  const attention = shipment.exception_count > 0 || shipment.seal_status === 'compromised';
  const telemetryClass = live === 'live' ? 'text-emerald-300' : live === 'recent' ? 'text-amber-300' : 'text-white/50';
  const sealClass = shipment.seal_status === 'intact' ? 'text-emerald-300' : shipment.seal_status === 'compromised' ? 'text-red-300' : 'text-amber-300';

  return (
    <button onClick={onSelect} className={cx([
      'w-full text-left rounded-2xl border p-4 transition-all',
      selected ? 'border-orange-500/35 bg-orange-500/[0.06]' :
      attention ? 'border-red-500/15 bg-red-500/[0.025] hover:border-red-500/30' :
      'border-white/[0.07] bg-white/[0.018] hover:border-white/[0.14]',
    ])}>
      <div className="flex items-start gap-3">
        <div className={cx(['mt-0.5 h-9 w-9 rounded-xl flex items-center justify-center border', attention ? 'border-red-500/25 bg-red-500/10' : 'border-orange-500/20 bg-orange-500/10'])}>
          {attention ? <AlertTriangle size={15} className="text-red-400" /> : <Package size={15} className="text-orange-400" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-sm text-white truncate">{shipment.reference}</p>
            <Badge label={statusLabel(shipment.status)} variant={shipment.status} />
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-white/35">
            <span className="truncate">{shipment.origin ?? '—'} → {shipment.destination ?? '—'}</span>
          </div>
        </div>
        <ArrowRight size={15} className="text-white/20 mt-1 shrink-0" />
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] text-white/30">
          <span>Journey progress</span>
          <span className="mono">{shipment.progress_pct == null ? '—' : Math.round(shipment.progress_pct) + '%'}</span>
        </div>
        <ProgressBar pct={shipment.progress_pct ?? 0} className="mt-2" />
      </div>

      <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div className="rounded-lg border border-white/[0.05] bg-black/10 px-2.5 py-2">
          <span className="block text-white/25">ETA</span>
          <span className="mono mt-0.5 block text-white/65">{fmtDateTime(shipment.eta)}</span>
        </div>
        <div className="rounded-lg border border-white/[0.05] bg-black/10 px-2.5 py-2">
          <span className="block text-white/25">Telemetry</span>
          <span className={cx(['mt-0.5 block', telemetryClass])}>
            {live === 'live' ? 'Live' : live === 'recent' ? 'Recent' : live === 'stale' ? 'Stale' : 'Offline'}
          </span>
        </div>
        <div className="rounded-lg border border-white/[0.05] bg-black/10 px-2.5 py-2">
          <span className="block text-white/25">Seal</span>
          <span className={cx(['mt-0.5 block', sealClass])}>
            {shipment.seal_status === 'intact' ? 'Verified' : shipment.seal_status === 'compromised' ? 'Compromised' : 'Unverified'}
          </span>
        </div>
        <div className="rounded-lg border border-white/[0.05] bg-black/10 px-2.5 py-2">
          <span className="block text-white/25">Exceptions</span>
          <span className={cx(['mono mt-0.5 block', shipment.exception_count > 0 ? 'text-red-300' : 'text-white/65'])}>{shipment.exception_count}</span>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-white/[0.05] flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-white/40">
        <span className="inline-flex items-center gap-1"><Clock3 size={11}/>{shipment.last_ping_at ? relativeTime(shipment.last_ping_at) : 'No ping'}</span>
        {shipment.exception_count > 0 && <span className="inline-flex items-center gap-1 text-red-300"><AlertTriangle size={11}/>Attention required</span>}
        <span className="ml-auto text-orange-300/70 hover:text-orange-300"
          onClick={(e) => { e.stopPropagation(); void navigate({ to: '/portal/convoy/$convoy_id/track', params: { convoy_id: shipment.convoy_id } }); }}>
          Open live view →
        </span>
      </div>
    </button>
  );
}

function InsightRail({ shipments }: { shipments: ShipmentSummary[] }) {
  const active = shipments.filter(isActive);
  const exceptions = shipments.filter(s => s.exception_count > 0);
  const compromised = shipments.filter(s => s.seal_status === 'compromised');
  const stale = active.filter(s => freshness(s) === 'stale' || freshness(s) === 'offline');

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-white/[0.07] p-4 sm:p-5 bg-gradient-to-br from-white/[0.03] to-transparent">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-white/35">Control picture</p>
            <p className="mt-1 text-sm font-semibold text-white/80">Cargo health signals</p>
          </div>
          <Activity size={16} className="text-orange-400" />
        </div>
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between"><span className="text-xs text-white/45">In transit</span><span className="mono text-xs text-white">{active.length}</span></div>
          <div className="flex items-center justify-between"><span className="text-xs text-white/45">Shipments needing attention</span><span className={cx(['mono text-xs', exceptions.length ? 'text-amber-300' : 'text-white'])}>{exceptions.length}</span></div>
          <div className="flex items-center justify-between"><span className="text-xs text-white/45">Seal exceptions</span><span className={cx(['mono text-xs', compromised.length ? 'text-red-300' : 'text-white'])}>{compromised.length}</span></div>
          <div className="flex items-center justify-between"><span className="text-xs text-white/45">Telemetry stale/offline</span><span className={cx(['mono text-xs', stale.length ? 'text-amber-300' : 'text-white'])}>{stale.length}</span></div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/[0.07] p-4 sm:p-5 bg-gradient-to-br from-white/[0.03] to-transparent">
        <div className="flex items-center gap-2"><TimerReset size={15} className="text-sky-400" /><p className="text-sm font-semibold text-white/80">What matters now</p></div>
        {exceptions.length === 0 && compromised.length === 0 ? (
          <div className="mt-4 flex gap-3 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.045] p-3">
            <CheckCircle2 size={15} className="text-emerald-400 mt-0.5 shrink-0" />
            <div><p className="text-xs font-medium text-emerald-300">No active cargo exceptions</p><p className="text-[11px] text-emerald-200/45 mt-0.5">The current portfolio has no shipment-level alerts requiring your attention.</p></div>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {exceptions.slice(0, 3).map(s => (
              <div key={s.convoy_id} className="rounded-xl border border-red-500/15 bg-red-500/[0.035] p-3">
                <div className="flex items-center gap-2"><AlertTriangle size={13} className="text-red-400" /><p className="text-xs font-semibold text-white">{s.reference}</p></div>
                <p className="mt-1 text-[11px] text-white/40">{s.exception_count} exception{s.exception_count === 1 ? '' : 's'} recorded</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-white/[0.07] p-4 sm:p-5 bg-gradient-to-br from-white/[0.03] to-transparent">
        <div className="flex items-center gap-2"><FileText size={15} className="text-orange-400" /><p className="text-sm font-semibold text-white/80">Shipment workspace</p></div>
        <p className="mt-2 text-[11px] leading-relaxed text-white/35">Every shipment opens into tracking, manifest, documents, custody, security, sensor history, trip replay and proof-of-delivery records.</p>
      </div>
    </div>
  );
}

export default function PortalDashboard(): React.ReactElement {
  const navigate = useNavigate();
  const [shipments, setShipments] = useState<ShipmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const load = React.useCallback(() => {
    setErrorMsg('');
    fetch(API + '/portal/shipments', { credentials: 'include' })
      .then(async res => {
        if (res.status === 401) { void navigate({ to: '/portal/login' }); return null; }
        if (!res.ok) throw new Error((await res.json().catch(() => ({} as Record<string, string>)) as { error?: string }).error ?? ('Error ' + res.status));
        return res.json() as Promise<{ data: ShipmentSummary[] }>;
      })
      .then(json => {
        if (json) { setShipments(json.data ?? []); setLastRefresh(new Date()); }
      })
      .catch((e: Error) => setErrorMsg(e.message))
      .finally(() => setLoading(false));
  }, [navigate]);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 60000);
    return () => window.clearInterval(timer);
  }, [load]);

  const active = useMemo(() => shipments.filter(isActive), [shipments]);
  const attention = useMemo(() => shipments.filter(s => s.exception_count > 0 || s.seal_status === 'compromised'), [shipments]);
  const completed = useMemo(() => shipments.filter(s => s.status === 'completed' || s.status === 'cancelled'), [shipments]);
  const liveCount = shipments.filter(s => freshness(s) === 'live').length;
  const verifiedSeals = shipments.filter(s => s.seal_status === 'intact').length;
  const avgProgress = active.length ? Math.round(active.reduce((a, s) => a + (s.progress_pct ?? 0), 0) / active.length) : 0;

  const filtered = useMemo(() => {
    let base = tab === 'active' ? active : tab === 'attention' ? attention : tab === 'completed' ? completed : shipments;
    const q = search.trim().toLowerCase();
    if (q) base = base.filter(s => [s.reference, s.origin, s.destination].some(v => (v ?? '').toLowerCase().includes(q)));
    return base;
  }, [tab, search, shipments, active, attention, completed]);

  return (
    <PortalShell>
      <header className="sticky top-0 z-40 border-b border-white/[0.06]" style={{ background: 'rgba(7,11,22,0.9)', backdropFilter: 'blur(18px)' }}>
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 xl:px-8 py-3 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-orange-300/70">Cargo Owner Workspace</p>
            <div className="flex items-center gap-2 mt-1">
              <h1 className="text-sm sm:text-base font-semibold text-white truncate">Portfolio command center</h1>
              <span className="hidden sm:inline-flex items-center gap-1 text-[10px] text-emerald-300 border border-emerald-500/20 bg-emerald-500/10 rounded-full px-2 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden md:inline text-[10px] text-white/25">Updated {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <button onClick={load} className="p-2 rounded-lg border border-white/[0.07] text-white/40 hover:text-white hover:border-white/15 transition-colors" title="Refresh"><RefreshCw size={14} /></button>
            <button onClick={() => void navigate({ to: '/portal/notifications' })} className="p-2 rounded-lg border border-white/[0.07] text-white/40 hover:text-white hover:border-white/15 transition-colors"><Bell size={14} /></button>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-4 sm:px-6 xl:px-8 pt-5 sm:pt-7 pb-20">
        <section className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-white/[0.07] bg-white/[0.018] px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-orange-300/65">Cargo</p>
            <p className="mt-1 text-sm font-semibold text-white">Live shipments</p>
          </div>
          <div className="flex flex-wrap gap-2 text-[9px] font-bold uppercase tracking-[0.12em]">
            <span className="rounded-lg border border-white/[0.07] px-2.5 py-1.5 text-white/35">{active.length} active</span>
            <span className="rounded-lg border border-white/[0.07] px-2.5 py-1.5 text-white/35">{attention.length} attention</span>
            <span className="rounded-lg border border-white/[0.07] px-2.5 py-1.5 text-white/35">{shipments.length} total</span>
          </div>
        </section>

        {!loading && !errorMsg && (
          <section className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPI label="Active shipments" value={active.length} meta={avgProgress + '% average journey progress'} icon={Truck} tone="green" />
            <KPI label="Live telemetry" value={liveCount} meta={(shipments.length ? Math.round((liveCount / shipments.length) * 100) : 0) + '% of visible portfolio'} icon={Activity} tone="blue" />
            <KPI label="Attention" value={attention.length} meta={attention.length ? 'Review shipment exceptions' : 'No shipment alerts'} icon={AlertTriangle} tone={attention.length ? 'amber' : 'default'} />
            <KPI label="Seal verified" value={verifiedSeals} meta={shipments.filter(s => s.seal_status).length + ' shipments reporting a seal state'} icon={ShieldCheck} tone={verifiedSeals ? 'green' : 'default'} />
          </section>
        )}

        {errorMsg && (
          <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/[0.04] p-4 flex gap-3">
            <XCircle size={17} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-300">Cargo portfolio unavailable</p>
              <p className="mt-1 text-xs text-red-200/50">{errorMsg}</p>
              <button onClick={load} className="mt-2 text-xs font-semibold text-orange-300">Retry</button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="mt-5 grid grid-cols-1 lg:grid-cols-[minmax(0,1.75fr)_minmax(280px,.75fr)] gap-4">
            <div className="h-[380px] rounded-2xl border border-white/[0.07] animate-pulse bg-white/[0.02]" />
            <div className="h-[380px] rounded-2xl border border-white/[0.07] animate-pulse bg-white/[0.02]" />
          </div>
        ) : !errorMsg && (
          <>
            <section className="mt-5 grid grid-cols-1 lg:grid-cols-[minmax(0,1.75fr)_minmax(280px,.75fr)] gap-4">
              <OverviewMap shipments={shipments} selected={selected} onSelect={setSelected} />
              <InsightRail shipments={shipments} />
            </section>

            <section className="mt-5 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-4 items-start">
              <div className="rounded-2xl border border-white/[0.07] overflow-hidden bg-white/[0.012]">
                <div className="px-4 sm:px-5 py-4 border-b border-white/[0.06]">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-white/30">Shipment portfolio</p>
                      <p className="mt-1 text-sm font-semibold text-white/80">{filtered.length} shipment{filtered.length === 1 ? '' : 's'} in view</p>
                    </div>
                    <div className="relative min-w-[220px]">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25"/>
                      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reference or route…" className="w-full pl-8 pr-3 py-2 rounded-lg border border-white/[0.07] bg-black/10 text-xs text-white placeholder-white/20 focus:outline-none focus:border-orange-500/35"/>
                    </div>
                  </div>
                  <div className="mt-4 flex gap-1 overflow-x-auto pb-0.5">
                    {([
                      ['active', 'Active ' + active.length],
                      ['attention', 'Attention ' + attention.length],
                      ['completed', 'Completed ' + completed.length],
                      ['all', 'All ' + shipments.length],
                    ] as [Tab, string][]).map(([key, label]) => (
                      <button key={key} onClick={() => setTab(key)} className={cx(['whitespace-nowrap rounded-lg px-3 py-2 text-[11px] font-semibold transition-colors', tab === key ? 'bg-orange-500 text-white' : 'text-white/35 hover:text-white/70 hover:bg-white/[0.03]'])}>{label}</button>
                    ))}
                  </div>
                </div>

                <div className="p-3 sm:p-4 space-y-3">
                  {filtered.length === 0 ? (
                    <div className="py-16 flex flex-col items-center text-center">
                      <Package size={30} className="text-white/10" />
                      <p className="mt-3 text-sm text-white/45">No shipments match this view.</p>
                      <p className="mt-1 text-xs text-white/25">Try another tab or search term.</p>
                    </div>
                  ) : filtered.map(s => (
                    <ShipmentRow key={s.convoy_id} shipment={s} selected={selected === s.convoy_id} onSelect={() => setSelected(s.convoy_id)} />
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-white/[0.07] p-4 bg-white/[0.012]">
                  <div className="flex items-center gap-2"><CalendarClock size={15} className="text-orange-400" /><p className="text-sm font-semibold text-white/80">Upcoming movement</p></div>
                  <div className="mt-4 space-y-3">
                    {active.filter(s => s.eta).sort((a, b) => new Date(a.eta!).getTime() - new Date(b.eta!).getTime()).slice(0, 4).map(s => (
                      <button key={s.convoy_id} onClick={() => { setSelected(s.convoy_id); void navigate({ to: '/portal/convoy/$convoy_id/track', params: { convoy_id: s.convoy_id } }); }} className="w-full text-left rounded-xl border border-white/[0.06] p-3 hover:border-orange-500/20 transition-colors">
                        <div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-white truncate">{s.reference}</span><span className="mono text-[10px] text-orange-300/70">{fmtDateTime(s.eta)}</span></div>
                        <p className="mt-1 text-[11px] text-white/35 truncate">{s.origin ?? '—'} → {s.destination ?? '—'}</p>
                      </button>
                    ))}
                    {active.filter(s => s.eta).length === 0 && <p className="text-xs text-white/30">No upcoming ETAs are available.</p>}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/[0.07] p-4 bg-white/[0.012]">
                  <div className="flex items-center gap-2"><FileText size={15} className="text-sky-400" /><p className="text-sm font-semibold text-white/80">Delivery & evidence</p></div>
                  <p className="mt-2 text-[11px] leading-relaxed text-white/35">Open a shipment to access its manifest, chain-of-custody ledger, documents and proof of delivery as the record becomes available.</p>
                  <div className="mt-4 flex items-center justify-between text-[11px]"><span className="text-white/30">Completed shipments</span><span className="mono text-white/60">{completed.length}</span></div>
                </div>

                <div className="rounded-2xl border border-white/[0.07] p-4 bg-gradient-to-br from-orange-500/[0.07] to-transparent">
                  <div className="flex items-center gap-2"><CheckCircle2 size={15} className="text-orange-400" /><p className="text-sm font-semibold text-white/80">Scoped by design</p></div>
                  <p className="mt-2 text-[11px] leading-relaxed text-white/40">The portal gives cargo owners the information needed to make decisions while sensitive internal security and personnel details remain behind Sonalit's operational boundary.</p>
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </PortalShell>
  );
}
