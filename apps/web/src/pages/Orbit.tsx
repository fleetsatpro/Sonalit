import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Search, Mic, X, Settings, Home, LayoutDashboard, ShieldAlert, Truck, Briefcase, type LucideIcon } from 'lucide-react';
import { api } from '../lib/api.js';
import { useDashboardStore, type DashboardOverview, type PanicEvent } from '../stores/dashboardStore.js';
import { NAV_GROUPS } from '../components/layout/Rail.js';
import {
  trafficTransformRequest, addTrafficLayers, setTrafficLayersVisible, setTrafficIncidents,
  bboxFromMap, useTrafficIncidents, useTrafficStatus,
} from '../lib/trafficLayer.js';
import '../styles/orbit.css';

// ── Orbit: the immersive homepage. A real MapLibre globe carrying every map
// the platform owns (satellite/street, traffic, risk zones, geofences, devices,
// convoys). It auto-cycles emphasis modes, slowly spins when idle, and flies
// in to zoom on a live panic. The app is segmented into four domain folders
// floating over it.

const GROUP_COVER: Record<string, LucideIcon> = {
  Command: LayoutDashboard, Security: ShieldAlert, Fleet: Truck, Business: Briefcase,
};

interface MapConvoy { id: string; name: string; status: string; lat: number | null; lng: number | null; heading?: number }
interface MapVehicle { id: string; registration: string; lat: number; lng: number; status: string; speed_kmh?: number }
interface MapDevice { id: string; name: string; status: string; lat: number; lng: number; panic_active?: boolean }
interface MapGeofence { id: string; name: string; type: string; lat: number | null; lng: number | null; radius_m: number; path?: [number, number][] | null }
interface MapRiskZone { id: string; name: string; risk_level: string; lat: number; lng: number; radius_km: number }
interface AlertZone { lat: number; lng: number; radius_m: number; severity: string }
interface MapData { convoys?: MapConvoy[]; alert_zones?: AlertZone[]; vehicles?: MapVehicle[]; devices?: MapDevice[]; geofences?: MapGeofence[]; riskzones?: MapRiskZone[] }

const EA_CENTER: [number, number] = [37, 3];
const EA_ZOOM = 2.7;

function geoCircle(lat: number, lng: number, radiusKm: number, steps = 48): [number, number][] {
  const R = 6371, pts: [number, number][] = [], cosLat = Math.cos(lat * Math.PI / 180);
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    pts.push([lng + (radiusKm / R) * (180 / Math.PI) * Math.sin(a) / cosLat, lat + (radiusKm / R) * (180 / Math.PI) * Math.cos(a)]);
  }
  return pts;
}

const STATUS_COLOR: maplibregl.ExpressionSpecification = [
  'match', ['get', 'status'],
  'panic', '#ff1e1e', 'alert', '#ff4422', 'sos', '#ff1e1e', 'warn', '#ff9040',
  'moving', '#22c55e', 'on_mission', '#37e6ff', 'available', '#22e39a',
  'idle', '#888888', 'offline', '#444444', '#6aa0d0',
];

const INITIAL_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    sat: { type: 'raster', tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: '© Esri, Maxar' },
    'sat-ref': { type: 'raster', tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: '© Esri' },
    osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap' },
  },
  layers: [
    { id: 'sat-tiles', type: 'raster', source: 'sat', paint: { 'raster-opacity': 1 } },
    { id: 'sat-ref-tiles', type: 'raster', source: 'sat-ref', paint: { 'raster-opacity': 0.85 } },
    { id: 'osm-base', type: 'raster', source: 'osm', layout: { visibility: 'none' }, paint: { 'raster-opacity': 1 } },
  ],
};

function setupLayers(map: maplibregl.Map) {
  const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  (['sv-vehicles', 'sv-devices', 'sv-geofences', 'sv-risk', 'sv-alerts', 'sv-convoys'] as const)
    .forEach(s => map.addSource(s, { type: 'geojson', data: empty }));

  const riskColor: maplibregl.ExpressionSpecification = ['case', ['==', ['get', 'risk_level'], 'critical'], '#ff2200', ['==', ['get', 'risk_level'], 'high'], '#ff6600', '#ffaa00'];
  map.addLayer({ id: 'sv-risk-fill', type: 'fill', source: 'sv-risk', paint: { 'fill-color': riskColor, 'fill-opacity': 0.08 } });
  map.addLayer({ id: 'sv-risk-line', type: 'line', source: 'sv-risk', paint: { 'line-color': riskColor, 'line-width': 1, 'line-opacity': 0.5, 'line-dasharray': [4, 4] } });
  map.addLayer({ id: 'sv-alerts-fill', type: 'fill', source: 'sv-alerts', paint: { 'fill-color': '#ff4422', 'fill-opacity': 0.12 } });
  map.addLayer({ id: 'sv-alerts-line', type: 'line', source: 'sv-alerts', paint: { 'line-color': '#ff4422', 'line-width': 1.5, 'line-opacity': 0.6 } });
  map.addLayer({ id: 'sv-geofences-fill', type: 'fill', source: 'sv-geofences', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#37e6ff', 'fill-opacity': 0.12 } });
  map.addLayer({ id: 'sv-geofences-line', type: 'line', source: 'sv-geofences', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': '#37e6ff', 'line-width': 1.8, 'line-opacity': 0.85, 'line-dasharray': [6, 3] } });
  map.addLayer({ id: 'sv-geofences-corridor', type: 'line', source: 'sv-geofences', filter: ['==', ['geometry-type'], 'LineString'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#38bdf8', 'line-width': 3, 'line-opacity': 0.9, 'line-dasharray': [4, 2] } });
  map.addLayer({ id: 'sv-convoys-line', type: 'line', source: 'sv-convoys', paint: { 'line-color': '#ffb23e', 'line-width': 2, 'line-opacity': 0.8 } });
  map.addLayer({ id: 'sv-vehicles-glow', type: 'circle', source: 'sv-vehicles', paint: { 'circle-radius': 13, 'circle-color': STATUS_COLOR, 'circle-opacity': 0.18, 'circle-blur': 1 } });
  map.addLayer({ id: 'sv-vehicles-dot', type: 'circle', source: 'sv-vehicles', paint: { 'circle-radius': 6, 'circle-color': STATUS_COLOR, 'circle-stroke-width': 2, 'circle-stroke-color': '#000', 'circle-opacity': 0.95 } });
  map.addLayer({ id: 'sv-devices-glow', type: 'circle', source: 'sv-devices', paint: { 'circle-radius': ['case', ['==', ['get', 'status'], 'sos'], 22, 9], 'circle-color': STATUS_COLOR, 'circle-opacity': ['case', ['==', ['get', 'status'], 'sos'], 0.4, 0.16], 'circle-blur': 1 } });
  map.addLayer({ id: 'sv-devices-dot', type: 'circle', source: 'sv-devices', paint: { 'circle-radius': 5, 'circle-color': STATUS_COLOR, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff', 'circle-opacity': 0.95 } });
}

function updateData(map: maplibregl.Map, d: MapData) {
  const set = (n: string, fc: GeoJSON.FeatureCollection) => (map.getSource(n) as maplibregl.GeoJSONSource | undefined)?.setData(fc);
  set('sv-vehicles', { type: 'FeatureCollection', features: (d.vehicles ?? []).filter(v => v.lat != null && v.lng != null).map(v => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [v.lng, v.lat] }, properties: { registration: v.registration, status: v.status } })) });
  set('sv-devices', { type: 'FeatureCollection', features: (d.devices ?? []).filter(v => v.lat != null && v.lng != null).map(v => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [v.lng, v.lat] }, properties: { name: v.name, status: v.status } })) });
  set('sv-convoys', { type: 'FeatureCollection', features: (d.convoys ?? []).filter(c => c.lat != null && c.lng != null).map(c => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[c.lng!, c.lat!], EA_CENTER] }, properties: { name: c.name } })) });
  set('sv-geofences', {
    type: 'FeatureCollection',
    features: (d.geofences ?? []).reduce<GeoJSON.Feature[]>((acc, g) => {
      if ((g.type === 'corridor' || g.type === 'linear') && Array.isArray(g.path) && g.path.length >= 2) {
        acc.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: g.path.map(([lat, lng]) => [lng ?? 0, lat ?? 0] as [number, number]) }, properties: { name: g.name } });
      } else if (g.lat != null && g.lng != null) {
        acc.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [geoCircle(g.lat, g.lng, g.radius_m / 1000)] }, properties: { name: g.name } });
      }
      return acc;
    }, []),
  });
  set('sv-risk', { type: 'FeatureCollection', features: (d.riskzones ?? []).map(r => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [geoCircle(r.lat, r.lng, r.radius_km)] }, properties: { name: r.name, risk_level: r.risk_level } })) });
  set('sv-alerts', { type: 'FeatureCollection', features: (d.alert_zones ?? []).map(z => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [geoCircle(z.lat, z.lng, z.radius_m / 1000)] }, properties: { severity: z.severity } })) });
}

// Emphasis modes cycled automatically. Each tweaks layer opacity / the base
// so the operator sees the platform's maps rotate through on their own.
type ModeKey = 'SATELLITE' | 'RISK INTEL' | 'FLEET' | 'GEOFENCES' | 'STREET' | 'TRAFFIC';
interface Mode { key: ModeKey; color: string }
const BASE_MODES: Mode[] = [
  { key: 'SATELLITE', color: '#37e6ff' },
  { key: 'RISK INTEL', color: '#ff3b5c' },
  { key: 'FLEET', color: '#22e39a' },
  { key: 'GEOFENCES', color: '#38bdf8' },
  { key: 'STREET', color: '#ffb23e' },
];
function setP(map: maplibregl.Map, id: string, prop: string, val: unknown) {
  if (map.getLayer(id)) { try { map.setPaintProperty(id, prop, val as never); } catch { /* layer not ready */ } }
}
function setVis(map: maplibregl.Map, id: string, v: boolean) {
  if (map.getLayer(id)) { try { map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none'); } catch { /* noop */ } }
}
function applyMode(map: maplibregl.Map, key: ModeKey) {
  const street = key === 'STREET' || key === 'TRAFFIC';
  setVis(map, 'osm-base', street);
  setP(map, 'osm-base', 'raster-opacity', street ? 1 : 0);
  const risk = key === 'RISK INTEL';
  setP(map, 'sv-risk-fill', 'fill-opacity', risk ? 0.28 : 0.08);
  setP(map, 'sv-risk-line', 'line-opacity', risk ? 0.9 : 0.5);
  setP(map, 'sv-risk-line', 'line-width', risk ? 2.2 : 1);
  const fleet = key === 'FLEET';
  setP(map, 'sv-vehicles-glow', 'circle-opacity', fleet ? 0.3 : 0.18);
  setP(map, 'sv-vehicles-dot', 'circle-radius', fleet ? 8 : 6);
  setP(map, 'sv-devices-dot', 'circle-radius', fleet ? 6.5 : 5);
  const geo = key === 'GEOFENCES';
  setP(map, 'sv-geofences-fill', 'fill-opacity', geo ? 0.26 : 0.12);
  setP(map, 'sv-geofences-line', 'line-width', geo ? 3 : 1.8);
  setTrafficLayersVisible(map, key === 'TRAFFIC');
}

function useClock(): string {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id); }, []);
  return [t.getHours(), t.getMinutes(), t.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
}

export default function Orbit() {
  const nav = useNavigate();
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const dataRef = useRef<MapData | null>(null);
  const idleRef = useRef(true);           // spinning + cycling when true
  const flyingRef = useRef(false);
  const lastPanicId = useRef<string | null>(null);
  const clock = useClock();

  const { setOverview } = useDashboardStore.getState();
  const overview = useDashboardStore(s => s.overview);
  const panic = useDashboardStore(s => s.panicState);
  const panicActive = panic?.status === 'active';

  const [mode, setMode] = useState<Mode>(BASE_MODES[0]!);
  const [banner, setBanner] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [bbox, setBbox] = useState<string | null>(null);

  const { data: trafficStatus } = useTrafficStatus();
  const { data: trafficFC } = useTrafficIncidents(bbox, mode.key === 'TRAFFIC');
  const modes = useMemo<Mode[]>(() => trafficStatus?.configured ? [...BASE_MODES, { key: 'TRAFFIC', color: '#ff9040' }] : BASE_MODES, [trafficStatus]);

  useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: async () => { try { const r = await api.get<DashboardOverview>('/dashboard/overview'); setOverview(r.data); return r.data; } catch { return null; } },
    staleTime: 30000, refetchInterval: 60000,
  });
  useQuery({
    queryKey: ['dashboard-map'],
    queryFn: async () => {
      try { const r = await api.get<MapData>('/dashboard/map'); dataRef.current = r.data; if (readyRef.current && mapRef.current) updateData(mapRef.current, r.data); return r.data; }
      catch { return null; }
    },
    staleTime: 30000, refetchInterval: 45000,
  });

  // ── build the map once ────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const reduce = matchMedia('(prefers-reduced-motion:reduce)').matches;
    const map = new maplibregl.Map({
      container: mapEl.current, style: INITIAL_STYLE, center: EA_CENTER, zoom: EA_ZOOM,
      attributionControl: false, transformRequest: trafficTransformRequest, dragRotate: false,
    });
    mapRef.current = map;
    map.on('error', () => {});
    const pause = () => { idleRef.current = false; };
    map.on('mousedown', pause); map.on('touchstart', pause); map.on('wheel', pause);
    map.on('moveend', () => setBbox(bboxFromMap(map)));

    map.on('load', () => {
      try { map.setProjection({ type: 'globe' }); } catch { /* flat fallback */ }
      setupLayers(map);
      addTrafficLayers(map, false);
      applyMode(map, BASE_MODES[0]!.key);
      readyRef.current = true;
      if (dataRef.current) updateData(map, dataRef.current);
      setBbox(bboxFromMap(map));
      // Container size can settle a tick after load; force a resize so the
      // globe fills the pane instead of MapLibre's fallback height.
      map.resize();
      setTimeout(() => map.resize(), 120);
    });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => map.resize()) : null;
    if (ro && mapEl.current) ro.observe(mapEl.current);

    // idle spin
    let raf = 0;
    const spin = () => {
      if (!reduce && idleRef.current && !flyingRef.current && readyRef.current) {
        const c = map.getCenter();
        map.setCenter([c.lng + 0.035, c.lat]);
      }
      raf = requestAnimationFrame(spin);
    };
    raf = requestAnimationFrame(spin);

    // auto-cycle modes
    let mi = 0;
    const cycle = setInterval(() => {
      if (!idleRef.current || flyingRef.current || !readyRef.current) return;
      mi = (mi + 1) % modesRef.current.length;
      const m = modesRef.current[mi]!;
      applyMode(map, m.key);
      setMode(m);
    }, 9000);

    return () => { cancelAnimationFrame(raf); clearInterval(cycle); ro?.disconnect(); map.remove(); mapRef.current = null; readyRef.current = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // keep the cycle's mode list current without rebuilding the map
  const modesRef = useRef(modes); modesRef.current = modes;

  // feed traffic incidents when in traffic mode
  useEffect(() => { const m = mapRef.current; if (m && readyRef.current && trafficFC) setTrafficIncidents(m, trafficFC); }, [trafficFC]);

  // ── fly in to zoom on a live panic, then return ───────────────────────────
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !readyRef.current) return;
    if (panicActive && panic && panic.id !== lastPanicId.current && panic.lat != null && panic.lng != null) {
      lastPanicId.current = panic.id;
      idleRef.current = false; flyingRef.current = true;
      setMode({ key: 'RISK INTEL', color: '#ff3b5c' }); applyMode(m, 'RISK INTEL');
      setBanner(`PANIC · ${(panic as PanicEvent).vehicle_id ?? 'device'} — zooming in`);
      m.flyTo({ center: [panic.lng, panic.lat], zoom: 8.5, speed: 0.7, curve: 1.5, essential: true });
      const t = setTimeout(() => {
        flyingRef.current = false; setBanner(null);
        m.flyTo({ center: EA_CENTER, zoom: EA_ZOOM, speed: 0.5, essential: true });
        setTimeout(() => { idleRef.current = true; }, 4000);
      }, 14000);
      return () => clearTimeout(t);
    }
    if (!panicActive) lastPanicId.current = null;
    return;
  }, [panicActive, panic]);

  const kpi = overview?.kpi;
  const glances = [
    { l: 'Vehicles', v: kpi?.vehicles_live ?? '—', d: 'live', c: 'var(--o-cyan)' },
    { l: 'Convoys', v: kpi?.convoys_active ?? '—', d: 'active', c: 'var(--o-green)' },
    { l: 'On-time', v: kpi?.on_time_pct != null ? `${kpi.on_time_pct}%` : '—', d: '30-day', c: 'var(--o-amber)' },
    { l: 'Guards', v: kpi?.guards_active ?? '—', d: 'on shift', c: 'var(--o-violet)' },
  ];
  const badges: Record<string, { kind: string; text: string } | null> = {
    Command: panicActive ? { kind: 'crit', text: '1' } : null,
    Security: overview?.threat.alerts_open ? { kind: 'crit', text: String(overview.threat.alerts_open) } : null,
    Fleet: kpi?.convoys_active ? { kind: 'count', text: String(kpi.convoys_active) } : null,
    Business: null,
  };

  const jump = useMemo(() => NAV_GROUPS.flatMap(g => g.items.map(i => ({ ...i, hue: g.hue, group: g.label }))), []);
  const matches = useMemo(() => {
    const n = q.trim().toLowerCase(); if (!n) return [];
    return jump.filter(i => i.label.toLowerCase().includes(n) || i.group.toLowerCase().includes(n)).slice(0, 6);
  }, [q, jump]);

  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenGroup(null); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, []);
  const go = (path: string) => { setOpenGroup(null); nav({ to: path }); };

  return (
    <div className="orbit orbit--map">
      <div ref={mapEl} className="o-map" />
      <div className="o-mapshade" />

      {/* top bar */}
      <div className="o-top">
        <div className="o-brand"><div className="o-avatar">AU</div><div><b>SONALIT</b><br /><span>Northern Corridor · Ops</span></div></div>
        <div className="o-spacer" />
        <div className="o-clockwrap"><div className="o-clock">{clock}</div><div className="o-live"><i />LIVE · ALL SYSTEMS NOMINAL</div></div>
        <div className="o-spacer" />
        <div className={`o-chip ${overview?.threat.level ?? 'secure'}`}><span className="o-dot" />THREAT {(overview?.threat.level ?? 'secure').toUpperCase()}</div>
        <button className="o-iconbtn" title="Settings" onClick={() => nav({ to: '/settings' })}><Settings size={17} /></button>
      </div>

      {/* live layer-mode HUD */}
      <div className="o-modehud" style={{ '--mc': mode.color } as CSSProperties}>
        <span className="o-modedot" /><b>{mode.key}</b><span>· live composite</span>
      </div>

      {/* panic fly-to banner */}
      {banner && <div className="o-flybanner">⚠ {banner}</div>}

      {/* floating deck */}
      <div className="o-float">
        <div className="o-glance">
          {glances.map(g => (
            <div key={g.l} className="o-pod" style={{ '--c': g.c } as CSSProperties}>
              <div className="o-pl">{g.l}</div><div className="o-pv">{g.v}</div><div className="o-pd">{g.d}</div>
            </div>
          ))}
        </div>
        <div className="o-launch">
          <div className="o-lh"><b>Mission apps</b><span>· tap a folder to open its apps</span></div>
          <div className="o-groups">
            {NAV_GROUPS.map((gr, gi) => {
              const Cover = GROUP_COVER[gr.label] ?? LayoutDashboard;
              const b = badges[gr.label];
              return (
                <button key={gr.label} className="o-grp" style={{ '--gc': `rgb(${gr.hue})` } as CSSProperties} onClick={() => setOpenGroup(gi)}>
                  {b && <span className={`o-badge ${b.kind}`}>{b.text}</span>}
                  <span className="o-folder"><Cover size={30} /></span>
                  <h3>{gr.label}</h3><p>{gr.items.length} apps</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* command bar */}
      <div className="o-cmdwrap">
        <div className="o-cmd">
          <Search size={18} />
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && matches[0]) go(matches[0].path); }} placeholder="Search a vehicle, jump to an app, or run a command…" aria-label="Command bar" />
          <span className="o-kbd">⌘K</span>
          <Mic size={18} className="o-mic" />
          {matches.length > 0 && (
            <div className="o-results">
              {matches.map(m => (
                <button key={m.path} className="o-result" onMouseDown={e => { e.preventDefault(); go(m.path); }}>
                  <span className="o-rdot" style={{ background: `rgb(${m.hue})` }} />{m.label}<span className="o-rgrp">{m.group}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* folder overlay */}
      {openGroup != null && (() => {
        const gr = NAV_GROUPS[openGroup]!;
        const Cover = GROUP_COVER[gr.label] ?? LayoutDashboard;
        return (
          <div className="o-scrim" onClick={e => { if (e.target === e.currentTarget) setOpenGroup(null); }}>
            <div className="o-folderpanel" style={{ '--gc': `rgb(${gr.hue})` } as CSSProperties}>
              <div className="o-fp-head">
                <span className="o-fi"><Cover size={22} /></span>
                <div><h2>{gr.label}</h2><div className="o-fsub">{gr.items.length} apps</div></div>
                <button className="o-x" onClick={() => setOpenGroup(null)} aria-label="Close"><X size={18} /></button>
              </div>
              <div className="o-apps">
                {gr.items.map(it => { const Icon = it.icon; return (
                  <button key={it.path} className="o-app" style={{ '--gc': `rgb(${gr.hue})` } as CSSProperties} onClick={() => go(it.path)}>
                    <span className="o-aic"><Icon size={22} /></span><span className="o-atl">{it.label}</span>
                  </button>
                ); })}
              </div>
            </div>
          </div>
        );
      })()}

      {/* Home button (bottom-left) */}
      <button className="o-homebtn" onClick={() => nav({ to: '/gps' })} title="Open full GPS Live"><Home size={15} /> GPS LIVE</button>
    </div>
  );
}
