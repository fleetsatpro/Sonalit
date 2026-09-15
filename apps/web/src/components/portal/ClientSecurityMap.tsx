import React, { useEffect, useMemo, useRef, useState } from 'react';
import Map, { Marker, NavigationControl, Source, Layer, type MapRef } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Activity, Maximize2, MapPin, Truck } from 'lucide-react';

const API = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

type Vehicle = {
  vehicle_id: string;
  registration: string;
  current_lat: number | null;
  current_lng: number | null;
  speed_kmh: number | null;
  heading_deg: number | null;
  last_ping_at: string | null;
  carries_my_cargo: boolean;
};

type ReplayPoint = {
  lat: number;
  lng: number;
  timestamp: string;
  speed: number | null;
  vehicle_id: string;
};

function age(iso: string | null): string {
  if (!iso) return 'NO FIX';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 'NO FIX';
  const sec = Math.max(0, Math.round(ms / 1000));
  return sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.floor(sec / 60)}m` : `${Math.floor(sec / 3600)}h`;
}

function isValidPosition(lat: number | null, lng: number | null): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat as number) <= 90 && Math.abs(lng as number) <= 180;
}

export function ClientSecurityMap({ convoyId, alerting, onFullscreen }: { convoyId: string; alerting: boolean; onFullscreen?: () => void }): React.ReactElement {
  const ref = useRef<MapRef | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [replay, setReplay] = useState<ReplayPoint[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = React.useCallback(async () => {
    try {
      setError('');
      const [vRes, rRes] = await Promise.all([
        fetch(`${API}/portal/convoy/${encodeURIComponent(convoyId)}/vehicles`, { credentials: 'include' }),
        fetch(`${API}/portal/convoy/${encodeURIComponent(convoyId)}/replay`, { credentials: 'include' }),
      ]);
      if (vRes.status === 401 || rRes.status === 401) { setError('Session expired'); return; }
      if (!vRes.ok || !rRes.ok) throw new Error('Telemetry unavailable');
      const v = (await vRes.json()) as { data?: Vehicle[] };
      const r = (await rRes.json()) as { data?: ReplayPoint[] };
      setVehicles(Array.isArray(v.data) ? v.data : []);
      setReplay(Array.isArray(r.data) ? r.data : []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Telemetry unavailable'); }
  }, [convoyId]);

  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 15000); return () => window.clearInterval(timer); }, [load]);
  useEffect(() => { if (selected && !vehicles.some(v => v.vehicle_id === selected)) setSelected(null); }, [selected, vehicles]);

  const points = useMemo(() => vehicles.filter(v => isValidPosition(v.current_lat, v.current_lng)).map(v => ({ id: v.vehicle_id, lat: v.current_lat as number, lng: v.current_lng as number, label: v.registration, alerting: v.carries_my_cargo && alerting })), [vehicles, alerting]);
  const validReplay = useMemo(() => replay.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180 && p.vehicle_id), [replay]);

  // Never connect points belonging to different vehicles. A single LineString across
  // the whole replay would invent a route between the end of one truck's track and
  // the start of another truck's track.
  const replayTracks = useMemo(() => {
    const grouped = new globalThis.Map<string, ReplayPoint[]>();
    for (const point of validReplay) {
      const bucket = grouped.get(point.vehicle_id) ?? [];
      bucket.push(point);
      grouped.set(point.vehicle_id, bucket);
    }
    return Array.from(grouped.entries())
      .map(([vehicleId, points]) => ({ vehicleId, points: points.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()) }))
      .filter(track => track.points.length > 1);
  }, [validReplay]);

  const geo = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: replayTracks.map(track => ({
      type: 'Feature' as const,
      properties: { vehicle_id: track.vehicleId },
      geometry: { type: 'LineString' as const, coordinates: track.points.map(p => [p.lng, p.lat]) },
    })),
  }), [replayTracks]);

  const telemetryCoords = useMemo<[number, number][]>(() => [
    ...points.map(p => [p.lng, p.lat] as [number, number]),
    ...validReplay.map(p => [p.lng, p.lat] as [number, number]),
  ], [points, validReplay]);

  const fit = React.useCallback(() => {
    const map = ref.current;
    if (!map || !telemetryCoords.length) return;
    if (telemetryCoords.length === 1) { map.easeTo({ center: telemetryCoords[0], zoom: 11, duration: 500 }); return; }
    const lats = telemetryCoords.map(c => c[1]);
    const lngs = telemetryCoords.map(c => c[0]);
    map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 80, maxZoom: 11, duration: 650 });
  }, [telemetryCoords]);

  useEffect(() => { if (!telemetryCoords.length) return; const timer = window.setTimeout(fit, 150); return () => window.clearTimeout(timer); }, [fit, telemetryCoords.length]);

  const selectedVehicle = vehicles.find(v => v.vehicle_id === selected) ?? null;
  const firstTelemetryPoint = telemetryCoords[0] ?? null;

  if (!firstTelemetryPoint) return <div className="relative flex h-[360px] items-center justify-center overflow-hidden rounded-2xl border border-white/[.08] bg-[#06101a]"><div className="flex items-center gap-2 text-[10px] text-white/35"><Activity size={14} />{error || 'No telemetry available'}</div></div>;

  return <div className="relative overflow-hidden rounded-2xl border border-white/[.08] bg-[#06101a]" style={{ height: 360 }}>
    <Map ref={ref} initialViewState={{ longitude: firstTelemetryPoint[0], latitude: firstTelemetryPoint[1], zoom: 7 }} mapStyle={MAP_STYLE} style={{ width: '100%', height: '100%' }} attributionControl onLoad={fit}>
      <NavigationControl position="bottom-right" showCompass showZoom />
      {replayTracks.length > 0 && <Source id="security-replay" type="geojson" data={geo}><Layer id="security-replay-line" type="line" paint={{ 'line-color': '#f97316', 'line-width': 4, 'line-opacity': 0.82, 'line-dasharray': [1.2, 1] }} /></Source>}
      {points.map(p => <Marker key={p.id} longitude={p.lng} latitude={p.lat} anchor="center"><button type="button" title={p.label} aria-label={`Select ${p.label}`} onClick={() => setSelected(p.id)} className={`flex h-10 w-10 items-center justify-center rounded-full border-2 bg-[#08131e] shadow-[0_0_0_6px_rgba(249,115,22,.08)] transition hover:scale-110 ${selected === p.id ? 'border-white bg-orange-500 text-white' : p.alerting ? 'border-red-300/80 text-red-300' : 'border-orange-300/70 text-orange-300'}`}><Truck size={15}/></button></Marker>)}
    </Map>
    <div className="absolute left-3 top-3 rounded-lg border border-white/10 bg-[#071019]/90 px-2.5 py-1.5 backdrop-blur-md"><div className="flex items-center gap-2"><span className={`h-1.5 w-1.5 rounded-full ${points.length ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} /><span className="text-[9px] font-bold uppercase tracking-[.16em] text-white/70">Security</span><span className="font-mono text-[9px] text-white/25">{points.length} positioned</span></div></div>
    <div className="absolute right-3 top-3 flex gap-2"><button type="button" aria-label="Fit telemetry" onClick={fit} disabled={!telemetryCoords.length} className="rounded-lg border border-white/10 bg-[#071019]/90 p-2 text-white/45 disabled:opacity-30 hover:text-white/80"><MapPin size={14}/></button>{onFullscreen && <button type="button" aria-label="Fullscreen map" onClick={onFullscreen} className="rounded-lg border border-white/10 bg-[#071019]/90 p-2 text-white/45 hover:text-white/80"><Maximize2 size={14}/></button>}</div>
    {selectedVehicle && <div className="absolute bottom-3 right-3 w-[230px] rounded-xl border border-white/10 bg-[#071019]/95 p-3 backdrop-blur-md"><div className="flex items-center justify-between gap-3"><span className="truncate font-mono text-[11px] text-white/80">{selectedVehicle.registration || 'Vehicle'}</span><span className={`shrink-0 font-mono text-[9px] ${selectedVehicle.last_ping_at && age(selectedVehicle.last_ping_at).endsWith('s') ? 'text-emerald-300' : 'text-white/30'}`}>{age(selectedVehicle.last_ping_at)}</span></div><div className="mt-2 grid grid-cols-2 gap-2 text-[9px] text-white/40"><span>{selectedVehicle.speed_kmh == null ? 'Speed —' : `${Math.round(selectedVehicle.speed_kmh)} km/h`}</span><span>{selectedVehicle.heading_deg == null ? 'Heading —' : `${Math.round(selectedVehicle.heading_deg)}°`}</span></div></div>}
  </div>;
}
