import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { api } from '../lib/api.js';
import { geoCircle, fmtAge } from '../lib/geoMath.js';
import {
  MapPin, Plus, Bell, Truck, Smartphone, Radio,
  Circle as CircleIcon, Waypoints, ChevronDown, Search,
  AlertTriangle,
} from 'lucide-react';
import BootSplash from '../components/geofences/BootSplash.js';
import Compass from '../components/geofences/Compass.js';
import AlertsDrawer from '../components/geofences/AlertsDrawer.js';
import MissionControlDrawer from '../components/geofences/MissionControlDrawer.js';
import ZoneCard from '../components/geofences/ZoneCard.js';
import CreateGeofenceModal from '../components/geofences/CreateGeofenceModal.js';
import {
  STATUS_COLOR, REGIONS, REGION_BOUNDS, EA_CENTER, EA_ZOOM, EVENT_LABEL, EVENT_COLOR, SEVERITY_COLOR, SEVERITY_WEIGHT,
} from '../components/geofences/types.js';
import type {
  MapData, Geofence, GeofenceEvent, GeofenceAction, VehicleMeta, VehicleTelemetry, AlertRow, MapVehicle,
} from '../components/geofences/types.js';

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
  const [form, setForm] = useState({ name: '', region: REGIONS[0]!, radius: '2000', buffer_km: '2' });
  const [newAction, setNewAction] = useState({ action_type: 'sms', recipient: '', message_template: '' });

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

  const mapQ = useQuery<MapData>({ queryKey: ['geofence-map-data'], queryFn: async () => (await api.get<MapData>('/dashboard/map')).data, refetchInterval: 15_000 });
  const geofencesQ = useQuery<{ data: Geofence[] }>({ queryKey: ['geofences-list'], queryFn: () => api.get('/geofences').then(r => ({ data: Array.isArray(r.data) ? r.data : r.data?.data ?? [] })) });
  const eventsQ = useQuery<{ data: GeofenceEvent[] }>({ queryKey: ['geofence-events'], queryFn: () => api.get('/geofences/events?limit=150').then(r => r.data), refetchInterval: 20_000 });
  const actionsQ = useQuery<{ data: GeofenceAction[] }>({ queryKey: ['geofence-actions', expandedId], queryFn: () => api.get(`/geofences/${expandedId}/actions`).then(r => r.data), enabled: !!expandedId });
  const vehiclesMetaQ = useQuery<{ data: VehicleMeta[] }>({ queryKey: ['geofence-vehicles-meta'], queryFn: () => api.get('/vehicles?limit=200').then(r => r.data) });
  const telemetryQ = useQuery<{ data: VehicleTelemetry[] }>({ queryKey: ['geofence-vehicle-telemetry'], queryFn: () => api.get('/dashboard/vehicles').then(r => r.data), refetchInterval: 20_000 });
  const alertsQ = useQuery<{ data: AlertRow[] }>({ queryKey: ['geofence-alerts'], queryFn: () => api.get('/alerts?limit=50&resolved=false').then(r => r.data), refetchInterval: 20_000 });
  // Broader (resolved + unresolved) recent alerts, used only for the real trend deltas in Mission Control.
  const allAlertsQ = useQuery<{ data: AlertRow[] }>({ queryKey: ['geofence-alerts-all'], queryFn: () => api.get('/alerts?limit=200').then(r => r.data), refetchInterval: 60_000 });

  const coreQueries = [mapQ, geofencesQ, eventsQ, vehiclesMetaQ, alertsQ];
  const bootLoaded = coreQueries.filter(q => !q.isLoading).length;
  const bootReady = bootLoaded === coreQueries.length;

  const vehicles = mapQ.data?.vehicles ?? [];
  const devices = mapQ.data?.devices ?? [];
  const mapGeofences = mapQ.data?.geofences ?? [];
  const zones = geofencesQ.data?.data ?? [];
  const events = eventsQ.data?.data ?? [];
  const vehiclesMeta = vehiclesMetaQ.data?.data ?? [];
  const telemetry = telemetryQ.data?.data ?? [];
  const alerts = alertsQ.data?.data ?? [];
  const allAlerts = allAlertsQ.data?.data ?? [];

  const regionVehicleIds = useMemo(() => regionFilter === 'all' ? null : new Set(vehiclesMeta.filter(v => v.region === regionFilter).map(v => v.id)), [vehiclesMeta, regionFilter]);
  const visibleVehicles = useMemo(() => regionVehicleIds ? vehicles.filter(v => regionVehicleIds.has(v.id)) : vehicles, [vehicles, regionVehicleIds]);
  const visibleZones = useMemo(() => regionFilter === 'all' ? zones : zones.filter(z => z.region === regionFilter), [zones, regionFilter]);

  const invalidateZones = () => { qc.invalidateQueries({ queryKey: ['geofences-list'] }); qc.invalidateQueries({ queryKey: ['geofence-map-data'] }); };

  const createMut = useMutation({
    mutationFn: (body: object) => api.post('/geofences', body),
    onSuccess: () => { invalidateZones(); setShowCreate(false); setDrawMode(null); setDrawCenter(null); setDrawPath([]); setForm({ name: '', region: REGIONS[0]!, radius: '2000', buffer_km: '2' }); },
  });
  const toggleActiveMut = useMutation({ mutationFn: ({ id, active }: { id: string; active: boolean }) => api.patch(`/geofences/${id}`, { active }), onSuccess: invalidateZones });
  const deleteMut = useMutation({ mutationFn: (id: string) => api.delete(`/geofences/${id}`), onSuccess: invalidateZones });
  const addActionMut = useMutation({
    mutationFn: (body: object) => api.post(`/geofences/${expandedId}/actions`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['geofence-actions', expandedId] }); setNewAction({ action_type: 'sms', recipient: '', message_template: '' }); },
  });
  const toggleActionMut = useMutation({ mutationFn: (actionId: string) => api.patch(`/geofences/${expandedId}/actions/${actionId}/toggle`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['geofence-actions', expandedId] }) });
  const deleteActionMut = useMutation({ mutationFn: (actionId: string) => api.delete(`/geofences/${expandedId}/actions/${actionId}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['geofence-actions', expandedId] }) });
  const acknowledgeAlertMut = useMutation({ mutationFn: (id: string) => api.patch(`/alerts/${id}/acknowledge`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['geofence-alerts'] }) });
  const resolveAlertMut = useMutation({ mutationFn: (id: string) => api.patch(`/alerts/${id}/resolve`, {}), onSuccess: () => qc.invalidateQueries({ queryKey: ['geofence-alerts'] }) });
  const setVehicleStatusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/vehicles/${id}/status`, { status }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['geofence-vehicles-meta'] }); qc.invalidateQueries({ queryKey: ['geofence-vehicle-telemetry'] }); qc.invalidateQueries({ queryKey: ['geofence-map-data'] }); },
  });
  // Real escalation: files one alert per real vehicle currently on the corridor.
  const escalateMut = useMutation({
    mutationFn: async ({ vehicleIds, corridorName }: { vehicleIds: string[]; corridorName: string }) => {
      await Promise.all(vehicleIds.map(vehicleId => api.post('/alerts', {
        vehicleId, type: 'geofence', severity: 'high', message: `Route deviation risk — corridor "${corridorName}" escalated by dispatcher`,
      }, { headers: { 'X-Idempotency-Key': `corridor-escalate-${vehicleId}-${Date.now()}` } })));
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['geofence-alerts'] }); qc.invalidateQueries({ queryKey: ['geofence-alerts-all'] }); },
  });

  useEffect(() => {
    const t = setInterval(() => setUtcClock(new Date().toISOString().slice(11, 19) + ' UTC'), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: mapEl.current, style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json', center: EA_CENTER, zoom: EA_ZOOM });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    map.on('load', () => { mapReadyRef.current = true; });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; mapReadyRef.current = false; };
  }, []);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !drawMode) return;
    const handler = (e: maplibregl.MapMouseEvent) => {
      const pt: [number, number] = [e.lngLat.lat, e.lngLat.lng];
      if (drawMode === 'circle') setDrawCenter(pt); else setDrawPath(prev => [...prev, pt]);
    };
    m.on('click', handler);
    return () => { m.off('click', handler); };
  }, [drawMode]);

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

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const render = () => {
      ['gf-zone-fill', 'gf-zone-line', 'gf-corridor-glow', 'gf-corridor-line', 'gf-vehicles-glow', 'gf-vehicles-dot', 'gf-devices-glow', 'gf-devices-dot', 'gf-draw-fill', 'gf-draw-line']
        .forEach(id => { if (m.getLayer(id)) m.removeLayer(id); });
      ['gf-zone-src', 'gf-corridor-src', 'gf-vehicles-src', 'gf-devices-src', 'gf-draw-src'].forEach(id => { if (m.getSource(id)) m.removeSource(id); });

      const circleFeatures: GeoJSON.Feature[] = [];
      const corridorFeatures: GeoJSON.Feature[] = [];
      const visibleZoneIds = new Set(visibleZones.map(z => z.id));
      mapGeofences.filter(g => regionFilter === 'all' || visibleZoneIds.has(g.id)).forEach(g => {
        if (g.type === 'corridor' && g.path && g.path.length >= 2) {
          corridorFeatures.push({ type: 'Feature', properties: { name: g.name }, geometry: { type: 'LineString', coordinates: g.path.map(([lat, lng]) => [lng, lat]) } });
        } else if (g.lat != null && g.lng != null) {
          circleFeatures.push({ type: 'Feature', properties: { name: g.name }, geometry: { type: 'Polygon', coordinates: [geoCircle(g.lat, g.lng, (g.radius_m || 1000) / 1000)] } });
        }
      });
      m.addSource('gf-zone-src', { type: 'geojson', data: { type: 'FeatureCollection', features: circleFeatures } });
      m.addLayer({ id: 'gf-zone-fill', type: 'fill', source: 'gf-zone-src', paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.08 } });
      m.addLayer({ id: 'gf-zone-line', type: 'line', source: 'gf-zone-src', paint: { 'line-color': '#22d3ee', 'line-width': 1.5, 'line-dasharray': [4, 3] } });
      m.addSource('gf-corridor-src', { type: 'geojson', data: { type: 'FeatureCollection', features: corridorFeatures } });
      m.addLayer({ id: 'gf-corridor-glow', type: 'line', source: 'gf-corridor-src', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#38bdf8', 'line-width': 14, 'line-opacity': 0.15 } });
      m.addLayer({ id: 'gf-corridor-line', type: 'line', source: 'gf-corridor-src', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#38bdf8', 'line-width': 2.5, 'line-dasharray': [3, 2] } });

      const vehicleFeatures: GeoJSON.Feature[] = visibleVehicles.map(v => ({ type: 'Feature', properties: { id: v.id, registration: v.registration, status: v.status }, geometry: { type: 'Point', coordinates: [v.lng, v.lat] } }));
      m.addSource('gf-vehicles-src', { type: 'geojson', data: { type: 'FeatureCollection', features: vehicleFeatures } });
      const statusColorExpr: maplibregl.ExpressionSpecification = ['match', ['get', 'status'], 'panic', STATUS_COLOR['panic']!, 'alert', STATUS_COLOR['alert']!, 'warn', STATUS_COLOR['warn']!, 'moving', STATUS_COLOR['moving']!, 'idle', STATUS_COLOR['idle']!, 'offline', STATUS_COLOR['offline']!, '#666666'];
      m.addLayer({ id: 'gf-vehicles-glow', type: 'circle', source: 'gf-vehicles-src', paint: { 'circle-radius': 13, 'circle-color': statusColorExpr, 'circle-opacity': 0.2, 'circle-blur': 1 } });
      m.addLayer({ id: 'gf-vehicles-dot', type: 'circle', source: 'gf-vehicles-src', paint: { 'circle-radius': 6, 'circle-color': statusColorExpr, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#000', 'circle-opacity': 0.95 } });

      const deviceFeatures: GeoJSON.Feature[] = devices.map(d => ({ type: 'Feature', properties: { id: d.id, name: d.name, status: d.status }, geometry: { type: 'Point', coordinates: [d.lng, d.lat] } }));
      m.addSource('gf-devices-src', { type: 'geojson', data: { type: 'FeatureCollection', features: deviceFeatures } });
      m.addLayer({ id: 'gf-devices-glow', type: 'circle', source: 'gf-devices-src', paint: { 'circle-radius': ['case', ['==', ['get', 'status'], 'panic'], 20, 9], 'circle-color': statusColorExpr, 'circle-opacity': ['case', ['==', ['get', 'status'], 'panic'], 0.35, 0.15], 'circle-blur': 1 } });
      m.addLayer({ id: 'gf-devices-dot', type: 'circle', source: 'gf-devices-src', paint: { 'circle-radius': 4.5, 'circle-color': statusColorExpr, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff', 'circle-opacity': 0.95 } });

      const drawFeatures: GeoJSON.Feature[] = [];
      if (drawMode === 'circle' && drawCenter) drawFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [geoCircle(drawCenter[0], drawCenter[1], parseFloat(form.radius || '2000') / 1000)] } });
      else if (drawMode === 'corridor' && drawPath.length >= 2) drawFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: drawPath.map(([lat, lng]) => [lng, lat]) } });
      m.addSource('gf-draw-src', { type: 'geojson', data: { type: 'FeatureCollection', features: drawFeatures } });
      m.addLayer({ id: 'gf-draw-fill', type: 'fill', source: 'gf-draw-src', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#f97316', 'fill-opacity': 0.15 } });
      m.addLayer({ id: 'gf-draw-line', type: 'line', source: 'gf-draw-src', paint: { 'line-color': '#f97316', 'line-width': 2.5 } });
    };
    if (mapReadyRef.current) render(); else m.once('load', render);
    m.on('style.load', render);
    return () => { m.off('style.load', render); };
  }, [visibleVehicles, devices, mapGeofences, visibleZones, regionFilter, drawMode, drawCenter, drawPath, form.radius]);

  const startDraw = useCallback((mode: DrawMode) => { setDrawMode(mode); setDrawCenter(null); setDrawPath([]); setShowCreate(false); }, []);
  const finishDraw = useCallback(() => setShowCreate(true), []);
  const cancelDraw = useCallback(() => { setDrawMode(null); setDrawCenter(null); setDrawPath([]); }, []);
  const submitCreate = useCallback(() => {
    if (drawMode === 'circle' && drawCenter) createMut.mutate({ name: form.name, type: 'circle', lat: drawCenter[0], lng: drawCenter[1], radius: parseFloat(form.radius), region: form.region });
    else if (drawMode === 'corridor' && drawPath.length >= 2) createMut.mutate({ name: form.name, type: 'corridor', region: form.region, coordinates: { path: drawPath, buffer_m: parseFloat(form.buffer_km) * 1000 } });
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

  const topAlert = useMemo(() => [...alerts].sort((a, b) => (SEVERITY_WEIGHT[b.severity] ?? 0) - (SEVERITY_WEIGHT[a.severity] ?? 0))[0] ?? null, [alerts]);
  const filteredEvents = useMemo(() => eventTypeFilter === 'all' ? events : events.filter(e => e.event_type === eventTypeFilter), [events, eventTypeFilter]);

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
    devices.filter(d => d.name.toLowerCase().includes(q)).slice(0, 4).forEach(d => hits.push({ type: 'device', label: d.name, sub: d.status, onClick: () => { if (mapRef.current) mapRef.current.flyTo({ center: [d.lng, d.lat], zoom: 12, duration: 800 }); } }));
    return hits;
  }, [search, vehiclesMeta, vehicles, zones, devices]);

  const fetchAI = useCallback(async () => {
    setAiLoading(true); setAiText('');
    const cmd = `You are SONALIT AI. Provide a 3-sentence situation assessment for our East Africa fleet operation: Threat index ${kpi.threat}/100, ${kpi.vehicles} vehicles and ${kpi.devices} Guardian devices tracked, ${kpi.openAlerts} open alerts, ${kpi.zones} geofenced zones configured. Include a risk outlook (improving/stable/deteriorating). Under 100 words, authoritative.`;
    try { const r = await api.post('/ai/dispatch', { command: cmd, history: [] }); setAiText(r.data?.response || ''); }
    catch { setAiText(`${kpi.openAlerts > 2 ? '⚠' : '●'} ${kpi.openAlerts} open alert${kpi.openAlerts === 1 ? '' : 's'} · Threat index ${kpi.threat}/100 across ${kpi.vehicles} tracked vehicles. ${kpi.openAlerts > 2 ? 'Recommend immediate review of unresolved alerts.' : 'Standard monitoring in effect.'}`); }
    setAiLoading(false);
  }, [kpi]);

  const runConsoleCmd = useCallback((raw: string) => {
    const addLine = (t: string, c: string) => setConsoleLines(l => [...l.slice(-29), { t, c }]);
    addLine('> ' + raw, 'info');
    const cmd = raw.toLowerCase().trim();
    if (cmd === 'help') ['help — show commands', 'status — situation report', 'region <name> — filter (kenya/drc/tanzania/mali/all)', 'assets — count vehicles by status', 'ai — refresh AI assessment', 'clear — clear console'].forEach(l => addLine(l, 'info'));
    else if (cmd === 'status') addLine(`THREAT INDEX: ${kpi.threat}/100 | ZONES: ${kpi.zones} | VEHICLES: ${kpi.vehicles} | DEVICES: ${kpi.devices} | OPEN ALERTS: ${kpi.openAlerts}`, 'ok');
    else if (cmd.startsWith('region ')) {
      const r = raw.trim().split(' ')[1] ?? '';
      const match = r.toLowerCase() === 'all' ? 'all' : REGIONS.find(x => x.toLowerCase() === r.toLowerCase());
      if (match) { applyRegion(match); addLine('Region filter: ' + match, 'ok'); } else addLine('Unknown region. Try: kenya, drc, tanzania, mali, all', 'err');
    } else if (cmd === 'assets') {
      const byStatus = vehicles.reduce<Record<string, number>>((acc, v) => { acc[v.status] = (acc[v.status] || 0) + 1; return acc; }, {});
      addLine(Object.entries(byStatus).map(([k, v]) => `${k}: ${v}`).join(' | ') || 'No vehicles tracked', 'ok');
    } else if (cmd === 'ai') { void fetchAI(); addLine('AI assessment refresh triggered', 'ok'); }
    else if (cmd === 'clear') setConsoleLines([]);
    else addLine('Unknown command. Type "help".', 'err');
  }, [kpi, vehicles, applyRegion, fetchAI]);

  const selectedVehicle = useMemo(() => {
    if (!selectedVehicleId) return null;
    const meta = vehiclesMeta.find(v => v.id === selectedVehicleId);
    const tel = telemetry.find(v => v.id === selectedVehicleId);
    const pos = vehicles.find(v => v.id === selectedVehicleId);
    if (!meta && !tel && !pos) return null;
    return { id: selectedVehicleId, meta, tel, pos };
  }, [selectedVehicleId, vehiclesMeta, telemetry, vehicles]);

  const selectVehicle = useCallback((v: MapVehicle) => {
    setSelectedVehicleId(v.id);
    if (mapRef.current) mapRef.current.flyTo({ center: [v.lng, v.lat], zoom: 12, duration: 800 });
  }, []);

  if (!bootReady) return <BootSplash loaded={bootLoaded} total={coreQueries.length} />;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-6 h-6 text-cyan-400" />
          <h1 className="text-2xl font-bold text-white">Geofences</h1>
          <span className="flex items-center gap-1.5 text-xs font-bold text-green-400 ml-2"><span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" /> LIVE</span>
          <span className="text-xs font-mono font-semibold text-gray-400">{utcClock}</span>
        </div>
        <button onClick={() => setShowCreate(true)} className="flex items-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg text-sm font-semibold"><Plus className="w-4 h-4" /> New Geofence</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatChip label="Threat Index" value={kpi.threat} icon={<AlertTriangle size={18} />} color={kpi.threat > 70 ? 'text-red-400' : kpi.threat > 40 ? 'text-yellow-400' : 'text-cyan-400'} />
        <StatChip label="Open Alerts" value={kpi.openAlerts} icon={<Bell size={18} />} color="text-orange-400" />
        <StatChip label="Zones" value={kpi.zones} icon={<MapPin size={18} />} color="text-cyan-400" />
        <StatChip label="Vehicles Tracked" value={kpi.vehicles} icon={<Truck size={18} />} color="text-blue-400" />
        <StatChip label="Devices Tracked" value={kpi.devices} icon={<Smartphone size={18} />} color="text-violet-400" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vehicles, zones, devices…" className="w-full bg-gray-800 border border-gray-700 text-white text-sm font-medium rounded-lg pl-9 pr-3 py-2 focus:outline-none focus:border-cyan-500" />
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
          <button onClick={() => setRegionMenuOpen(o => !o)} className="flex items-center gap-2 bg-gray-800 border border-gray-700 hover:border-cyan-500 text-white px-3 py-2 rounded-lg text-sm font-semibold">{regionFilter === 'all' ? 'All Regions' : regionFilter} <ChevronDown size={14} /></button>
          {regionMenuOpen && (
            <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded-lg z-30 overflow-hidden min-w-[150px]">
              <button onClick={() => applyRegion('all')} className={`w-full text-left px-3 py-2 text-sm font-semibold hover:bg-gray-700 ${regionFilter === 'all' ? 'text-cyan-400' : 'text-gray-300'}`}>All Regions</button>
              {REGIONS.map(r => <button key={r} onClick={() => applyRegion(r)} className={`w-full text-left px-3 py-2 text-sm font-semibold hover:bg-gray-700 ${regionFilter === r ? 'text-cyan-400' : 'text-gray-300'}`}>{r}</button>)}
            </div>
          )}
        </div>
        <button onClick={() => setConsoleOpen(o => !o)} className={`px-3 py-2 rounded-lg text-sm font-semibold border ${consoleOpen ? 'bg-cyan-900/40 border-cyan-600 text-cyan-300' : 'bg-gray-800 border-gray-700 text-gray-300 hover:text-white'}`}>Console</button>
      </div>

      {consoleOpen && (
        <div className="bg-black/90 border border-cyan-700/50 rounded-lg overflow-hidden">
          <div className="px-3 py-1.5 bg-cyan-900/20 text-xs font-bold text-cyan-300 flex justify-between"><span>Command Console — Enter to execute</span><span className="text-gray-500 font-semibold">type "help" for commands</span></div>
          <div className="max-h-28 overflow-y-auto px-3 py-2 font-mono text-xs space-y-1">{consoleLines.map((l, i) => <div key={i} className={l.c === 'ok' ? 'text-green-400' : l.c === 'err' ? 'text-red-400' : 'text-gray-300'}>{l.t}</div>)}</div>
          <input autoFocus value={consoleInput} onChange={e => setConsoleInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && consoleInput.trim()) { runConsoleCmd(consoleInput.trim()); setConsoleInput(''); } if (e.key === 'Escape') setConsoleOpen(false); }} placeholder="> _" className="w-full px-3 py-2 bg-transparent border-t border-cyan-900/40 outline-none text-cyan-300 font-mono text-sm font-semibold" />
        </div>
      )}

      <div className="relative rounded-lg overflow-hidden border border-gray-700">
        <div ref={mapEl} style={{ width: '100%', height: 480, background: '#050f18' }} />

        <div className="absolute top-3 left-3 bg-black/70 backdrop-blur rounded-lg border border-gray-700 px-3 py-2 flex flex-col gap-1.5 text-xs font-semibold">
          <LegendRow color={STATUS_COLOR['moving']!} label="Moving" />
          <LegendRow color={STATUS_COLOR['idle']!} label="Idle" />
          <LegendRow color={STATUS_COLOR['warn']!} label="Warning" />
          <LegendRow color={STATUS_COLOR['alert']!} label="Alert / Panic" />
          <LegendRow color={STATUS_COLOR['offline']!} label="Offline" />
        </div>

        <Compass heading={selectedVehicle?.pos?.heading ?? null} label={selectedVehicle?.meta?.registration ?? selectedVehicle?.pos?.registration ?? 'No vehicle selected'} />

        <div className="absolute top-3 right-3 flex flex-col items-end gap-2">
          {!drawMode && (
            <div className="flex gap-2">
              <button onClick={() => startDraw('circle')} className="flex items-center gap-1.5 bg-black/70 backdrop-blur border border-gray-700 hover:border-cyan-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"><CircleIcon size={14} /> Draw Circle Zone</button>
              <button onClick={() => startDraw('corridor')} className="flex items-center gap-1.5 bg-black/70 backdrop-blur border border-gray-700 hover:border-cyan-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"><Waypoints size={14} /> Draw Corridor</button>
            </div>
          )}
          {drawMode === 'circle' && (
            <div className="bg-black/80 backdrop-blur border border-orange-500/50 rounded-lg px-3 py-2 text-xs font-semibold text-white space-y-2">
              <div>{drawCenter ? 'Center placed — adjust radius, then Continue' : 'Click the map to place the zone center'}</div>
              {drawCenter && <input type="number" value={form.radius} onChange={e => setForm(p => ({ ...p, radius: e.target.value }))} placeholder="Radius (m)" className="w-full bg-gray-800 text-white px-2 py-1 rounded text-xs" />}
              <div className="flex gap-2"><button onClick={cancelDraw} className="flex-1 px-2 py-1 rounded bg-gray-700 hover:bg-gray-600">Cancel</button>{drawCenter && <button onClick={finishDraw} className="flex-1 px-2 py-1 rounded bg-orange-600 hover:bg-orange-700">Continue</button>}</div>
            </div>
          )}
          {drawMode === 'corridor' && (
            <div className="bg-black/80 backdrop-blur border border-orange-500/50 rounded-lg px-3 py-2 text-xs font-semibold text-white space-y-2">
              <div>{drawPath.length} point{drawPath.length === 1 ? '' : 's'} — click to add, need at least 2</div>
              <input type="number" value={form.buffer_km} onChange={e => setForm(p => ({ ...p, buffer_km: e.target.value }))} placeholder="Buffer width (km)" className="w-full bg-gray-800 text-white px-2 py-1 rounded text-xs" />
              <div className="flex gap-2"><button onClick={cancelDraw} className="flex-1 px-2 py-1 rounded bg-gray-700 hover:bg-gray-600">Cancel</button><button onClick={finishDraw} disabled={drawPath.length < 2} className="flex-1 px-2 py-1 rounded bg-orange-600 hover:bg-orange-700 disabled:opacity-40">Continue</button></div>
            </div>
          )}
        </div>

        {!leftOpen && <button onClick={() => setLeftOpen(true)} className="absolute left-0 top-1/2 -translate-y-1/2 bg-black/70 backdrop-blur border border-gray-700 border-l-0 rounded-r-lg px-1.5 py-4 text-xs font-bold text-gray-300 [writing-mode:vertical-rl]">ALERTS {kpi.openAlerts > 0 && <span className="text-red-400">({kpi.openAlerts})</span>}</button>}
        {!rightOpen && <button onClick={() => setRightOpen(true)} className="absolute right-0 top-1/2 -translate-y-1/2 bg-black/70 backdrop-blur border border-gray-700 border-r-0 rounded-l-lg px-1.5 py-4 text-xs font-bold text-gray-300 [writing-mode:vertical-rl]">MISSION CONTROL</button>}

        <AlertsDrawer open={leftOpen} onClose={() => setLeftOpen(false)} alerts={alerts} onAcknowledge={id => acknowledgeAlertMut.mutate(id)} onResolve={id => resolveAlertMut.mutate(id)} />
        <MissionControlDrawer
          open={rightOpen} onClose={() => setRightOpen(false)} selectedVehicle={selectedVehicle} vehicles={vehicles}
          selectedVehicleId={selectedVehicleId} onSelectVehicle={selectVehicle}
          onSetStatus={(id, status) => setVehicleStatusMut.mutate({ id, status })}
          allAlerts={allAlerts} events={events} aiText={aiText} aiLoading={aiLoading} onFetchAI={fetchAI}
        />

        <div className="absolute bottom-3 right-3 bg-black/80 backdrop-blur border border-gray-700 rounded-lg overflow-hidden min-w-[220px]">
          <div className="px-3 py-1.5 bg-gray-900/60 border-b border-gray-700 flex items-center justify-between"><span className="text-xs font-bold text-gray-300 uppercase">Situation Overview</span><span className={`text-xs font-bold px-2 py-0.5 rounded ${topAlert ? SEVERITY_COLOR[topAlert.severity] : 'text-green-400'}`}>{topAlert ? topAlert.severity.toUpperCase() : 'CLEAR'}</span></div>
          <div className="grid grid-cols-2 gap-2 p-3 text-xs">
            <div><div className="text-gray-500 font-semibold">Top Alert</div><div className="font-bold text-white truncate max-w-[110px]">{topAlert?.message ?? 'None'}</div></div>
            <div><div className="text-gray-500 font-semibold">Open Alerts</div><div className="font-bold text-white">{kpi.openAlerts}</div></div>
          </div>
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg border border-gray-700 flex items-center gap-3 px-3 py-2 overflow-hidden">
        <div className="flex gap-1 shrink-0">{['all', 'enter', 'exit', 'dwell_exceeded', 'route_deviation'].map(f => <button key={f} onClick={() => setEventTypeFilter(f)} className={`text-xs font-bold px-2.5 py-1 rounded-full ${eventTypeFilter === f ? 'bg-cyan-900/50 text-cyan-300' : 'text-gray-500 hover:text-gray-300'}`}>{f === 'all' ? 'All' : EVENT_LABEL[f]}</button>)}</div>
        <div className="flex-1 flex gap-2 overflow-x-auto">
          {filteredEvents.length === 0 && <span className="text-xs text-gray-500 font-medium">No events for current filter</span>}
          {filteredEvents.slice(0, 20).map(e => <div key={e.id} className="shrink-0 flex items-center gap-2 bg-gray-900/60 rounded-full px-3 py-1 whitespace-nowrap"><Radio size={11} className={EVENT_COLOR[e.event_type] ?? 'text-gray-400'} /><span className="text-xs text-gray-400 font-semibold">{fmtAge(e.created_at)}</span><span className="text-xs font-bold text-white">{e.geofence_name ?? 'Zone'}</span></div>)}
        </div>
      </div>

      <div className="flex gap-1 bg-gray-800 p-1 rounded-lg w-fit">
        <button onClick={() => setTab('zones')} className={`px-4 py-2 rounded-md text-sm font-semibold ${tab === 'zones' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>Zones ({visibleZones.length})</button>
        <button onClick={() => setTab('events')} className={`px-4 py-2 rounded-md text-sm font-semibold ${tab === 'events' ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}>Live Events ({events.length})</button>
      </div>

      {tab === 'zones' && (
        <div className="space-y-2">
          {geofencesQ.isLoading && <div className="p-8 text-center text-gray-400 font-semibold">Loading zones…</div>}
          {visibleZones.length === 0 && !geofencesQ.isLoading && <div className="p-8 text-center text-gray-400 font-semibold bg-gray-800 rounded-lg">No geofences yet. Draw one on the map to get started.</div>}
          {visibleZones.map(z => (
            <ZoneCard
              key={z.id}
              zone={z}
              mapGeofence={mapGeofences.find(g => g.id === z.id)}
              vehicles={vehicles}
              events={events}
              expanded={expandedId === z.id}
              onToggleExpand={() => setExpandedId(id => id === z.id ? null : z.id)}
              onToggleActive={() => toggleActiveMut.mutate({ id: z.id, active: !z.active })}
              onDelete={() => deleteMut.mutate(z.id)}
              actions={expandedId === z.id ? (actionsQ.data?.data ?? []) : []}
              newAction={newAction}
              setNewAction={setNewAction}
              onAddAction={() => addActionMut.mutate(newAction)}
              onToggleAction={id => toggleActionMut.mutate(id)}
              onDeleteAction={id => deleteActionMut.mutate(id)}
              addActionPending={addActionMut.isPending}
              escalating={escalateMut.isPending}
              onEscalate={vehicleIds => escalateMut.mutate({ vehicleIds, corridorName: z.name })}
            />
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

      {showCreate && (
        <CreateGeofenceModal
          drawMode={drawMode} drawCenter={drawCenter} drawPath={drawPath} form={form} setForm={setForm}
          onStartDraw={startDraw} onClose={() => { setShowCreate(false); cancelDraw(); }} onSubmit={submitCreate}
          submitting={createMut.isPending} error={createMut.isError}
        />
      )}
    </div>
  );
}

function StatChip({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-3 flex items-center gap-3">
      <div className={color}>{icon}</div>
      <div><div className="text-xl font-bold leading-none text-white">{value}</div><div className="text-xs text-gray-400 font-semibold mt-1">{label}</div></div>
    </div>
  );
}

function LegendRow({ color, label }: { color: string; label: string }) {
  return <div className="flex items-center gap-2"><div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} /><span className="text-gray-200">{label}</span></div>;
}
