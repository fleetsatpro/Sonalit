import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle, Bell, Loader2, Package } from 'lucide-react';

const API_BASE = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

// ── Types ─────────────────────────────────────────────────────────────────────

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

type TabKey = 'active' | 'completed' | 'all';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtEta(val: string | null): string {
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

function statusBadge(status: string): { bg: string; border: string; text: string; label: string } {
  const map: Record<string, { bg: string; border: string; text: string; label: string }> = {
    in_transit: { bg: 'bg-green-900/40',  border: 'border-green-700',  text: 'text-green-400',  label: 'In Transit' },
    completed:  { bg: 'bg-blue-900/40',   border: 'border-blue-700',   text: 'text-blue-400',   label: 'Completed' },
    pending:    { bg: 'bg-gray-700/40',   border: 'border-gray-600',   text: 'text-gray-400',   label: 'Pending' },
    cancelled:  { bg: 'bg-red-900/40',    border: 'border-red-700',    text: 'text-red-400',    label: 'Cancelled' },
  };
  return map[status] ?? {
    bg: 'bg-gray-700/40', border: 'border-gray-600', text: 'text-gray-400',
    label: status.replace(/_/g, ' '),
  };
}

const CARD_STYLE: React.CSSProperties = { background: 'rgba(13,20,38,0.7)' };

// ── Sub-components ────────────────────────────────────────────────────────────

function SkeletonCard(): React.ReactElement {
  return (
    <div
      className="rounded-xl border border-white/[0.07] p-5 animate-pulse"
      style={CARD_STYLE}
    >
      <div className="flex justify-between mb-3">
        <div className="h-4 w-32 rounded bg-white/10" />
        <div className="h-5 w-20 rounded-full bg-white/10" />
      </div>
      <div className="h-3 w-40 rounded bg-white/[0.06] mb-4" />
      <div className="h-1.5 w-full rounded-full bg-white/10 mb-3" />
      <div className="flex justify-between">
        <div className="h-3 w-24 rounded bg-white/[0.06]" />
        <div className="h-3 w-16 rounded bg-white/[0.06]" />
      </div>
    </div>
  );
}

function SealBadge({ seal }: { seal: ShipmentSummary['seal_status'] }): React.ReactElement | null {
  if (!seal) return null;
  if (seal === 'intact') {
    return <span className="text-green-400 text-xs font-medium">Seal: Intact ✓</span>;
  }
  if (seal === 'compromised') {
    return <span className="text-red-400 text-xs font-medium">Seal: Compromised !</span>;
  }
  return <span className="text-yellow-400 text-xs font-medium">Seal: Unverified</span>;
}

function ShipmentCard({ shipment }: { shipment: ShipmentSummary }): React.ReactElement {
  const navigate = useNavigate();
  const badge = statusBadge(shipment.status);
  const showProgress = shipment.progress_pct != null && shipment.status === 'in_transit';

  const handleTrack = () => {
    void navigate({ to: '/portal-view', search: { convoy_id: shipment.convoy_id } });
  };

  return (
    <div
      className="rounded-xl border border-white/[0.07] p-5 flex flex-col gap-3"
      style={CARD_STYLE}
    >
      {/* Row 1: reference + badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-white truncate">{shipment.reference}</p>
          {(shipment.origin || shipment.destination) && (
            <p className="text-xs text-white/50 mt-0.5 truncate">
              {shipment.origin || '?'} → {shipment.destination || '?'}
            </p>
          )}
        </div>
        <span
          className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border shrink-0 ${badge.bg} ${badge.border} ${badge.text}`}
        >
          {badge.label}
        </span>
      </div>

      {/* Progress bar */}
      {showProgress && (
        <div>
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-1.5 rounded-full bg-orange-500 transition-all duration-500"
              style={{ width: `${shipment.progress_pct ?? 0}%` }}
            />
          </div>
          <p className="text-xs text-white/50 mt-1">{shipment.progress_pct}%</p>
        </div>
      )}

      {/* Row 2: ETA + last ping */}
      <div className="flex items-center justify-between gap-3 text-xs text-white/50">
        <span>
          ETA:{' '}
          <span className="text-white/70">{fmtEta(shipment.eta)}</span>
        </span>
        <span>Last ping: {agoText(shipment.last_ping_at)}</span>
      </div>

      {/* Row 3: seal badge */}
      <div className="flex items-center gap-3">
        {shipment.exception_count > 0 && (
          <button
            onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/exceptions', params: { convoy_id: shipment.convoy_id } })}
            className="flex items-center gap-1 text-xs text-red-400 font-medium hover:text-red-300 transition-colors"
          >
            <span className="inline-block w-2 h-2 rounded-full bg-red-500 shrink-0" />
            {shipment.exception_count} exception{shipment.exception_count !== 1 ? 's' : ''}
          </button>
        )}
        <SealBadge seal={shipment.seal_status} />
      </div>

      {/* Row 4: action links */}
      <div className="flex items-center flex-wrap gap-3 pt-0.5 border-t border-white/[0.05]">
        <button onClick={handleTrack} className="text-xs font-semibold text-orange-400 hover:text-orange-300 transition-colors">
          Track →
        </button>
        <button
          onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/manifest', params: { convoy_id: shipment.convoy_id } })}
          className="text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          Manifest
        </button>
        <button
          onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/exceptions', params: { convoy_id: shipment.convoy_id } })}
          className="text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          Exceptions
        </button>
        {(shipment.status === 'completed' || shipment.status === 'cancelled') && (
          <button
            onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/pod', params: { convoy_id: shipment.convoy_id } })}
            className="text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            POD
          </button>
        )}
        <button
          onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/documents', params: { convoy_id: shipment.convoy_id } })}
          className="text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          Docs
        </button>
        <button
          onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/sensors', params: { convoy_id: shipment.convoy_id } })}
          className="text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          Sensors
        </button>
        <button
          onClick={() => void navigate({ to: '/portal/convoy/$convoy_id/replay', params: { convoy_id: shipment.convoy_id } })}
          className="text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          Replay
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PortalDashboard(): React.ReactElement {
  const navigate = useNavigate();
  const [shipments, setShipments] = useState<ShipmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('active');
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/portal/shipments`, { credentials: 'include' })
      .then(async (res) => {
        if (res.status === 401) {
          void navigate({ to: '/portal/login' });
          return null;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as { error?: string };
          throw new Error(body.error ?? `Failed to load shipments (${res.status})`);
        }
        return res.json() as Promise<{ data: ShipmentSummary[] }>;
      })
      .then((json) => {
        if (json) setShipments(json.data ?? []);
      })
      .catch((err: Error) => {
        setErrorMsg(err.message);
      })
      .finally(() => setLoading(false));
  }, [navigate]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch(`${API_BASE}/portal/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } finally {
      void navigate({ to: '/portal/login' });
    }
  };

  const filtered = useMemo<ShipmentSummary[]>(() => {
    if (activeTab === 'active') {
      return shipments.filter((s) => s.status === 'in_transit' || s.status === 'pending');
    }
    if (activeTab === 'completed') {
      return shipments.filter((s) => s.status === 'completed' || s.status === 'cancelled');
    }
    return shipments;
  }, [shipments, activeTab]);

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'completed', label: 'Completed' },
    { key: 'all', label: 'All' },
  ];

  return (
    <div className="min-h-screen" style={{ background: '#050813' }}>

      {/* Header */}
      <div className="border-b border-white/[0.06] px-4 sm:px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package size={18} className="text-orange-400 shrink-0" />
          <span
            className="font-black text-base tracking-wider uppercase"
            style={{
              fontFamily: "'Barlow Condensed','Arial Narrow',sans-serif",
              background: 'linear-gradient(90deg,#ff9040,#f07020)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            SONALIT
          </span>
          <span className="text-xs text-gray-500 ml-1">Cargo Portal</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void navigate({ to: '/portal/notifications' })}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-white/[0.06] hover:border-white/[0.15]"
            aria-label="Notification settings"
          >
            <Bell size={13} />
          </button>
          <button
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white disabled:opacity-50 transition-colors px-3 py-1.5 rounded-lg border border-white/[0.06] hover:border-white/[0.15]"
          >
            {loggingOut ? <Loader2 size={12} className="animate-spin" /> : null}
            Log out
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 pt-6 pb-12">

        {/* Greeting */}
        <h1 className="text-xl font-bold text-white mb-5">Your Shipments</h1>

        {/* Tabs */}
        <div className="flex gap-1 mb-5 rounded-lg border border-white/[0.07] p-1 w-fit" style={CARD_STYLE}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-orange-500 text-white'
                  : 'text-white/50 hover:text-white/80'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {errorMsg && (
          <div className="flex items-start gap-3 rounded-xl border border-red-700/50 bg-red-900/20 px-4 py-3 mb-5">
            <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 text-sm font-semibold">Could not load shipments</p>
              <p className="text-red-400/80 text-xs mt-1">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Loading skeletons */}
        {loading && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {/* Shipment grid */}
        {!loading && !errorMsg && filtered.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {filtered.map((s) => (
              <ShipmentCard key={s.convoy_id} shipment={s} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !errorMsg && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Package size={40} className="text-white/10 mb-4" />
            <p className="text-white/40 text-sm">No shipments linked to your account yet.</p>
          </div>
        )}
      </div>
    </div>
  );
}
