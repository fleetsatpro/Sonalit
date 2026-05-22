import { useRef, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Map, Plus, X, ToggleLeft, ToggleRight } from 'lucide-react';

const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

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

// Approximate a circle as a GeoJSON polygon ring
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

// Convert whatever coordinate format the API returns into a closed GeoJSON ring [[lng,lat],...]
function toRing(g: Geofence): number[][] | null {
  const coords = g.coordinates;

  // Polygon array formats
  if (Array.isArray(coords) && coords.length >= 3) {
    if (Array.isArray(coords[0])) {
      // [[lng,lat],...] — standard GeoJSON
      const ring = (coords as unknown[][]).map((p) => [Number(p[0]), Number(p[1])]);
      const first = ring[0]!;
      const last = ring[ring.length - 1]!;
      const closed = first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
      return closed;
    }
    if (coords[0] !== null && typeof coords[0] === 'object') {
      // [{lat,lng},...] or [{latitude,longitude},...]
      type LatLng = { lat?: number; lng?: number; latitude?: number; longitude?: number };
      const ring = (coords as LatLng[]).map((p) => [p.lng ?? p.longitude ?? 0, p.lat ?? p.latitude ?? 0]);
      return [...ring, ring[0]!];
    }
  }

  // Single-point or object: use circle
  if (g.lat != null && g.lng != null) {
    const r = g.radius != null && g.radius > 0 ? g.radius : 5000;
    return circleRing(g.lat, g.lng, r);
  }

  return null;
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateGeofencePayload>({
    name: '',
    trigger: 'both',
    coordinates_json: '',
  });

  const mutation = useMutation({
    mutationFn: (payload: CreateGeofencePayload) => {
      let coordinates: unknown = undefined;
      try {
        coordinates = JSON.parse(payload.coordinates_json);
      } catch {
        // invalid JSON — send raw string
        coordinates = payload.coordinates_json;
      }
      return api.post('/geofences', { name: payload.name, type: payload.trigger, coordinates });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geofences'] });
      onClose();
    },
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
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
              placeholder="Zone Name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Trigger</label>
            <select
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
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
            GeoJSON Coordinates (array of [lng, lat] pairs)
          </label>
          <textarea
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-indigo-500 resize-none"
            rows={4}
            placeholder='[[27.45, -11.28], [27.46, -11.28], [27.46, -11.27], [27.45, -11.27]]'
            value={form.coordinates_json}
            onChange={(e) => setForm((f) => ({ ...f, coordinates_json: e.target.value }))}
          />
        </div>
        {mutation.isError && (
          <p className="text-red-400 text-sm">Failed to create geofence.</p>
        )}
        <button
          onClick={() => mutation.mutate(form)}
          disabled={mutation.isPending || !form.name || !form.coordinates_json}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded text-sm font-medium text-white"
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
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery<Geofence[]>({
    queryKey: ['geofences'],
    queryFn: async () => {
      const res = await api.get<Geofence[]>('/geofences');
      return res.data;
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api.patch(`/geofences/${id}`, { active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['geofences'] }),
  });

  // Initialise map once
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    mapRef.current = new maplibregl.Map({
      container: mapContainer.current,
      style: DARK_STYLE,
      // Default to central Africa — will be overridden by fitBounds when data loads
      center: [27.5, -11.5],
      zoom: 5,
    });
    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  // Draw geofences when data is ready
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;

    const draw = () => {
      // Remove stale layers/sources
      if (map.getSource('geofences')) {
        if (map.getLayer('geofences-fill')) map.removeLayer('geofences-fill');
        if (map.getLayer('geofences-outline')) map.removeLayer('geofences-outline');
        map.removeSource('geofences');
      }

      const features: GeoJSON.Feature<GeoJSON.Polygon>[] = [];
      const bounds = new maplibregl.LngLatBounds();

      for (const g of data) {
        const ring = toRing(g);
        if (!ring || ring.length < 4) continue;
        features.push({
          type: 'Feature',
          properties: { name: g.name, active: g.active },
          geometry: { type: 'Polygon', coordinates: [ring] },
        });
        // Extend bounds using first coordinate of ring
        for (const pt of ring) {
          if (pt[0] != null && pt[1] != null) bounds.extend([pt[0], pt[1]]);
        }
      }

      map.addSource('geofences', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });
      map.addLayer({
        id: 'geofences-fill',
        type: 'fill',
        source: 'geofences',
        paint: { 'fill-color': '#6366f1', 'fill-opacity': 0.25 },
      });
      map.addLayer({
        id: 'geofences-outline',
        type: 'line',
        source: 'geofences',
        paint: { 'line-color': '#6366f1', 'line-width': 2 },
      });

      // Fit map to show all geofences
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 60, maxZoom: 12, duration: 600 });
      }
    };

    if (map.loaded()) draw();
    else map.once('load', draw);
  }, [data]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Map size={20} className="text-indigo-400" />
          <h1 className="text-xl font-bold text-white">Geofences</h1>
          {data && <span className="text-gray-400 text-sm">({data.length} zones)</span>}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm font-medium text-white"
        >
          <Plus size={16} />
          Create Geofence
        </button>
      </div>

      {showForm && <CreateForm onClose={() => setShowForm(false)} />}

      <div className="rounded-xl overflow-hidden border border-gray-800 h-80">
        <div ref={mapContainer} className="w-full h-full" />
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
                    <span className="px-2 py-0.5 bg-gray-800 rounded text-xs capitalize text-gray-300">{g.type ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{g.region ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-400">
                    {g.created_at ? new Date(g.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleMutation.mutate({ id: g.id, active: !g.active })}
                      disabled={toggleMutation.isPending}
                      className="text-gray-400 hover:text-white disabled:opacity-50"
                    >
                      {g.active
                        ? <ToggleRight size={24} className="text-green-400" />
                        : <ToggleLeft size={24} />}
                    </button>
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">No geofences configured.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
