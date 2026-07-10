import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api } from '../lib/api.js';
import {
  MapPin, Plus, X, Trash2, Bell, Truck, Smartphone, Radio,
  Circle as CircleIcon, Waypoints, ChevronDown, ChevronRight, Mail, MessageSquare, Map as MapIcon,
  Search, ChevronLeft, Sparkles, AlertTriangle, CheckCircle2, Gauge, Fuel as FuelIcon, Wifi,
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
// /vehicles — CRUD metadata (region, driver, type)
interface VehicleMeta { id: string; registration: string; type: string; region: string; status: string; driver_name: string | null }
// /dashboard/vehicles — live telemetry
interface VehicleTelemetry { id: string; registration: string; status: string; speed_kmh: number; fuel_pct: number | null; engine_temp_c: number | null; gps_signal_pct: number | null; last_ping_at: string | null }
// /alerts
interface AlertRow { id: string; type: string; severity: string; message: string; vehicle_id: string | null; vehicle_reg: string | null; region: string | null; convoy_name: string | null; acknowledged_at: string | null; resolved_at: string | null; created_at: string }

const STATUS_COLOR: Record<string, string> = {
  panic: '#ef4444', alert: '#ef4444', warn: '#f59e0b',
  moving: '#22c55e', idle: '#94a3b8', offline: '#475569',
};

const REGIONS = ['Kenya', 'DRC', 'Tanzania', 'Mali'];
// Real (approximate) country bounding boxes [[west,south],[east,north]] for map fly-to.
const REGION_BOUNDS: Record<string, [[number, number], [number, number]]> = {
  Kenya: [[33.9, -4.7], [41.9, 5.5]],
  DRC: [[12.2, -13.5], [31.3, 5.4]],
  Tanzania: [[29.3, -11.8], [40.5, -1.0]],
  Mali: [[-12.2, 10.2], [4.2, 25.0]],
};
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

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'text-red-400', high: 'text-orange-400', medium: 'text-yellow-400', low: 'text-blue-400',
};
const SEVERITY_WEIGHT: Record<string, number> = { critical: 100, high: 75, medium: 50, low: 25 };

const VEHICLE_STATUS_ACTIONS: { status: 'active' | 'idle' | 'maintenance' | 'offline'; label: string }[] = [
  { status: 'active', label: 'Set Active' },
  { status: 'idle', label: 'Set Idle' },
  { status: 'maintenance', label: 'Send to Maintenance' },
  { status: 'offline', label: 'Mark Offline' },
];

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

  // Restored command-deck state
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleInput, setConsoleInput] = useState('');
  const [consoleLines, setConsoleLines] = useState<{ t: string; c: string }[]>([]);
  const [utcClock, setUtcClock] = useState('');
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [eventTypeFilter, setEventTypeFilter] = useState('all');

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

  const vehiclesMetaQ = useQuery<{ data: VehicleMeta[] }>({
    queryKey: ['geofence-vehicles-meta'],
    queryFn: () => api.get('/vehicles?limit=200').then(r => r.data),
  });

  const telemetryQ = useQuery<{ data: VehicleTelemetry[] }>({
    queryKey: ['geofence-vehicle-telemetry'],
    queryFn: () => api.get('/dashboard/vehicles').then(r => r.data),
    refetchInterval: 20_000,
  });

  const alertsQ = useQuery<{ data: AlertRow[] }>({
    queryKey: ['geofence-alerts'],
    queryFn: () => api.get('/alerts?limit=50&resolved=false').then(r => r.data),
    refetchInterval: 20_000,
  });

  const vehicles = mapQ.data?.vehicles ?? [];
  const devices = mapQ.data?.devices ?? [];
  const mapGeofences = mapQ.data?.geofences ?? [];
  const zones = geofencesQ.data?.data ?? [];
  const events = eventsQ.data?.data ?? [];
  const vehiclesMeta = vehiclesMetaQ.data?.data ?? [];
  const telemetry = telemetryQ.data?.data ?? [];
  const alerts = alertsQ.data?.data ?? [];

  // Vehicles allowed under the current region filter (region only exists on the CRUD vehicle record)
  const regionVehicleIds = useMemo(() => {
    if (regionFilter === 'all') return null;
    return new Set(vehiclesMeta.filter(v => v.region === regionFilter).map(v => v.id));
  }, [vehiclesMeta, regionFilter]);

  const visibleVehicles = useMemo(
    () => regionVehicleIds ? vehicles.filter(v => regionVehicleIds.has(v.id)) : vehicles,
    [vehicles, regionVehicleIds],
  );
  const visibleZones = useMemo(
    () => regionFilter === 'all' ? zones : zones.filter(z => z.region === regionFilter),
    [zones, regionFilter],
  );

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

  const acknowledgeAlertMut = useMutation({
    mutationFn: (id: string) => api.patch(`/alerts/${id}/acknowledge`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['geofence-alerts'] }),
  });

  const resolveAlertMut = useMutation({
    mutationFn: (id: string) => api.patch(`/alerts/${id}/resolve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['geofence-alerts'] }),
  });

  const setVehicleStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/vehicles/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['geofence-vehicles-meta'] });
      qc.invalidateQueries({ queryKey: ['geofence-vehicle-telemetry'] });
      qc.invalidateQueries({ queryKey: ['geofence-map-data'] });
    },
  });

  // ── Live UTC clock ───────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setUtcClock(new Date().toISOString().slice(11, 19) + ' UTC'), 1000);
    return () => clearInterval(t);
  }, []);

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

  // Vehicle-marker click → open Mission Control with the real telemetry for that vehicle
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const handler = (e: maplibregl.MapMouseEvent) => {
      const feats = m.queryRenderedFeatures(e.point, { layers: ['gf-vehicles-dot'] });
      const id = feats[0]?.properties?.['id'];
      if (id) { setSelectedVehicleId(id); setRightOpen(true); }
    };
    m.on('click', 'gf-vehicles-dot', handler);
    return () => { m.off('click', 'gf-vehicles-dot', handler); };
  }, [vehicles.length]);

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
      const visibleZoneIds = new Set(visibleZones.map(z => z.id));
      mapGeofences.filter(g => regionFilter === 'all' || visibleZoneIds.has(g.id)).forEach(g => {
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

      // Live vehicles (region-filtered)
      const vehicleFeatures: GeoJSON.Feature[] = visibleVehicles.map(v => ({
        type: 'Feature', properties: { id: v.id, registration: v.registration, status: v.status },
        geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
      }));
      m.addSource('gf-vehicles-src', { type: 'geojson', data: { type: 'FeatureCollection', features: vehicleFeatures } });
      const statusColorExpr: maplibregl.ExpressionSpecification = ['match', ['get', 'status'], 'panic', STATUS_COLOR['panic']!, 'alert', STATUS_COLOR['alert']!, 'warn', STATUS_COLOR['warn']!, 'moving', STATUS_COLOR['moving']!, 'idle', STATUS_COLOR['idle']!, 'offline', STATUS_COLOR['offline']!, '#666666'];
      m.addLayer({ id: 'gf-vehicles-glow', type: 'circle', source: 'gf-vehicles-src', paint: { 'circle-radius': 13, 'circle-color': statusColorExpr, 'circle-opacity': 0.2, 'circle-blur': 1 } });
      m.addLayer({ id: 'gf-vehicles-dot', type: 'circle', source: 'gf-vehicles-src', paint: { 'circle-radius': 6, 'circle-color': statusColorExpr, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#000', 'circle-opacity': 0.95 } });

      // Live Guardian devices (no region field on guardian_devices — always shown)
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
  }, [visibleVehicles, devices, mapGeofences, visibleZones, regionFilter, drawMode, drawCenter, drawPath, form.radius]);

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

  const applyRegion = useCallback((r: string) => {
    setRegionFilter(r); setRegionMenuOpen(false);
    const bounds = r === 'all' ? null : REGION_BOUNDS[r];
    if (bounds && mapRef.current) mapRef.current.fitBounds(bounds, { animate: true, duration: 600 });
    else if (mapRef.current) mapRef.current.flyTo({ center: EA_CENTER, zoom: EA_ZOOM, duration: 600 });
  }, []);

  const kpi = useMemo(() => {
    const threat = alerts.length ? Math.max(...alerts.map(a => SEVERITY_WEIGHT[a.severity] ?? 25)) : 5;
    return { threat, openAlerts: alerts.length, zones: zones.length, vehicles: vehicles.length, devices: devices.length };
  }, [alerts, zones, vehicles, devices]);

  const topAlert = useMemo(
    () => [...alerts].sort((a, b) => (SEVERITY_WEIGHT[b.severity] ?? 0) - (SEVERITY_WEIGHT[a.severity] ?? 0))[0] ?? null,
    [alerts],
  );

  const filteredEvents = useMemo(
    () => eventTypeFilter === 'all' ? events : events.filter(e => e.event_type === eventTypeFilter),
    [events, eventTypeFilter],
  );

  const searchResults = useMemo(() => {
    if (search.length < 2) return [];
    const q = search.toLowerCase();
    const hits: { type: string; label: string; sub: string; onClick: () => void }[] = [];
    vehiclesMeta.filter(v => v.registration.toLowerCase().includes(q)).slice(0, 5).forEach(v => hits.push({
      type: 'vehicle', label: v.registration, sub: v.status,
      onClick: () => { setSelectedVehicleId(v.id); setRightOpen(true); const mv = vehicles.find(x => x.id === v.id); if (mv && mapRef.current) mapRef.current.flyTo({ center: [mv.lng, mv.lat], zoom: 11, duration: 800 }); },
    }));
    zones.filter(z => z.name.toLowerCase().includes(q)).slice(0, 5).forEach(z => hits.push({
      type: 'zone', label: z.name, sub: z.type,
      onClick: () => { setTab('zones'); setExpandedId(z.id); if (z.lat != null && z.lng != null && mapRef.current) mapRef.current.flyTo({ center: [z.lng, z.lat], zoom: 10, duration: 800 }); },
    }));
    devices.filter(d => d.name.toLowerCase().includes(q)).slice(0, 4).forEach(d => hits.push({
      type: 'device', label: d.name, sub: d.status, onClick: () => { if (mapRef.current) mapRef.current.flyTo({ center: [d.lng, d.lat], zoom: 12, duration: 800 }); },
    }));
    return hits;
  }, [search, vehiclesMeta, vehicles, zones, devices]);

  const runConsoleCmd = useCallback((raw: string) => {
    const addLine = (t: string, c: string) => setConsoleLines(l => [...l.slice(-29), { t, c }]);
    addLine('> ' + raw, 'info');
    const cmd = raw.toLowerCase().trim();
    if (cmd === 'help') {
      ['help — show commands', 'status — situation report', 'region <name> — filter by region (kenya/drc/tanzania/mali/all)', 'assets — count vehicles by status', 'ai — refresh AI assessment', 'clear — clear console'].forEach(l => addLine(l, 'info'));
    } else if (cmd === 'status') {
      addLine(`THREAT INDEX: ${kpi.threat}/100 | ZONES: ${kpi.zones} | VEHICLES: ${kpi.vehicles} | DEVICES: ${kpi.devices} | OPEN ALERTS: ${kpi.openAlerts}`, 'ok');
    } else if (cmd.startsWith('region ')) {
      const r = raw.trim().split(' ')[1] ?? '';
      const match = r.toLowerCase() === 'all' ? 'all' : REGIONS.find(x => x.toLowerCase() === r.toLowerCase());
      if (match) { applyRegion(match); addLine('Region filter: ' + match, 'ok'); } else addLine('Unknown region. Try: kenya, drc, tanzania, mali, all', 'err');
    } else if (cmd === 'assets') {
      const byStatus = vehicles.reduce<Record<string, number>>((acc, v) => { acc[v.status] = (acc[v.status] || 0) + 1; return acc; }, {});
      addLine(Object.entries(byStatus).map(([k, v]) => `${k}: ${v}`).join(' | ') || 'No vehicles tracked', 'ok');
    } else if (cmd === 'ai') {
      void fetchAI(); addLine('AI assessment refresh triggered', 'ok');
    } else if (cmd === 'clear') {
      setConsoleLines([]);
    } else {
      addLine('Unknown command. Type "help".', 'err');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpi, vehicles, applyRegion]);

  const fetchAI = useCallback(async () => {
    setAiLoading(true); setAiText('');
    const cmd = `You are SONALIT AI. Provide a 3-sentence situation assessment for our East Africa fleet operation: Threat index ${kpi.threat}/100, ${kpi.vehicles} vehicles and ${kpi.devices} Guardian devices tracked, ${kpi.openAlerts} open alerts, ${kpi.zones} geofenced zones configured. Include a risk outlook (improving/stable/deteriorating). Under 100 words, authoritative.`;
    try {
      const r = await api.post('/ai/dispatch', { command: cmd, history: [] });
      setAiText(r.data?.response || '');
    } catch {
      setAiText(`${kpi.openAlerts > 2 ? '⚠' : '●'} ${kpi.openAlerts} open alert${kpi.openAlerts === 1 ? '' : 's'} · Threat index ${kpi.threat}/100 across ${kpi.vehicles} tracked vehicles. ${kpi.openAlerts > 2 ? 'Recommend immediate review of unresolved alerts.' : 'Standard monitoring in effect.'}`);
    }
    setAiLoading(false);
  }, [kpi]);

  const selectedVehicle = useMemo(() => {
    if (!selectedVehicleId) return null;
    const meta = vehiclesMeta.find(v => v.id === selectedVehicleId);
    const tel = telemetry.find(v => v.id === selectedVehicleId);
    const pos = vehicles.find(v => v.id === selectedVehicleId);
    if (!meta && !tel && !pos) return null;
    return { id: selectedVehicleId, meta, tel, pos };
  }, [selectedVehicleId, vehiclesMeta, telemetry, vehicles]);

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-6 h-6 text-cyan-400" />
          <h1 className="text-2xl font-bold text-white">Geofences</h1>
          <span className="flex items-center gap-1.5 text-xs font-bold text-green-400 ml-2">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /> LIVE
          </span>
          <span className="text-xs font-mono font-semibold text-gray-400">{utcClock}</span>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg text-sm font-semibold">
          <Plus className="w-4 h-4" /> New Geofence
        </button>
      </div>

      {/* Stat chips */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatChip label="Threat Index" value={kpi.threat} icon={<AlertTriangle size={18} />} color={kpi.threat > 70 ? 'text-red-400' : kpi.threat > 40 ? 'text-yellow-400' : 'text-cyan-400'} />
        <StatChip label="Open Alerts" value={kpi.openAlerts} icon={<Bell size={18} />} color="text-orange-400" />
        <StatChip label="Zones" value={kpi.zones} icon={<MapIcon size={18} />} color="text-cyan-400" />
        <StatChip label="Vehicles Tracked" value={kpi.vehicles} icon={<Truck size={18} />} color="text-blue-400" />
        <StatChip label="Devices Tracked" value={kpi.devices} icon={<Smartphone size={18} />} color="text-violet-400" />
      </div>

      {/* Search + region filter + console toggle */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vehicles, zones, devices…"
            className="w-full bg-gray-800 border border-gray-700 text-white text-sm font-medium rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:border-cyan-500" />
          {search.length >= 2 && searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg z-30 overflow-hidden shadow-xl">
              {searchResults.map((h, i) => (
                <button key={i} onClick={() => { h.onClick(); setSearch(''); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-700 text-left">
                  <span className="text-xs font-bold text-gray-500 uppercase w-14 shrink-0">{h.type}</span>
                  <span className="font-semibold text-white flex-1 truncate">{h.label}</span>
                  <span className="text-xs text-gray-400 font-medium">{h.sub}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative">
          <button onClick={() => setRegionMenuOpen(o => !o)} className="flex items-center gap-2 bg-gray-800 border border-gray-700 hover:border-cyan-500 text-white px-3 py-2 rounded-lg text-sm font-semibold">
            {regionFilter === 'all' ? 'All Regions' : regionFilter} <ChevronDown size={14} />
          </button>
          {regionMenuOpen && (
            <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg z-30 overflow-hidden min-w-[150px]">
              <button onClick={() => applyRegion('all')} className={`w-full text-left px-3 py-2 text-sm font-semibold hover:bg-gray-700 ${regionFilter === 'all' ? 'text-cyan-400' : 'text-gray-300'}`}>All Regions</button>
              {REGIONS.map(r => (
                <button key={r} onClick={() => applyRegion(r)} className={`w-full text-left px-3 py-2 text-sm font-semibold hover:bg-gray-700 ${regionFilter === r ? 'text-cyan-400' : 'text-gray-300'}`}>{r}</button>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => setConsoleOpen(o => !o)} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${consoleOpen ? 'bg-cyan-900/40 border-cyan-600 text-cyan-300' : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'}`}>Console</button>
      </div>

      {/* Command console */}
      {consoleOpen && (
        <div className="bg-black/90 border border-cyan-700/50 rounded-lg overflow-hidden">
          <div className="px-3 py-1.5 bg-cyan-900/20 text-xs font-bold text-cyan-300 flex justify-between">
            <span>Command Console — Enter to execute</span>
            <span className="text-gray-500 font-semibold">type "help" for commands</span>
          </div>
          <div className="max-h-28 overflow-y-auto px-3 py-2 font-mono text-xs space-y-1">
            {consoleLines.map((l, i) => <div key={i} className={l.c === 'ok' ? 'text-green-400' : l.c === 'err' ? 'text-red-400' : 'text-gray-300'}>{l.t}</div>)}
          </div>
          <input autoFocus value={consoleInput} onChange={e => setConsoleInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && consoleInput.trim()) { runConsoleCmd(consoleInput.trim()); setConsoleInput(''); } if (e.key === 'Escape') setConsoleOpen(false); }}
            placeholder="> _" className="w-full px-3 py-2 bg-transparent border-t border-cyan-900/40 outline-none text-cyan-300 font-mono text-sm font-semibold" />
        </div>
      )}

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

        {/* Drawer tabs */}
        {!leftOpen && (
          <button onClick={() => setLeftOpen(true)} className="absolute left-0 top-1/2 -translate-y-1/2 bg-black/70 backdrop-blur border border-gray-700 border-l-0 rounded-r-lg px-1.5 py-4 text-xs font-bold text-gray-300 [writing-mode:vertical-rl]">
            ALERTS {kpi.openAlerts > 0 && <span className="text-red-400">({kpi.openAlerts})</span>}
          </button>
        )}
        {!rightOpen && (
          <button onClick={() => setRightOpen(true)} className="absolute right-0 top-1/2 -translate-y-1/2 bg-black/70 backdrop-blur border border-gray-700 border-r-0 rounded-l-lg px-1.5 py-4 text-xs font-bold text-gray-300 [writing-mode:vertical-rl]">
            MISSION CONTROL
          </button>
        )}

        {/* Left drawer: Alerts */}
        <div className={`absolute top-0 left-0 h-full w-80 bg-black/90 backdrop-blur border-r border-gray-700 flex flex-col transition-transform duration-300 ${leftOpen ? '' : '-translate-x-full'}`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
            <span className="text-sm font-bold text-white flex items-center gap-2"><Bell size={14} className="text-orange-400" /> Alerts ({alerts.length})</span>
            <button onClick={() => setLeftOpen(false)} className="text-gray-400 hover:text-white"><ChevronLeft size={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {alerts.length === 0 && <div className="text-xs text-gray-500 font-medium text-center py-6">No open alerts.</div>}
            {alerts.map(a => (
              <div key={a.id} className="bg-gray-800 rounded-lg p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold uppercase ${SEVERITY_COLOR[a.severity] ?? 'text-gray-300'}`}>{a.severity}</span>
                  <span className="text-xs text-gray-500 font-medium">{fmtAge(a.created_at)}</span>
                </div>
                <div className="text-sm text-white font-medium">{a.message}</div>
                <div className="text-xs text-gray-400 font-medium">{a.vehicle_reg ?? 'Unassigned'}{a.region ? ` · ${a.region}` : ''}</div>
                <div className="flex gap-2 pt-1">
                  {!a.acknowledged_at && <button onClick={() => acknowledgeAlertMut.mutate(a.id)} className="text-xs font-bold text-cyan-400 hover:text-cyan-300">Acknowledge</button>}
                  {a.acknowledged_at && <button onClick={() => resolveAlertMut.mutate(a.id)} className="text-xs font-bold text-green-400 hover:text-green-300">Resolve</button>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right drawer: Mission Control */}
        <div className={`absolute top-0 right-0 h-full w-80 bg-black/90 backdrop-blur border-l border-gray-700 flex flex-col transition-transform duration-300 ${rightOpen ? '' : 'translate-x-full'}`}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
            <span className="text-sm font-bold text-white">Mission Control</span>
            <button onClick={() => setRightOpen(false)} className="text-gray-400 hover:text-white"><X size={18} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {selectedVehicle ? (
              <div className="bg-gray-800 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-gray-900/60 border-b border-gray-700">
                  <div className="font-bold text-white">{selectedVehicle.meta?.registration ?? selectedVehicle.pos?.registration}</div>
                  <div className="text-xs text-gray-400 font-semibold">{selectedVehicle.meta?.type ?? '—'} · {(selectedVehicle.tel?.status ?? selectedVehicle.pos?.status ?? '—').toUpperCase()}</div>
                </div>
                <div className="p-3 space-y-2 text-sm">
                  <Row icon={<Gauge size={13} />} label="Speed" value={`${Math.round(selectedVehicle.tel?.speed_kmh ?? selectedVehicle.pos?.speed_kmh ?? 0)} km/h`} />
                  <Row icon={<FuelIcon size={13} />} label="Fuel" value={selectedVehicle.tel?.fuel_pct != null ? `${Math.round(selectedVehicle.tel.fuel_pct)}%` : '—'} />
                  <Row icon={<Wifi size={13} />} label="GPS Signal" value={selectedVehicle.tel?.gps_signal_pct != null ? `${Math.round(selectedVehicle.tel.gps_signal_pct)}%` : '—'} />
                  <Row icon={<Truck size={13} />} label="Driver" value={selectedVehicle.meta?.driver_name ?? '—'} />
                  <Row icon={<MapPin size={13} />} label="Region" value={selectedVehicle.meta?.region ?? '—'} />
                </div>
                <div className="grid grid-cols-2 gap-1.5 p-3 pt-0">
                  {VEHICLE_STATUS_ACTIONS.map(a => (
                    <button key={a.status} onClick={() => setVehicleStatusMut.mutate({ id: selectedVehicle.id, status: a.status })}
                      className="text-xs font-semibold bg-gray-700 hover:bg-gray-600 text-white py-1.5 rounded">{a.label}</button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-gray-400 font-medium bg-gray-800 rounded-lg p-3">Select a vehicle marker on the map to view live telemetry and issue commands.</div>
            )}

            <div>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2">Active Assets ({vehicles.length})</div>
              <div className="max-h-40 overflow-y-auto space-y-1.5">
                {vehicles.map(v => (
                  <button key={v.id} onClick={() => { setSelectedVehicleId(v.id); if (mapRef.current) mapRef.current.flyTo({ center: [v.lng, v.lat], zoom: 12, duration: 800 }); }}
                    className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-sm font-semibold ${selectedVehicleId === v.id ? 'bg-cyan-900/40 text-cyan-300' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}>
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: STATUS_COLOR[v.status] ?? '#666' }} />
                    <span className="flex-1 text-left truncate">{v.registration}</span>
                    <span className="text-xs text-gray-500 font-medium">{v.status}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Sparkles size={12} className="text-violet-400" /> AI Situation Assessment</div>
              {aiLoading && <div className="text-xs text-gray-400 font-medium">Analysing…</div>}
              {!aiLoading && aiText && (
                <div className="bg-gradient-to-br from-cyan-950/40 to-violet-950/40 border border-cyan-800/40 rounded-lg p-3 text-sm text-gray-200 leading-relaxed space-y-2">
                  <p>{aiText}</p>
                  <button onClick={fetchAI} className="text-xs font-bold bg-cyan-600 hover:bg-cyan-700 text-white px-3 py-1 rounded">Refresh</button>
                </div>
              )}
              {!aiLoading && !aiText && <button onClick={fetchAI} className="w-full text-xs font-bold bg-cyan-900/40 border border-cyan-700 text-cyan-300 py-2 rounded">Run AI Assessment</button>}
            </div>
          </div>
        </div>

        {/* Situation pod */}
        <div className="absolute bottom-3 right-3 bg-black/80 backdrop-blur border border-gray-700 rounded-lg overflow-hidden min-w-[220px]">
          <div className="px-3 py-1.5 bg-gray-900/60 border-b border-gray-700 flex items-center justify-between">
            <span className="text-xs font-bold text-gray-300 uppercase">Situation Overview</span>
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${topAlert ? SEVERITY_COLOR[topAlert.severity] : 'text-green-400'}`}>{topAlert ? topAlert.severity.toUpperCase() : 'CLEAR'}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 p-3 text-xs">
            <div><div className="text-gray-500 font-semibold">Top Alert</div><div className="font-bold text-white truncate max-w-[110px]">{topAlert?.message ?? 'None'}</div></div>
            <div><div className="text-gray-500 font-semibold">Open Alerts</div><div className="font-bold text-white">{kpi.openAlerts}</div></div>
          </div>
        </div>
      </div>

      {/* Timeline footer: real geofence events */}
      <div className="bg-gray-800 rounded-lg border border-gray-700 flex items-center gap-3 px-3 py-2 overflow-hidden">
        <div className="flex gap-1 shrink-0">
          {['all', 'enter', 'exit', 'dwell_exceeded', 'route_deviation'].map(f => (
            <button key={f} onClick={() => setEventTypeFilter(f)} className={`text-xs font-bold px-2.5 py-1 rounded-full ${eventTypeFilter === f ? 'bg-cyan-900/50 text-cyan-300' : 'text-gray-500 hover:text-gray-300'}`}>
              {f === 'all' ? 'All' : EVENT_LABEL[f]}
            </button>
          ))}
        </div>
        <div className="flex-1 flex gap-2 overflow-x-auto">
          {filteredEvents.length === 0 && <span className="text-xs text-gray-500 font-medium">No events for current filter</span>}
          {filteredEvents.slice(0, 20).map(e => (
            <div key={e.id} className="shrink-0 flex items-center gap-2 bg-gray-900/60 rounded-full px-3 py-1 whitespace-nowrap">
              <Radio size={11} className={EVENT_COLOR[e.event_type] ?? 'text-gray-400'} />
              <span className="text-xs text-gray-400 font-semibold">{fmtAge(e.created_at)}</span>
              <span className="text-xs font-bold text-white">{e.geofence_name ?? 'Zone'}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg w-fit">
        <button onClick={() => setTab('zones')} className={`px-4 py-2 rounded-md text-sm font-semibold ${tab === 'zones' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>Zones ({visibleZones.length})</button>
        <button onClick={() => setTab('events')} className={`px-4 py-2 rounded-md text-sm font-semibold ${tab === 'events' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>Live Events ({events.length})</button>
      </div>

      {tab === 'zones' && (
        <div className="space-y-2">
          {geofencesQ.isLoading && <div className="p-8 text-center text-gray-400 font-semibold">Loading zones…</div>}
          {visibleZones.length === 0 && !geofencesQ.isLoading && (
            <div className="p-8 text-center text-gray-400 font-semibold bg-gray-800 rounded-lg">No geofences yet. Draw one on the map to get started.</div>
          )}
          {visibleZones.map(z => (
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
                  <div className="flex items-center gap-4 text-xs font-semibold text-gray-400">
                    <span className="flex items-center gap-1"><CheckCircle2 size={12} /> {events.filter(e => e.geofence_id === z.id).length} events recorded</span>
                  </div>
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

function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-gray-400 font-semibold"><span className="text-gray-500">{icon}</span>{label}</span>
      <span className="font-bold text-white">{value}</span>
    </div>
  );
}
