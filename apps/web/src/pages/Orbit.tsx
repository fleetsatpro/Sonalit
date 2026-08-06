import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Search, Mic, X, Settings, Home, LayoutDashboard, ShieldAlert, Truck, Briefcase, Activity, ChevronRight, Play, ShieldCheck, Radio, MapPin, Camera, Ship, type LucideIcon } from 'lucide-react';
import { api } from '../lib/api.js';
import { useDashboardStore, type DashboardOverview } from '../stores/dashboardStore.js';
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
  Command: LayoutDashboard, Security: ShieldAlert, Surveillance: Camera, Fleet: Truck, Business: Briefcase, 'Container Management': Ship,
};

interface MapConvoy { id: string; name: string; status: string; lat: number | null; lng: number | null; heading?: number }
interface MapVehicle { id: string; registration: string; lat: number; lng: number; status: string; speed_kmh?: number }
interface MapDevice { id: string; name: string; status: string; lat: number; lng: number; panic_active?: boolean; speed_kmh?: number; last_seen?: string | null; model?: string }
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
  set('sv-vehicles', { type: 'FeatureCollection', features: (d.vehicles ?? []).filter(v => v.lat != null && v.lng != null).map(v => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [v.lng, v.lat] }, properties: { registration: v.registration, status: v.status, speed_kmh: v.speed_kmh ?? 0 } })) });
  set('sv-devices', { type: 'FeatureCollection', features: (d.devices ?? []).filter(v => v.lat != null && v.lng != null).map(v => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [v.lng, v.lat] }, properties: { name: v.name, status: v.status, speed_kmh: v.speed_kmh ?? 0, last_seen: v.last_seen ?? '', model: v.model ?? '' } })) });
  set('sv-convoys', { type: 'FeatureCollection', features: (d.convoys ?? []).filter(c => c.lat != null && c.lng != null).map(c => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[c.lng!, c.lat!], EA_CENTER] }, properties: { name: c.name, status: c.status } })) });
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

function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ── inspect-popup + priority-rail plumbing ──────────────────────────────────
// Marker layers a click can land on. A single map click handler hit-tests
// against these (order = pick priority) so tapping a vehicle/device/convoy/
// risk zone opens its inspect card; a miss closes any open card.
const PICK_LAYERS = ['sv-vehicles-dot', 'sv-devices-dot', 'sv-convoys-line', 'sv-risk-fill'];
// "Live" means the last few minutes; older items drop to the History tab so the
// live feed stays a live feed instead of an ever-growing scrollback.
const LIVE_WINDOW_MS = 15 * 60_000;
// A 0-sample WAV. Browsers refuse audio.play() until a media element has been
// unlocked by a user gesture; playing this on the first interaction primes the
// shared element so a voice note that lands later can auto-play on its own.
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
const STATUS_LABEL: Record<string, string> = {
  moving: 'Moving', idle: 'Idle', offline: 'Offline', panic: 'PANIC', sos: 'SOS',
  alert: 'Alert', warn: 'Warning', on_mission: 'On mission', available: 'Available', active: 'Active',
};
function statusLabel(s: unknown): string { const k = String(s ?? ''); return STATUS_LABEL[k] ?? (k ? k[0]!.toUpperCase() + k.slice(1) : '—'); }
// Compact subset of the Panic Center reason codes for the on-globe resolve —
// the full list (with notes) still lives in Panic Center for the paper trail.
const SOS_REASONS: Array<{ value: string; label: string }> = [
  { value: 'resolved_safe', label: 'Safe' },
  { value: 'false_alarm', label: 'False alarm' },
  { value: 'escalated_to_authorities', label: 'Escalated' },
];

interface RecentVoice { id: string; device_id: string; device_name: string; duration_ms: number | null; created_at: string; lat: number | null; lng: number | null }
interface InspectRow { k: string; v: string }
interface Inspect { kind: string; kindLabel: string; title: string; rows: InspectRow[]; gpsPath: string | null; lng: number; lat: number }
interface RailRow { id: string; kind: 'alert' | 'feed' | 'voice' | 'capture'; severity: string; title: string; sub?: string; at: string; voice?: { deviceId: string; voiceId: string; durationMs: number | null }; imageUrl?: string }

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
  const lastVoiceId = useRef<string | null>(null);
  const voicePollInit = useRef(false);
  const voiceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceMarkerRef = useRef<maplibregl.Marker | null>(null);
  const clock = useClock();

  const { setOverview, acknowledgePanicState, updatePanicState, setVoiceNoteAlert } = useDashboardStore.getState();
  const overview = useDashboardStore(s => s.overview);
  const panic = useDashboardStore(s => s.panicState);
  const alerts = useDashboardStore(s => s.alerts);
  const feedItems = useDashboardStore(s => s.feedItems);
  const voiceNoteAlert = useDashboardStore(s => s.voiceNoteAlert);
  const panicActive = panic?.status === 'active';

  const [mode, setMode] = useState<Mode>(BASE_MODES[0]!);
  const [sos, setSos] = useState<{ label: string; short: string | null; lat: number; lng: number; at: string } | null>(null);
  const [voiceLoc, setVoiceLoc] = useState<{ name: string; short: string | null; lat: number; lng: number; at: string; voiceId: string; deviceId: string } | null>(null);
  const [openGroup, setOpenGroup] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const [bbox, setBbox] = useState<string | null>(null);

  // #1 — act on a panic from the SOS card without leaving the globe
  const [resolving, setResolving] = useState(false);
  const ackMut = useMutation({
    mutationFn: (id: string) => api.patch(`/guardian/panic/${id}/ack`, {}),
    onSuccess: (_r, id) => acknowledgePanicState(id, new Date().toISOString(), null),
  });
  const resolveMut = useMutation({
    mutationFn: (v: { id: string; reason: string }) => api.patch(`/guardian/panic/${v.id}/resolve`, { reason_code: v.reason }),
    onSuccess: (_r, v) => { updatePanicState({ id: v.id, status: 'resolved', triggered_at: panic?.triggered_at ?? new Date().toISOString() }); setResolving(false); },
  });

  // #2 — inspect popup for a clicked marker (React overlay projected onto the globe)
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [inspectPos, setInspectPos] = useState<{ x: number; y: number } | null>(null);
  const pickRef = useRef<(layerId: string, props: Record<string, unknown>, lng: number, lat: number) => void>(() => {});
  const closeInspectRef = useRef<() => void>(() => {});

  // #3 — live priority rail
  const [railOpen, setRailOpen] = useState<boolean>(() => {
    try { const saved = localStorage.getItem('orbit-rail'); if (saved != null) return saved !== '0'; } catch { /* private mode */ }
    return typeof window !== 'undefined' ? window.innerWidth > 680 : true; // default closed on phones so it doesn't cover the deck
  });
  useEffect(() => { try { localStorage.setItem('orbit-rail', railOpen ? '1' : '0'); } catch { /* private mode */ } }, [railOpen]);
  const [railTab, setRailTab] = useState<'live' | 'history'>('live');
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [voiceBlocked, setVoiceBlocked] = useState(false); // autoplay gated → invite a tap
  const voicePlayerRef = useRef<HTMLAudioElement | null>(null);
  const audioUnlocked = useRef(false);
  const playVoice = async (deviceId: string, voiceId: string) => {
    let url: string | null = null;
    try {
      const res = await api.get(`/guardian/devices/${deviceId}/voice-messages/${voiceId}/audio`, { responseType: 'blob' });
      url = URL.createObjectURL(res.data as Blob);
      if (!voicePlayerRef.current) voicePlayerRef.current = new Audio();
      const p = voicePlayerRef.current;
      const objUrl = url;
      p.src = url;
      p.muted = false;
      p.volume = 1; // play field-officer notes at full volume — they can be urgent
      p.onended = () => { setPlayingVoice(null); URL.revokeObjectURL(objUrl); };
      await p.play();          // rejects when the browser's autoplay gate is closed
      setPlayingVoice(voiceId);
      setVoiceBlocked(false);
      return true;
    } catch {
      setPlayingVoice(null);
      setVoiceBlocked(true);   // most often the autoplay policy — the callout now says "TAP TO PLAY"
      if (url) URL.revokeObjectURL(url);
      return false;
    }
  };
  useEffect(() => () => voicePlayerRef.current?.pause(), []);

  // Unlock audio on the first user gesture so later voice notes can auto-play.
  useEffect(() => {
    const unlock = () => {
      if (audioUnlocked.current) return;
      audioUnlocked.current = true;
      if (!voicePlayerRef.current) voicePlayerRef.current = new Audio();
      const p = voicePlayerRef.current;
      try {
        p.muted = true; p.src = SILENT_WAV;
        void p.play().then(() => { p.pause(); p.currentTime = 0; p.muted = false; }).catch(() => { p.muted = false; });
      } catch { /* ignore */ }
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

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
  // Reliable backstop for voice notes: poll the org's recent from-device notes
  // so the feed keeps a history and a new note still auto-plays + zooms even if
  // the live websocket event was missed (tab unfocused / brief disconnect).
  const { data: recentVoice } = useQuery<RecentVoice[]>({
    queryKey: ['orbit-recent-voice'],
    queryFn: async () => { try { const r = await api.get<{ data: RecentVoice[] }>('/guardian/voice-messages/recent'); return r.data.data ?? []; } catch { return []; } },
    staleTime: 8000, refetchInterval: 12000,
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

      // Click-to-inspect: hit-test the marker layers; a hit opens that entity's
      // card, a miss closes whatever's open. Layer-specific handlers won't fire
      // for the empty-space case, so one global handler owns both.
      const pickLayers = () => PICK_LAYERS.filter(l => map.getLayer(l));
      map.on('click', (e) => {
        const hits = map.queryRenderedFeatures(e.point, { layers: pickLayers() });
        if (!hits.length) { closeInspectRef.current(); return; }
        const f = hits[0]!;
        let lng = e.lngLat.lng, lat = e.lngLat.lat;
        if (f.geometry.type === 'Point') { const c = f.geometry.coordinates as [number, number]; lng = c[0]; lat = c[1]; }
        pickRef.current(f.layer.id, (f.properties ?? {}) as Record<string, unknown>, lng, lat);
      });
      map.on('mousemove', (e) => {
        map.getCanvas().style.cursor = map.queryRenderedFeatures(e.point, { layers: pickLayers() }).length ? 'pointer' : '';
      });

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

  // ── lock the globe on a live panic until it's acknowledged or resolved ─────
  // "Action taken" = acknowledged or cleared. Until then the globe stays zoomed
  // in on the location with a persistent SOS card (reverse-geocoded address).
  const acknowledged = !!panic?.acknowledgedAt;
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !readyRef.current) return;
    const locked = panicActive && !acknowledged && !!panic && panic.lat != null && panic.lng != null;
    if (locked) {
      idleRef.current = false;
      if (panic!.id !== lastPanicId.current) {
        lastPanicId.current = panic!.id;
        flyingRef.current = true;
        setMode({ key: 'RISK INTEL', color: '#ff3b5c' }); applyMode(m, 'RISK INTEL');
        m.flyTo({ center: [panic!.lng!, panic!.lat!], zoom: 14.5, speed: 0.85, curve: 1.5, essential: true });
        m.once('moveend', () => { flyingRef.current = false; });
        setSos({ label: panic!.deviceName ?? panic!.vehicle_id ?? 'unassigned device', short: null, lat: panic!.lat!, lng: panic!.lng!, at: panic!.triggered_at });
        // Best-effort reverse geocode via the backend (browser CSP blocks geocoders).
        api.get<{ short: string | null; address: string | null }>(`/dashboard/reverse-geocode?lat=${panic!.lat}&lng=${panic!.lng}`)
          .then(r => setSos(s => (s && s.lat === panic!.lat ? { ...s, short: r.data.short ?? r.data.address } : s)))
          .catch(() => {});
      }
      return;
    }
    // acknowledged or resolved → release the lock, ease back to the overview
    if (lastPanicId.current) {
      lastPanicId.current = null; setSos(null);
      m.flyTo({ center: EA_CENTER, zoom: EA_ZOOM, speed: 0.5, essential: true });
      setTimeout(() => { idleRef.current = true; }, 3500);
    }
  }, [panicActive, acknowledged, panic]);

  // ── field-officer voice note: auto-play at full volume + fly to its exact spot
  // A live clip from the field is treated like a soft alert: it plays itself and
  // the globe swings to the precise send location (backend ships the device's
  // GPS fix on the note), holds with a reverse-geocoded callout, then eases back.
  // A live panic always wins — its siren and lock take priority, so we stand down.
  useEffect(() => {
    const a = voiceNoteAlert;
    if (!a || a.id === lastVoiceId.current) return;
    lastVoiceId.current = a.id;
    if (panicActive) return;

    void playVoice(a.deviceId, a.voiceId); // falls back to manual Play if autoplay is blocked

    const m = mapRef.current;
    if (!m || !readyRef.current || a.lat == null || a.lng == null) return;
    if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current);
    idleRef.current = false;
    flyingRef.current = true;
    // Drop to the street map and zoom to building level so the operator can read
    // the actual streets around the officer, with a pin planted on the spot.
    setMode({ key: 'STREET', color: '#ffb23e' }); applyMode(m, 'STREET');
    m.flyTo({ center: [a.lng, a.lat], zoom: 16.6, speed: 0.7, curve: 1.4, essential: true });
    m.once('moveend', () => { flyingRef.current = false; });
    setVoiceLoc({ name: a.deviceName, short: null, lat: a.lat, lng: a.lng, at: a.createdAt, voiceId: a.voiceId, deviceId: a.deviceId });
    api.get<{ short: string | null; address: string | null }>(`/dashboard/reverse-geocode?lat=${a.lat}&lng=${a.lng}`)
      .then(r => setVoiceLoc(s => (s && s.lat === a.lat ? { ...s, short: r.data.short ?? r.data.address } : s)))
      .catch(() => {});

    const hold = Math.min(20000, Math.max(10000, (a.durationMs ?? 0) + 4000));
    voiceTimerRef.current = setTimeout(() => {
      setVoiceLoc(null);
      if (!lastPanicId.current) { // don't undo a panic lock that engaged meanwhile
        mapRef.current?.flyTo({ center: EA_CENTER, zoom: EA_ZOOM, speed: 0.5, essential: true });
        idleRef.current = true;
      }
    }, hold);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceNoteAlert, panicActive]);
  useEffect(() => () => { if (voiceTimerRef.current) clearTimeout(voiceTimerRef.current); }, []);

  // Plant a pin on the exact spot while a voice note is on screen; its tip
  // points at the coordinate (anchor:'bottom') and it clears when the note does.
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    if (!voiceLoc) { voiceMarkerRef.current?.remove(); return; }
    if (!voiceMarkerRef.current) {
      const el = document.createElement('div');
      el.className = 'o-vpin';
      el.innerHTML = '<span class="o-vpin-pulse"></span><span class="o-vpin-body"></span>';
      voiceMarkerRef.current = new maplibregl.Marker({ element: el, anchor: 'bottom' });
    }
    voiceMarkerRef.current.setLngLat([voiceLoc.lng, voiceLoc.lat]).addTo(m);
  }, [voiceLoc]);
  useEffect(() => () => { voiceMarkerRef.current?.remove(); }, []);

  // Poll-driven new-note detection. On first result we adopt the newest note as
  // the baseline (no auto-play of history on load); after that, a newer note id
  // is pushed into the store, which drives the same auto-play + zoom + callout
  // path as the websocket event. `lastVoiceId` is the shared guard, so a note
  // already handled live is never replayed here.
  useEffect(() => {
    const list = recentVoice ?? [];
    if (list.length === 0) return;
    const newest = list[0]!;
    if (!voicePollInit.current) {
      voicePollInit.current = true;
      if (!lastVoiceId.current) lastVoiceId.current = newest.id;
      return;
    }
    if (newest.id === lastVoiceId.current) return;
    setVoiceNoteAlert({
      id: newest.id, deviceId: newest.device_id, deviceName: newest.device_name,
      voiceId: newest.id, durationMs: newest.duration_ms, createdAt: newest.created_at,
      lat: newest.lat, lng: newest.lng,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentVoice]);

  // Build the inspect card for whichever marker layer was clicked. Assigned
  // every render so it always closes over the latest nav/setters (the map's
  // own click handler is bound once and reaches it through this ref).
  pickRef.current = (layerId, props, lng, lat) => {
    setOpenGroup(null);
    const coord = { k: 'Position', v: `${lat.toFixed(4)}, ${lng.toFixed(4)}` };
    if (layerId === 'sv-vehicles-dot') {
      setInspect({ kind: 'vehicle', kindLabel: 'Vehicle', title: String(props['registration'] ?? 'Vehicle'), gpsPath: '/gps', lng, lat,
        rows: [{ k: 'Status', v: statusLabel(props['status']) }, { k: 'Speed', v: `${Math.round(Number(props['speed_kmh']) || 0)} km/h` }, coord] });
    } else if (layerId === 'sv-devices-dot') {
      const panicking = props['status'] === 'panic' || props['status'] === 'sos';
      const seen = props['last_seen'] ? String(props['last_seen']) : '';
      setInspect({ kind: panicking ? 'panic' : 'device', kindLabel: 'Guardian device', title: String(props['name'] ?? 'Device'), gpsPath: '/gps', lng, lat,
        rows: [{ k: 'Status', v: statusLabel(props['status']) }, { k: 'Speed', v: `${Math.round(Number(props['speed_kmh']) || 0)} km/h` }, { k: 'Last seen', v: seen ? relTime(seen) : '—' }, coord] });
    } else if (layerId === 'sv-convoys-line') {
      setInspect({ kind: 'convoy', kindLabel: 'Convoy', title: String(props['name'] ?? 'Convoy'), gpsPath: '/gps', lng, lat,
        rows: [{ k: 'Status', v: statusLabel(props['status'] ?? 'active') }, coord] });
    } else if (layerId === 'sv-risk-fill') {
      setInspect({ kind: 'risk', kindLabel: 'Risk zone', title: String(props['name'] ?? 'Risk zone'), gpsPath: null, lng, lat,
        rows: [{ k: 'Risk level', v: statusLabel(props['risk_level']) }, coord] });
    }
  };
  closeInspectRef.current = () => setInspect(null);

  // Keep the inspect card glued to its marker as the globe moves/spins; hide it
  // if the point rotates off-screen so it never floats over empty sky.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !inspect) { setInspectPos(null); return; }
    const place = () => {
      const p = m.project([inspect.lng, inspect.lat]);
      const c = m.getCanvas();
      const on = p.x >= 0 && p.y >= 0 && p.x <= c.clientWidth && p.y <= c.clientHeight;
      setInspectPos(on ? { x: p.x, y: p.y } : null);
    };
    place();
    m.on('move', place); m.on('render', place);
    return () => { m.off('move', place); m.off('render', place); };
  }, [inspect]);

  // Merge alerts + realtime feed (+ any live voice note) into one newest-first
  // stream for the priority rail. The SOS row is pinned separately, above this.
  const railRows = useMemo<RailRow[]>(() => {
    const rows: RailRow[] = [];
    const seenVoice = new Set<string>();
    const pushVoice = (voiceId: string, deviceId: string, deviceName: string, durationMs: number | null, at: string) => {
      if (seenVoice.has(voiceId)) return; seenVoice.add(voiceId);
      rows.push({ id: `voice-${voiceId}`, kind: 'voice', severity: 'info', title: 'Voice note', sub: deviceName, at, voice: { deviceId, voiceId, durationMs } });
    };
    if (voiceNoteAlert) pushVoice(voiceNoteAlert.voiceId, voiceNoteAlert.deviceId, voiceNoteAlert.deviceName, voiceNoteAlert.durationMs, voiceNoteAlert.createdAt);
    for (const v of (recentVoice ?? [])) pushVoice(v.id, v.device_id, v.device_name, v.duration_ms, v.created_at);
    for (const a of alerts) rows.push({ id: `alert-${a.id}`, kind: 'alert', severity: a.severity, title: a.title, sub: a.summary, at: a.occurred_at });
    for (const f of feedItems) rows.push({ id: `feed-${f.id}`, kind: f.imageUrl ? 'capture' : 'feed', severity: f.severity ?? 'low', title: f.message, at: f.timestamp, ...(f.imageUrl ? { imageUrl: f.imageUrl } : {}) });
    rows.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
    return rows;
  }, [alerts, feedItems, voiceNoteAlert, recentVoice]);
  // useClock re-renders each second, so this recency split re-evaluates live.
  const { liveRows, historyRows } = useMemo(() => {
    const now = Date.now();
    const live: RailRow[] = [], hist: RailRow[] = [];
    for (const r of railRows) (now - new Date(r.at).getTime() < LIVE_WINDOW_MS ? live : hist).push(r);
    return { liveRows: live, historyRows: hist };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [railRows, clock]);
  const shownRows = railTab === 'live' ? liveRows : historyRows;
  const railCount = liveRows.length + (panicActive ? 1 : 0); // collapsed badge = live only

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

      {/* persistent SOS lock card — stays until acknowledged/resolved, and now
          lets the operator acknowledge or resolve without leaving the globe */}
      {sos && panic && (
        <div className="o-sos">
          <div className="o-sos-head"><span className="o-sos-tag">● SOS</span><b>PANIC ACTIVE</b><span className="o-sos-t">{relTime(sos.at)}</span></div>
          <div className="o-sos-who">{panic.deviceName ?? panic.vehicle_id ?? sos.label}</div>
          <div className="o-sos-addr">{sos.short ?? `${sos.lat.toFixed(4)}, ${sos.lng.toFixed(4)}`}</div>
          <div className="o-sos-coord">{sos.lat.toFixed(5)}, {sos.lng.toFixed(5)}</div>

          {!resolving ? (
            <div className="o-sos-actions">
              <button className="o-sos-act ack" disabled={ackMut.isPending || !!panic.acknowledgedAt}
                onClick={() => ackMut.mutate(panic.id)}>
                <ShieldCheck size={14} />{panic.acknowledgedAt ? 'ACKNOWLEDGED' : ackMut.isPending ? 'ACKNOWLEDGING…' : 'ACKNOWLEDGE'}
              </button>
              <button className="o-sos-act resolve" disabled={resolveMut.isPending} onClick={() => setResolving(true)}>RESOLVE</button>
            </div>
          ) : (
            <div className="o-sos-resolve">
              <span className="o-sos-rl">Resolve — pick a reason</span>
              <div className="o-sos-reasons">
                {SOS_REASONS.map(r => (
                  <button key={r.value} className="o-sos-reason" disabled={resolveMut.isPending}
                    onClick={() => resolveMut.mutate({ id: panic.id, reason: r.value })}>{r.label}</button>
                ))}
              </div>
              <button className="o-sos-cancel" disabled={resolveMut.isPending} onClick={() => setResolving(false)}>Cancel</button>
            </div>
          )}
          <button className="o-sos-link" onClick={() => nav({ to: '/panic-center' })}>Open Panic Center →</button>
        </div>
      )}

      {/* live voice-note callout — auto-plays and pins the globe to its exact spot
          (suppressed while a panic owns the card slot) */}
      {voiceLoc && !sos && (
        <div className="o-voice">
          <div className="o-voice-head"><span className="o-voice-tag">🎙 VOICE NOTE</span><span className="o-voice-live"><i />PLAYING LIVE</span><span className="o-voice-t">{relTime(voiceLoc.at)}</span></div>
          <div className="o-voice-who">{voiceLoc.name}</div>
          <div className="o-voice-addr"><MapPin size={13} />{voiceLoc.short ?? `${voiceLoc.lat.toFixed(4)}, ${voiceLoc.lng.toFixed(4)}`}</div>
          <div className="o-voice-coord">{voiceLoc.lat.toFixed(5)}, {voiceLoc.lng.toFixed(5)}</div>
          <div className="o-voice-actions">
            <button className={`o-voice-play ${playingVoice === voiceLoc.voiceId ? 'on' : ''} ${voiceBlocked && playingVoice !== voiceLoc.voiceId ? 'blocked' : ''}`} onClick={() => void playVoice(voiceLoc.deviceId, voiceLoc.voiceId)}>
              <Play size={13} />{playingVoice === voiceLoc.voiceId ? 'Playing…' : voiceBlocked ? 'TAP TO PLAY' : 'Replay'}
            </button>
            <button className="o-voice-go" onClick={() => nav({ to: '/gps' })}>Open in GPS Live →</button>
          </div>
        </div>
      )}

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

      {/* inspect popup — clicked marker, glued to its point on the globe */}
      {inspect && inspectPos && (
        <div className="o-inspect" style={{ left: inspectPos.x, top: inspectPos.y } as CSSProperties}>
          <div className={`o-inspect-card k-${inspect.kind}`}>
            <button className="o-inspect-x" onClick={() => setInspect(null)} aria-label="Close"><X size={13} /></button>
            <div className="o-inspect-kind">{inspect.kindLabel}</div>
            <div className="o-inspect-title">{inspect.title}</div>
            <div className="o-inspect-rows">
              {inspect.rows.map(r => (<div key={r.k} className="o-inspect-row"><span>{r.k}</span><b>{r.v}</b></div>))}
            </div>
            {inspect.gpsPath && <button className="o-inspect-go" onClick={() => nav({ to: inspect.gpsPath! })}>Open in GPS Live →</button>}
          </div>
          <span className="o-inspect-stem" />
        </div>
      )}

      {/* live priority rail — realtime stream, SOS pinned, collapsible */}
      <aside className={`o-rail ${railOpen ? 'open' : 'closed'}`}>
        {!railOpen ? (
          <button className="o-rail-tab" onClick={() => setRailOpen(true)} title="Open live feed">
            <Radio size={17} />
            {railCount > 0 && <span className="o-rail-badge">{railCount > 99 ? '99+' : railCount}</span>}
          </button>
        ) : (
          <div className="o-rail-body">
            <div className="o-rail-head">
              <Activity size={15} />
              <div className="o-rail-tabs">
                <button className={`o-rail-tabbtn ${railTab === 'live' ? 'on' : ''}`} onClick={() => setRailTab('live')}>
                  <i className="o-rail-livei" />LIVE{liveRows.length > 0 ? ` ${liveRows.length}` : ''}
                </button>
                <button className={`o-rail-tabbtn ${railTab === 'history' ? 'on' : ''}`} onClick={() => setRailTab('history')}>
                  HISTORY{historyRows.length > 0 ? ` ${historyRows.length}` : ''}
                </button>
              </div>
              <button className="o-rail-collapse" onClick={() => setRailOpen(false)} title="Collapse"><ChevronRight size={16} /></button>
            </div>
            <div className="o-rail-list">
              {railTab === 'live' && panicActive && panic && (
                <button className="o-rail-row pinned" onClick={() => nav({ to: '/panic-center' })}>
                  <span className="o-rail-chip crit">SOS</span>
                  <div className="o-rail-main">
                    <div className="o-rail-title">Panic active · {panic.deviceName ?? panic.vehicle_id ?? 'device'}</div>
                    <div className="o-rail-sub">{panic.acknowledgedAt ? 'Acknowledged — resolve to clear' : 'Awaiting response'}</div>
                  </div>
                  <span className="o-rail-t">{relTime(panic.triggered_at)}</span>
                </button>
              )}
              {shownRows.length === 0 && !(railTab === 'live' && panicActive) && (
                <div className="o-rail-empty">{railTab === 'live'
                  ? <>All quiet.<br />Live alerts, driver events and voice notes stream in here.</>
                  : 'No earlier events yet.'}</div>
              )}
              {shownRows.map(r => (
                <div key={r.id} className={`o-rail-row ${r.kind === 'voice' ? 'voice' : ''} ${r.kind === 'capture' ? 'capture' : ''}`}>
                  <span className={`o-rail-chip ${r.severity}`}>{r.kind === 'voice' ? '♪' : r.kind === 'capture' ? '📷' : r.severity[0]!.toUpperCase()}</span>
                  <div className="o-rail-main">
                    <div className="o-rail-title">{r.title}</div>
                    {r.sub && <div className="o-rail-sub">{r.sub}</div>}
                    {r.imageUrl && (
                      <a className="o-rail-thumb" href={r.imageUrl} target="_blank" rel="noreferrer" title="Open full-size">
                        <img src={r.imageUrl} alt="Captured photo" loading="lazy" />
                      </a>
                    )}
                    {r.voice && (
                      <button className={`o-rail-play ${playingVoice === r.voice.voiceId ? 'on' : ''}`} onClick={() => void playVoice(r.voice!.deviceId, r.voice!.voiceId)}>
                        <Play size={11} />{playingVoice === r.voice.voiceId ? 'Playing…' : 'Play'}
                        {r.voice.durationMs != null && <span className="o-rail-dur">{Math.round(r.voice.durationMs / 1000)}s</span>}
                      </button>
                    )}
                  </div>
                  <span className="o-rail-t">{relTime(r.at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Home button (bottom-left) */}
      <button className="o-homebtn" onClick={() => nav({ to: '/gps' })} title="Open full GPS Live"><Home size={15} /> GPS LIVE</button>
    </div>
  );
}
