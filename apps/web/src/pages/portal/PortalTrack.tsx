import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { AlertTriangle, ArrowLeft, Clock, MapPin, Shield, Truck } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  PortalShell, Badge, ProgressBar, RouteRibbon, MapShell,
  TruckRow, EscortPanel, fmtDateTime,
} from '../../components/portal/PortalPrimitives.js';

const API = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';

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
  eta_confidence_low: string | null;
  eta_confidence_high: string | null;
  vehicles: Vehicle[];
  escorts: Array<{ escort_id: string; callsign: string; role: string; company: string | null; vehicle_registration: string | null }>;
  coload_count: number;
  exception_count: number;
  seal_status: string | null;
  waypoints: Array<{ lat: number; lng: number }>;
}

// ── ETA Ribbon ────────────────────────────────────────────────────────────────

function EtaRibbon({ overview }: { overview: ConvoyOverview }) {
  const eta = overview.estimated_arrival_at;
  const low = overview.eta_confidence_low;
  const high = overview.eta_confidence_high;

  return (
    <div className="rounded-xl border border-white/[0.07] px-4 py-3 mb-4 portal-reveal"
      style={{ background: 'linear-gradient(145deg,var(--p-surface),var(--p-surface2))' }}>
      <div className="flex flex-wrap items-center gap-4 justify-between">
        <div>
          <p className="text-xs text-white/40 uppercase tracking-widest mb-0.5">Estimated Arrival</p>
          <p className="mono text-xl font-medium text-white">{fmtDateTime(eta)}</p>
          {low && high && (
            <p className="mono text-xs text-white/30 mt-0.5">
              Window: {fmtDateTime(low)} – {fmtDateTime(high)}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge label={overview.status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())} variant={overview.status} />
          {overview.exception_count > 0 && (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <AlertTriangle size={11} /> {overview.exception_count} exception{overview.exception_count !== 1 ? 's' : ''}
            </span>
          )}
          {overview.seal_status && (
            <span className={`flex items-center gap-1 text-xs ${overview.seal_status === 'intact' ? 'text-green-400' : overview.seal_status === 'compromised' ? 'text-red-400' : 'text-amber-400'}`}>
              <Shield size={11} /> {overview.seal_status}
            </span>
          )}
        </div>
      </div>
      {overview.progress_pct != null && (
        <div className="mt-3">
          <RouteRibbon origin={overview.origin} destination={overview.destination} progress={overview.progress_pct} />
          <ProgressBar pct={overview.progress_pct} className="mt-2" />
          <p className="mono text-[11px] text-white/30 mt-1 text-right">{overview.progress_pct}% complete</p>
        </div>
      )}
    </div>
  );
}

// ── Live map ──────────────────────────────────────────────────────────────────

function TrackMap({ vehicles }: { vehicles: Vehicle[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const located = vehicles.filter(v => v.current_lat != null && v.current_lng != null);
    const first = located[0];
    const center: [number, number] = first
      ? [first.current_lng!, first.current_lat!]
      : [28, -26];

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center,
      zoom: located.length > 1 ? 7 : 10,
      attributionControl: false,
    });
    mapRef.current = map;

    map.on('load', () => {
      located.forEach(v => {
        const el = document.createElement('div');
        el.style.cssText = `width:14px;height:14px;border-radius:50%;border:2px solid ${v.carries_my_cargo ? '#f97316' : '#475569'};background:${v.carries_my_cargo ? 'rgba(249,115,22,0.4)' : 'rgba(71,85,105,0.4)'};`;
        if (v.carries_my_cargo) {
          el.style.boxShadow = '0 0 10px rgba(249,115,22,0.5)';
        }
        const popup = new maplibregl.Popup({ offset: 10, closeButton: false })
          .setHTML(`<div style="font-family:monospace;font-size:11px;color:#fff;background:#0e1626;padding:4px 6px;border-radius:4px;">${v.registration}${v.driver_name ? ` · ${v.driver_name}` : ''}</div>`);
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([v.current_lng!, v.current_lat!])
          .setPopup(popup)
          .addTo(map);
        markersRef.current.push(marker);
      });

      if (located.length > 1) {
        const coords = located.map(v => `${v.current_lng},${v.current_lat}`).join(';');
        fetch(`${OSRM_BASE}/${coords}?overview=full&geometries=geojson`)
          .then(r => r.json() as Promise<{ routes?: Array<{ geometry: GeoJSON.Geometry }> }>)
          .then(data => {
            const route = data.routes?.[0]?.geometry;
            if (!route) return;
            if (map.getSource('route')) {
              (map.getSource('route') as maplibregl.GeoJSONSource).setData({ type: 'Feature', properties: {}, geometry: route });
            } else {
              map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: route } });
              map.addLayer({ id: 'route-line', type: 'line', source: 'route',
                layout: { 'line-join': 'round', 'line-cap': 'round' },
                paint: { 'line-color': '#f97316', 'line-width': 2.5, 'line-opacity': 0.7 } });
            }
          })
          .catch(() => null);
      }
    });

    return () => { map.remove(); mapRef.current = null; markersRef.current = []; };
  }, [vehicles]);

  return (
    <MapShell className="portal-reveal portal-reveal-2" style={{ height: 260 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div className="absolute top-2 left-3 text-xs text-white/40 pointer-events-none flex items-center gap-1">
        <span className="w-2 h-2 rounded-full bg-orange-400" /> Your vehicles
        <span className="w-2 h-2 rounded-full bg-slate-500 ml-2" /> Other
      </div>
    </MapShell>
  );
}

// ── Vehicles & Crew card ──────────────────────────────────────────────────────

function VehiclesCrewCard({ overview }: { overview: ConvoyOverview }) {
  const mine = overview.vehicles.filter(v => v.carries_my_cargo);
  const others = overview.vehicles.filter(v => !v.carries_my_cargo);

  return (
    <div className="rounded-xl border border-white/[0.07] overflow-hidden portal-reveal portal-reveal-3"
      style={{ background: 'linear-gradient(145deg,var(--p-surface),var(--p-surface2))' }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]">
        <Truck size={14} className="text-orange-400" />
        <span className="text-sm font-semibold text-white">Vehicles &amp; Crew</span>
        <span className="mono text-xs text-white/30 ml-auto">{overview.vehicles.length} vehicles</span>
      </div>

      <div className="p-3 flex flex-col gap-2">
        {mine.length > 0 && (
          <>
            <p className="text-[11px] text-orange-400/70 uppercase tracking-wider px-1 mb-1">Carrying Your Cargo</p>
            {mine.map(v => (
              <TruckRow key={v.vehicle_id} registration={v.registration} driverName={v.driver_name}
                isMyCargo={true} speedKmh={v.speed_kmh} lastPing={v.last_ping_at} />
            ))}
          </>
        )}

        {others.length > 0 && (
          <>
            <p className="text-[11px] text-white/30 uppercase tracking-wider px-1 mt-2 mb-1">Co-load Vehicles</p>
            {others.map(v => (
              <TruckRow key={v.vehicle_id} registration={v.registration} driverName={v.driver_name}
                isMyCargo={false} speedKmh={v.speed_kmh} lastPing={v.last_ping_at} />
            ))}
            {overview.coload_count > 0 && (
              <p className="mono text-xs text-white/25 text-center py-2">
                +{overview.coload_count} other secured consignment{overview.coload_count !== 1 ? 's' : ''}
              </p>
            )}
          </>
        )}

        {overview.vehicles.length === 0 && (
          <p className="text-xs text-white/30 text-center py-4">No vehicle data available</p>
        )}
      </div>

      {overview.escorts.length > 0 && (
        <div className="border-t border-white/[0.06] p-3">
          <p className="text-[11px] text-blue-400/70 uppercase tracking-wider px-1 mb-2">Escort Detail</p>
          <div className="flex flex-col gap-2">
            {overview.escorts.map(e => (
              <EscortPanel key={e.escort_id} callsign={e.callsign} role={e.role}
                company={e.company} vehicleReg={e.vehicle_registration} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function PortalTrack(): React.ReactElement {
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
        <button onClick={() => void navigate({ to: '/portal/dashboard' })}
          className="p-1.5 rounded-lg text-white/40 hover:text-white/80 transition-colors">
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-white truncate">{overview?.reference ?? 'Deep Track'}</p>
          <p className="text-xs text-white/30 flex items-center gap-1">
            <Clock size={10} /> Live tracking
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/exceptions', params: { convoy_id } })}
            className="text-xs text-white/40 hover:text-white/70 transition-colors flex items-center gap-1">
            <AlertTriangle size={12} /> Exceptions
          </button>
          <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/sensors', params: { convoy_id } })}
            className="text-xs text-white/40 hover:text-white/70 transition-colors flex items-center gap-1">
            <MapPin size={12} /> Sensors
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 pt-5 pb-16">
        {loading && (
          <div className="space-y-3">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-28 rounded-xl border border-white/[0.07] animate-pulse"
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
            <EtaRibbon overview={overview} />
            {overview.vehicles.some(v => v.current_lat != null) && (
              <div className="mb-4">
                <TrackMap vehicles={overview.vehicles} />
              </div>
            )}
            <VehiclesCrewCard overview={overview} />

            {/* Quick nav */}
            <div className="mt-5 grid grid-cols-2 gap-3 portal-reveal portal-reveal-4">
              <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/security', params: { convoy_id } })}
                className="rounded-xl border py-3 text-sm font-semibold transition-all col-span-2 flex items-center justify-center gap-2"
                style={{ background: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.30)', color: '#fca5a5' }}>
                <Shield size={14} /> Live Security
              </button>
              <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/convoy', params: { convoy_id } })}
                className="rounded-xl border border-white/[0.07] py-3 text-sm text-white/50 hover:text-white/80 hover:border-orange-500/30 transition-all" style={{ background: 'var(--p-surface2)' }}>
                Convoy View
              </button>
              <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/custody', params: { convoy_id } })}
                className="rounded-xl border border-white/[0.07] py-3 text-sm text-white/50 hover:text-white/80 hover:border-orange-500/30 transition-all" style={{ background: 'var(--p-surface2)' }}>
                Custody Ledger
              </button>
              <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/manifest', params: { convoy_id } })}
                className="rounded-xl border border-white/[0.07] py-3 text-sm text-white/50 hover:text-white/80 hover:border-orange-500/30 transition-all" style={{ background: 'var(--p-surface2)' }}>
                Manifest
              </button>
              <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/documents', params: { convoy_id } })}
                className="rounded-xl border border-white/[0.07] py-3 text-sm text-white/50 hover:text-white/80 hover:border-orange-500/30 transition-all" style={{ background: 'var(--p-surface2)' }}>
                Documents
              </button>
            </div>
          </>
        )}
      </main>
    </PortalShell>
  );
}
