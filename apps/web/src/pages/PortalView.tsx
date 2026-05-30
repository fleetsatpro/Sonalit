import React, {
  useCallback, useEffect, useRef, useState, lazy, Suspense,
} from 'react';
import { Centrifuge } from 'centrifuge';
import {
  AlertTriangle, CheckCircle2, Circle, Clock, Download,
  Loader2, Package, Share2, Truck,
} from 'lucide-react';
import type { LatLng, TrailPoint } from '../components/PortalMap';

const PortalMap = lazy(() => import('../components/PortalMap'));

// ── Types ──────────────────────────────────────────────────────────────────────

interface ConvoyData {
  convoy_id: string;
  reference: string;
  status: string;
  origin: string | null;
  destination: string | null;
  departed_at: string | null;
  arrived_at: string | null;
  estimated_arrival_at: string | null;
  vehicle_count: number;
  cargo_owner_ref: string | null;
}

interface LocationData {
  current_location: LatLng | null;
  heading: number | null;
  speed_kmh: number | null;
  last_ping_at: string | null;
  trail: TrailPoint[];
  route_line: LatLng[] | null;
}

interface EtaData {
  eta: string | null;
  remaining_km: number | null;
  progress_pct: number | null;
  status: string;
  avg_speed_kmh: number | null;
}

interface Checkpoint {
  name: string;
  order: number;
  reached: boolean;
  reached_at: string | null;
}

interface SealTruck {
  truck_id: string;
  position: number;
  driver_name: string | null;
  sod_count: number;
  eod_count: number;
}

interface SealData {
  seal_status: 'intact' | 'compromised' | 'unverified';
  trucks: SealTruck[];
}

// ── Constants ──────────────────────────────────────────────────────────────────

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';
const WS_URL   = (import.meta.env['VITE_CENTRIFUGO_URL'] as string | undefined)
  ?? 'wss://rt.sonalit.io/connection/websocket';

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtTime(val: string | null): string {
  if (!val) return '—';
  return new Date(val).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
}

function agoText(val: string | null): string {
  if (!val) return 'No ping yet';
  const secs = Math.round((Date.now() - new Date(val).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

function convoyBadge(status: string): { bg: string; border: string; text: string; label: string } {
  const map: Record<string, { bg: string; border: string; text: string; label: string }> = {
    in_transit:  { bg: 'bg-green-900/40',  border: 'border-green-700',  text: 'text-green-400',  label: 'In Transit' },
    completed:   { bg: 'bg-blue-900/40',   border: 'border-blue-700',   text: 'text-blue-400',   label: 'Completed' },
    cancelled:   { bg: 'bg-red-900/40',    border: 'border-red-700',    text: 'text-red-400',    label: 'Cancelled' },
    not_started: { bg: 'bg-gray-700/40',   border: 'border-gray-600',   text: 'text-gray-400',   label: 'Not Started' },
  };
  return map[status] ?? { bg: 'bg-gray-700/40', border: 'border-gray-600', text: 'text-gray-400', label: status.replace(/_/g, ' ') };
}

const CARD = 'rounded-xl border border-white/[0.07] p-5';
const CARD_BG: React.CSSProperties = { background: 'rgba(13,20,38,0.7)' };
const SECTION_TITLE = 'text-xs font-semibold text-white/60 uppercase tracking-wider mb-4';

// ── Component ──────────────────────────────────────────────────────────────────

export default function PortalView(): React.ReactElement {
  const urlToken = new URLSearchParams(window.location.search).get('token') ?? '';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [convoy,      setConvoy]      = useState<ConvoyData | null>(null);
  const [location,    setLocation]    = useState<LocationData | null>(null);
  const [eta,         setEta]         = useState<EtaData | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [seals,       setSeals]       = useState<SealData | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const [pdfLoading,  setPdfLoading]  = useState(false);
  const [pingAgo,     setPingAgo]     = useState('No ping yet');

  const cfRef = useRef<Centrifuge | null>(null);

  const portalFetch = useCallback(<T,>(path: string): Promise<{ data: T }> =>
    fetch(`${API_BASE}/portal${path}`, {
      headers: { Authorization: `Bearer ${urlToken}` },
    }).then(r => {
      if (!r.ok) return r.json().then((b: { error?: string }) =>
        Promise.reject(new Error(b.error ?? `Error ${r.status}`)));
      return r.json() as Promise<{ data: T }>;
    }),
  [urlToken]);

  // Parallel initial data fetch
  useEffect(() => {
    if (!urlToken) {
      setError('No portal token provided in URL.');
      setLoading(false);
      return;
    }
    Promise.all([
      portalFetch<ConvoyData>('/convoy'),
      portalFetch<LocationData>('/convoy/location').catch(() => null),
      portalFetch<EtaData>('/convoy/eta').catch(() => null),
      portalFetch<Checkpoint[]>('/convoy/checkpoints').catch(() => null),
      portalFetch<SealData>('/convoy/seals').catch(() => null),
    ]).then(([convoyRes, locRes, etaRes, cpRes, sealRes]) => {
      setConvoy(convoyRes.data);
      if (locRes)  setLocation(locRes.data);
      if (etaRes)  setEta(etaRes.data);
      if (cpRes)   setCheckpoints(cpRes.data);
      if (sealRes) setSeals(sealRes.data);
    }).catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [urlToken, portalFetch]);

  // Centrifugo subscription for real-time position events
  useEffect(() => {
    if (!convoy) return;
    let active = true;

    void (async () => {
      try {
        const c = new Centrifuge(WS_URL, {
          getToken: async () => {
            const r = await portalFetch<{ token: string }>('/centrifuge-token');
            return r.data.token;
          },
        });
        if (!active) return;
        cfRef.current = c;

        const sub = c.newSubscription(`portal#${convoy.convoy_id}`, { recoverable: true });
        sub.on('publication', ctx => {
          const ev = ctx.data as {
            type: string;
            location?: LatLng;
            speed_kmh?: number;
            ping_at?: string;
          };
          if (ev.type === 'position' && ev.location) {
            setLocation(prev => {
              if (!prev) return prev;
              const trail = [
                ...prev.trail,
                { ...ev.location!, t: ev.ping_at! },
              ].slice(-200);
              return {
                ...prev,
                current_location: ev.location!,
                speed_kmh: ev.speed_kmh ?? prev.speed_kmh,
                last_ping_at: ev.ping_at ?? prev.last_ping_at,
                trail,
              };
            });
            if (ev.ping_at) setPingAgo(agoText(ev.ping_at));
          }
        });
        sub.subscribe();
        c.connect();
      } catch { /* realtime unavailable — snapshot data shown */ }
    })();

    return () => {
      active = false;
      cfRef.current?.disconnect();
      cfRef.current = null;
    };
  }, [convoy, portalFetch]);

  // Refresh "X ago" text every 30 s
  useEffect(() => {
    const lastPing = location?.last_ping_at ?? null;
    setPingAgo(agoText(lastPing));
    const id = setInterval(() => setPingAgo(agoText(lastPing)), 30_000);
    return () => clearInterval(id);
  }, [location?.last_ping_at]);

  const downloadPdf = async () => {
    setPdfLoading(true);
    try {
      const res = await fetch(`${API_BASE}/portal/convoy/custody-pdf`, {
        headers: { Authorization: `Bearer ${urlToken}` },
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `custody-${convoy?.reference ?? 'report'}.pdf`,
      });
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      alert(`PDF download failed: ${(e as Error).message}`);
    } finally {
      setPdfLoading(false);
    }
  };

  const badge = convoy ? convoyBadge(convoy.status) : null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen" style={{ background: '#050813' }}>

      {/* Header */}
      <div className="border-b border-white/[0.06] px-4 sm:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package size={18} className="text-orange-400 shrink-0" />
          <span className="font-black text-base tracking-wider uppercase"
            style={{
              fontFamily: "'Barlow Condensed','Arial Narrow',sans-serif",
              background: 'linear-gradient(90deg,#ff9040,#f07020)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>
            SONALIT
          </span>
          <span className="text-xs text-gray-500 ml-1">Cargo Portal</span>
        </div>
        {convoy && (
          <button
            onClick={() => void navigator.clipboard?.writeText(window.location.href)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/[0.06] hover:border-white/[0.15]"
            title="Copy tracking link"
          >
            <Share2 size={13} /> Share
          </button>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-24 text-gray-400">
          <Loader2 size={18} className="animate-spin mr-2" /> Loading shipment…
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="max-w-lg mx-auto px-4 py-12">
          <div className="rounded-xl border border-red-700 bg-red-900/20 p-6 flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 font-semibold">Access denied</p>
              <p className="text-red-400/80 text-sm mt-1">{error}</p>
              <p className="text-gray-500 text-xs mt-3">
                This link may have expired or been revoked. Contact the fleet operator for a new link.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      {!loading && convoy && badge && (
        <div className="max-w-2xl mx-auto px-4 pb-12 pt-4 space-y-4">

          {/* Title row */}
          <div className="flex items-start justify-between gap-3 pt-2">
            <div>
              <h1 className="text-xl font-bold text-white">{convoy.reference}</h1>
              {convoy.cargo_owner_ref && (
                <p className="text-xs text-gray-500 mt-0.5">{convoy.cargo_owner_ref}</p>
              )}
            </div>
            <span className={`text-xs font-semibold px-3 py-1 rounded-full border shrink-0 mt-0.5 ${badge.bg} ${badge.border} ${badge.text}`}>
              {badge.label}
            </span>
          </div>

          {/* Hero map */}
          <div
            className="rounded-xl overflow-hidden border border-white/[0.07]"
            style={{ height: 'clamp(260px, 55vw, 460px)' }}
          >
            <Suspense fallback={
              <div className="flex items-center justify-center h-full text-gray-500 text-sm gap-2"
                style={{ background: '#060e1a' }}>
                <Loader2 size={16} className="animate-spin" /> Loading map…
              </div>
            }>
              <PortalMap
                currentLocation={location?.current_location ?? null}
                heading={location?.heading ?? null}
                trail={location?.trail ?? []}
                routeLine={location?.route_line ?? null}
                origin={convoy.origin ?? ''}
                destination={convoy.destination ?? ''}
                status={convoy.status}
                animatePosition={!reducedMotion}
              />
            </Suspense>
          </div>

          {/* Status strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className={CARD} style={CARD_BG}>
              <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                <Clock size={10} /> Est. Arrival
              </p>
              <p className="text-sm font-semibold text-white leading-tight">
                {fmtTime(eta?.eta ?? null)}
              </p>
              {eta?.status === 'delayed' && (
                <p className="text-xs text-red-400 mt-0.5">Delayed</p>
              )}
              {eta?.status === 'arrived' && (
                <p className="text-xs text-blue-400 mt-0.5">Arrived</p>
              )}
            </div>

            <div className={CARD} style={CARD_BG}>
              <p className="text-xs text-gray-500 mb-2">Progress</p>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-1.5 rounded-full bg-orange-500 transition-all duration-500"
                  style={{ width: `${eta?.progress_pct ?? 0}%` }}
                />
              </div>
              <p className="text-xs text-white mt-1.5">
                {eta?.progress_pct != null ? `${eta.progress_pct}%` : '—'}
                {eta?.remaining_km != null && (
                  <span className="text-gray-500"> · {Math.round(eta.remaining_km)} km left</span>
                )}
              </p>
            </div>

            <div className={CARD} style={CARD_BG}>
              <p className="text-xs text-gray-500 mb-1">Last Ping</p>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${
                  location?.last_ping_at ? 'bg-green-400 animate-pulse' : 'bg-gray-600'
                }`} />
                <p className="text-xs text-white truncate">{pingAgo}</p>
              </div>
            </div>

            <div className={CARD} style={CARD_BG}>
              <p className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                <Truck size={10} /> Speed
              </p>
              <p className="text-sm font-semibold text-white">
                {location?.speed_kmh != null ? `${Math.round(location.speed_kmh)} km/h` : '—'}
              </p>
              {eta?.avg_speed_kmh != null && (
                <p className="text-xs text-gray-500">avg {Math.round(eta.avg_speed_kmh)} km/h</p>
              )}
            </div>
          </div>

          {/* Route card */}
          <div className={CARD} style={CARD_BG}>
            <h2 className={SECTION_TITLE}>Route</h2>
            <div className="flex items-stretch gap-3">
              <div className="flex flex-col items-center py-0.5 gap-0">
                <div className="w-2.5 h-2.5 rounded-full bg-green-500 shrink-0" />
                <div className="w-px flex-1 bg-white/10 my-1" style={{ minHeight: 28 }} />
                <div className="w-2.5 h-2.5 rounded-full bg-orange-500 shrink-0" />
              </div>
              <div className="flex flex-col gap-3 flex-1">
                <div>
                  <p className="text-xs text-gray-500">Origin</p>
                  <p className="text-sm text-white font-medium">{convoy.origin || '—'}</p>
                  {convoy.departed_at && (
                    <p className="text-xs text-gray-500">Departed {fmtTime(convoy.departed_at)}</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-gray-500">Destination</p>
                  <p className="text-sm text-white font-medium">{convoy.destination || '—'}</p>
                  {convoy.arrived_at && (
                    <p className="text-xs text-gray-500">Arrived {fmtTime(convoy.arrived_at)}</p>
                  )}
                </div>
              </div>
              <div className="shrink-0 flex items-center">
                <div className="text-right">
                  <p className="text-xs text-gray-500">Vehicles</p>
                  <p className="text-lg font-bold text-white">{convoy.vehicle_count}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Checkpoint timeline */}
          {checkpoints.length > 0 && (
            <div className={CARD} style={CARD_BG}>
              <h2 className={SECTION_TITLE}>Checkpoints</h2>
              <div className="space-y-3">
                {checkpoints.map((cp, i) => {
                  const isNext = !cp.reached && (i === 0 || (checkpoints[i - 1]?.reached ?? false));
                  return (
                    <div key={cp.order} className="flex items-start gap-3">
                      {cp.reached
                        ? <CheckCircle2 size={15} className="text-green-400 mt-0.5 shrink-0" />
                        : isNext
                          ? <Circle size={15} className="text-orange-400 mt-0.5 shrink-0 animate-pulse" />
                          : <Circle size={15} className="text-gray-600 mt-0.5 shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium leading-tight ${cp.reached ? 'text-white' : isNext ? 'text-orange-300' : 'text-gray-500'}`}>
                          {cp.name}
                        </p>
                        {cp.reached_at && (
                          <p className="text-xs text-gray-500 mt-0.5">{fmtTime(cp.reached_at)}</p>
                        )}
                        {isNext && !cp.reached && (
                          <p className="text-xs text-orange-400/70 mt-0.5">Next checkpoint</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Seal status card */}
          {seals && (
            <div className={CARD} style={CARD_BG}>
              <div className="flex items-center justify-between mb-4">
                <h2 className={SECTION_TITLE.replace(' mb-4', '')}>Seal Status</h2>
                <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${
                  seals.seal_status === 'intact'
                    ? 'bg-green-900/40 text-green-400 border-green-700'
                    : seals.seal_status === 'compromised'
                      ? 'bg-red-900/40 text-red-400 border-red-700'
                      : 'bg-yellow-900/40 text-yellow-400 border-yellow-700'
                }`}>
                  {seals.seal_status.charAt(0).toUpperCase() + seals.seal_status.slice(1)}
                </span>
              </div>
              {seals.trucks.length > 0 && (
                <div className="space-y-0 divide-y divide-white/[0.05]">
                  {seals.trucks.map(t => (
                    <div key={t.truck_id} className="flex items-center justify-between py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-white">Truck {t.position}</p>
                        {t.driver_name && (
                          <p className="text-xs text-gray-500 truncate">{t.driver_name}</p>
                        )}
                      </div>
                      <div className="flex gap-4 text-xs shrink-0 ml-3">
                        <span>
                          SOD&nbsp;
                          <span className={t.sod_count > 0 ? 'text-green-400 font-semibold' : 'text-gray-600'}>
                            {t.sod_count}
                          </span>
                        </span>
                        <span>
                          EOD&nbsp;
                          <span className={t.eod_count > 0 ? 'text-green-400 font-semibold' : 'text-gray-600'}>
                            {t.eod_count}
                          </span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* PDF download */}
          <button
            onClick={() => void downloadPdf()}
            disabled={pdfLoading}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-orange-500/30 bg-orange-600/10 hover:bg-orange-600/20 disabled:opacity-50 px-4 py-3 text-sm font-semibold text-orange-400 transition-colors"
          >
            {pdfLoading
              ? <Loader2 size={14} className="animate-spin" />
              : <Download size={14} />}
            Download Custody Chain PDF
          </button>

          <p className="text-center text-xs text-gray-600">
            Read-only view · Powered by SONALIT Fleet Operations
          </p>
        </div>
      )}
    </div>
  );
}
