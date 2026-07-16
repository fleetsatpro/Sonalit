import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useDashboardStore } from '../../stores/dashboardStore.js';

interface MapConvoy { id: string; name: string; status: string; lat: number | null; lng: number | null; heading: number; color: string }
interface AlertZone { lat: number; lng: number; radius_m: number; severity: string }
interface MapVehicle { id: string; registration: string; lat: number; lng: number; heading: number; status: string; speed_kmh: number }
interface MapDevice { id: string; name: string; model?: string; assignment_type?: string; lat: number; lng: number; status: string; speed_kmh: number; panic_active: boolean; last_seen?: string | null }
interface MapGeofence { id: string; name: string; type: string; lat: number | null; lng: number | null; radius_m: number; path?: [number, number][] | null; buffer_m?: number | null }
interface MapRiskZone { id: string; name: string; risk_level: string; lat: number; lng: number; radius_km: number }
interface MapData { convoys: MapConvoy[]; alert_zones: AlertZone[]; vehicles?: MapVehicle[]; devices?: MapDevice[]; geofences?: MapGeofence[]; riskzones?: MapRiskZone[] }
interface VehicleTelemetry { id: string; registration: string; convoy_id: string | null; status: string; speed_kmh: number; fuel_pct: number | null; engine_temp_c: number | null; gps_signal_pct: number | null; last_ping_at: string | null }

const EA_CENTER: [number, number] = [35.5, 1.2];
const EA_ZOOM = 5.2;
const GAUGE_PATH = 'M 31.1 98.9 A 48 48 0 1 1 98.9 98.9';
const ARC_LEN = 226.2;

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

const STREET_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' as const, paint: { 'raster-opacity': 1 } }],
};
// Satellite imagery + Esri reference layer (place names, country/admin boundaries, major roads)
const SAT_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    sat: { type: 'raster', tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: '© Esri, Maxar, GeoEye, Earthstar Geographics' },
    'sat-ref': { type: 'raster', tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Reference_Overlay/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: '© Esri Reference Overlay' },
  },
  layers: [
    { id: 'sat-tiles', type: 'raster', source: 'sat' as const, paint: { 'raster-opacity': 1 } },
    { id: 'sat-ref-tiles', type: 'raster', source: 'sat-ref' as const, paint: { 'raster-opacity': 0.9 } },
  ],
};

// Status → color. Drives both vehicle and device markers.
// alert/panic = red, warn = amber, moving = green, idle = gray, offline = dim gray
const STATUS_COLOR_EXPR: maplibregl.ExpressionSpecification = [
  'match', ['get', 'status'],
  'panic',   '#ff1e1e',
  'alert',   '#ff4422',
  'warn',    '#ff9040',
  'moving',  '#22c55e',
  'idle',    '#888888',
  'offline', '#444444',
  '#666666',
];

function setupMapLayers(map: maplibregl.Map) {
  const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
  map.addSource('sv-vehicles',  { type: 'geojson', data: empty });
  map.addSource('sv-devices',   { type: 'geojson', data: empty });
  map.addSource('sv-geofences', { type: 'geojson', data: empty });
  map.addSource('sv-risk',      { type: 'geojson', data: empty });
  map.addSource('sv-alerts',    { type: 'geojson', data: empty });

  map.addLayer({ id: 'sv-risk-fill', type: 'fill', source: 'sv-risk', paint: {
    'fill-color': ['case', ['==', ['get', 'risk_level'], 'critical'], '#ff2200', ['==', ['get', 'risk_level'], 'high'], '#ff6600', '#ffaa00'],
    'fill-opacity': 0.07,
  }});
  map.addLayer({ id: 'sv-risk-line', type: 'line', source: 'sv-risk', paint: {
    'line-color': ['case', ['==', ['get', 'risk_level'], 'critical'], '#ff2200', ['==', ['get', 'risk_level'], 'high'], '#ff6600', '#ffaa00'],
    'line-width': 1, 'line-opacity': 0.45, 'line-dasharray': [4, 4],
  }});
  map.addLayer({ id: 'sv-alerts-fill', type: 'fill', source: 'sv-alerts', paint: { 'fill-color': '#ff4422', 'fill-opacity': 0.1 }});
  map.addLayer({ id: 'sv-alerts-line', type: 'line', source: 'sv-alerts', paint: { 'line-color': '#ff4422', 'line-width': 1.5, 'line-opacity': 0.6 }});
  map.addLayer({ id: 'sv-geofences-fill', type: 'fill', source: 'sv-geofences',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': '#00ffcc', 'fill-opacity': 0.14 },
  });
  map.addLayer({ id: 'sv-geofences-line', type: 'line', source: 'sv-geofences',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'line-color': '#00ffcc', 'line-width': 1.8, 'line-opacity': 0.85, 'line-dasharray': [6, 3] },
  });
  map.addLayer({ id: 'sv-geofences-corridor-bg', type: 'line', source: 'sv-geofences',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#38bdf8', 'line-width': 12, 'line-opacity': 0.18 },
  });
  map.addLayer({ id: 'sv-geofences-corridor-line', type: 'line', source: 'sv-geofences',
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': '#38bdf8', 'line-width': 2.5, 'line-opacity': 0.9, 'line-dasharray': [4, 2] },
  });
  map.addLayer({ id: 'sv-geofences-label', type: 'symbol', source: 'sv-geofences', layout: {
    'text-field': ['get', 'name'],
    'text-size': 10, 'text-anchor': 'center',
    'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
    'text-allow-overlap': false, 'text-optional': true,
    'symbol-placement': 'point',
  }, paint: {
    'text-color': '#00ffcc', 'text-halo-color': '#000000', 'text-halo-width': 1.5,
  }});

  // Vehicles: triangle-ish square markers
  map.addLayer({ id: 'sv-vehicles-glow', type: 'circle', source: 'sv-vehicles', paint: {
    'circle-radius': 14,
    'circle-color': STATUS_COLOR_EXPR,
    'circle-opacity': 0.18, 'circle-blur': 1,
  }});
  map.addLayer({ id: 'sv-vehicles-dot', type: 'circle', source: 'sv-vehicles', paint: {
    'circle-radius': 7,
    'circle-color': STATUS_COLOR_EXPR,
    'circle-stroke-width': 2, 'circle-stroke-color': '#000000', 'circle-opacity': 0.95,
  }});
  map.addLayer({ id: 'sv-vehicles-label', type: 'symbol', source: 'sv-vehicles', layout: {
    'text-field': ['get', 'registration'],
    'text-size': 9, 'text-offset': [0, 1.4], 'text-anchor': 'top',
    'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
    'text-allow-overlap': false, 'text-optional': true,
  }, paint: {
    'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.5,
  }});

  // Devices: smaller, diamond-style halo to distinguish from vehicles
  map.addLayer({ id: 'sv-devices-glow', type: 'circle', source: 'sv-devices', paint: {
    'circle-radius': ['case', ['==', ['get', 'status'], 'panic'], 22, 10],
    'circle-color': STATUS_COLOR_EXPR,
    'circle-opacity': ['case', ['==', ['get', 'status'], 'panic'], 0.35, 0.15],
    'circle-blur': 1,
  }});
  map.addLayer({ id: 'sv-devices-dot', type: 'circle', source: 'sv-devices', paint: {
    'circle-radius': 5,
    'circle-color': STATUS_COLOR_EXPR,
    'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff', 'circle-opacity': 0.95,
  }});
  // Devices (Guardian officer phones) previously had no on-map label at all —
  // just a colored dot, so identifying WHO a dot was or their live state
  // meant leaving this widget for the GPS Live page. This tag (name + state)
  // is what makes Tactical Map a glanceable HUD rather than a duplicate of
  // GPS Live's click-to-inspect officer markers.
  map.addLayer({ id: 'sv-devices-label', type: 'symbol', source: 'sv-devices', layout: {
    'text-field': ['concat', ['get', 'name'], '  ·  ', ['upcase', ['get', 'status']]],
    'text-size': 9, 'text-offset': [0, 1.1], 'text-anchor': 'top',
    'text-font': ['Open Sans Regular', 'Arial Unicode MS Regular'],
    'text-allow-overlap': false, 'text-optional': true,
  }, paint: {
    'text-color': '#ffffff', 'text-halo-color': '#000000', 'text-halo-width': 1.5,
  }});
}

function updateMapData(map: maplibregl.Map, data: MapData) {
  const setData = (name: string, fc: GeoJSON.FeatureCollection) =>
    (map.getSource(name) as maplibregl.GeoJSONSource | undefined)?.setData(fc);

  setData('sv-vehicles', {
    type: 'FeatureCollection',
    features: (data.vehicles ?? []).map(v => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [v.lng, v.lat] },
      properties: { id: v.id, registration: v.registration, status: v.status, speed_kmh: v.speed_kmh },
    })),
  });
  setData('sv-devices', {
    type: 'FeatureCollection',
    features: (data.devices ?? []).map(d => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [d.lng, d.lat] },
      properties: { id: d.id, name: d.name, status: d.status, panic_active: d.panic_active },
    })),
  });
  setData('sv-geofences', {
    type: 'FeatureCollection',
    features: (data.geofences ?? []).reduce<GeoJSON.Feature[]>((acc, g) => {
      if ((g.type === 'corridor' || g.type === 'linear') && Array.isArray(g.path) && g.path.length >= 2) {
        const coords = g.path.map(([lat, lng]) => [lng ?? 0, lat ?? 0] as [number, number]);
        acc.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: { id: g.id, name: g.name } });
      } else if (g.lat != null && g.lng != null) {
        acc.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [geoCircle(g.lat, g.lng, g.radius_m / 1000)] }, properties: { id: g.id, name: g.name } });
      }
      return acc;
    }, []),
  });
  setData('sv-risk', {
    type: 'FeatureCollection',
    features: (data.riskzones ?? []).map(r => ({
      type: 'Feature', geometry: { type: 'Polygon', coordinates: [geoCircle(r.lat, r.lng, r.radius_km)] },
      properties: { id: r.id, name: r.name, risk_level: r.risk_level },
    })),
  });
  setData('sv-alerts', {
    type: 'FeatureCollection',
    features: (data.alert_zones ?? []).map((z, i) => ({
      type: 'Feature', geometry: { type: 'Polygon', coordinates: [geoCircle(z.lat, z.lng, z.radius_m / 1000)] },
      properties: { severity: z.severity, idx: i },
    })),
  });
}

function gaugeOffset(value: number, max: number): number { return ARC_LEN * (1 - Math.min(1, value / max)); }
function gaugeColor(type: string, value: number | null): string {
  if (value == null) return 'var(--d-t4)';
  switch (type) {
    case 'speed':  return value >= 100 ? 'var(--d-fire)' : value >= 80 ? 'var(--d-warn)' : 'var(--d-sig)';
    case 'fuel':   return value <= 25  ? 'var(--d-fire)' : value <= 50 ? 'var(--d-warn)' : 'var(--d-sig)';
    case 'temp':   return value >= 100 ? 'var(--d-fire)' : value >= 90 ? 'var(--d-warn)' : 'var(--d-ok)';
    case 'signal': return value <= 50  ? 'var(--d-fire)' : value <= 80 ? 'var(--d-warn)' : 'var(--d-sig)';
    default: return 'var(--d-sig)';
  }
}

function Gauge({ label, value, max, unit, type }: { label: string; value: number | null; max: number; unit: string; type: string }) {
  const pathRef = useRef<SVGPathElement>(null);
  const color = gaugeColor(type, value);
  const target = value != null ? gaugeOffset(value, max) : ARC_LEN;
  useEffect(() => {
    const el = pathRef.current; if (!el) return;
    el.style.strokeDashoffset = String(ARC_LEN);
    requestAnimationFrame(() => { el.style.transition = 'stroke-dashoffset 1s ease, stroke .4s'; el.style.strokeDashoffset = String(target); el.style.stroke = color; });
  }, [target, color]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg viewBox='0 0 130 130' width={80} height={80} style={{ overflow: 'visible' }}>
        <path d={GAUGE_PATH} fill='none' stroke='var(--d-lift2)' strokeWidth={8} strokeLinecap='round' />
        <path ref={pathRef} d={GAUGE_PATH} fill='none' stroke={color} strokeWidth={8} strokeLinecap='round' strokeDasharray={ARC_LEN} strokeDashoffset={ARC_LEN} style={{ willChange: 'stroke-dashoffset' }} />
        <text x={65} y={72} textAnchor='middle' fill={value != null ? 'var(--d-t1)' : 'var(--d-t4)'} fontFamily='Orbitron, sans-serif' fontWeight={700} fontSize={18}>{value != null ? Math.round(value) : '—'}</text>
        <text x={65} y={86} textAnchor='middle' fill='var(--d-t3)' fontFamily='IBM Plex Mono, monospace' fontSize={9}>{unit}</text>
      </svg>
      <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', letterSpacing: '.06em', textAlign: 'center' }}>{label}</div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t4)', letterSpacing: '.06em' }}>{label}</span>
    </div>
  );
}

const TacticalMap = React.memo(function TacticalMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);
  const pendingDataRef = useRef<MapData | null>(null);
  const markerRafRef = useRef<Map<string, number>>(new Map());
  const vehiclePositions = useDashboardStore((s) => s.vehiclePositions);
  const selectedVehicleId = useDashboardStore((s) => s.selectedVehicleId);
  const { setSelectedVehicle } = useDashboardStore.getState();
  const [expanded, setExpanded] = useState(false);
  const [mapStyle, setMapStyle] = useState<'street' | 'satellite'>('street');
  const currentDataRef = useRef<MapData | null>(null);

  const { data: mapData } = useQuery<MapData>({
    queryKey: ['dashboard-map'],
    queryFn: async () => { const r = await api.get<MapData>('/dashboard/map'); return r.data; },
    staleTime: 30000, refetchInterval: 60000,
  });

  const { data: vehicles } = useQuery<VehicleTelemetry[]>({
    queryKey: ['dashboard-vehicles'],
    queryFn: async () => { const r = await api.get<{ data: VehicleTelemetry[] }>('/dashboard/vehicles'); return r.data.data ?? []; },
    staleTime: 15000, refetchInterval: 30000,
  });

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: STREET_STYLE,
      center: EA_CENTER, zoom: EA_ZOOM, attributionControl: false,
    });
    map.on('error', () => {});
    map.on('load', () => {
      setupMapLayers(map);
      mapReadyRef.current = true;
      if (pendingDataRef.current) { updateMapData(map, pendingDataRef.current); pendingDataRef.current = null; }
    });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; mapReadyRef.current = false; };
  }, []);

  useEffect(() => {
    if (!mapData) return;
    currentDataRef.current = mapData;
    if (mapReadyRef.current && mapRef.current) {
      updateMapData(mapRef.current, mapData);
    } else {
      pendingDataRef.current = mapData;
    }
  }, [mapData]);

  // Switch base map style between street and satellite
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const style = mapStyle === 'satellite' ? SAT_STYLE : STREET_STYLE;
    mapReadyRef.current = false;
    map.setStyle(style);
    const onLoad = () => {
      setupMapLayers(map);
      mapReadyRef.current = true;
      if (currentDataRef.current) updateMapData(map, currentDataRef.current);
    };
    map.once('style.load', onLoad);
    return () => { map.off('style.load', onLoad); };
  }, [mapStyle]);

  useEffect(() => {
    vehiclePositions.forEach((pos, vehicleId) => {
      const existing = markerRafRef.current.get(vehicleId);
      if (existing) cancelAnimationFrame(existing);
      const el = document.getElementById(`convoy-marker-${vehicleId}`);
      if (!el || !mapRef.current) return;
      const map = mapRef.current;
      const startLng = parseFloat(el.dataset['lng'] ?? String(pos.lng));
      const startLat = parseFloat(el.dataset['lat'] ?? String(pos.lat));
      let startTime: number | null = null;
      const animate = (time: number) => {
        if (!startTime) startTime = time;
        const t = Math.min(1, (time - startTime) / 800);
        const ease = 1 - Math.pow(1 - t, 2);
        const lng = startLng + (pos.lng - startLng) * ease;
        const lat = startLat + (pos.lat - startLat) * ease;
        const projected = map.project([lng, lat]);
        el.style.transform = `translate(${projected.x}px, ${projected.y}px) rotate(${pos.heading}deg)`;
        el.dataset['lng'] = String(lng); el.dataset['lat'] = String(lat);
        if (t < 1) markerRafRef.current.set(vehicleId, requestAnimationFrame(animate));
      };
      markerRafRef.current.set(vehicleId, requestAnimationFrame(animate));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehiclePositions]);

  const selectedVehicle = vehicles?.find(v => v.id === selectedVehicleId) ?? vehicles?.[0] ?? null;
  const panicActive = useDashboardStore((s) => s.panicState?.status === 'active');
  // Radar color: red during panic, green normally
  const rc  = panicActive ? '255,30,30'  : '34,197,94';
  const sig = panicActive ? '#ff1e1e'    : 'var(--d-sig)';

  // Resize map when container size changes (e.g. expand/collapse)
  useEffect(() => {
    if (mapRef.current) setTimeout(() => mapRef.current?.resize(), 50);
  }, [expanded]);

  // Escape key closes fullscreen
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [expanded]);

  return (
    <div style={expanded ? { position: 'fixed', inset: 0, zIndex: 500, background: 'var(--d-void)', display: 'flex', flexDirection: 'column', padding: 0 } : { padding: '16px 16px 0' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap', rowGap: 6, ...(expanded && { padding: '12px 16px 0' }) }}>
        <div style={{ width: 3, height: 14, background: 'var(--d-orange)', borderRadius: 2, flexShrink: 0 }} />
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>TACTICAL MAP</span>
        <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)' }}>East Africa · Live</span>
        <div style={{ flex: 1 }} />
        <LegendDot color='#22c55e' label='OK' />
        <LegendDot color='#ff9040' label='WARN' />
        <LegendDot color='#ff4422' label='ALERT' />
        <LegendDot color='#ff1e1e' label='PANIC' />
        <LegendDot color='#888888' label='IDLE' />
        {/* Layer switcher */}
        <button
          onClick={() => setMapStyle(s => s === 'street' ? 'satellite' : 'street')}
          title={mapStyle === 'street' ? 'Switch to satellite view' : 'Switch to street view'}
          style={{ background: mapStyle === 'satellite' ? 'rgba(249,115,22,.15)' : 'var(--d-lift2)', border: `1px solid ${mapStyle === 'satellite' ? 'var(--d-orange)' : 'var(--d-rim2)'}`, borderRadius: 6, color: mapStyle === 'satellite' ? 'var(--d-orange)' : 'var(--d-t2)', cursor: 'pointer', padding: '4px 8px', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.06em', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
        >
          {mapStyle === 'street' ? 'SAT' : 'STR'}
        </button>
        {/* Expand / collapse button */}
        <button
          onClick={() => setExpanded(v => !v)}
          title={expanded ? 'Exit fullscreen' : 'Expand map'}
          style={{ background: 'var(--d-lift2)', border: '1px solid var(--d-rim2)', borderRadius: 6, color: 'var(--d-t2)', cursor: 'pointer', padding: '4px 8px', fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.06em', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
        >
          {expanded ? '⊠ EXIT' : '⊞ EXPAND'}
        </button>
      </div>

      {/* Map container */}
      <div style={{ position: 'relative', borderRadius: expanded ? 0 : 12, overflow: 'hidden', border: '1px solid var(--d-rim2)', marginBottom: expanded ? 0 : 12, flex: expanded ? 1 : undefined }}>
        <div ref={mapContainer} style={{ width: '100%', height: expanded ? '100%' : 420, background: 'var(--d-deep)', ...(expanded && { position: 'absolute', inset: 0 }) }} />

        {/* Radar — own 160×160 square SVG so rings stay circular on all widths */}
        <div style={{ position: 'absolute', top: 8, left: 8, pointerEvents: 'none', width: 160, height: 160 }}>
          {/* Glass backdrop — keeps radar legible on bright satellite tiles */}
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,0,0,.55) 60%, rgba(0,0,0,.15) 85%, transparent 100%)', backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)' }} />
          <svg width={160} height={160} viewBox='0 0 160 160' style={{ position: 'relative' }}>
            {/* HUD corner brackets */}
            <path d='M8 20 L8 8 L20 8' fill='none' stroke={`rgba(${rc},.5)`} strokeWidth={1.5} strokeLinecap='square' />
            <path d='M140 8 L152 8 L152 20' fill='none' stroke={`rgba(${rc},.5)`} strokeWidth={1.5} strokeLinecap='square' />
            <path d='M8 140 L8 152 L20 152' fill='none' stroke={`rgba(${rc},.5)`} strokeWidth={1.5} strokeLinecap='square' />
            <path d='M140 152 L152 152 L152 140' fill='none' stroke={`rgba(${rc},.5)`} strokeWidth={1.5} strokeLinecap='square' />
            {/* Rings: outer solid, rest dashed */}
            <circle cx={80} cy={80} r={68} fill='none' stroke={`rgba(${rc},.22)`} strokeWidth={1} />
            <circle cx={80} cy={80} r={51} fill='none' stroke={`rgba(${rc},.12)`} strokeWidth={1} strokeDasharray='4 4' />
            <circle cx={80} cy={80} r={34} fill='none' stroke={`rgba(${rc},.10)`} strokeWidth={1} strokeDasharray='4 4' />
            <circle cx={80} cy={80} r={17} fill='none' stroke={`rgba(${rc},.08)`} strokeWidth={1} strokeDasharray='3 3' />
            {/* Crosshair axes */}
            <line x1={12} y1={80} x2={148} y2={80} stroke={`rgba(${rc},.08)`} strokeWidth={0.5} />
            <line x1={80} y1={12} x2={80} y2={148} stroke={`rgba(${rc},.08)`} strokeWidth={0.5} />
            {/* Cardinal labels */}
            <text x={80} y={8}   textAnchor='middle' fill={`rgba(${rc},.55)`} fontSize={7} fontFamily='IBM Plex Mono, monospace' letterSpacing='.04em'>N</text>
            <text x={80} y={158} textAnchor='middle' fill={`rgba(${rc},.35)`} fontSize={7} fontFamily='IBM Plex Mono, monospace' letterSpacing='.04em'>S</text>
            <text x={155} y={83} textAnchor='start'  fill={`rgba(${rc},.35)`} fontSize={7} fontFamily='IBM Plex Mono, monospace' letterSpacing='.04em'>E</text>
            <text x={4}   y={83} textAnchor='end'    fill={`rgba(${rc},.35)`} fontSize={7} fontFamily='IBM Plex Mono, monospace' letterSpacing='.04em'>W</text>
            {/* Rotating sweep group — CCW comet tail behind clockwise arm */}
            <g>
              <animateTransform attributeName='transform' type='rotate' from='0 80 80' to='360 80 80' dur={panicActive ? '2s' : '6s'} repeatCount='indefinite' />
              {/* arm=north(80,12); 45°CCW→NW(31.92,31.92); 90°CCW→W(12,80); 135°CCW→SW(31.92,128.08) */}
              <path d='M 80 80 L 80 12 A 68 68 0 0 0 31.92 31.92' fill={`rgba(${rc},.22)`} />
              <path d='M 80 80 L 31.92 31.92 A 68 68 0 0 0 12 80'      fill={`rgba(${rc},.12)`} />
              <path d='M 80 80 L 12 80 A 68 68 0 0 0 31.92 128.08'  fill={`rgba(${rc},.05)`} />
              {/* Arm: glow then crisp line */}
              <line x1={80} y1={80} x2={80} y2={12} stroke={`rgba(${rc},.38)`} strokeWidth={panicActive ? 8 : 5} strokeLinecap='round' />
              <line x1={80} y1={80} x2={80} y2={12} stroke={sig} strokeWidth={1.5} strokeLinecap='round' />
            </g>
            {/* Centre reticle */}
            <circle cx={80} cy={80} r={4} fill='none' stroke={`rgba(${rc},.45)`} strokeWidth={1} />
            <circle cx={80} cy={80} r={2} fill={`rgba(${rc},.9)`} />
            <line x1={76} y1={80} x2={84} y2={80} stroke={`rgba(${rc},.65)`} strokeWidth={1} />
            <line x1={80} y1={76} x2={80} y2={84} stroke={`rgba(${rc},.65)`} strokeWidth={1} />
          </svg>
        </div>

        {/* Convoy markers via RAF-animated DOM elements */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          {(mapData?.convoys ?? []).filter(c => c.lat && c.lng).map(c => {
            const proj = mapRef.current?.project([c.lng!, c.lat!]);
            const ix = proj ? proj.x : (((c.lng ?? 0) - 22) / 27) * 400;
            const iy = proj ? proj.y : (1 - ((c.lat ?? 0) + 3.6) / 9.6) * 280;
            return (
              <div key={c.id} id={`convoy-marker-${c.id}`} data-lng={c.lng} data-lat={c.lat}
                style={{ position: 'absolute', top: 0, left: 0, transform: `translate(${ix}px, ${iy}px) rotate(${c.heading}deg)`, willChange: 'transform' }}>
                <svg width={18} height={18} viewBox='0 0 18 18' style={{ marginLeft: -9, marginTop: -9 }}>
                  <circle cx={9} cy={9} r={8} fill='none' stroke={c.color} strokeWidth={1.5} opacity={0.4} />
                  <circle cx={9} cy={9} r={4.5} fill={c.color} opacity={0.85} />
                  <circle cx={9} cy={9} r={2} fill={c.color} />
                </svg>
              </div>
            );
          })}
        </div>

        {/* HUD grid overlay */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: `linear-gradient(rgba(${rc},.02) 1px, transparent 1px), linear-gradient(90deg, rgba(${rc},.02) 1px, transparent 1px)`, backgroundSize: '30px 30px' }} />
        {/* Scanline */}
        <div style={{ position: 'absolute', left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, rgba(${rc},.18), transparent)`, animation: `d-scanv ${panicActive ? '1.5s' : '4s'} linear infinite`, pointerEvents: 'none' }} />
        {/* Edge vignette */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at 50% 50%, transparent 65%, rgba(0,0,0,.28))' }} />
      </div>

      {/* Vehicle chips */}
      {vehicles && vehicles.length > 0 && (
        <div className='d-hscroll' style={{ marginBottom: 12, gap: 8, paddingBottom: 6 }}>
          {vehicles.map(v => (
            <button key={v.id} onClick={() => setSelectedVehicle(v.id === selectedVehicleId ? null : v.id)}
              style={{ flex: '0 0 auto', scrollSnapAlign: 'start', padding: '6px 12px', background: v.id === selectedVehicleId ? 'var(--d-sg)' : 'var(--d-well)', border: `1px solid ${v.id === selectedVehicleId ? 'var(--d-sig)' : 'var(--d-rim2)'}`, borderRadius: 6, cursor: 'pointer', color: v.id === selectedVehicleId ? 'var(--d-sig)' : 'var(--d-t2)', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
            >{v.registration}</button>
          ))}
        </div>
      )}

      {/* Telemetry row */}
      {selectedVehicle && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', padding: '10px 12px', background: 'var(--d-well)', borderRadius: 8, border: '1px solid var(--d-rim2)' }}>
          <TelItem label='Speed' value={`${Math.round(selectedVehicle.speed_kmh)} km/h`} />
          <TelItem label='Status' value={selectedVehicle.status.toUpperCase()} color={selectedVehicle.status === 'alert' ? 'var(--d-fire)' : selectedVehicle.status === 'moving' ? 'var(--d-ok)' : 'var(--d-t3)'} />
          <TelItem label='Last Ping' value={selectedVehicle.last_ping_at ? relSec(selectedVehicle.last_ping_at) + 's ago' : '—'} />
        </div>
      )}

      {/* Gauges */}
      {selectedVehicle && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
          <Gauge label='SPEED' value={selectedVehicle.speed_kmh} max={120} unit='km/h' type='speed' />
          <Gauge label='FUEL' value={selectedVehicle.fuel_pct} max={100} unit='%' type='fuel' />
          <Gauge label='ENGINE' value={selectedVehicle.engine_temp_c} max={120} unit='°C' type='temp' />
          <Gauge label='GPS SIG' value={selectedVehicle.gps_signal_pct} max={100} unit='%' type='signal' />
        </div>
      )}

      <FleetBars vehicles={vehicles ?? []} />
    </div>
  );
});

function TelItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', letterSpacing: '.06em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: color ?? 'var(--d-t1)', fontFamily: 'IBM Plex Mono, monospace' }}>{value}</div>
    </div>
  );
}

function FleetBars({ vehicles }: { vehicles: VehicleTelemetry[] }) {
  const total = vehicles.length;
  if (total === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
      <FleetBar label='In Transit' count={vehicles.filter(v => v.status === 'moving').length} total={total} color='var(--d-sig)' />
      <FleetBar label='Idle'       count={vehicles.filter(v => v.status === 'idle').length}   total={total} color='var(--d-t3)' />
      <FleetBar label='Alert'      count={vehicles.filter(v => v.status === 'alert').length}  total={total} color='var(--d-fire)' />
    </div>
  );
}

function FleetBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current; if (!el) return;
    requestAnimationFrame(() => { el.style.transition = 'width 1.2s ease'; el.style.width = `${pct}%`; });
  }, [pct]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', width: 70, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 4, background: 'var(--d-lift2)', borderRadius: 2, overflow: 'hidden' }}>
        <div ref={barRef} style={{ height: '100%', width: 0, background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 11, fontWeight: 700, color, width: 20, textAlign: 'right', flexShrink: 0 }}>{count}</span>
    </div>
  );
}

function relSec(iso: string): number { return Math.floor((Date.now() - new Date(iso).getTime()) / 1000); }

export default TacticalMap;
