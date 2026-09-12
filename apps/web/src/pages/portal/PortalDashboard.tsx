import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, Bell, LogOut, MapPin, Package, Search, Shield, Truck } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  PortalShell, StatCard, Badge, ProgressBar, RouteRibbon, MapShell,
  relativeTime, fmtDateTime,
} from '../../components/portal/PortalPrimitives.js';

const API = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

interface ShipmentSummary {
  convoy_id: string;
  reference: string;
  status: string;
  origin: string | null;
  destination: string | null;
  eta: string | null;
  last_ping_at: string | null;
  progress_pct: number | null;
  exception_count: number;
  seal_status: 'intact' | 'compromised' | 'unverified' | null;
  current_location: { lat: number; lng: number } | null;
}

type Tab = 'active' | 'completed' | 'all';

// ── Health strip ──────────────────────────────────────────────────────────────

function HealthStrip({ shipments }: { shipments: ShipmentSummary[] }) {
  const active = shipments.filter(s => s.status === 'in_transit' || s.status === 'pending');
  const withExceptions = shipments.filter(s => s.exception_count > 0);
  const compromised = shipments.filter(s => s.seal_status === 'compromised');

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 portal-reveal">
      <StatCard label="Active Convoys" value={active.length} accent="green" />
      <StatCard label="Total Shipments" value={shipments.length} accent="default" />
      <StatCard
        label="Exceptions"
        value={withExceptions.length}
        accent={withExceptions.length > 0 ? 'red' : 'default'}
      />
      <StatCard
        label="Seal Issues"
        value={compromised.length}
        accent={compromised.length > 0 ? 'red' : 'default'}
      />
    </div>
  );
}

// ── All-shipments mini-map ────────────────────────────────────────────────────

function ShipmentsMap({ shipments }: { shipments: ShipmentSummary[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [28, -26],
      zoom: 4,
      interactive: false,
      attributionControl: false,
    });
    mapRef.current = map;
    map.on('load', () => {
      const located = shipments.filter(s => s.current_location);
      located.forEach(s => {
        const el = document.createElement('div');
        el.className = 'flex items-center justify-center';
        el.style.cssText = 'width:10px;height:10px;border-radius:50%;background:#f97316;box-shadow:0 0 8px rgba(249,115,22,0.6);';
        if (s.exception_count > 0) el.style.background = '#ef4444';
        new maplibregl.Marker({ element: el })
          .setLngLat([s.current_location!.lng, s.current_location!.lat])
          .addTo(map);
      });
    });
    return () => { map.remove(); mapRef.current = null; };
  }, [shipments]);

  return (
    <MapShell className="h-48 mb-6 portal-reveal portal-reveal-2" style={{ height: 192 }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div className="absolute top-2 left-3 text-xs text-white/40 pointer-events-none">Live Positions</div>
    </MapShell>
  );
}

// ── Pipeline card ─────────────────────────────────────────────────────────────

function PipelineCard({ shipment }: { shipment: ShipmentSummary }) {
  const navigate = useNavigate();
  const isActive = shipment.status === 'in_transit' || shipment.status === 'pending';
  const statusLabel = shipment.status.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  return (
    <div
      className={`rounded-xl border p-4 flex flex-col gap-3 cursor-pointer transition-all duration-200 hover:border-orange-500/30 hover:shadow-orange-500/10 hover:shadow-lg portal-reveal ${shipment.exception_count > 0 ? 'border-red-500/20' : 'border-white/[0.07]'}`}
      style={{ background: 'linear-gradient(145deg,var(--p-surface),var(--p-surface2))' }}
      onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/track', params: { convoy_id: shipment.convoy_id } })}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm text-white truncate">{shipment.reference}</p>
          {shipment.exception_count > 0 && (
            <p className="text-xs text-red-400 mt-0.5 flex items-center gap-1">
              <AlertTriangle size={11} />
              {shipment.exception_count} exception{shipment.exception_count !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        <Badge label={statusLabel} variant={shipment.status} />
      </div>

      <RouteRibbon
        origin={shipment.origin ?? '—'}
        destination={shipment.destination ?? '—'}
        progress={shipment.progress_pct}
      />

      {isActive && shipment.progress_pct != null && (
        <div>
          <ProgressBar pct={shipment.progress_pct} />
          <div className="flex justify-between mt-1">
            <span className="mono text-[11px] text-white/30">{shipment.progress_pct}%</span>
            <span className="mono text-[11px] text-white/30">ETA {fmtDateTime(shipment.eta)}</span>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t border-white/[0.05]">
        <div className="flex items-center gap-3">
          {shipment.seal_status === 'intact' && (
            <span className="flex items-center gap-1 text-[11px] text-green-400">
              <Shield size={11} /> Sealed
            </span>
          )}
          {shipment.seal_status === 'compromised' && (
            <span className="flex items-center gap-1 text-[11px] text-red-400">
              <Shield size={11} /> Compromised
            </span>
          )}
          {shipment.last_ping_at && (
            <span className="mono text-[11px] text-white/30 flex items-center gap-1">
              <MapPin size={10} /> {relativeTime(shipment.last_ping_at)}
            </span>
          )}
        </div>
        <span className="text-xs text-orange-400/70 font-semibold">Track →</span>
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-3 text-[11px]" onClick={e => e.stopPropagation()}>
        <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/convoy', params: { convoy_id: shipment.convoy_id } })} className="text-white/40 hover:text-white/70 flex items-center gap-0.5 transition-colors"><Truck size={10} /> Fleet</button>
        <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/manifest', params: { convoy_id: shipment.convoy_id } })} className="text-white/40 hover:text-white/70 transition-colors">Manifest</button>
        <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/documents', params: { convoy_id: shipment.convoy_id } })} className="text-white/40 hover:text-white/70 transition-colors">Docs</button>
        <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/custody', params: { convoy_id: shipment.convoy_id } })} className="text-white/40 hover:text-white/70 transition-colors">Custody</button>
        {(shipment.status === 'completed' || shipment.status === 'cancelled') && (
          <button onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/pod', params: { convoy_id: shipment.convoy_id } })} className="text-white/40 hover:text-white/70 transition-colors">POD</button>
        )}
      </div>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function PortalDashboard(): React.ReactElement {
  const navigate = useNavigate();
  const [shipments, setShipments] = useState<ShipmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch(`${API}/portal/shipments`, { credentials: 'include' })
      .then(async res => {
        if (res.status === 401) { void navigate({ to: '/portal/login' }); return null; }
        if (!res.ok) throw new Error((await res.json().catch(() => ({} as Record<string, string>)) as { error?: string }).error ?? `Error ${res.status}`);
        return res.json() as Promise<{ data: ShipmentSummary[] }>;
      })
      .then(json => { if (json) setShipments(json.data ?? []); })
      .catch((e: Error) => setErrorMsg(e.message))
      .finally(() => setLoading(false));
  }, [navigate]);

  const filtered = useMemo(() => {
    let base = shipments;
    if (tab === 'active') base = base.filter(s => s.status === 'in_transit' || s.status === 'pending');
    if (tab === 'completed') base = base.filter(s => s.status === 'completed' || s.status === 'cancelled');
    if (search.trim()) {
      const q = search.toLowerCase();
      base = base.filter(s =>
        s.reference.toLowerCase().includes(q) ||
        (s.origin ?? '').toLowerCase().includes(q) ||
        (s.destination ?? '').toLowerCase().includes(q),
      );
    }
    return base;
  }, [shipments, tab, search]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'completed', label: 'Completed' },
    { key: 'all', label: 'All' },
  ];

  return (
    <PortalShell>
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] px-4 py-3 flex items-center justify-between"
        style={{ background: 'rgba(7,11,22,0.95)', backdropFilter: 'blur(16px)' }}>
        <div className="flex items-center gap-2">
          <Package size={16} className="text-orange-400" />
          <span className="font-black text-sm tracking-widest uppercase text-orange-400">SONALIT</span>
          <span className="text-xs text-white/30 ml-1">Command Center</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void navigate({ to: '/portal/notifications' })}
            className="p-2 rounded-lg border border-white/[0.06] text-white/40 hover:text-white/80 hover:border-white/20 transition-colors">
            <Bell size={14} />
          </button>
          <button
            onClick={() => fetch(`${API}/portal/auth/logout`, { method: 'POST', credentials: 'include' }).finally(() => void navigate({ to: '/portal/login' }))}
            className="p-2 rounded-lg border border-white/[0.06] text-white/40 hover:text-white/80 hover:border-white/20 transition-colors">
            <LogOut size={14} />
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pt-5 pb-16">
        {/* Health strip */}
        {!loading && !errorMsg && <HealthStrip shipments={shipments} />}

        {/* Map */}
        {!loading && !errorMsg && shipments.some(s => s.current_location) && (
          <ShipmentsMap shipments={shipments} />
        )}

        {/* Search + tabs */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5 portal-reveal portal-reveal-3">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search reference or route…"
              className="w-full pl-8 pr-3 py-2 rounded-lg border border-white/[0.07] bg-white/[0.04] text-sm text-white placeholder-white/25 focus:outline-none focus:border-orange-500/50"
            />
          </div>
          <div className="flex rounded-lg border border-white/[0.07] overflow-hidden shrink-0"
            style={{ background: 'var(--p-surface2)' }}>
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t.key ? 'bg-orange-500 text-white' : 'text-white/40 hover:text-white/70'}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="flex gap-3 p-4 rounded-xl border border-red-700/40 bg-red-900/20 mb-5">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-red-300">Could not load shipments</p>
              <p className="text-xs text-red-400/70 mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-xl border border-white/[0.07] h-44 animate-pulse"
                style={{ background: 'var(--p-surface)', animationDelay: `${i * 80}ms` }} />
            ))}
          </div>
        )}

        {/* Pipeline grid */}
        {!loading && !errorMsg && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filtered.map((s, i) => (
              <div key={s.convoy_id} style={{ animationDelay: `${i * 50}ms` }}>
                <PipelineCard shipment={s} />
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!loading && !errorMsg && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Package size={36} className="text-white/10 mb-4" />
            <p className="text-sm text-white/40">No shipments found.</p>
          </div>
        )}
      </main>
    </PortalShell>
  );
}
