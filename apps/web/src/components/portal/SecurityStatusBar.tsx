import React, { useEffect, useState } from 'react';
import { ShieldCheck, AlertTriangle } from 'lucide-react';
import { subscribePortal as subscribe } from '../../lib/portalCentrifuge.js';
import { relativeTime } from './PortalPrimitives.js';

const API = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

// ── Types ─────────────────────────────────────────────────────────────────────

type SecurityLevel = 'secure' | 'warning' | 'critical';

interface PortalSecurityStatus {
  convoy_id: string;
  level: SecurityLevel;
  headline: string;
  detail: string;
  escort_active: boolean;
  seal_status: 'intact' | 'compromised' | 'unverified' | null;
  last_checkin_at: string | null;
}

interface SecurityRtEvent {
  type: 'security';
  level: SecurityLevel;
  incident?: unknown;
}

interface Props {
  convoyId: string;
  initialStatus?: PortalSecurityStatus | null;
}

// ── Level config ───────────────────────────────────────────────────────────────

const LEVEL_CONFIG = {
  secure: {
    color: '#22c55e',
    bg: 'rgba(34,197,94,.10)',
    border: 'rgba(34,197,94,.25)',
    dot: 'bg-green-500',
    Icon: ShieldCheck,
    sweep: false,
  },
  warning: {
    color: '#f5b042',
    bg: 'rgba(245,176,66,.12)',
    border: 'rgba(245,176,66,.30)',
    dot: 'bg-amber-400',
    Icon: AlertTriangle,
    sweep: true,
  },
  critical: {
    color: '#ef4444',
    bg: 'rgba(239,68,68,.14)',
    border: 'rgba(239,68,68,.32)',
    dot: 'bg-red-500',
    Icon: AlertTriangle,
    sweep: true,
  },
} as const;

// ── Sweep keyframe style injected once ────────────────────────────────────────

const SWEEP_STYLE_ID = 'security-sweep-keyframes';

function ensureSweepStyle() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(SWEEP_STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = SWEEP_STYLE_ID;
  el.textContent = `
    @media (prefers-reduced-motion: no-preference) {
      @keyframes security-sweep {
        0%   { background-position: -200% center; }
        100% { background-position: 200% center; }
      }
      .security-sweep-anim {
        background-image: linear-gradient(
          90deg,
          transparent 30%,
          rgba(255,255,255,0.04) 50%,
          transparent 70%
        );
        background-size: 200% 100%;
        animation: security-sweep 2s linear infinite;
      }
      @keyframes security-pulse-dot {
        0%, 100% { opacity: 1; transform: scale(1); }
        50%       { opacity: 0.5; transform: scale(1.5); }
      }
      .security-dot-pulse {
        animation: security-pulse-dot 1.2s ease-in-out infinite;
      }
    }
  `;
  document.head.appendChild(el);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function SecurityStatusBar({ convoyId, initialStatus = null }: Props): React.ReactElement | null {
  const [status, setStatus] = useState<PortalSecurityStatus | null>(initialStatus ?? null);
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => { ensureSweepStyle(); }, []);

  // Fetch initial status
  useEffect(() => {
    if (!convoyId) return;
    fetch(`${API}/portal/convoy/${encodeURIComponent(convoyId)}/security`, { credentials: 'include' })
      .then(async res => {
        if (res.status === 401) return null; // parent navigates
        if (res.status === 403) { setForbidden(true); return null; }
        if (!res.ok) return null;
        return res.json() as Promise<{ data: PortalSecurityStatus }>;
      })
      .then(json => { if (json) setStatus(json.data); })
      .catch(() => null);
  }, [convoyId]);

  // Real-time subscription
  useEffect(() => {
    if (!convoyId) return;
    const unsub = subscribe<SecurityRtEvent>(`portal#${convoyId}`, evt => {
      if (evt.type === 'security') {
        setStatus(prev => prev ? { ...prev, level: evt.level } : prev);
      }
    });
    return unsub;
  }, [convoyId]);

  if (forbidden) return null;
  if (!status) return null;

  const cfg = LEVEL_CONFIG[status.level];
  const { Icon } = cfg;

  return (
    <div
      className={`relative overflow-hidden rounded-xl border px-4 py-3 mb-4 portal-reveal${cfg.sweep ? ' security-sweep-anim' : ''}`}
      style={{ background: cfg.bg, borderColor: cfg.border }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <Icon size={20} style={{ color: cfg.color }} className="shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-white text-sm">{status.headline}</p>
          <p className="text-xs mt-0.5" style={{ color: cfg.color, opacity: 0.8 }}>{status.detail}</p>
          {status.last_checkin_at && (
            <p className="mono text-[11px] text-white/30 mt-1">
              Last check-in: {relativeTime(status.last_checkin_at)}
            </p>
          )}
        </div>
        {/* Status dot */}
        <span
          className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ${cfg.dot}${status.level === 'critical' ? ' security-dot-pulse' : ''}`}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
