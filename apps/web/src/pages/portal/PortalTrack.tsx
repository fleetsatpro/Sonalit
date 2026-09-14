import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import Map, { Marker, NavigationControl, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AlertTriangle, ArrowLeft, Activity, Clock3, Expand, Gauge, MapPin, RefreshCw, ShieldCheck, Signal, Truck } from 'lucide-react';
import { PortalShell, Badge, ProgressBar, fmtDateTime } from '../../components/portal/PortalPrimitives.js';
import { subscribePortal } from '../../lib/portalCentrifuge.js';

const API = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

type Vehicle = {
  vehicle_id: string; registration: string; make: string | null; model: string | null;
  type: string | null; driver_name: string | null; current_lat: number | null;
  current_lng: number | null; speed_kmh: number | null; heading_deg: number | null;
  last_ping_at: string | null; carries_my_cargo: boolean;
};
type Overview = {
  convoy_id: string; reference: string; status: string; origin: string; destination: string;
  departed_at: string | null; estimated_arrival_at: string | null; arrived_at: string | null;
  progress_pct: number | null; exception_count: number; seal_status: string | null;
  vehicles: Vehicle[];
};
type TrackPoint = { lat: number; lng: number; recorded_at: string; speed_kmh: number | null };
type LivePosition = { lat: number; lng: number; speed_kmh: number | null; heading_deg: number | null; observed_at: string };

const ageLabel = (iso: string | null | undefined) => {
  if (!iso) return 'NO FIX';
  const sec = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return sec + 's';
  if (sec < 3600) return Math.floor(sec / 60) + 'm';
  return Math.floor(sec / 3600) + 'h';
};

const health = (iso: string | null | undefined) => {
  if (!iso) return 'offline';
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  return sec < 120 ? 'live' : sec < 900 ? 'recent' : sec < 3600 ? 'stale' : 'offline';
};

function Metric({ icon: Icon, label, value, sub }: { icon: React.ElementType; label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="rounded-2xl border border-white/[.07] bg-[#0b121c]/90 p-4">
      <div className="flex items-center justify-between"><span className="text-[9px] font-bold uppercase tracking-[.18em] text-white/30">{label}</span><Icon size={15} className="text-orange-300"/></div>
      <div className="mt-2 font-mono text-2xl text-white">{value}</div>
      <div className="mt-1 text-[10px] text-white/25">{sub}</div>
    </div>
  );
}

function LiveMap({ points, trail, onFullscreen }: { points: Array<{ id: string; lat: number; lng: number; registration: string; mine: boolean }>; trail: TrackPoint[]; onFullscreen: () => void }) {
  const mapRef = useRef<MapRef | null>(null);
  const fit = () => {
    if (!points.length) return;
    const lats = points.map(p => p.lat);
    const lngs = points.map(p => p.lng);
    mapRef.current?.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 90, maxZoom: 9, duration: 700 },
    );
  };
  useEffect(() => { if (points.length) window.setTimeout(fit, 250); }, [points.length]);
  const line = {
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: trail.map(p => [p.lng, p.lat]) },
    properties: {},
  };
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/[.08] bg-[#06101a]">
      <Map ref={mapRef} initialViewState={{ longitude: 0, latitude: 0, zoom: 1.6 }} mapStyle={MAP_STYLE} style={{ width: '100%', height: 610 }} attributionControl={false} onLoad={fit}>
        <NavigationControl position="bottom-right" showCompass showZoom />
        {trail.length > 1 && (
          <Source id="portal-track-line" type="geojson" data={line}>
            <Layer id="portal-track-line-layer" type="line" paint={{ 'line-color': '#ff7a18', 'line-width': 4, 'line-opacity': .9 }} />
          </Source>
        )}
        {points.map(p => (
          <Marker key={p.id} longitude={p.lng} latitude={p.lat} anchor="center">
            <div title={p.registration} className={"flex h-11 w-11 items-center justify-center rounded-full border-2 bg-[#0b1520] shadow-[0_0_0_7px_rgba(255,122,24,.08)] " + (p.mine ? 'border-orange-300 text-orange-300' : 'border-sky-300/60 text-sky-300')}>
              <Truck size={16} />
            </div>
          </Marker>
        ))}
      </Map>
      <div className="absolute left-4 top-4 flex items-center gap-2 rounded-xl border border-white/10 bg-[#071019]/90 px-3 py-2 backdrop-blur-md">
        <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-[9px] font-bold uppercase tracking-[.18em] text-white/65">LIVE CARGO ATLAS</span>
        <span className="font-mono text-[9px] text-white/25">{points.length} positioned units</span>
      </div>
      <div className="absolute right-4 top-4 flex gap-2">
        <button onClick={fit} disabled={!points.length} className="rounded-xl border border-white/10 bg-[#071019]/90 p-2.5 text-white/45 disabled:opacity-30"><MapPin size={15}/></button>
        <button onClick={onFullscreen} className="rounded-xl border border-white/10 bg-[#071019]/90 p-2.5 text-white/45"><Expand size={15}/></button>
      </div>
      {!points.length && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#06101a]/40">
          <div className="max-w-sm rounded-2xl border border-amber-400/15 bg-[#08111b]/95 p-6 text-center">
            <Signal size={24} className="mx-auto text-amber-300/70"/>
            <p className="mt-3 text-sm font-semibold text-white">No live coordinate is available</p>
            <p className="mt-2 text-[11px] leading-relaxed text-white/35">The map is connected to Sonalit telemetry. Nothing is fabricated when a vehicle has no valid fix.</p>
          </div>
        </div>
      )}
      <div className="absolute bottom-3 left-3 rounded-lg border border-white/10 bg-[#071019]/90 px-2.5 py-1.5 text-[9px] text-white/25">OpenStreetMap-compatible basemap · Sonalit telemetry</div>
    </div>
  );
}

function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  const state = health(vehicle.last_ping_at);
  return (
    <div className="rounded-2xl border border-white/[.07] bg-white/[.018] p-4">
      <div className="flex items-start gap-3">
        <div className={"h-10 w-10 rounded-xl border flex items-center justify-center " + (vehicle.carries_my_cargo ? 'border-orange-400/25 bg-orange-400/10' : 'border-white/10 bg-white/[.02]')}>
          <Truck size={16} className={vehicle.carries_my_cargo ? 'text-orange-300' : 'text-white/30'}/>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2"><p className="font-mono text-sm font-semibold text-white">{vehicle.registration}</p><span className="text-[9px] text-white/25">{vehicle.carries_my_cargo ? 'YOUR CARGO' : 'CO-LOAD'}</span></div>
          <p className="mt-1 truncate text-[10px] text-white/30">{vehicle.make || 'Vehicle'} {vehicle.model || ''}{vehicle.driver_name ? ' · ' + vehicle.driver_name : ''}</p>
        </div>
        <span className={"rounded-full border px-2 py-1 text-[9px] font-bold uppercase " + (state === 'live' ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300' : state === 'recent' ? 'border-amber-400/20 bg-amber-400/10 text-amber-300' : 'border-white/10 bg-white/[.03] text-white/30')}>{state}</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-white/[.06] p-2.5"><span className="block text-[8px] uppercase tracking-[.14em] text-white/20">Speed</span><strong className="mt-1 block font-mono text-[11px] text-white/65">{vehicle.speed_kmh == null ? '—' : Math.round(vehicle.speed_kmh) + ' km/h'}</strong></div>
        <div className="rounded-xl border border-white/[.06] p-2.5"><span className="block text-[8px] uppercase tracking-[.14em] text-white/20">Heading</span><strong className="mt-1 block font-mono text-[11px] text-white/65">{vehicle.heading_deg == null ? '—' : Math.round(vehicle.heading_deg) + '°'}</strong></div>
        <div className="rounded-xl border border-white/[.06] p-2.5"><span className="block text-[8px] uppercase tracking-[.14em] text-white/20">Fix age</span><strong className="mt-1 block font-mono text-[11px] text-white/65">{ageLabel(vehicle.last_ping_at)}</strong></div>
      </div>
    </div>
  );
}

export default function PortalTrack(): React.ReactElement {
  const navigate = useNavigate();
  const { convoy_id = '' } = useParams({ strict: false }) as { convoy_id?: string };
  const [overview, setOverview] = useState<Overview | null>(null);
  const [trail, setTrail] = useState<TrackPoint[]>([]);
  const [live, setLive] = useState<LivePosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [lastSync, setLastSync] = useState(new Date());

  const load = React.useCallback(async () => {
    if (!convoy_id) return;
    try {
      const [oRes, lRes, vRes] = await Promise.all([
        fetch(API + '/portal/convoy/' + encodeURIComponent(convoy_id) + '/overview', { credentials: 'include' }),
        fetch(API + '/portal/convoy/location', { credentials: 'include' }),
        fetch(API + '/portal/convoy/vehicles', { credentials: 'include' }),
      ]);
      if (oRes.status === 401) { void navigate({ to: '/portal/login' }); return; }
      if (oRes.status === 403) throw new Error('Not authorised for this shipment');
      if (!oRes.ok) throw new Error('Unable to load shipment telemetry');
      const o = await oRes.json() as { data: Overview };
      const l = await lRes.json() as { data: { trail?: TrackPoint[]; current_location?: { lat: number; lng: number }; speed_kmh?: number | null; heading?: number | null; last_ping_at?: string | null } };
      const v = await vRes.json() as { data: Vehicle[] };
      setOverview({ ...o.data, vehicles: v.data || o.data.vehicles || [] });
      setTrail(l.data?.trail || []);
      if (l.data?.current_location) setLive({ lat: l.data.current_location.lat, lng: l.data.current_location.lng, speed_kmh: l.data.speed_kmh ?? null, heading_deg: l.data.heading ?? null, observed_at: l.data.last_ping_at || new Date().toISOString() });
      setLastSync(new Date());
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Unable to load shipment');
    } finally {
      setLoading(false);
    }
  }, [convoy_id, navigate]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!convoy_id) return;
    return subscribePortal<{ type: string; location?: { lat: number; lng: number }; speed_kmh?: number | null }>('portal#' + convoy_id, evt => {
      if (evt.type !== 'position' || !evt.location) return;
      const point = { lat: evt.location.lat, lng: evt.location.lng, speed_kmh: evt.speed_kmh ?? null, observed_at: new Date().toISOString() };
      setLive(point);
      setTrail(cur => [...cur, { lat: point.lat, lng: point.lng, speed_kmh: point.speed_kmh, recorded_at: point.observed_at }].slice(-1000));
      setLastSync(new Date());
    });
  }, [convoy_id]);

  const positionPoints = useMemo(() => (overview?.vehicles || []).filter(v => v.current_lat != null && v.current_lng != null).map(v => ({ id: v.vehicle_id, lat: v.current_lat as number, lng: v.current_lng as number, registration: v.registration, mine: v.carries_my_cargo })), [overview?.vehicles]);
  const displayedPoints = live && overview?.vehicles.length === 1
    ? [{ id: overview.vehicles[0].vehicle_id, lat: live.lat, lng: live.lng, registration: overview.vehicles[0].registration, mine: overview.vehicles[0].carries_my_cargo }]
    : positionPoints;

  if (loading) return <PortalShell><div className="min-h-[100dvh] bg-[#050b12] p-6 text-white"><div className="mx-auto max-w-[1680px] animate-pulse space-y-4"><div className="h-20 rounded-2xl bg-white/[.03]"/><div className="h-[610px] rounded-3xl bg-white/[.03]"/></div></div></PortalShell>;

  return (
    <PortalShell>
      <div className="min-h-[100dvh] bg-[#050b12] text-white">
        <header className="sticky top-0 z-40 border-b border-white/[.07] bg-[#070c14]/90 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1680px] items-center gap-3 px-4 py-3 sm:px-6 xl:px-8">
            <button onClick={() => void navigate({ to: '/portal/dashboard' })} className="rounded-xl border border-white/[.07] p-2 text-white/40 hover:text-white"><ArrowLeft size={15}/></button>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-base font-semibold text-white">{overview?.reference || 'Shipment'}</p><Badge label={(overview?.status || 'unknown').replace(/_/g,' ')} variant={overview?.status}/></div><p className="mt-0.5 text-[10px] text-white/25">Live cargo telemetry · synced {lastSync.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</p></div>
            <button onClick={() => void load()} className="rounded-xl border border-white/[.07] p-2 text-white/40 hover:text-white"><RefreshCw size={15}/></button>
          </div>
        </header>
        <main className="mx-auto max-w-[1680px] space-y-4 px-4 pb-20 pt-5 sm:px-6 xl:px-8">
          {errorMsg && <div className="rounded-2xl border border-red-400/20 bg-red-400/[.05] p-4 text-sm text-red-200"><AlertTriangle size={15} className="mr-2 inline"/> {errorMsg}</div>}
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <Metric icon={Activity} label="Telemetry" value={live ? 'LIVE' : health(overview?.vehicles[0]?.last_ping_at)} sub={live ? ageLabel(live.observed_at) + ' since fix' : 'Polling telemetry'} />
            <Metric icon={Gauge} label="Speed" value={live?.speed_kmh == null ? (overview?.vehicles[0]?.speed_kmh == null ? '—' : Math.round(overview.vehicles[0].speed_kmh)) : Math.round(live.speed_kmh)} sub="km/h" />
            <Metric icon={MapPin} label="Position" value={live ? live.lat.toFixed(4) : '—'} sub={live ? live.lng.toFixed(4) : 'no valid fix'} />
            <Metric icon={ShieldCheck} label="Seal" value={(overview?.seal_status || 'unverified').toUpperCase()} sub="customer-safe status" />
            <Metric icon={AlertTriangle} label="Exceptions" value={overview?.exception_count ?? 0} sub={overview?.exception_count ? 'review required' : 'no active alerts'} />
          </section>
          <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_390px]">
            <LiveMap points={displayedPoints} trail={trail} onFullscreen={() => setFullscreen(true)} />
            <div className="space-y-4">
              <div className="rounded-3xl border border-orange-400/20 bg-gradient-to-br from-orange-400/[.08] to-transparent p-5">
                <p className="text-[9px] font-bold uppercase tracking-[.18em] text-orange-300/65">Journey intelligence</p>
                <h2 className="mt-2 text-xl font-semibold text-white">{overview?.origin || 'Origin not recorded'} → {overview?.destination || 'Destination not recorded'}</h2>
                <div className="mt-4"><div className="flex items-center justify-between text-[9px] uppercase tracking-[.14em] text-white/25"><span>Progress</span><span>{overview?.progress_pct == null ? '—' : Math.round(overview.progress_pct) + '%'}</span></div><ProgressBar pct={overview?.progress_pct ?? 0} className="mt-2"/></div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-xl border border-white/[.06] p-3"><span className="text-[8px] uppercase tracking-[.13em] text-white/20">ETA</span><strong className="mt-1 block font-mono text-[11px] text-white/65">{fmtDateTime(overview?.estimated_arrival_at || null)}</strong></div>
                  <div className="rounded-xl border border-white/[.06] p-3"><span className="text-[8px] uppercase tracking-[.13em] text-white/20">Last fix</span><strong className="mt-1 block font-mono text-[11px] text-white/65">{ageLabel(live?.observed_at || overview?.vehicles[0]?.last_ping_at)}</strong></div>
                </div>
              </div>
              <div className="rounded-3xl border border-white/[.07] bg-white/[.018] p-4">
                <div className="flex items-center justify-between"><p className="text-[9px] font-bold uppercase tracking-[.18em] text-white/30">Live vehicle telemetry</p><span className="font-mono text-[9px] text-white/20">{overview?.vehicles.length || 0} units</span></div>
                <div className="mt-3 space-y-3">{(overview?.vehicles || []).map(v => <VehicleCard key={v.vehicle_id} vehicle={v}/>)}</div>
              </div>
            </div>
          </section>
          <section className="grid gap-3 lg:grid-cols-4">
            <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/exceptions', params: { convoy_id } })} className="rounded-2xl border border-red-400/15 bg-red-400/[.04] p-4 text-left hover:border-red-400/30"><AlertTriangle size={15} className="text-red-300"/><p className="mt-3 text-sm font-semibold text-white">Exceptions</p><p className="mt-1 text-[10px] text-white/30">Review real shipment alerts.</p></button>
            <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/security', params: { convoy_id } })} className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[.03] p-4 text-left hover:border-emerald-400/25"><ShieldCheck size={15} className="text-emerald-300"/><p className="mt-3 text-sm font-semibold text-white">Security posture</p><p className="mt-1 text-[10px] text-white/30">Customer-safe security state.</p></button>
            <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/custody', params: { convoy_id } })} className="rounded-2xl border border-white/[.07] bg-white/[.018] p-4 text-left hover:border-orange-400/25"><Clock3 size={15} className="text-orange-300"/><p className="mt-3 text-sm font-semibold text-white">Custody ledger</p><p className="mt-1 text-[10px] text-white/30">Verified chain-of-custody events.</p></button>
            <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/documents', params: { convoy_id } })} className="rounded-2xl border border-white/[.07] bg-white/[.018] p-4 text-left hover:border-sky-400/25"><div className="h-[15px] w-[15px] rounded border border-sky-300/50 text-[8px] text-sky-300 flex items-center justify-center">DOC</div><p className="mt-3 text-sm font-semibold text-white">Evidence vault</p><p className="mt-1 text-[10px] text-white/30">Documents and delivery evidence.</p></button>
          </section>
        </main>
        {fullscreen && <div className="fixed inset-0 z-[120] bg-black/90 p-3"><LiveMap points={displayedPoints} trail={trail} onFullscreen={() => setFullscreen(false)} /></div>}
      </div>
    </PortalShell>
  );
}
