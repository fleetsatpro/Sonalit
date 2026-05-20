import { useRef, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Map, Plus, X, ToggleLeft, ToggleRight } from 'lucide-react';

type GeofenceType = 'entry' | 'exit' | 'both';

interface Geofence {
  id: string;
  name: string;
  type: GeofenceType;
  created_at: string;
  active: boolean;
  coordinates: number[][];
}

interface CreateGeofencePayload {
  name: string;
  type: GeofenceType;
  coordinates_json: string;
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<CreateGeofencePayload>({
    name: '',
    type: 'both',
    coordinates_json: '',
  });

  const mutation = useMutation({
    mutationFn: (payload: CreateGeofencePayload) => {
      let coordinates: number[][] = [];
      try {
        coordinates = JSON.parse(payload.coordinates_json) as number[][];
      } catch {
        // invalid JSON — pass raw
      }
      return api.post('/geofences', { name: payload.name, type: payload.type, coordinates });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['geofences'] });
      onClose();
    },
  });

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-semibold">Create Geofence</h3>
        <button onClick={onClose}><X size={16} /></button>
      </div>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Name</label>
            <input
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              placeholder="Warehouse Zone A"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Type</label>
            <select
              className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as GeofenceType }))}
            >
              <option value="entry">Entry</option>
              <option value="exit">Exit</option>
              <option value="both">Both</option>
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            GeoJSON Coordinates (paste array of [lng, lat] pairs)
          </label>
          <textarea
            className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-blue-500 resize-none"
            rows={4}
            placeholder='[[36.82, -1.29], [36.83, -1.29], [36.83, -1.28], [36.82, -1.28]]'
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
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-medium"
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

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    mapRef.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://demotiles.maplibre.org/style.json',
      center: [36.817, -1.286],
      zoom: 9,
    });
    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;

    const addLayers = () => {
      // Remove old layers/sources
      if (map.getSource('geofences')) {
        map.removeLayer('geofences-fill');
        map.removeLayer('geofences-outline');
        map.removeSource('geofences');
      }

      const features: GeoJSON.Feature<GeoJSON.Polygon>[] = data
        .filter((g) => g.coordinates && g.coordinates.length >= 3)
        .map((g) => ({
          type: 'Feature' as const,
          properties: { name: g.name, active: g.active },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [[...g.coordinates, g.coordinates[0]!]],
          },
        }));

      map.addSource('geofences', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });
      map.addLayer({
        id: 'geofences-fill',
        type: 'fill',
        source: 'geofences',
        paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.2 },
      });
      map.addLayer({
        id: 'geofences-outline',
        type: 'line',
        source: 'geofences',
        paint: { 'line-color': '#3b82f6', 'line-width': 2 },
      });
    };

    if (map.loaded()) addLayers();
    else map.once('load', addLayers);
  }, [data]);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <Map size={20} className="text-blue-400" />
          <h1 className="text-xl font-bold">Geofences</h1>
          {data && <span className="text-slate-400 text-sm">({data.length} zones)</span>}
        </div>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded text-sm font-medium"
        >
          <Plus size={16} />
          Create Geofence
        </button>
      </div>

      {showForm && <CreateForm onClose={() => setShowForm(false)} />}

      <div className="rounded-lg overflow-hidden border border-slate-700 h-72">
        <div ref={mapContainer} className="w-full h-full" />
      </div>

      {isLoading && <div className="text-slate-400 text-sm text-center">Loading geofences…</div>}
      {isError && <div className="text-red-400 text-sm text-center">Failed to load geofences.</div>}

      {data && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Type</th>
                <th className="px-4 py-3 text-left">Created</th>
                <th className="px-4 py-3 text-left">Active</th>
              </tr>
            </thead>
            <tbody>
              {data.map((g) => (
                <tr key={g.id} className="border-t border-slate-700">
                  <td className="px-4 py-3 font-medium">{g.name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-slate-700 rounded text-xs capitalize">{g.type}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-400">
                    {new Date(g.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleMutation.mutate({ id: g.id, active: !g.active })}
                      disabled={toggleMutation.isPending}
                      className="text-slate-400 hover:text-white disabled:opacity-50"
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
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">No geofences configured.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
