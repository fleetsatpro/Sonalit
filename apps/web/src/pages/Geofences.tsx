import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api } from '../lib/api.js';
import {
  MapPin, Plus, X, Trash2, Bell, Truck, Smartphone, Radio, Activity,
  Circle as CircleIcon, Waypoints, Power, ChevronDown, ChevronRight, Mail, MessageSquare, Map as MapIcon,
} from 'lucide-react';

// ─── Live data shapes ──────────────────────────────────────────────────────
// /dashboard/map — normalized geometry for rendering (real GPS + Guardian telemetry)
interface MapVehicle { id: string; registration: string; status: string; lat: number; lng: number; heading: number; speed_kmh: number }
interface MapDevice { id: string; name: string; model?: string; assignment_type?: string; lat: number; lng: number; speed_kmh: number; status: string; panic_active: boolean; last_seen: string | null }
interface MapGeofence { id: string; name: string; type: string; lat: number | null; lng: number | null; radius_m: number; path?: [number, number][] | null; buffer_m?: number | null }
interface MapData { vehicles: MapVehicle[]; devices: MapDevice[]; geofences: MapGeofence[] }

// /geofences — full CRUD record
interface Geofence { id: string; name: string; type: string; active: boolean; region: string | null; lat: number | null; lng: number | null; radius: number | null; created_at: string }
// /geofences/events
interface GeofenceEvent { id: string; event_type: string; geofence_id: string; geofence_name: string | null; convoy_id: string | null; vehicle_id: string | null; created_at: string }
// /geofences/:id/actions
interface GeofenceAction { id: string; action_type: string; recipient: string | null; message_template: string | null; enabled: boolean }

const STATUS_COLOR: Record<string, string> = {
  panic: '#ef4444', alert: '#ef4444', warn: '#f59e0b',
  moving: '#22c55e', idle: '#94a3b8', offline: '#475569',
};

const REGIONS = ['Kenya', 'DRC', 'Tanzania', 'Mali'];
const EA_CENTER: [number, number] = [35.5, 1.2];
const EA_ZOOM = 5.2;

const EVENT_LABEL: Record<string, string> = {
  enter: 'Entered zone', exit: 'Exited zone', dwell_exceeded: 'Dwell time exceeded',
  route_deviation: 'Route deviation', checkpoint_signin: 'Checkpoint sign-in',
};
const EVENT_COLOR: Record<string, string> = {
  enter: 'text-green-400', exit: 'text-blue-400', dwell_exceeded: 'text-yellow-400',
  route_deviation: 'text-red-400', checkpoint_signin: 'text-cyan-400',
};

const ACTION_TYPE_META: Record<string, { label: string; icon: React.ReactNode }> = {
  sms: { label: 'SMS', icon: <MessageSquare size={13} /> },
  whatsapp: { label: 'WhatsApp', icon: <MessageSquare size={13} /> },
  email: { label: 'Email', icon: <Mail size={13} /> },
  map_alert: { label: 'Map Alert', icon: <Bell size={13} /> },
};

function geoCircle(lat: number, lng: number, radiusKm: number, steps = 48): [number, number][] {
  const R = 6371;
  const pts: [number, number][] = [];
  const cosLat = Math.cos(lat * Math.PI / 180);
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    pts.push([
      lng + (radiusKm / R) * (180 / Math.PI) * Math.sin(angle) / cosLat,
      lat + (radiusKm / R) * (180 / Math.PI) * Math.cos(angle),
    ]);
  }
  return pts;
}

function fmtAge(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (d < 1) return 'just now';
  if (d < 60) return `${d}m ago`;
  if (d < 1440) return `${Math.floor(d / 60)}h ago`;
  return `${Math.floor(d / 1440)}d ago`;
}

type DrawMode = 'circle' | 'corridor' | null;

export default function Geofences() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);
  const qc = useQueryClient();

  const [tab, setTab] = useState<'zones' | 'events'>('zones');
  const [showCreate, setShowCreate] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode>(null);
  const [drawCenter, setDrawCenter] = useState<[number, number] | null>(null);
  const [drawPath, setDrawPath] = useState<[number, number][]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', region: REGIONS[0], radius: '2000', buffer_km: '2' });
  const [newAction, setNewAction] = useState({ action_type: 'sms', recipient: '', message_template: '' });

  const mapQ = useQuery<MapData>({
    queryKey: ['geofence-map-data'],
    queryFn: async () => { const r = await api.get<MapData>('/dashboard/map'); return r.data; },
    refetchInterval: 15_000,
  });

  const geofencesQ = useQuery<{ data: Geofence[] }>({
    queryKey: ['geofences-list'],
    queryFn: () => api.get('/geofences').then(r => ({ data: Array.isArray(r.data) ? r.data : r.data?.data ?? [] })),
  });

  const eventsQ = useQuery<{ data: GeofenceEvent[] }>({
    queryKey: ['geofence-events'],
    queryFn: () => api.get('/geofences/events?limit=50').then(r => r.data),
    refetchInterval: 20_000,
  });

  const actionsQ = useQuery<{ data: GeofenceAction[] }>({
    queryKey: ['geofence-actions', expandedId],
    queryFn: () => api.get(`/geofences/${expandedId}/actions`).then(r => r.data),
    enabled: !!expandedId,
  });

  const vehicles = mapQ.data?.vehicles ?? [];
  const devices = mapQ.data?.devices ?? [];
  const mapGeofences = mapQ.data?.geofences ?? [];
  const zones = geofencesQ.data?.data ?? [];
  const events = eventsQ.data?.data ?? [];

  const invalidateZones = () => {
    qc.invalidateQueries({ queryKey: ['geofences-list'] });
    qc.invalidateQueries({ queryKey: ['geofence-map-data'] });
  };

  const createMut = useMutation({
    mutationFn: (body: object) => api.post('/geofences', body),
    onSuccess: () => {
      invalidateZones();
      setShowCreate(false);
      setDrawMode(null); setDrawCenter(null); setDrawPath([]);
      setForm({ name: '', region: REGIONS[0], radius: '2000', buffer_km: '2' });
    },
  });

  const toggleActiveMut = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/geofences/${id}`, { active }),
    onSuccess: invalidateZones,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/geofences/${id}`),
    onSuccess: invalidateZones,
  });

  const addActionMut = useMutation({
    mutationFn: (body: object) => api.post(`/geofences/${expandedId}/actions`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['geofence-actions', expandedId] });
      setNewAction({ action_type: 'sms', recipient: '', message_template: '' });
    },
  });

  const toggleActionMut = useMutation({
    mutationFn: (actionId: string) => api.patch(`/geofences/${expandedId}/actions/${actionId}/toggle`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['geofence-actions', expandedId] }),
  });

  const deleteActionMut = useMutation({
    mutationFn: (actionId: string) => api.delete(`/geofences/${expandedId}/actions/${actionId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['geofence-actions', expandedId] }),
  });

  // ── Map init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapEl.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: EA_CENTER, zoom: EA_ZOOM,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    map.on('load', () => { mapReadyRef.current = true; });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; mapReadyRef.current = false; };
  }, []);

  // ── Draw-mode click capture ─────────────────────────────────────────────
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !drawMode) return;
    const handler = (e: maplibregl.MapMouseEvent) => {
      const pt: [number, number] = [e.lngLat.lat, e.lngLat.lng];
      if (drawMode === 'circle') setDrawCenter(pt);
      else setDrawPath(prev => [...prev, pt]);
    };
    m.on('click', handler);
    return () => { m.off('click', handler); };
  }, [drawMode]);

  // ── Render live layers: vehicles, devices, geofences, draw preview ──────
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const render = () => {
      ['gf-zone-fill', 'gf-zone-line', 'gf-corridor-glow', 'gf-corridor-line',
        'gf-vehicles-glow', 'gf-vehicles-dot', 'gf-devices-glow', 'gf-devices-dot',
        'gf-draw-fill', 'gf-draw-line'].forEach(id => { if (m.getLayer(id)) m.removeLayer(id); });
      ['gf-zone-src', 'gf-corridor-src', 'gf-vehicles-src', 'gf-devices-src', 'gf-draw-src'].forEach(id => { if (m.getSource(id)) m.removeSource(id); });

      // Existing geofences: circles as filled polygons, corridors as lines
      const circleFeatures: GeoJSON.Feature[] = [];
      const corridorFeatures: GeoJSON.Feature[] = [];
      mapGeofences.forEach(g => {
        if (g.type === 'corridor' && g.path && g.path.length >= 2) {
          corridorFeatures.push({
            type: 'Feature', properties: { name: g.name },
            geometry: { type: 'LineString', coordinates: g.path.map(([lat, lng]) => [lng, lat]) },
          });
        } else if (g.lat != null && g.lng != null) {
          circleFeatures.push({
            type: 'Feature', properties: { name: g.name },
            geometry: { type: 'Polygon', coordinates: [geoCircle(g.lat, g.lng, (g.radius_m || 1000) / 1000)] },
          });
        }
      });
      m.addSource('gf-zone-src', { type: 'geojson', data: { type: 'FeatureCollection', features: circleFeatures } });
      m.addLayer({ id: 'gf-zone-fill', type: 'fill', source: 'gf-zone-src', paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.08 } });
      m.addLayer({ id: 'gf-zone-line', type: 'line', source: 'gf-zone-src', paint: { 'line-color': '#22d3ee', 'line-width': 1.5, 'line-dasharray': [4, 3] } });

      m.addSource('gf-corridor-src', { type: 'geojson', data: { type: 'FeatureCollection', features: corridorFeatures } });
      m.addLayer({ id: 'gf-corridor-glow', type: 'line', source: 'gf-corridor-src', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#38bdf8', 'line-width': 14, 'line-opacity': 0.15 } });
      m.addLayer({ id: 'gf-corridor-line', type: 'line', source: 'gf-corridor-src', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#38bdf8', 'line-width': 2.5, 'line-dasharray': [3, 2] } });

      // Live vehicles
      const vehicleFeatures: GeoJSON.Feature[] = vehicles.map(v => ({
        type: 'Feature', properties: { id: v.id, registration: v.registration, status: v.status },
        geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
      }));
      m.addSource('gf-vehicles-src', { type: 'geojson', data: { type: 'FeatureCollection', features: vehicleFeatures } });
      const statusColorExpr: maplibregl.ExpressionSpecification = ['match', ['get', 'status'], 'panic', STATUS_COLOR['panic']!, 'alert', STATUS_COLOR['alert']!, 'warn', STATUS_COLOR['warn']!, 'moving', STATUS_COLOR['moving']!, 'idle', STATUS_COLOR['idle']!, 'offline', STATUS_COLOR['offline']!, '#666666'];
      m.addLayer({ id: 'gf-vehicles-glow', type: 'circle', source: 'gf-vehicles-src', paint: { 'circle-radius': 13, 'circle-color': statusColorExpr, 'circle-opacity': 0.2, 'circle-blur': 1 } });
      m.addLayer({ id: 'gf-vehicles-dot', type: 'circle', source: 'gf-vehicles-src', paint: { 'circle-radius': 6, 'circle-color': statusColorExpr, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#000', 'circle-opacity': 0.95 } });

      // Live Guardian devices
      const deviceFeatures: GeoJSON.Feature[] = devices.map(d => ({
        type: 'Feature', properties: { id: d.id, name: d.name, status: d.status },
        geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
      }));
      m.addSource('gf-devices-src', { type: 'geojson', data: { type: 'FeatureCollection', features: deviceFeatures } });
      m.addLayer({ id: 'gf-devices-glow', type: 'circle', source: 'gf-devices-src', paint: { 'circle-radius': ['case', ['==', ['get', 'status'], 'panic'], 20, 9], 'circle-color': statusColorExpr, 'circle-opacity': ['case', ['==', ['get', 'status'], 'panic'], 0.35, 0.15], 'circle-blur': 1 } });
      m.addLayer({ id: 'gf-devices-dot', type: 'circle', source: 'gf-devices-src', paint: { 'circle-radius': 4.5, 'circle-color': statusColorExpr, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff', 'circle-opacity': 0.95 } });

      // Draw preview
      const drawFeatures: GeoJSON.Feature[] = [];
      if (drawMode === 'circle' && drawCenter) {
        drawFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [geoCircle(drawCenter[0], drawCenter[1], parseFloat(form.radius || '2000') / 1000)] } });
      } else if (drawMode === 'corridor' && drawPath.length >= 2) {
        drawFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: drawPath.map(([lat, lng]) => [lng, lat]) } });
      }
      m.addSource('gf-draw-src', { type: 'geojson', data: { type: 'FeatureCollection', features: drawFeatures } });
      m.addLayer({ id: 'gf-draw-fill', type: 'fill', source: 'gf-draw-src', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#f97316', 'fill-opacity': 0.15 } });
      m.addLayer({ id: 'gf-draw-line', type: 'line', source: 'gf-draw-src', paint: { 'line-color': '#f97316', 'line-width': 2.5 } });
    };
    if (mapReadyRef.current) render(); else m.once('load', render);
    m.on('style.load', render);
    return () => { m.off('style.load', render); };
  }, [vehicles, devices, mapGeofences, drawMode, drawCenter, drawPath, form.radius]);

  const startDraw = useCallback((mode: DrawMode) => {
    setDrawMode(mode); setDrawCenter(null); setDrawPath([]);
    setShowCreate(false);
  }, []);

  const finishDraw = useCallback(() => {
    setShowCreate(true);
  }, []);

  const cancelDraw = useCallback(() => {
    setDrawMode(null); setDrawCenter(null); setDrawPath([]);
  }, []);

  const submitCreate = useCallback(() => {
    if (drawMode === 'circle' && drawCenter) {
      createMut.mutate({ name: form.name, type: 'circle', lat: drawCenter[0], lng: drawCenter[1], radius: parseFloat(form.radius), region: form.region });
    } else if (drawMode === 'corridor' && drawPath.length >= 2) {
      createMut.mutate({ name: form.name, type: 'corridor', region: form.region, coordinates: { path: drawPath, buffer_m: parseFloat(form.buffer_km) * 1000 } });
    }
  }, [drawMode, drawCenter, drawPath, form, createMut]);

  const stats = useMemo(() => ({
    total: zones.length,
    active: zones.filter(z => z.active).length,
    vehicles: vehicles.length,
    devices: devices.length,
    eventsToday: events.filter(e => new Date(e.created_at).toDateString() === new Date().toDateString()).length,
  }), [zones, vehicles, devices, events]);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-6 h-6 text-cyan-400" />
          <h1 className="text-2xl font-bold text-white">Geofences</h1>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
          <Plus className="w-4 h-4" /> New Geofence
        </button>
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatChip label="Zones" value={stats.total} icon={<MapIcon size={18} />} color="text-cyan-400" />
        <StatChip label="Active" value={stats.active} icon={<Power size={18} />} color="text-green-400" />
        <StatChip label="Vehicles Tracked" value={stats.vehicles} icon={<Truck size={18} />} color="text-blue-400" />
        <StatChip label="Devices Tracked" value={stats.devices} icon={<Smartphone size={18} />} color="text-violet-400" />
        <StatChip label="Events Today" value={stats.eventsToday} icon={<Activity size={18} />} color="text-orange-400" />
      </div>

      {/* Map panel */}
      <div className="relative rounded-lg overflow-hidden border border-gray-700">
        <div ref={mapEl} style={{ width: '100%', height: 480, background: '#050f18' }} />

        {/* Legend */}
        <div className="absolute top-3 left-3 bg-black/70 backdrop-blur rounded-lg border border-gray-700 px-3 py-2 flex flex-col gap-1.5 text-xs font-semibold">
          <LegendRow color={STATUS_COLOR['moving']!} label="Moving" />
          <LegendRow color={STATUS_COLOR['idle']!} label="Idle" />
          <LegendRow color={STATUS_COLOR['warn']!} label="Warning" />
          <LegendRow color={STATUS_COLOR['alert']!} label="Alert / Panic" />
          <LegendRow color={STATUS_COLOR['offline']!} label="Offline" />
        </div>

        {/* Draw controls */}
        <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
          {!drawMode && (
            <div className="flex gap-2">
              <button onClick={() => startDraw('circle')} className="flex items-center gap-1.5 bg-black/70 backdrop-blur border border-gray-700 hover:border-cyan-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">
                <CircleIcon size={14} /> Draw Circle Zone
              </button>
              <button onClick={() => startDraw('corridor')} className="flex items-center gap-1.5 bg-black/70 backdrop-blur border border-gray-700 hover:border-cyan-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold">
                <Waypoints size={14} /> Draw Corridor
              </button>
            </div>
          )}
          {drawMode === 'circle' && (
            <div className="bg-black/80 backdrop-blur border border-orange-500/50 rounded-lg px-3 py-2 text-xs font-semibold text-white space-y-2">
              <div>{drawCenter ? 'Center placed — adjust radius, then Continue' : 'Click the map to place the zone center'}</div>
              {drawCenter && (
                <input type="number" value={form.radius} onChange={e => setForm(p => ({ ...p, radius: e.target.value }))} placeholder="Radius (m)" className="w-full bg-gray-800 text-white px-2 py-1 rounded text-xs" />
              )}
              <div className="flex gap-2">
                <button onClick={cancelDraw} className="flex-1 px-2 py-1 rounded bg-gray-700 hover:bg-gray-600">Cancel</button>
                {drawCenter && <button onClick={finishDraw} className="flex-1 px-2 py-1 rounded bg-orange-600 hover:bg-orange-700">Continue</button>}
              </div>
            </div>
          )}
          {drawMode === 'corridor' && (
            <div className="bg-black/80 backdrop-blur border border-orange-500/50 rounded-lg px-3 py-2 text-xs font-semibold text-white space-y-2">
              <div>{drawPath.length} point{drawPath.length === 1 ? '' : 's'} — click to add, need at least 2</div>
              <input type="number" value={form.buffer_km} onChange={e => setForm(p => ({ ...p, buffer_km: e.target.value }))} placeholder="Buffer width (km)" className="w-full bg-gray-800 text-white px-2 py-1 rounded text-xs" />
              <div className="flex gap-2">
                <button onClick={cancelDraw} className="flex-1 px-2 py-1 rounded bg-gray-700 hover:bg-gray-600">Cancel</button>
                <button onClick={finishDraw} disabled={drawPath.length < 2} className="flex-1 px-2 py-1 rounded bg-orange-600 hover:bg-orange-700 disabled:opacity-40">Continue</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg w-fit">
        <button onClick={() => setTab('zones')} className={`px-4 py-2 rounded-md text-sm font-semibold ${tab === 'zones' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>Zones ({zones.length})</button>
        <button onClick={() => setTab('events')} className={`px-4 py-2 rounded-md text-sm font-semibold ${tab === 'events' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>Live Events ({events.length})</button>
      </div>

      {tab === 'zones' && (
        <div className="space-y-2">
          {geofencesQ.isLoading && <div className="p-8 text-center text-gray-400 font-semibold">Loading zones…</div>}
          {zones.length === 0 && !geofencesQ.isLoading && (
            <div className="p-8 text-center text-gray-400 font-semibold bg-gray-800 rounded-lg">No geofences yet. Draw one on the map to get started.</div>
          )}
          {zones.map(z => (
            <div key={z.id} className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <button onClick={() => setExpandedId(id => id === z.id ? null : z.id)} className="text-gray-400 hover:text-white">
                  {expandedId === z.id ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>
                {z.type === 'corridor' ? <Waypoints size={16} className="text-blue-400 shrink-0" /> : <CircleIcon size={16} className="text-cyan-400 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white truncate">{z.name}</div>
                  <div className="text-xs text-gray-400 font-medium">{z.type} · {z.region ?? 'Unassigned'}{z.radius ? ` · ${Math.round(z.radius)}m` : ''}</div>
                </div>
                <span className={`text-xs font-bold px-2 py-1 rounded ${z.active ? 'bg-green-900/60 text-green-300' : 'bg-gray-700 text-gray-400'}`}>{z.active ? 'ACTIVE' : 'INACTIVE'}</span>
                <button onClick={() => toggleActiveMut.mutate({ id: z.id, active: !z.active })} className="text-xs font-semibold text-cyan-400 hover:text-cyan-300 px-2">{z.active ? 'Disable' : 'Enable'}</button>
                <button onClick={() => deleteMut.mutate(z.id)} className="text-gray-500 hover:text-red-400"><Trash2 size={16} /></button>
              </div>
              {expandedId === z.id && (
                <div className="border-t border-gray-700 bg-gray-900/60 px-4 py-3 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-bold text-white"><Bell size={14} className="text-yellow-400" /> Notification Actions</div>
                  {(actionsQ.data?.data ?? []).map(a => (
                    <div key={a.id} className="flex items-center gap-3 bg-gray-800 rounded px-3 py-2">
                      <span className="text-gray-300">{ACTION_TYPE_META[a.action_type]?.icon ?? <Bell size={13} />}</span>
                      <span className="text-sm font-semibold text-white w-24">{ACTION_TYPE_META[a.action_type]?.label ?? a.action_type}</span>
                      <span className="text-xs text-gray-400 flex-1 truncate">{a.recipient ?? '—'}</span>
                      <button onClick={() => toggleActionMut.mutate(a.id)} className={`text-xs font-bold px-2 py-0.5 rounded ${a.enabled ? 'bg-green-900/60 text-green-300' : 'bg-gray-700 text-gray-400'}`}>{a.enabled ? 'ON' : 'OFF'}</button>
                      <button onClick={() => deleteActionMut.mutate(a.id)} className="text-gray-500 hover:text-red-400"><Trash2 size={14} /></button>
                    </div>
                  ))}
                  {(actionsQ.data?.data ?? []).length === 0 && <div className="text-xs text-gray-500 font-medium">No notification actions configured.</div>}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <select value={newAction.action_type} onChange={e => setNewAction(p => ({ ...p, action_type: e.target.value }))} className="bg-gray-800 text-white text-xs font-semibold px-2 py-1.5 rounded">
                      {Object.entries(ACTION_TYPE_META).map(([v, m]) => <option key={v} value={v}>{m.label}</option>)}
                    </select>
                    <input placeholder="Recipient (phone/email)" value={newAction.recipient} onChange={e => setNewAction(p => ({ ...p, recipient: e.target.value }))} className="bg-gray-800 text-white text-xs px-2 py-1.5 rounded flex-1 min-w-[160px]" />
                    <button onClick={() => addActionMut.mutate(newAction)} disabled={!newAction.recipient || addActionMut.isPending} className="bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 rounded">Add Action</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {tab === 'events' && (
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          {events.length === 0 && <div className="p-8 text-center text-gray-400 font-semibold">No geofence events yet.</div>}
          {events.map(e => (
            <div key={e.id} className="flex items-center gap-3 px-4 py-3 border-b border-gray-700/50 last:border-0">
              <Radio size={16} className={EVENT_COLOR[e.event_type] ?? 'text-gray-400'} />
              <span className={`text-sm font-bold ${EVENT_COLOR[e.event_type] ?? 'text-gray-300'}`}>{EVENT_LABEL[e.event_type] ?? e.event_type}</span>
              <span className="text-sm text-gray-300 font-medium">{e.geofence_name ?? 'Unknown zone'}</span>
              <span className="ml-auto text-xs text-gray-400 font-medium">{fmtAge(e.created_at)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">New Geofence</h2>
              <button onClick={() => { setShowCreate(false); cancelDraw(); }} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            {!drawMode && (
              <div className="space-y-3">
                <p className="text-sm text-gray-300 font-medium">Choose a shape and draw it on the map first.</p>
                <div className="flex gap-2">
                  <button onClick={() => startDraw('circle')} className="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg text-sm font-semibold"><CircleIcon size={16} /> Circle Zone</button>
                  <button onClick={() => startDraw('corridor')} className="flex-1 flex items-center justify-center gap-2 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-lg text-sm font-semibold"><Waypoints size={16} /> Corridor</button>
                </div>
              </div>
            )}
            {drawMode && (
              <div className="space-y-3">
                <div className="text-xs font-bold text-cyan-400 uppercase tracking-wide">
                  {drawMode === 'circle' ? `Center: ${drawCenter ? `${drawCenter[0].toFixed(4)}, ${drawCenter[1].toFixed(4)}` : 'not set'} · Radius: ${form.radius}m` : `${drawPath.length} points captured · Buffer ${form.buffer_km}km`}
                </div>
                <input placeholder="Zone Name *" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm font-medium" />
                <select value={form.region} onChange={e => setForm(p => ({ ...p, region: e.target.value }))} className="w-full bg-gray-700 text-white px-3 py-2 rounded-lg text-sm font-medium">
                  {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <div className="flex gap-3 justify-end">
                  <button onClick={() => { setShowCreate(false); cancelDraw(); }} className="px-4 py-2 text-sm font-semibold text-gray-400 hover:text-white">Cancel</button>
                  <button
                    onClick={submitCreate}
                    disabled={!form.name || createMut.isPending || (drawMode === 'circle' ? !drawCenter : drawPath.length < 2)}
                    className="px-4 py-2 text-sm font-bold bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 text-white rounded-lg"
                  >
                    {createMut.isPending ? 'Creating…' : 'Create Geofence'}
                  </button>
                </div>
                {createMut.isError && <p className="text-red-400 text-xs font-semibold">Failed to create geofence.</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-center gap-3">
      <div className={color}>{icon}</div>
      <div>
        <div className="text-xl font-bold leading-none text-white">{value}</div>
        <div className="text-xs text-gray-400 font-semibold mt-1">{label}</div>
      </div>
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
      <span className="text-gray-200">{label}</span>
    </div>
  );
}
