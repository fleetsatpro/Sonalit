import { useRef, useEffect, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Map, Plus, X, ToggleLeft, ToggleRight, Layers } from 'lucide-react';

const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    'google-sat': {
      type: 'raster',
      tiles: [
        'https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        'https://mt2.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
        'https://mt3.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      ],
      tileSize: 256,
      maxzoom: 22,
      attribution: '© 2024 Google',
    },
  },
  layers: [{ id: 'google-sat', type: 'raster', source: 'google-sat' }],
};

type GeofenceTrigger = 'entry' | 'exit' | 'both';

interface Geofence {
  id: string;
  name: string;
  type: string;
  created_at: string;
  active: boolean;
  coordinates: unknown;
  radius: number | null;
  lat: number | null;
  lng: number | null;
  region: string | null;
}

interface CreateGeofencePayload {
  name: string;
  trigger: GeofenceTrigger;
  coordinates_json: string;
}

function circleRing(lat: number, lng: number, radiusMeters: number, steps = 64): number[][] {
  const coords: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const dx = radiusMeters * Math.cos(angle);
    const dy = radiusMeters * Math.sin(angle);
    const dlat = dy / 111320;
    const dlng = dx / (111320 * Math.cos((lat * Math.PI) / 180));
    coords.push([lng + dlng, lat + dlat]);
  }
  return coords;
}

function coordsToPoints(coords: unknown): number[][] | null {
  if (typeof coords === 'string') {
    try { return coordsToPoints(JSON.parse(coords)); } catch { return null; }
  }
  if (coords !== null && typeof coords === 'object' && !Array.isArray(coords)) {
    const obj = coords as Record<string, unknown>;
    // GeoJSON geometry: {type:'LineString', coordinates:[...]}
    if (Array.isArray(obj['coordinates'])) return coordsToPoints(obj['coordinates']);
    // AI corridor format: {lat, lng, path:[[lat,lng],...], buffer_m, ...}
    // OSRM stores path in lat-first order — swap to GeoJSON [lng,lat]
    if (Array.isArray(obj['path'])) {
      const pts = (obj['path'] as unknown[])
        .map((p) => Array.isArray(p) ? [Number((p as unknown[])[1]), Number((p as unknown[])[0])] : null)
        .filter((p): p is number[] => p !== null && p.length === 2);
      return pts.length >= 2 ? pts : null;
    }
    return null;
  }
  if (!Array.isArray(coords) || coords.length < 2) return null;
  if (Array.isArray(coords[0]) && Array.isArray((coords[0] as unknown[])[0])) {
    return coordsToPoints(coords[0]);
  }
  if (Array.isArray(coords[0])) {
    return (coords as unknown[][]).map((p) => [Number(p[0]), Number(p[1])]);
  }
  if (coords[0] !== null && typeof coords[0] === 'object') {
    type LatLng = { lat?: number; lng?: number; latitude?: number; longitude?: number };
    return (coords as LatLng[]).map((p) => [p.lng ?? p.longitude ?? 0, p.lat ?? p.latitude ?? 0]);
  }
  return null;
}

function isCorridor(g: Geofence, pts: number[][]): boolean {
  const t = (g.type ?? '').toLowerCase();
  if (t === 'corridor' || t === 'linear' || t === 'line' || t === 'linestring' || t === 'route') return true;
  return pts.length === 2;
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateGeofencePayload>({ name: '', trigger: 'both', coordinates_json: '' });

  const mutation = useMutation({
    mutationFn: (payload: CreateGeofencePayload) => {
      let coordinates: unknown = undefined;
      try { coordinates = JSON.parse(payload.coordinates_json); } catch { coordinates = payload.coordinates_json; }
      return api.post('/geofences', { name: payload.name, type: payload.trigger, coordinates });
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['geofences'] }); onClose(); },
  });

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 mb-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold text-white">Create Geofence</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={16} /></button>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name</label>
            <input
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              placeholder="Zone Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Trigger</label>
            <select
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-orange-500"
              value={form.trigger}
              onChange={(e) => setForm((f) => ({ ...f, trigger: e.target.value as GeofenceTrigger }))}
            >
              <option value="entry">Entry</option>
              <option value="exit">Exit</option>
              <option value="both">Both</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            GeoJSON Coordinates — polygon <code>[[lng,lat],…]</code> or corridor line
          </label>
          <textarea
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-orange-500 resize-none"
            rows={4}
            placeholder='[[27.45, -11.28], [27.46, -11.28], [27.46, -11.27], [27.45, -11.27]]'
            value={form.coordinates_json}
            onChange={(e) => setForm((f) => ({ ...f, coordinates_json: e.target.value }))}
          />
        </div>
        {mutation.isError && <p className="text-red-400 text-sm">Failed to create geofence.</p>}
        <button
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending || !form.name || !form.coordinates_json}
          className="px-4 py-2 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 rounded text-sm font-medium text-white transition-colors"
        >
          {mutation.isPending ? 'Creating…' : 'Create Geofence'}
        </button>
      </div>
    </div>
  );
}

const ALL_LAYERS = ['geofences-line-fill', 'geofences-line-outline', 'geofences-corridor-line', 'geofences-corridor-border', 'geofences-sel-poly', 'geofences-sel-line'];
const ALL_SOURCES = ['geofences-polygons', 'geofences-corridors', 'geofences-selected'];

export default function Geofences() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [isSatellite, setIsSatellite] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<Geofence[]>({
    queryKey: ['geofences'],
    queryFn: async () => {
      const res = await api.get<Geofence[] | { data: Geofence[] }>('/geofences');
      const raw = res.data;
      return Array.isArray(raw) ? raw : (raw?.data ?? []);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/geofences/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['geofences'] }),
  });

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    mapRef.current = new maplibregl.Map({
      container: mapContainer.current,
      style: DARK_STYLE,
      center: [27.5, -11.5],
      zoom: 5,
    });
    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(isSatellite ? SATELLITE_STYLE : DARK_STYLE);
  }, [isSatellite]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;

    const draw = () => {
      ALL_LAYERS.forEach((l) => { if (map.getLayer(l)) map.removeLayer(l); });
      ALL_SOURCES.forEach((s) => { if (map.getSource(s)) map.removeSource(s); });

      const polyFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
      const lineFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      const bounds = new maplibregl.LngLatBounds();

      for (const g of data) {
        const pts = coordsToPoints(g.coordinates);

        if (!pts) {
          const t = (g.type ?? '').toLowerCase();
          if (g.lat != null && g.lng != null) {
            if (t === 'corridor' || t === 'linear' || t === 'line' || t === 'route') {
              lineFeatures.push({ type: 'Feature', properties: { id: g.id }, geometry: { type: 'LineString', coordinates: circleRing(g.lat, g.lng, 500).slice(0, 2) } });
            } else {
              polyFeatures.push({ type: 'Feature', properties: { id: g.id }, geometry: { type: 'Polygon', coordinates: [circleRing(g.lat, g.lng, g.radius ?? 5000)] } });
            }
            bounds.extend([g.lng, g.lat]);
          }
          continue;
        }

        if (isCorridor(g, pts)) {
          lineFeatures.push({ type: 'Feature', properties: { id: g.id }, geometry: { type: 'LineString', coordinates: pts } });
          for (const pt of pts) bounds.extend([pt[0]!, pt[1]!]);
        } else {
          const first = pts[0]!;
          const last = pts[pts.length - 1]!;
          const ring = first[0] === last[0] && first[1] === last[1] ? pts : [...pts, first];
          polyFeatures.push({ type: 'Feature', properties: { id: g.id }, geometry: { type: 'Polygon', coordinates: [ring] } });
          for (const pt of ring) bounds.extend([pt[0]!, pt[1]!]);
        }
      }

      map.addSource('geofences-polygons', { type: 'geojson', data: { type: 'FeatureCollection', features: polyFeatures } });
      map.addLayer({ id: 'geofences-line-fill', type: 'fill', source: 'geofences-polygons', paint: { 'fill-color': '#f07020', 'fill-opacity': 0.18 } });
      map.addLayer({ id: 'geofences-line-outline', type: 'line', source: 'geofences-polygons', paint: { 'line-color': '#f07020', 'line-width': 2 } });

      map.addSource('geofences-corridors', { type: 'geojson', data: { type: 'FeatureCollection', features: lineFeatures } });
      map.addLayer({ id: 'geofences-corridor-border', type: 'line', source: 'geofences-corridors', paint: { 'line-color': '#ff9040', 'line-width': 10, 'line-opacity': 0.15 } });
      map.addLayer({ id: 'geofences-corridor-line', type: 'line', source: 'geofences-corridors', paint: { 'line-color': '#ff9040', 'line-width': 2.5, 'line-dasharray': [4, 2] } });

      map.addSource('geofences-selected', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'geofences-sel-poly', type: 'fill', source: 'geofences-selected', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': '#ffffff', 'fill-opacity': 0.12 } });
      map.addLayer({ id: 'geofences-sel-line', type: 'line', source: 'geofences-selected', paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-dasharray': [3, 1.5] } });

      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 600 });
    };

    if (map.loaded()) draw();
    else map.once('load', draw);
    map.on('style.load', draw);
    return () => { map.off('style.load', draw); };
  }, [data]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.loaded()) return;
    const source = map.getSource('geofences-selected') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    if (!selectedId || !data) {
      source.setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const g = data.find((x) => x.id === selectedId);
    if (!g) { source.setData({ type: 'FeatureCollection', features: [] }); return; }

    const pts = coordsToPoints(g.coordinates);
    const features: GeoJSON.Feature[] = [];

    if (pts) {
      if (isCorridor(g, pts)) {
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
      } else {
        const first = pts[0]!;
        const last = pts[pts.length - 1]!;
        const ring = first[0] === last[0] && first[1] === last[1] ? pts : [...pts, first];
        features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } });
      }
    } else if (g.lat != null && g.lng != null) {
      features.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [circleRing(g.lat, g.lng, g.radius ?? 5000)] } });
    }

    source.setData({ type: 'FeatureCollection', features });
  }, [selectedId, data]);

  const flyToGeofence = useCallback((g: Geofence) => {
    const map = mapRef.current;
    if (!map) return;
    const pts = coordsToPoints(g.coordinates);
    if (pts && pts.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      for (const pt of pts) bounds.extend([pt[0]!, pt[1]!]);
      if (!bounds.isEmpty()) { map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 800 }); return; }
    }
    if (g.lat != null && g.lng != null) {
      map.flyTo({ center: [g.lng, g.lat], zoom: 13, duration: 800 });
    }
  }, []);

  const handleRowClick = useCallback((g: Geofence) => {
    setSelectedId((prev) => (prev === g.id ? null : g.id));
    flyToGeofence(g);
  }, [flyToGeofence]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Map size={20} className="text-orange-400" />
          <h1 className="text-xl font-bold text-white">Geofences</h1>
          {data && <span className="text-gray-400 text-sm">({data.length} zones)</span>}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 bg-orange-600 hover:bg-orange-500 rounded-lg text-sm font-medium text-white transition-colors"
        >
          <Plus size={16} /> Create Geofence
        </button>
      </div>

      {showForm && <CreateForm onClose={() => setShowForm(false)} />}

      <div className="rounded-xl overflow-hidden border border-gray-800 relative" style={{ height: 420 }}>
        <div ref={mapContainer} className="w-full h-full" />
        <button
          onClick={() => setIsSatellite((v) => !v)}
          className="absolute bottom-4 left-4 z-10 flex items-center gap-1.5 bg-gray-900/90 hover:bg-gray-800 text-white text-xs font-medium px-3 py-2 rounded-lg border border-gray-700 shadow-lg transition-colors"
        >
          <Layers size={13} /> {isSatellite ? 'Dark' : 'Satellite'}
        </button>
        {selectedId && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-gray-900/90 border border-gray-700 text-gray-300 text-xs px-3 py-1.5 rounded-full pointer-events-none">
            {data?.find((g) => g.id === selectedId)?.name} — click row again to deselect
          </div>
        )}
      </div>

      {isLoading && <div className="text-gray-400 text-sm text-center">Loading geofences…</div>}
      {isError && <div className="text-red-400 text-sm text-center">Failed to load geofences.</div>}

      {data && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-950 text-gray-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Region</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-left">Active</th>
              </tr>
            </thead>
            <tbody>
              {data.map((g) => {
                const isSelected = g.id === selectedId;
                return (
                  <tr
                    key={g.id}
                    onClick={() => handleRowClick(g)}
                    className={`border-t border-gray-800 cursor-pointer transition-colors ${isSelected ? 'bg-orange-900/20 border-l-2 border-l-orange-500' : 'hover:bg-gray-800/40'}`}
                  >
                    <td className={`px-4 py-3 font-medium ${isSelected ? 'text-orange-300' : 'text-white'}`}>{g.name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs capitalize ${isCorridor(g, coordsToPoints(g.coordinates) ?? []) ? 'bg-amber-900/50 text-amber-300' : 'bg-gray-800 text-gray-300'}`}>
                        {g.type ?? '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{g.region ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400">{g.created_at ? new Date(g.created_at).toLocaleDateString() : '—'}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleMutation.mutate({ id: g.id, active: !g.active }); }}
                        disabled={toggleMutation.isPending}
                        className="text-gray-400 hover:text-white disabled:opacity-50"
                      >
                        {g.active ? <ToggleRight size={24} className="text-green-400" /> : <ToggleLeft size={24} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {data.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">No geofences configured.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
