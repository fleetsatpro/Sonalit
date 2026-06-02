import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { AlertTriangle, ArrowLeft, Loader2, Package, Pause, Play } from 'lucide-react';

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

interface ReplayPoint {
  lat: number;
  lng: number;
  timestamp: string;
  speed: number | null;
  vehicle_id: string;
}

const CARD: React.CSSProperties = { background: 'var(--p-surface)' };

function fmtTime(val: string): string {
  return new Date(val).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtSpeed(s: number | null): string {
  return s != null ? `${s.toFixed(0)} km/h` : '—';
}

export default function PortalReplay(): React.ReactElement {
  const navigate = useNavigate();
  const { convoy_id } = useParams({ strict: false }) as { convoy_id?: string };

  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const playRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [points, setPoints] = useState<ReplayPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Fetch replay data
  useEffect(() => {
    if (!convoy_id) { setErrorMsg('No convoy ID'); setLoading(false); return; }
    fetch(`${API_BASE}/portal/convoy/${convoy_id}/replay`, { credentials: 'include' })
      .then(async (res) => {
        if (res.status === 401) { void navigate({ to: '/portal/login' }); return null; }
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Failed (${res.status})`);
        }
        return res.json() as Promise<{ data: ReplayPoint[] }>;
      })
      .then(json => { if (json) setPoints(json.data); })
      .catch((err: Error) => setErrorMsg(err.message))
      .finally(() => setLoading(false));
  }, [convoy_id, navigate]);

  // Initialise map after data loads
  useEffect(() => {
    if (!mapRef.current || points.length === 0 || mapInstance.current) return;

    const map = new maplibregl.Map({
      container: mapRef.current,
      style: MAP_STYLE,
      center: [points[0]!.lng, points[0]!.lat],
      zoom: 10,
      attributionControl: false,
    });

    map.on('load', () => {
      // Full route line
      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: points.map(p => [p.lng, p.lat]),
          },
        },
      });
      map.addLayer({ id: 'route-line', type: 'line', source: 'route',
        paint: { 'line-color': 'rgba(255,255,255,0.15)', 'line-width': 2 } });

      // Traversed portion
      map.addSource('traversed', {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } },
      });
      map.addLayer({ id: 'traversed-line', type: 'line', source: 'traversed',
        paint: { 'line-color': '#f97316', 'line-width': 2.5 } });

      // Vehicle marker
      const el = document.createElement('div');
      el.style.cssText = 'width:14px;height:14px;border-radius:50%;background:#f97316;border:2px solid #fff;box-shadow:0 0 8px rgba(249,115,22,0.7)';
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([points[0]!.lng, points[0]!.lat])
        .addTo(map);
      markerRef.current = marker;

      // Fit bounds
      const lngs = points.map(p => p.lng), lats = points.map(p => p.lat);
      map.fitBounds(
        [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 48, duration: 600 },
      );
    });

    mapInstance.current = map;
    return () => { map.remove(); mapInstance.current = null; };
  }, [points]);

  // Update marker + traversed line on cursor change
  useEffect(() => {
    const map = mapInstance.current;
    if (!map || !map.isStyleLoaded() || points.length === 0) return;
    const pt = points[cursor];
    if (!pt) return;

    markerRef.current?.setLngLat([pt.lng, pt.lat]);

    const src = map.getSource('traversed') as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: 'Feature', properties: {},
      geometry: { type: 'LineString', coordinates: points.slice(0, cursor + 1).map(p => [p.lng, p.lat]) },
    });
  }, [cursor, points]);

  // Play/Pause
  useEffect(() => {
    if (playing) {
      playRef.current = setInterval(() => {
        setCursor(c => {
          if (c >= points.length - 1) { setPlaying(false); return c; }
          return c + 1;
        });
      }, 80);
    } else {
      if (playRef.current) clearInterval(playRef.current);
    }
    return () => { if (playRef.current) clearInterval(playRef.current); };
  }, [playing, points.length]);

  const pt = points[cursor];

  return (
    <div className="portal-root flex flex-col">
      <div className="border-b border-white/[0.06] px-4 sm:px-6 py-4 flex items-center gap-3 shrink-0">
        <button onClick={() => void navigate({ to: '/portal/dashboard' })} className="text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={18} />
        </button>
        <Package size={18} className="text-orange-400 shrink-0" />
        <span
          className="font-black text-base tracking-wider uppercase"
          style={{ fontFamily: 'var(--p-sans)', background: 'linear-gradient(90deg,#ff9040,#f07020)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}
        >
          SONALIT
        </span>
        <span className="text-xs text-gray-500">/ Journey Replay</span>
      </div>

      {loading && (
        <div className="flex-1 flex justify-center items-center">
          <Loader2 size={28} className="animate-spin text-orange-400" />
        </div>
      )}

      {errorMsg && (
        <div className="p-6">
          <div className="flex items-start gap-3 rounded-xl border border-red-700/50 bg-red-900/20 px-4 py-3">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-red-300 text-sm">{errorMsg}</p>
          </div>
        </div>
      )}

      {!loading && !errorMsg && points.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center py-20">
          <Package size={40} className="text-white/10 mb-4" />
          <p className="text-white/40 text-sm">No GPS track data available for this convoy.</p>
        </div>
      )}

      {!loading && !errorMsg && points.length > 0 && (
        <>
          {/* Map */}
          <div ref={mapRef} className="flex-1" style={{ minHeight: '60vh' }} />

          {/* Controls */}
          <div className="shrink-0 border-t border-white/[0.06] px-4 py-4" style={CARD}>
            {/* Timestamp + speed */}
            <div className="flex items-center justify-between mb-3 text-xs text-white/60">
              <span>{pt ? fmtTime(pt.timestamp) : '—'}</span>
              <span className="text-white/40">Speed: {fmtSpeed(pt?.speed ?? null)}</span>
              <span>{cursor + 1} / {points.length}</span>
            </div>

            {/* Scrubber */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPlaying(p => !p)}
                className="flex items-center justify-center w-9 h-9 rounded-full bg-orange-500 hover:bg-orange-400 transition-colors shrink-0"
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? <Pause size={14} className="text-white" /> : <Play size={14} className="text-white ml-0.5" />}
              </button>
              <input
                type="range"
                min={0}
                max={points.length - 1}
                value={cursor}
                onChange={e => { setPlaying(false); setCursor(parseInt(e.target.value)); }}
                className="flex-1 accent-orange-500"
                style={{ accentColor: '#f97316' }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
