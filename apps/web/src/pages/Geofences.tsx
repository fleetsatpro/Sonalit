import { useRef, useEffect, useState } from 'react';
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
  if (!Array.isArray(coords) || coords.length < 2) return null;
  if (Array.isArray(coords[0])) {
    return (coords as unknown[][]).map((p) => [Number(p[0]), Number(p[1])]);
  }
  if (coords[0] !== null && typeof coords[0] === 'object') {
    type LatLng = { lat?: number; lng?: number; latitude?: number; longitude?: number };
    return (coords as LatLng[]).map((p) => [p.lng ?? p.longitude ?? 0, p.lat ?? p.latitude ?? 0]);
  }
  return null;
}

function isCorridorType(type: string): boolean {
  const t = type.toLowerCase();
  return t === 'corridor' || t === 'linear' || t === 'line' || t === 'linestring' || t === 'route';
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

export default function Geofences() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [isSatellite, setIsSatellite] = useState(false);
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

  // Swap base style when satellite toggle changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(isSatellite ? SATELLITE_STYLE : DARK_STYLE);
  }, [isSatellite]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;

    const draw = () => {
      // Clean up previous layers/sources
      ['geofences-line-fill', 'geofences-line-outline', 'geofences-corridor-line', 'geofences-corridor-border'].forEach((l) => {
        if (map.getLayer(l)) map.removeLayer(l);
      });
      ['geofences-polygons', 'geofences-corridors'].forEach((s) => {
        if (map.getSource(s)) map.removeSource(s);
      });

      const polyFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
      const lineFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
      const bounds = new maplibregl.LngLatBounds();

      for (const g of data) {
        const pts = coordsToPoints(g.coordinates);

        if (!pts) {
          // Circle fallback
          if (g.lat != null && g.lng != null) {
            const ring = circleRing(g.lat, g.lng, g.radius ?? 5000);
            polyFeatures.push({ type: 'Feature', properties: { name: g.name, active: g.active }, geometry: { type: 'Polygon', coordinates: [ring] } });
            bounds.extend([g.lng, g.lat]);
          }
          continue;
        }

        if (isCorridorType(g.type ?? '') || pts.length < 3) {
          // Corridor / linear geofence → LineString
          lineFeatures.push({ type: 'Feature', properties: { name: g.name, active: g.active }, geometry: { type: 'LineString', coordinates: pts } });
          for (const pt of pts) bounds.extend([pt[0]!, pt[1]!]);
        } else {
          // Polygon geofence
          const first = pts[0]!;
          const last = pts[pts.length - 1]!;
          const ring = first[0] === last[0] && first[1] === last[1] ? pts : [...pts, first];
          polyFeatures.push({ type: 'Feature', properties: { name: g.name, active: g.active }, geometry: { type: 'Polygon', coordinates: [ring] } });
          for (const pt of ring) bounds.extend([pt[0]!, pt[1]!]);
        }
      }

      // Polygon layers
      map.addSource('geofences-polygons', { type: 'geojson', data: { type: 'FeatureCollection', features: polyFeatures } });
      map.addLayer({ id: 'geofences-line-fill', type: 'fill', source: 'geofences-polygons', paint: { 'fill-color': '#f07020', 'fill-opacity': 0.18 } });
      map.addLayer({ id: 'geofences-line-outline', type: 'line', source: 'geofences-polygons', paint: { 'line-color': '#f07020', 'line-width': 2 } });

      // Corridor / linear layers
      map.addSource('geofences-corridors', { type: 'geojson', data: { type: 'FeatureCollection', features: lineFeatures } });
      map.addLayer({ id: 'geofences-corridor-border', type: 'line', source: 'geofences-corridors', paint: { 'line-color': '#ff9040', 'line-width': 10, 'line-opacity': 0.15 } });
      map.addLayer({ id: 'geofences-corridor-line', type: 'line', source: 'geofences-corridors', paint: { 'line-color': '#ff9040', 'line-width': 2.5, 'line-dasharray': [4, 2] } });

      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 600 });
    };

    if (map.loaded()) draw();
    else map.once('load', draw);
    map.on('style.load', draw);
    return () => { map.off('style.load', draw); };
  }, [data]);

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
              {data.map((g) => (
                <tr key={g.id} className="border-t border-gray-800 hover:bg-gray-800/40">
                  <td className="px-4 py-3 font-medium text-white">{g.name}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs capitalize ${isCorridorType(g.type ?? '') ? 'bg-amber-900/50 text-amber-300' : 'bg-gray-800 text-gray-300'}`}>
                      {g.type ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{g.region ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400">{g.created_at ? new Date(g.created_at).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleMutation.mutate({ id: g.id, active: !g.active })}
                      disabled={toggleMutation.isPending}
                      className="text-gray-400 hover:text-white disabled:opacity-50"
                    >
                      {g.active ? <ToggleRight size={24} className="text-green-400" /> : <ToggleLeft size={24} />}
                    </button>
                  </td>
                </tr>
              ))}
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
