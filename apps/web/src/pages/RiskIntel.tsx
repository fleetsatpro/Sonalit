import { useRef, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Shield } from 'lucide-react';

type RiskLevel = 'low' | 'medium' | 'high';

interface RiskZone {
  h3_index: string;
  risk_level: RiskLevel;
  event_count: number;
  center_lat: number;
  center_lon: number;
}

interface FilterParams {
  risk_level: RiskLevel | 'all';
  from: string;
  to: string;
}

const RISK_COLORS: Record<RiskLevel, string> = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#ef4444',
};

const RISK_BADGES: Record<RiskLevel, string> = {
  low: 'bg-green-800 text-green-200',
  medium: 'bg-yellow-800 text-yellow-200',
  high: 'bg-red-800 text-red-200',
};

// Approximate a hex polygon from center point + radius
function approximateHexPolygon(lat: number, lon: number, radiusDeg = 0.025): number[][] {
  const sides = 6;
  const points: number[][] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    points.push([
      lon + radiusDeg * Math.cos(angle),
      lat + radiusDeg * Math.sin(angle),
    ]);
  }
  points.push(points[0]!);
  return points;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function RiskIntel() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  const today = new Date();
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [filters, setFilters] = useState<FilterParams>({
    risk_level: 'all',
    from: formatDate(weekAgo),
    to: formatDate(today),
  });

  const params = {
    ...(filters.risk_level !== 'all' ? { risk_level: filters.risk_level } : {}),
    from: filters.from,
    to: filters.to,
  };

  const { data, isLoading, isError } = useQuery<RiskZone[]>({
    queryKey: ['riskzones', filters],
    queryFn: async () => {
      const res = await api.get<RiskZone[] | { data: RiskZone[] }>('/riskzones', { params });
      const raw = res.data;
      return Array.isArray(raw) ? raw : (raw?.data ?? []);
    },
  });

  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;
    mapRef.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [27.5, -11.5],
      zoom: 5,
    });
    mapRef.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;

    const addLayers = () => {
      (['high', 'medium', 'low'] as RiskLevel[]).forEach((level) => {
        const sourceId = `riskzones-${level}`;
        const layerId = `riskzones-fill-${level}`;

        if (map.getSource(sourceId)) {
          map.removeLayer(layerId);
          map.removeSource(sourceId);
        }

        const zones = data.filter((z) => z.risk_level === level);
        const features: GeoJSON.Feature<GeoJSON.Polygon>[] = zones.map((z) => ({
          type: 'Feature',
          properties: {
            h3_index: z.h3_index,
            risk_level: z.risk_level,
            event_count: z.event_count,
          },
          geometry: {
            type: 'Polygon',
            coordinates: [approximateHexPolygon(z.center_lat, z.center_lon)],
          },
        }));

        map.addSource(sourceId, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features },
        });
        map.addLayer({
          id: layerId,
          type: 'fill',
          source: sourceId,
          paint: {
            'fill-color': RISK_COLORS[level],
            'fill-opacity': 0.45,
          },
        });
      });
    };

    const addLayersAndFit = () => {
      addLayers();
      // Fit bounds to actual zone locations
      const bounds = new maplibregl.LngLatBounds();
      (data ?? []).forEach((z) => {
        if (z.center_lat != null && z.center_lon != null) bounds.extend([z.center_lon, z.center_lat]);
      });
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, maxZoom: 10, duration: 600 });
    };

    if (map.loaded()) addLayersAndFit();
    else map.once('load', addLayersAndFit);
  }, [data]);

  const displayedZones = data
    ? filters.risk_level === 'all'
      ? data
      : data.filter((z) => z.risk_level === filters.risk_level)
    : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Shield size={20} className="text-orange-400" />
          <h1 className="text-xl font-bold">Risk Intelligence</h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
            value={filters.risk_level}
            onChange={(e) => setFilters((f) => ({ ...f, risk_level: e.target.value as FilterParams['risk_level'] }))}
          >
            <option value="all">All Risk Levels</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
          <input
            type="date"
            className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
          />
          <input
            type="date"
            className="bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-orange-500"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
          />
        </div>
      </div>

      <div className="rounded-lg overflow-hidden border border-slate-700 h-80">
        <div ref={mapContainer} className="w-full h-full" />
      </div>

      <div className="flex gap-3 text-xs">
        {(['low', 'medium', 'high'] as RiskLevel[]).map((level) => (
          <span key={level} className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: RISK_COLORS[level] }} />
            {level.charAt(0).toUpperCase() + level.slice(1)} ({data?.filter((z) => z.risk_level === level).length ?? 0})
          </span>
        ))}
      </div>

      {isLoading && <div className="text-slate-400 text-sm text-center">Loading risk zones…</div>}
      {isError && <div className="text-red-400 text-sm text-center">Failed to load risk zones.</div>}

      {data && (
        <div className="bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 text-slate-400 text-xs uppercase">
              <tr>
                <th className="px-4 py-3 text-left">H3 Index</th>
                <th className="px-4 py-3 text-left">Risk Level</th>
                <th className="px-4 py-3 text-left">Event Count</th>
                <th className="px-4 py-3 text-left">Center</th>
              </tr>
            </thead>
            <tbody>
              {displayedZones.map((zone) => (
                <tr key={zone.h3_index} className="border-t border-slate-700">
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">{zone.h3_index}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${RISK_BADGES[zone.risk_level]}`}>
                      {zone.risk_level}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{(zone.event_count ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs font-mono">
                    {zone.center_lat?.toFixed(4) ?? '—'}, {zone.center_lon?.toFixed(4) ?? '—'}
                  </td>
                </tr>
              ))}
              {displayedZones.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-400">
                    No risk zones match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
