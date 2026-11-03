import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, Lock, Shield, Truck } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  PortalShell, Badge, MapShell, TruckRow, EscortPanel, fmtDateTime,
} from '../../components/portal/PortalPrimitives.js';

const API = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

interface Vehicle {
  vehicle_id: string;
  registration: string;
  make: string | null;
  model: string | null;
  type: string | null;
  driver_name: string | null;
  current_lat: number | null;
  current_lng: number | null;
  speed_kmh: number | null;
  heading_deg: number | null;
  last_ping_at: string | null;
  carries_my_cargo: boolean;
}

interface ConvoyOverview {
  convoy_id: string;
  reference: string;
  status: string;
  origin: string;
  destination: string;
  departed_at: string | null;
  estimated_arrival_at: string | null;
  arrived_at: string | null;
  progress_pct: number | null;
  vehicles: Vehicle[];
  escorts: Array<{ escort_id: string; callsign: string; role: string; company: string | null; vehicle_registration: string | null }>;
  coload_count: number;
  exception_count: number;
  seal_status: string | null;
}

// ── Cluster map ───────────────────────────────────────────────────────────────

function ConvoyClusterMap({ vehicles }: { vehicles: Vehicle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const located = vehicles.filter(v => v.current_lat != null);
    const first = located[0];
    const center: [number, number] = first ? [first.current_lng!, first.current_lat!] : [28, -26];

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center, zoom: located.length > 1 ? 8 : 10,
      attributionControl: false,
    });
    mapRef.current = map;

    map.on('load', () => {
      const features: GeoJSON.Feature[] = located.map(v => ({
        type: 'Feature',
        properties: { reg: v.registration, mine: v.carries_my_cargo },
        geometry: { type: 'Point', coordinates: [v.current_lng!, v.current_lat!] },
      }));

      map.addSource('vehicles', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 40,
      });

      map.addLayer({
        id: 'clusters', type: 'circle', source: 'vehicles',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#f97316',
          'circle-radius': ['step', ['get', 'point_count'], 16, 5, 22, 20, 28],
          'circle-opacity': 0.85,
        },
      });
      map.addLayer({
        id: 'cluster-count', type: 'symbol', source: 'vehicles',
        filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'], 'text-size': 11 },
        paint: { 'text-color': '#fff' },
      });
      map.addLayer({
        id: 'unclustered', type: 'circle', source: 'vehicles',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['case', ['get', 'mine'], '#f97316', '#475569'],
          'circle-radius': 7,
          'circle-stroke-width': 2,
          'circle-stroke-color': ['case', ['get', 'mine'], '#fb923c', '#64748b'],
        },
      });
    });

    return () => { map.remove(); mapRef.current = null; };
  }, [vehicles]);

  return (
    <MapShell style={{ height: 220 }} className="mb-4 portal-reveal portal-reveal-2">
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
    </MapShell>
  );
}

// ── Full roster ───────────────────────────────────────────────────────────────

function FullRoster({ vehicles, coloadCount }: { vehicles: Vehicle[]; coloadCount: number }) {
  const mine = vehicles.filter(v => v.carries_my_cargo);
  const others = vehicles.filter(v => !v.carries_my_cargo);

  return (
    <div className="rounded-xl border border-white/[0.07] overflow-hidden portal-reveal portal-reveal-3"
      style={{ background: 'linear-gradient(145deg,var(--p-surface),var(--p-surface2))' }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
        <Truck size={14} className="text-orange-400" />
        <span className="text-sm font-semibold text-white">Full Convoy Roster</span>
        <span className="mono text-xs text-white/30 ml-auto">{vehicles.length} total</span>
      </div>

      <div className="p-3 flex flex-col gap-2">
        {mine.length > 0 && (
          <>
            <p className="text-[11px] text-orange-400/70 uppercase tracking-wider px-1 mb-1">Your Cargo Vehicles</p>
            {mine.map(v => (
              <TruckRow key={v.vehicle_id} registration={v.registration} driverName={v.driver_name}
                isMyCargo={true} speedKmh={v.speed_kmh} lastPing={v.last_ping_at} />
            ))}
          </>
        )}

        {others.length > 0 && (
          <>
            <p className="text-[11px] text-white/30 uppercase tracking-wider px-1 mt-3 mb-1">Co-load Vehicles</p>
            {others.map(v => (
              <TruckRow key={v.vehicle_id} registration={v.registration} driverName={v.driver_name}
                isMyCargo={false} speedKmh={v.speed_kmh} lastPing={v.last_ping_at} />
            ))}
          </>
        )}

        {/* Co-load privacy notice */}
        {coloadCount > 0 && (
          <div className="mt-3 flex items-start gap-2 p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
            <Lock size={13} className="text-white/30 shrink-0 mt-0.5" />
            <p className="mono text-xs text-white/30">
              This convoy carries {coloadCount} other secured consignment{coloadCount !== 1 ? 's' : ''}. Their details are not visible to protect shipper privacy.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function PortalConvoy(): React.ReactElement {
  const navigate = useNavigate();
  const { convoy_id = '' } = useParams({ strict: false }) as { convoy_id?: string };
  const [overview, setOverview] = useState<ConvoyOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    fetch(`${API}/portal/convoy/${encodeURIComponent(convoy_id)}/overview`, { credentials: 'include' })
      .then(async res => {
        if (res.status === 401) { void navigate({ to: '/portal/login' }); return null; }
        if (res.status === 403) throw new Error('Not authorised for this convoy');
        if (!res.ok) throw new Error(`Error ${res.status}`);
        return res.json() as Promise<{ data: ConvoyOverview }>;
      })
      .then(json => { if (json) setOverview(json.data); })
      .catch((e: Error) => setErrorMsg(e.message))
      .finally(() => setLoading(false));
  }, [convoy_id, navigate]);

  return (
    <PortalShell>
      <header className="sticky top-0 z-40 border-b border-white/[0.06] px-4 py-3 flex items-center gap-3"
        style={{ background: 'rgba(7,11,22,0.95)', backdropFilter: 'blur(16px)' }}>
        <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/track', params: { convoy_id } })}
          className="p-1.5 rounded-lg text-white/40 hover:text-white/80 transition-colors">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-white truncate">{overview?.reference ?? 'Convoy View'}</p>
          {overview && (
            <p className="text-xs text-white/30">
              {overview.origin} → {overview.destination}
            </p>
          )}
        </div>
        {overview && <Badge label={overview.status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())} variant={overview.status} />}
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5 pb-16">
        {loading && (
          <div className="space-y-3">
            {[0, 1].map(i => (
              <div key={i} className="h-44 rounded-xl border border-white/[0.07] animate-pulse"
                style={{ background: 'var(--p-surface)', animationDelay: `${i * 80}ms` }} />
            ))}
          </div>
        )}

        {errorMsg && (
          <div className="flex gap-3 p-4 rounded-xl border border-red-700/40 bg-red-900/20">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-sm text-red-300">{errorMsg}</p>
          </div>
        )}

        {overview && (
          <>
            {/* Summary strip */}
            <div className="grid grid-cols-3 gap-3 mb-4 portal-reveal">
              <div className="rounded-xl border border-white/[0.07] p-3 text-center"
                style={{ background: 'var(--p-surface2)' }}>
                <p className="mono text-lg font-medium text-white">{overview.vehicles.length}</p>
                <p className="text-[11px] text-white/40">Vehicles</p>
              </div>
              <div className="rounded-xl border border-white/[0.07] p-3 text-center"
                style={{ background: 'var(--p-surface2)' }}>
                <p className={`mono text-lg font-medium ${overview.exception_count > 0 ? 'text-red-400' : 'text-white'}`}>
                  {overview.exception_count}
                </p>
                <p className="text-[11px] text-white/40">Exceptions</p>
              </div>
              <div className="rounded-xl border border-white/[0.07] p-3 text-center"
                style={{ background: 'var(--p-surface2)' }}>
                {overview.seal_status === 'intact'
                  ? <Shield size={18} className="text-green-400 mx-auto mb-0.5" />
                  : overview.seal_status === 'compromised'
                    ? <Shield size={18} className="text-red-400 mx-auto mb-0.5" />
                    : <Shield size={18} className="text-white/20 mx-auto mb-0.5" />}
                <p className="text-[11px] text-white/40">Seal</p>
              </div>
            </div>

            {/* Departure / arrival times */}
            <div className="rounded-xl border border-white/[0.07] px-4 py-3 mb-4 grid grid-cols-2 gap-4 portal-reveal portal-reveal-1"
              style={{ background: 'var(--p-surface2)' }}>
              <div>
                <p className="text-[11px] text-white/30 uppercase tracking-wider mb-0.5">Departed</p>
                <p className="mono text-sm text-white">{fmtDateTime(overview.departed_at)}</p>
              </div>
              <div>
                <p className="text-[11px] text-white/30 uppercase tracking-wider mb-0.5">ETA</p>
                <p className="mono text-sm text-white">{fmtDateTime(overview.estimated_arrival_at)}</p>
              </div>
            </div>

            {/* Cluster map */}
            {overview.vehicles.some(v => v.current_lat != null) && (
              <ConvoyClusterMap vehicles={overview.vehicles} />
            )}

            {/* Full roster with co-load privacy */}
            <FullRoster vehicles={overview.vehicles} coloadCount={overview.coload_count} />

            {/* Escorts */}
            {overview.escorts.length > 0 && (
              <div className="mt-4 rounded-xl border border-white/[0.07] overflow-hidden portal-reveal portal-reveal-4"
                style={{ background: 'var(--p-surface2)' }}>
                <div className="px-4 py-3 border-b border-white/[0.06]">
                  <p className="text-sm font-semibold text-blue-300">Escort Detail</p>
                </div>
                <div className="p-3 flex flex-col gap-2">
                  {overview.escorts.map(e => (
                    <EscortPanel key={e.escort_id} callsign={e.callsign} role={e.role}
                      company={e.company} vehicleReg={e.vehicle_registration} />
                  ))}
                </div>
              </div>
            )}

            {/* Nav links */}
            <div className="mt-5 flex flex-wrap gap-3 portal-reveal portal-reveal-5">
              <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/security', params: { convoy_id } })}
                className="flex items-center gap-1.5 text-xs font-semibold border px-3 py-2 rounded-lg transition-all"
                style={{ color: '#fca5a5', borderColor: 'rgba(239,68,68,0.30)', background: 'rgba(239,68,68,0.08)' }}>
                <Shield size={12} /> Live Security
              </button>
              <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/exceptions', params: { convoy_id } })}
                className="flex items-center gap-1.5 text-xs text-white/50 hover:text-red-400 border border-white/[0.07] hover:border-red-500/30 px-3 py-2 rounded-lg transition-all">
                <AlertTriangle size={12} /> Exceptions
              </button>
              <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/sensors', params: { convoy_id } })}
                className="text-xs text-white/50 hover:text-white/80 border border-white/[0.07] hover:border-white/20 px-3 py-2 rounded-lg transition-all">
                Sensors
              </button>
              <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/replay', params: { convoy_id } })}
                className="text-xs text-white/50 hover:text-white/80 border border-white/[0.07] hover:border-white/20 px-3 py-2 rounded-lg transition-all">
                Replay
              </button>
              <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/custody', params: { convoy_id } })}
                className="text-xs text-white/50 hover:text-white/80 border border-white/[0.07] hover:border-white/20 px-3 py-2 rounded-lg transition-all">
                Custody Ledger
              </button>
            </div>
          </>
        )}
      </main>
    </PortalShell>
  );
}
