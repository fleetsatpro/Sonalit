import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle, Clock, Radio, ShieldAlert } from 'lucide-react';
import { subscribe } from '../../lib/centrifuge.js';
import { relativeTime } from './PortalPrimitives.js';

const API = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

// ── Types ─────────────────────────────────────────────────────────────────────

type IncidentStatus = 'detected' | 'responding' | 'resolved';
type IncidentSeverity = 'info' | 'warning' | 'critical';
type IncidentType = 'deviation' | 'unplanned_stop' | 'sos' | 'geofence' | 'delay' | 'seal';

interface TimelineEvent {
  at: string;
  label: string;
  phase: string;
}

export interface PortalIncident {
  id: string;
  convoy_id: string;
  type: IncidentType;
  severity: IncidentSeverity;
  title: string;
  summary: string;
  status: IncidentStatus;
  occurred_at: string;
  resolved_at: string | null;
  timeline: TimelineEvent[];
}

interface SecurityRtEvent {
  type: 'security';
  level: string;
  incident?: PortalIncident;
}

// ── Severity + type config ────────────────────────────────────────────────────

const SEV_COLOR: Record<IncidentSeverity, string> = {
  info:     '#60a5fa',
  warning:  '#f5b042',
  critical: '#ef4444',
};

const TYPE_ICON: Record<IncidentType, React.ElementType> = {
  deviation:      AlertTriangle,
  unplanned_stop: Clock,
  sos:            ShieldAlert,
  geofence:       Radio,
  delay:          Clock,
  seal:           CheckCircle,
};

const PHASE_LABELS: Record<string, string> = {
  detected:   'DETECTED',
  responding: 'RESPONDING',
  resolved:   'RESOLVED',
};

const PHASE_COLOR: Record<string, string> = {
  detected:   '#f5b042',
  responding: '#818cf8',
  resolved:   '#22c55e',
};

// ── IncidentCard ──────────────────────────────────────────────────────────────

function IncidentCard({ incident }: { incident: PortalIncident }) {
  const [expanded, setExpanded] = useState(incident.status !== 'resolved');
  const color = SEV_COLOR[incident.severity];
  const Icon = TYPE_ICON[incident.type] ?? AlertTriangle;
  const isActive = incident.status !== 'resolved';

  return (
    <article
      className="rounded-xl border overflow-hidden portal-reveal"
      style={{
        background: 'var(--p-surface)',
        borderColor: isActive ? `${color}33` : 'rgba(255,255,255,0.07)',
      }}
    >
      {/* Header row */}
      <button
        className="w-full flex items-start gap-3 px-4 py-3 text-left"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <Icon size={16} className="shrink-0 mt-0.5" style={{ color }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white truncate">{incident.title}</p>
          <p className="mono text-[11px] text-white/30 mt-0.5">
            {relativeTime(incident.occurred_at)}
          </p>
        </div>
        {/* Phase chip */}
        <span
          className="shrink-0 text-[10px] font-bold tracking-widest px-2 py-0.5 rounded"
          style={{
            color: PHASE_COLOR[incident.status],
            background: `${PHASE_COLOR[incident.status]}18`,
          }}
        >
          {PHASE_LABELS[incident.status] ?? incident.status.toUpperCase()}
        </span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/[0.05]">
          <p className="text-xs text-white/60 pt-3 leading-relaxed">{incident.summary}</p>

          {/* Timeline */}
          <div className="space-y-2 mt-2">
            {incident.timeline.map((ev, idx) => (
              <div key={idx} className="flex items-start gap-2.5">
                <div className="flex flex-col items-center shrink-0 mt-0.5">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: PHASE_COLOR[ev.phase] ?? '#ffffff40' }}
                  />
                  {idx < incident.timeline.length - 1 && (
                    <div className="w-px flex-1 min-h-[14px]" style={{ background: 'rgba(255,255,255,0.1)' }} />
                  )}
                </div>
                <div className="pb-2">
                  <p className="text-xs text-white/70">{ev.label}</p>
                  <p className="mono text-[10px] text-white/30">{relativeTime(ev.at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}

// ── IncidentFeed ──────────────────────────────────────────────────────────────

interface Props {
  convoyId: string;
  onLevelChange?: (level: string) => void;
}

export function IncidentFeed({ convoyId, onLevelChange }: Props): React.ReactElement {
  const [incidents, setIncidents] = useState<PortalIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!convoyId) return;
    setLoading(true);
    setErrorMsg(null);
    fetch(`${API}/portal/convoy/${encodeURIComponent(convoyId)}/incidents`, { credentials: 'include' })
      .then(async res => {
        if (res.status === 401) { window.location.href = '/portal/login'; return null; }
        if (res.status === 403) { setErrorMsg('Not authorised for this convoy'); return null; }
        if (!res.ok) { setErrorMsg('Failed to load incidents'); return null; }
        return res.json() as Promise<{ data: PortalIncident[] }>;
      })
      .then(json => { if (json) setIncidents(json.data); })
      .catch(() => setErrorMsg('Failed to load incidents'))
      .finally(() => setLoading(false));
  }, [convoyId]);

  // Real-time: merge incoming incidents into feed
  useEffect(() => {
    if (!convoyId) return;
    return subscribe<SecurityRtEvent>(`portal#${convoyId}`, evt => {
      if (evt.type === 'security') {
        onLevelChange?.(evt.level);
        if (evt.incident) {
          setIncidents(prev => {
            const existing = prev.findIndex(i => i.id === evt.incident!.id);
            if (existing >= 0) {
              const next = [...prev];
              next[existing] = evt.incident!;
              return next;
            }
            return [evt.incident!, ...prev];
          });
        }
      }
    });
  }, [convoyId, onLevelChange]);

  const open = incidents.filter(i => i.status !== 'resolved');
  const resolved = incidents.filter(i => i.status === 'resolved');

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1].map(i => (
          <div key={i} className="h-16 rounded-xl border border-white/[0.07] animate-pulse"
            style={{ background: 'var(--p-surface)', animationDelay: `${i * 80}ms` }} />
        ))}
      </div>
    );
  }

  if (errorMsg) {
    return (
      <div className="flex gap-3 p-4 rounded-xl border border-red-700/40 bg-red-900/20">
        <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
        <p className="text-sm text-red-300">{errorMsg}</p>
      </div>
    );
  }

  if (incidents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <div className="w-10 h-10 rounded-full flex items-center justify-center"
          style={{ background: 'rgba(34,197,94,0.12)' }}>
          <CheckCircle size={20} className="text-green-400" />
        </div>
        <p className="text-sm text-white/40">No incidents recorded for this convoy</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {open.length > 0 && (
        <>
          <p className="text-[11px] font-semibold tracking-widest text-white/30 uppercase">Active</p>
          {open.map(i => <IncidentCard key={i.id} incident={i} />)}
        </>
      )}
      {resolved.length > 0 && (
        <>
          <p className="text-[11px] font-semibold tracking-widest text-white/30 uppercase mt-4">Resolved</p>
          {resolved.map(i => <IncidentCard key={i.id} incident={i} />)}
        </>
      )}
    </div>
  );
}
