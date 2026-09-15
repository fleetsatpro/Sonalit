import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Truck,
  XCircle,
} from 'lucide-react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { PortalShell, fmtDateTime, relativeTime } from '../../components/portal/PortalPrimitives.js';

const API = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';
const LIVE_WINDOW_MS = 120_000;
const ACTIVE_STATUSES = new Set(['active', 'pending', 'in_transit', 'delayed', 'at_checkpoint']);

type Position = { lat: number; lng: number };
type Shipment = {
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
  current_location: Position | null;
};
type Report = {
  id: string;
  report_date: string;
  status: string;
  required_photo_count: number;
  received_photo_count: number;
  generated_at: string | null;
  content_hash: string | null;
  download_path: string;
};
type Document = {
  id: string;
  convoy_id: string;
  type: string;
  label: string;
  file_url: string;
  created_at: string;
};
type VaultGroup = {
  convoy_id: string;
  reference: string;
  status: string;
  origin: string | null;
  destination: string | null;
  convoy_date: string | null;
  reports: Report[];
  documents: Document[];
};

type Tone = 'neutral' | 'live' | 'danger' | 'amber';

function isValidPosition(position: Position | null): position is Position {
  if (!position) return false;
  const lat = Number(position.lat);
  const lng = Number(position.lng);
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && Math.abs(lat) <= 90
    && Math.abs(lng) <= 180
    && !(Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001);
}

function isFresh(shipment: Shipment): boolean {
  if (!shipment.last_ping_at) return false;
  const timestamp = new Date(shipment.last_ping_at).getTime();
  return Number.isFinite(timestamp)
    && timestamp <= Date.now()
    && Date.now() - timestamp < LIVE_WINDOW_MS;
}

function isLive(shipment: Shipment): boolean {
  return isFresh(shipment) && isValidPosition(shipment.current_location);
}

function hasAttention(shipment: Shipment): boolean {
  return shipment.exception_count > 0 || shipment.seal_status === 'compromised';
}

function StatePill({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: Tone }) {
  const classes: Record<Tone, string> = {
    neutral: 'border-white/10 bg-white/[.03] text-white/45',
    live: 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300',
    danger: 'border-red-400/20 bg-red-400/10 text-red-300',
    amber: 'border-amber-400/20 bg-amber-400/10 text-amber-300',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[8px] font-bold uppercase tracking-[.12em] ${classes[tone]}`}>
      {children}
    </span>
  );
}

function Metric({
  label,
  value,
  meta,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  meta: string;
  icon: React.ElementType;
  tone?: 'default' | 'live' | 'danger' | 'amber';
}) {
  const iconClass = tone === 'danger'
    ? 'text-red-300'
    : tone === 'live'
      ? 'text-emerald-300'
      : tone === 'amber'
        ? 'text-amber-300'
        : 'text-orange-300';
  return (
    <div className="rounded-2xl border border-white/[.07] bg-gradient-to-br from-white/[.035] to-transparent p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[9px] font-bold uppercase tracking-[.18em] text-white/30">{label}</p>
          <p className="mono mt-2 text-2xl font-medium text-white sm:text-3xl">{value}</p>
          <p className="mt-1 text-[10px] text-white/30">{meta}</p>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[.07] bg-black/15">
          <Icon size={15} className={iconClass} />
        </div>
      </div>
    </div>
  );
}

function MovementAtlas({ shipments, onOpen }: { shipments: Shipment[]; onOpen: (id: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const selectedRef = useRef(onOpen);
  selectedRef.current = onOpen;
  const located = useMemo(() => shipments.filter(isLive), [shipments]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const style: maplibregl.StyleSpecification = {
      version: 8,
      name: 'Sonalit Client Atlas',
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors',
        },
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
    };
    const map = new maplibregl.Map({
      container: containerRef.current,
      style,
      center: [20, 0],
      zoom: 2.2,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const render = () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];

      if (!located.length) {
        map.easeTo({ center: [20, 0], zoom: 2.2, duration: 250 });
        return;
      }

      const bounds = new maplibregl.LngLatBounds();
      for (const shipment of located) {
        const position = shipment.current_location;
        if (!position) continue;
        const button = document.createElement('button');
        button.type = 'button';
        button.setAttribute('aria-label', `Open ${shipment.reference}`);
        button.style.cssText = [
          'width:28px',
          'height:28px',
          'border-radius:999px',
          'border:1px solid rgba(255,255,255,.8)',
          'background:#0b121d',
          'box-shadow:0 0 0 6px rgba(249,115,22,.12),0 0 24px rgba(249,115,22,.35)',
          'cursor:pointer',
          'position:relative',
        ].join(';');
        const dot = document.createElement('span');
        dot.style.cssText = [
          'position:absolute',
          'inset:7px',
          'border-radius:999px',
          `background:${hasAttention(shipment) ? '#ef4444' : '#ff7a18'}`,
        ].join(';');
        button.appendChild(dot);
        button.onclick = () => selectedRef.current(shipment.convoy_id);
        const marker = new maplibregl.Marker({ element: button })
          .setLngLat([position.lng, position.lat])
          .addTo(map);
        markersRef.current.push(marker);
        bounds.extend([position.lng, position.lat]);
      }

      if (located.length === 1 && located[0].current_location) {
        map.easeTo({
          center: [located[0].current_location.lng, located[0].current_location.lat],
          zoom: 6,
          duration: 450,
        });
      } else {
        map.fitBounds(bounds, { padding: 80, maxZoom: 7, duration: 500 });
      }
    };

    if (map.isStyleLoaded()) render();
    else map.once('load', render);
    return () => map.off('load', render);
  }, [located]);

  return (
    <div className="relative h-[440px] overflow-hidden rounded-2xl border border-white/[.07] bg-[#071019] sm:h-[570px]">
      <div ref={containerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="rounded-xl border border-white/10 bg-[#071019]/90 px-3 py-2 backdrop-blur">
          <p className="text-[8px] font-bold uppercase tracking-[.18em] text-orange-300/70">Verified Movement Atlas</p>
          <p className="mt-1 text-[10px] text-white/35">Fresh, non-sentinel telemetry only. Stale fixes are withheld.</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#071019]/90 px-3 py-2 text-right backdrop-blur">
          <p className="text-[8px] uppercase tracking-[.16em] text-white/25">Plotted</p>
          <p className="mono mt-1 text-sm text-white">{located.length}</p>
        </div>
      </div>
      {!located.length && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="max-w-sm rounded-2xl border border-amber-400/15 bg-[#071019]/95 p-7 text-center shadow-2xl">
            <MapPin size={24} className="mx-auto text-amber-300/70" />
            <p className="mt-3 text-sm font-semibold text-white">No verified live location</p>
            <p className="mt-2 text-[11px] leading-relaxed text-white/35">
              Sonalit will not invent a position. Missing, stale or 0,0 telemetry remains off-map until a trustworthy fix arrives.
            </p>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 left-3 rounded-xl border border-white/10 bg-[#071019]/90 px-3 py-2 text-[8px] uppercase tracking-[.13em] text-white/25">
        Sonalit telemetry · © OpenStreetMap
      </div>
    </div>
  );
}

function MovementRow({ shipment, onOpen }: { shipment: Shipment; onOpen: () => void }) {
  const live = isLive(shipment);
  let state: { label: string; tone: Tone } = { label: 'NO LIVE FIX', tone: 'amber' };
  if (hasAttention(shipment)) state = { label: 'EXCEPTION', tone: 'danger' };
  else if (live) state = { label: 'LIVE', tone: 'live' };

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-2xl border border-white/[.06] bg-white/[.015] p-4 text-left transition hover:border-white/[.14] hover:bg-white/[.025]"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-orange-400/15 bg-orange-400/[.06]">
          <Truck size={16} className="text-orange-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[12px] font-semibold text-white">{shipment.reference}</span>
            <StatePill tone={state.tone}>{state.label}</StatePill>
          </div>
          <p className="mt-1 truncate text-[10px] text-white/30">
            {shipment.origin || 'Origin not recorded'} <span className="text-white/15">→</span> {shipment.destination || 'Destination not recorded'}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <span className="rounded-lg border border-white/[.05] bg-black/10 p-2">
              <b className="block text-[7px] uppercase tracking-[.14em] text-white/20">Telemetry</b>
              <strong className="mt-1 block text-[9px] text-white/55">
                {live ? `Verified · ${relativeTime(shipment.last_ping_at!)}` : shipment.last_ping_at ? relativeTime(shipment.last_ping_at) : 'Unavailable'}
              </strong>
            </span>
            <span className="rounded-lg border border-white/[.05] bg-black/10 p-2">
              <b className="block text-[7px] uppercase tracking-[.14em] text-white/20">ETA</b>
              <strong className="mt-1 block text-[9px] text-white/55">{shipment.eta ? fmtDateTime(shipment.eta) : 'Unavailable'}</strong>
            </span>
            <span className="rounded-lg border border-white/[.05] bg-black/10 p-2">
              <b className="block text-[7px] uppercase tracking-[.14em] text-white/20">Seal</b>
              <strong className="mt-1 block text-[9px] text-white/55">
                {shipment.seal_status === 'intact' ? 'Verified intact' : shipment.seal_status === 'compromised' ? 'Compromised' : 'Unverified'}
              </strong>
            </span>
            <span className="rounded-lg border border-white/[.05] bg-black/10 p-2">
              <b className="block text-[7px] uppercase tracking-[.14em] text-white/20">Alerts</b>
              <strong className={`mt-1 block text-[9px] ${shipment.exception_count ? 'text-red-300' : 'text-white/55'}`}>{shipment.exception_count}</strong>
            </span>
          </div>
        </div>
        <ArrowRight size={15} className="mt-2 shrink-0 text-white/15" />
      </div>
    </button>
  );
}

function ReportCard({ report }: { report: Report }) {
  const coverage = report.required_photo_count > 0
    ? Math.min(100, Math.round((report.received_photo_count / report.required_photo_count) * 100))
    : 100;
  return (
    <div className="rounded-2xl border border-white/[.06] bg-white/[.018] p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-400/10 bg-emerald-400/[.04]">
          <FileText size={15} className="text-emerald-300" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-semibold text-white">Daily Convoy Report · {report.report_date}</p>
            <StatePill tone="live">Generated</StatePill>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-[9px] text-white/30">
            <span>Evidence {report.received_photo_count}/{report.required_photo_count}</span>
            <span>{coverage}% coverage</span>
            {report.generated_at && <span>{relativeTime(report.generated_at)}</span>}
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[.06]">
            <div className="h-full rounded-full bg-emerald-400/70" style={{ width: `${coverage}%` }} />
          </div>
          {report.content_hash && (
            <p className="mt-2 truncate font-mono text-[8px] text-white/15">evidence fingerprint · {report.content_hash.slice(0, 16)}…</p>
          )}
        </div>
        <a
          href={API + report.download_path}
          target="_blank"
          rel="noreferrer"
          className="rounded-lg border border-white/[.07] px-3 py-2 text-[8px] font-semibold text-white/45 hover:text-white"
        >
          Open PDF
        </a>
      </div>
    </div>
  );
}

function DocumentVault({ groups }: { groups: VaultGroup[] }) {
  const [filter, setFilter] = useState<'all' | 'reports' | 'documents'>('all');
  const [openConvoy, setOpenConvoy] = useState<string | null>(null);
  const reportsCount = groups.reduce((count, group) => count + group.reports.length, 0);
  const documentsCount = groups.reduce((count, group) => count + group.documents.length, 0);

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[.07] bg-white/[.012]">
      <div className="border-b border-white/[.06] p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[.18em] text-orange-300/70">Convoy Document Vault</p>
            <h2 className="mt-1 text-base font-semibold text-white">A permanent client record, arranged by convoy</h2>
            <p className="mt-1 max-w-3xl text-[10px] leading-relaxed text-white/30">
              Generated convoy reports are imported automatically from Sonalit operations and grouped beneath their real convoy. Uploaded portal documents stay alongside them without losing provenance.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatePill tone="live">{reportsCount} generated reports</StatePill>
            <StatePill>{documentsCount} attached docs</StatePill>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-1">
          {(['all', 'reports', 'documents'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={`rounded-lg px-3 py-2 text-[8px] font-bold uppercase tracking-[.13em] ${filter === value ? 'bg-orange-500 text-white' : 'text-white/35'}`}
            >
              {value === 'all' ? 'All evidence' : value === 'reports' ? 'Convoy reports' : 'Documents'}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-white/[.05]">
        {groups.map((group) => {
          const expanded = openConvoy === group.convoy_id;
          const showReports = filter !== 'documents';
          const showDocuments = filter !== 'reports';
          return (
            <div key={group.convoy_id}>
              <button
                type="button"
                onClick={() => setOpenConvoy(expanded ? null : group.convoy_id)}
                className="flex w-full items-center gap-4 p-4 text-left hover:bg-white/[.018]"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[.06] bg-black/10">
                  <Archive size={15} className="text-orange-300/80" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold text-white">{group.reference}</span>
                    <StatePill>{group.reports.length + group.documents.length} records</StatePill>
                  </div>
                  <p className="mt-1 truncate text-[9px] text-white/25">
                    {group.origin || '—'} → {group.destination || '—'} · {group.convoy_date || 'date unavailable'}
                  </p>
                </div>
                {expanded ? <ChevronDown size={15} className="text-white/25" /> : <ArrowRight size={15} className="text-white/15" />}
              </button>

              {expanded && (
                <div className="space-y-3 border-t border-white/[.05] bg-black/10 p-4">
                  {showReports && [...group.reports].sort((a, b) => b.report_date.localeCompare(a.report_date)).map((report) => (
                    <ReportCard key={report.id} report={report} />
                  ))}
                  {showDocuments && [...group.documents].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((document) => (
                    <div key={document.id} className="flex items-center gap-3 rounded-xl border border-white/[.06] bg-white/[.015] p-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[.06]">
                        <FileText size={14} className="text-white/40" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[10px] font-semibold text-white/70">{document.label}</p>
                        <p className="mt-1 text-[8px] uppercase tracking-[.12em] text-white/20">{document.type} · {fmtDateTime(document.created_at)}</p>
                      </div>
                      <a
                        href={document.file_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="rounded-lg border border-white/[.07] px-2.5 py-2 text-[8px] font-semibold text-white/45 hover:text-white"
                      >
                        Open
                      </a>
                    </div>
                  ))}
                  {showReports && showDocuments && !group.reports.length && !group.documents.length && (
                    <div className="rounded-xl border border-dashed border-white/10 p-7 text-center text-[10px] text-white/20">No client-visible evidence is recorded for this convoy.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {!groups.length && (
          <div className="p-10 text-center">
            <FileText size={25} className="mx-auto text-white/10" />
            <p className="mt-3 text-[11px] text-white/30">No convoy-linked records available.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default function PortalDashboardAccurate(): React.ReactElement {
  const navigate = useNavigate();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [vault, setVault] = useState<VaultGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'overview' | 'movements' | 'documents'>('overview');

  const load = useCallback(async () => {
    try {
      setError('');
      const shipmentResponse = await fetch(`${API}/portal/shipments`, { credentials: 'include' });
      if (shipmentResponse.status === 401) {
        void navigate({ to: '/portal/login' });
        return;
      }
      if (!shipmentResponse.ok) throw new Error(`Client data request failed (${shipmentResponse.status})`);
      const shipmentBody = await shipmentResponse.json() as { data?: Shipment[] };
      setShipments(Array.isArray(shipmentBody.data) ? shipmentBody.data : []);

      const vaultResponse = await fetch(`${API}/portal/document-vault`, { credentials: 'include' });
      if (vaultResponse.status === 401) {
        void navigate({ to: '/portal/login' });
        return;
      }
      if (vaultResponse.ok) {
        const vaultBody = await vaultResponse.json() as { data?: VaultGroup[] };
        setVault(Array.isArray(vaultBody.data) ? vaultBody.data : []);
      } else {
        setVault([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Client data unavailable');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const activeShipments = useMemo(() => shipments.filter((shipment) => ACTIVE_STATUSES.has(shipment.status)), [shipments]);
  const liveShipments = useMemo(() => shipments.filter(isLive), [shipments]);
  const staleFixes = useMemo(() => shipments.filter((shipment) => isValidPosition(shipment.current_location) && !isFresh(shipment)), [shipments]);
  const attentionShipments = useMemo(() => shipments.filter(hasAttention), [shipments]);
  const verifiedSeals = useMemo(() => shipments.filter((shipment) => shipment.seal_status === 'intact'), [shipments]);
  const filteredShipments = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return shipments;
    return shipments.filter((shipment) => [shipment.reference, shipment.origin, shipment.destination].some((value) => (value ?? '').toLowerCase().includes(normalized)));
  }, [shipments, query]);

  const openConvoy = useCallback((convoyId: string) => {
    void navigate({ to: '/portal/convoy/$convoy_id/track', params: { convoy_id: convoyId } });
  }, [navigate]);

  return (
    <PortalShell>
      <header className="sticky top-0 z-40 border-b border-white/[.06]" style={{ background: 'rgba(7,11,22,.9)', backdropFilter: 'blur(18px)' }}>
        <div className="mx-auto flex max-w-[1520px] items-center justify-between gap-4 px-4 py-3 sm:px-6 xl:px-8">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[.22em] text-orange-300/70">SONALIT / CLIENT WORKSPACE</p>
            <h1 className="mt-1 text-sm font-semibold text-white sm:text-base">Client Workspace</h1>
            <p className="mt-1 text-[9px] text-white/25">Trusted cargo visibility · movement · convoy records</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void load()} className="rounded-lg border border-white/[.07] p-2 text-white/40 hover:text-white" title="Refresh">
              <RefreshCw size={14} />
            </button>
            <button type="button" onClick={() => void navigate({ to: '/portal/notifications' })} className="rounded-lg border border-white/[.07] p-2 text-white/40 hover:text-white" title="Notifications">
              <Activity size={14} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1520px] px-4 pb-24 pt-5 sm:px-6 sm:pt-7 xl:px-8">
        {error && (
          <div className="mb-4 flex gap-3 rounded-2xl border border-red-500/20 bg-red-500/[.04] p-4">
            <XCircle size={17} className="mt-0.5 text-red-400" />
            <div>
              <p className="text-sm font-semibold text-red-300">Client data unavailable</p>
              <p className="mt-1 text-xs text-red-200/50">{error}</p>
            </div>
          </div>
        )}

        {!loading && (
          <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">
            <Metric label="Active convoys" value={activeShipments.length} meta="Current movement records" icon={Truck} />
            <Metric label="Verified live" value={liveShipments.length} meta="Fresh GPS < 120 sec" icon={Activity} tone="live" />
            <Metric label="Stale fixes" value={staleFixes.length} meta="Not plotted as live" icon={Clock3} tone="amber" />
            <Metric label="Attention" value={attentionShipments.length} meta="Exceptions / seal state" icon={AlertTriangle} tone="danger" />
            <Metric label="Seal verified" value={verifiedSeals.length} meta="Explicitly intact" icon={ShieldCheck} tone="live" />
          </section>
        )}

        <div className="mt-5 flex flex-wrap gap-1 rounded-xl border border-white/[.07] bg-white/[.012] p-1">
          <button type="button" onClick={() => setTab('overview')} className={`rounded-lg px-4 py-2 text-[9px] font-bold uppercase tracking-[.14em] ${tab === 'overview' ? 'bg-orange-500 text-white' : 'text-white/35'}`}>Operating picture</button>
          <button type="button" onClick={() => setTab('movements')} className={`rounded-lg px-4 py-2 text-[9px] font-bold uppercase tracking-[.14em] ${tab === 'movements' ? 'bg-orange-500 text-white' : 'text-white/35'}`}>Movements</button>
          <button type="button" onClick={() => setTab('documents')} className={`rounded-lg px-4 py-2 text-[9px] font-bold uppercase tracking-[.14em] ${tab === 'documents' ? 'bg-orange-500 text-white' : 'text-white/35'}`}>Convoy documents</button>
        </div>

        {(tab === 'overview' || tab === 'movements') && (
          <>
            <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.72fr)_minmax(330px,.78fr)]">
              <MovementAtlas shipments={shipments} onOpen={openConvoy} />
              <aside className="space-y-4">
                <div className="rounded-2xl border border-white/[.07] bg-white/[.012] p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[.18em] text-white/30">Data integrity</p>
                      <h2 className="mt-1 text-sm font-semibold text-white">Telemetry trust panel</h2>
                    </div>
                    <CheckCircle2 size={16} className="text-emerald-300" />
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-xl border border-white/[.06] p-3"><span className="text-[8px] uppercase tracking-[.12em] text-white/20">Fresh</span><strong className="mono mt-1 block text-lg text-emerald-300">{liveShipments.length}</strong></div>
                    <div className="rounded-xl border border-white/[.06] p-3"><span className="text-[8px] uppercase tracking-[.12em] text-white/20">Held back</span><strong className="mono mt-1 block text-lg text-amber-300">{staleFixes.length}</strong></div>
                  </div>
                  <p className="mt-3 text-[10px] leading-relaxed text-white/28">A location is plotted only when the feed is recent, numerically valid, and not the 0,0 sentinel. Uncertainty is exposed instead of dressed up as precision.</p>
                </div>

                {attentionShipments.length ? (
                  <div className="rounded-2xl border border-red-400/15 bg-red-400/[.035] p-5">
                    <div className="flex items-center gap-2"><AlertTriangle size={15} className="text-red-300" /><h2 className="text-sm font-semibold text-white">Attention queue</h2></div>
                    <div className="mt-3 space-y-2">
                      {attentionShipments.slice(0, 5).map((shipment) => (
                        <button type="button" key={shipment.convoy_id} onClick={() => openConvoy(shipment.convoy_id)} className="w-full rounded-xl border border-red-400/10 bg-black/10 p-3 text-left">
                          <div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold text-white">{shipment.reference}</span><span className="text-[8px] text-red-300/70">{shipment.exception_count} exception{shipment.exception_count === 1 ? '' : 's'}</span></div>
                          <p className="mt-1 text-[9px] text-white/25">{shipment.seal_status === 'compromised' ? 'Seal compromised · ' : ''}{shipment.last_ping_at ? relativeTime(shipment.last_ping_at) : 'No telemetry'}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-emerald-400/10 bg-emerald-400/[.03] p-5">
                    <div className="flex gap-3"><CheckCircle2 size={16} className="text-emerald-300" /><div><h2 className="text-sm font-semibold text-white">No active exceptions</h2><p className="mt-1 text-[10px] text-white/28">No unresolved exception or compromised-seal records are attached to this client scope.</p></div></div>
                  </div>
                )}
              </aside>
            </section>

            <section className="mt-4">
              <div className="mb-3 flex items-end justify-between gap-3">
                <div><p className="text-[9px] font-bold uppercase tracking-[.18em] text-white/30">Movement portfolio</p><h2 className="mt-1 text-base font-semibold text-white">Shipments under this client scope</h2></div>
                <div className="relative w-[220px] max-w-[45vw]"><Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search convoy / route…" className="w-full rounded-xl border border-white/[.07] bg-black/10 py-2.5 pl-8 pr-3 text-[10px] text-white outline-none placeholder:text-white/20" /></div>
              </div>
              <div className="space-y-2">
                {filteredShipments.length ? filteredShipments.map((shipment) => (
                  <MovementRow key={shipment.convoy_id} shipment={shipment} onOpen={() => openConvoy(shipment.convoy_id)} />
                )) : <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-[10px] text-white/20">No client-linked movements match this view.</div>}
              </div>
            </section>
          </>
        )}

        {(tab === 'overview' || tab === 'documents') && (
          <div className={tab === 'overview' ? 'mt-4' : ''}>
            <DocumentVault groups={vault} />
          </div>
        )}
      </main>
    </PortalShell>
  );
}
