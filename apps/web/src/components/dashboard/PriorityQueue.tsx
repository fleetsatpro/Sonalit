import React, { Suspense, lazy } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, BellRing, Camera, CircleDot, Fuel, Gauge, Mic, Route, ShieldAlert, Siren, Truck, type LucideIcon } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useDashboardStore } from '../../stores/dashboardStore.js';
import type { DashboardAlert } from '../../stores/dashboardStore.js';

const ResponseCrewPanel = lazy(() => import('./ResponseCrewPanel.js'));

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, alert: 1, medium: 2, incident: 2, low: 3, convoy: 3 };

interface Chip { label: string; hue: string; Icon: LucideIcon }

function chipFor(type: string, severity?: string): Chip {
  const t = type.toLowerCase();
  if (t.includes('panic') || t.includes('sos')) return { label: 'SOS', hue: '255,59,92', Icon: Siren };
  if (t.includes('voice')) return { label: 'VOICE NOTE', hue: '55,230,255', Icon: Mic };
  if (t.includes('capture') || t.includes('photo')) return { label: 'CAPTURE', hue: '55,230,255', Icon: Camera };
  if (t.includes('natural_hazard') || t.includes('hazard_near_route') || t.includes('risk_zone')) return { label: 'HAZARD', hue: '255,178,62', Icon: ShieldAlert };
  if (t.includes('traffic_closure') || t.includes('traffic_congestion') || t.includes('traffic')) return { label: 'TRAFFIC', hue: '255,178,62', Icon: Route };
  if (t.includes('stale_telemetry') || t.includes('gps_gap') || t.includes('position_jump')) return { label: 'GPS', hue: '55,230,255', Icon: Gauge };
  if (t.includes('geofence') || t.includes('corridor') || t.includes('deviation')) return { label: 'ROUTE', hue: '255,178,62', Icon: Route };
  if (t.includes('brak') || t.includes('speed') || t.includes('driver') || t.includes('accel')) return { label: 'DRIVER', hue: '55,230,255', Icon: Gauge };
  if (t.includes('fuel')) return { label: 'FUEL', hue: '255,178,62', Icon: Fuel };
  if (t.includes('convoy')) return { label: 'CONVOY', hue: '34,227,154', Icon: Truck };
  if (t.includes('incident')) return { label: 'INCIDENT', hue: '255,59,92', Icon: ShieldAlert };
  if (t.includes('alert') || severity === 'critical' || severity === 'high') return { label: 'ALERT', hue: '255,59,92', Icon: BellRing };
  return { label: 'EVENT', hue: '255,178,62', Icon: CircleDot };
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function shortenIds(text: string): string { return text.replace(UUID_RE, (m) => m.slice(0, 8)); }

function relTime(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${Math.max(sec, 0)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export type QueueDestination = '/alerts' | '/panic-center' | '/guardian' | '/surveillance' | '/convoys' | '/incidents' | '/field-officers' | '/fleet';

export interface QueueItem {
  id: string;
  chip: Chip;
  title: string;
  body?: string;
  at: string;
  rank: number;
  source: string;
  destination: QueueDestination;
  severity?: string;
  priorityReason?: string | null;
  recordType: 'alert' | 'event';
  ackId?: string;
}

function destinationForFeed(type: string): QueueDestination {
  const value = type.toLowerCase();
  if (value.includes('panic') || value.includes('sos')) return '/panic-center';
  if (value.includes('voice')) return '/guardian';
  if (value.includes('capture') || value.includes('photo')) return '/surveillance';
  if (value.includes('geofence') || value.includes('corridor') || value.includes('deviation')) return '/alerts';
  if (value.includes('convoy')) return '/convoys';
  if (value.includes('incident')) return '/incidents';
  if (value.includes('crew') || value.includes('field')) return '/field-officers';
  if (value.includes('alert')) return '/alerts';
  return '/fleet';
}

function LockCorner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const base: React.CSSProperties = { position: 'absolute', width: 10, height: 10, borderColor: 'var(--d-fire)', borderStyle: 'solid', borderWidth: 0 };
  const map: Record<string, React.CSSProperties> = {
    tl: { top: -1, left: -1, borderTopWidth: 2, borderLeftWidth: 2 },
    tr: { top: -1, right: -1, borderTopWidth: 2, borderRightWidth: 2 },
    bl: { bottom: -1, left: -1, borderBottomWidth: 2, borderLeftWidth: 2 },
    br: { bottom: -1, right: -1, borderBottomWidth: 2, borderRightWidth: 2 },
  };
  return <span style={{ ...base, ...map[pos] }} aria-hidden='true' />;
}

function SectionHeader({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 8px' }}>
      <span style={{ width: 3, height: 12, background: 'var(--d-orange)', borderRadius: 2, flexShrink: 0 }} />
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 10, letterSpacing: '.12em', color: 'var(--d-t1)' }}>{children}</span>
      {count != null && count > 0 && <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-fire)' }}>{count} active</span>}
    </div>
  );
}

interface PriorityQueueProps {
  onSelect?: (item: QueueItem) => void;
  showNextDelivery?: boolean;
}

const PriorityQueue = React.memo(function PriorityQueue({ onSelect, showNextDelivery = true }: PriorityQueueProps) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const alerts = useDashboardStore((s) => s.alerts);
  const feedItems = useDashboardStore((s) => s.feedItems);
  const panic = useDashboardStore((s) => s.panicState);
  const voiceNote = useDashboardStore((s) => s.voiceNoteAlert);
  const overview = useDashboardStore((s) => s.overview);
  const convoys = useDashboardStore((s) => s.convoys);
  const { setAlerts, removeAlert } = useDashboardStore.getState();

  const alertsQuery = useQuery({
    queryKey: ['dashboard-alerts-ops'],
    queryFn: async () => { const r = await api.get<{ data: DashboardAlert[] }>('/dashboard/alerts?limit=10'); setAlerts(r.data.data ?? []); return r.data.data; },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const ackMut = useMutation({
    mutationFn: (id: string) => api.patch(`/alerts/${id}/acknowledge`),
    onSuccess: (_, id) => { removeAlert(id); qc.invalidateQueries({ queryKey: ['alerts-unread-count'] }); },
  });

  const items: QueueItem[] = [
    ...alerts.map((a): QueueItem => ({
      id: `a-${a.id}`,
      chip: chipFor(a.event_code || a.type, a.severity),
      title: shortenIds(a.title),
      ...(a.summary && a.summary.trim() !== a.title.trim() ? { body: shortenIds(a.summary) } : {}),
      ...(a.priority_reason ? { priorityReason: a.priority_reason } : {}),
      source: a.source || 'Dashboard alert register',
      at: a.occurred_at,
      rank: SEV_RANK[a.severity] ?? 3,
      source: 'Dashboard alert register',
      destination: '/alerts',
      severity: a.severity,
      recordType: 'alert',
      ...(!a.acknowledged ? { ackId: a.id } : {}),
    })),
    ...feedItems
      .filter((f) => !alerts.some((a) => a.id === f.id))
      .filter((f) => !/ENVIRONMENTAL_DETERIORATION/i.test(String(f.type || '') + ' ' + String(f.message || '')))
      .map((f): QueueItem => ({
        id: `f-${f.id}`,
        chip: chipFor(f.type, f.severity),
        title: shortenIds(f.message),
        at: f.timestamp,
        rank: SEV_RANK[f.severity ?? f.type] ?? 3,
        source: 'Realtime session event',
        destination: destinationForFeed(f.type),
        severity: f.severity,
        recordType: 'event',
      })),
  ].sort((x, y) => x.rank - y.rank || new Date(y.at).getTime() - new Date(x.at).getTime());

  const [filter, setFilter] = React.useState<'all' | 'critical' | 'high' | 'other'>('all');
  const visibleItems = items.filter((item) => filter === 'all'
    || (filter === 'critical' && item.severity === 'critical')
    || (filter === 'high' && item.severity === 'high')
    || (filter === 'other' && item.severity !== 'critical' && item.severity !== 'high'));
  const filterCounts = {
    all: items.length,
    critical: items.filter((item) => item.severity === 'critical').length,
    high: items.filter((item) => item.severity === 'high').length,
    other: items.filter((item) => item.severity !== 'critical' && item.severity !== 'high').length,
  };

  const nextDelivery = overview?.next_delivery ?? null;
  const focusConvoy = nextDelivery ? convoys.find((c) => c.id === nextDelivery.convoy_id) ?? null : convoys[0] ?? null;

  return (
    <aside className='d-console-queue' style={{ background: 'var(--d-carbon)', borderLeft: '1px solid var(--d-rim2)', display: 'flex', flexDirection: 'column', overflowY: 'auto', scrollbarWidth: 'none', minHeight: 0 }}>
      <SectionHeader count={items.length + (panic ? 1 : 0)}>PRIORITY QUEUE</SectionHeader>
      <nav className='ccxq-filters' aria-label='Filter priority response records'>
        {(['all', 'critical', 'high', 'other'] as const).map((key) => (
          <button key={key} type='button' className={filter === key ? 'ccxq-filter is-active' : 'ccxq-filter'} aria-pressed={filter === key} onClick={() => setFilter(key)}>
            <span>{key === 'other' ? 'OTHER' : key.toUpperCase()}</span><b>{filterCounts[key]}</b>
          </button>
        ))}
      </nav>

      {panic && (
        <div className='ccxq-panic-wrap' style={{ padding: '0 14px 10px' }}>
          <div className='ccxq-panic-card' style={{ position: 'relative', padding: '10px 12px', background: 'rgba(255,59,92,.08)', border: '1px solid var(--d-fire)', borderRadius: 8, animation: 'd-crit 1.8s ease-in-out infinite' }}>
            <LockCorner pos='tl' /><LockCorner pos='tr' /><LockCorner pos='bl' /><LockCorner pos='br' />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span className='ccxq-panic-badge'><Siren size={12} strokeWidth={2.1} aria-hidden='true' /> SOS</span>
              <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, color: 'var(--d-fire)', letterSpacing: '.06em' }}>PANIC ACTIVE</span>
              <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)' }}>{relTime(panic.triggered_at)}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--d-t1)', marginBottom: 8 }}>{panic.mode ? `${panic.mode.replace(/_/g, ' ')} · ` : ''}{panic.vehicle_id ?? 'unassigned device'}</div>
            <button type='button' onClick={() => nav({ to: '/panic-center' })} style={{ width: '100%', padding: '7px 0', background: 'var(--d-fire)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 10, letterSpacing: '.1em' }}>OPEN PANIC CENTER</button>
          </div>
        </div>
      )}

      {voiceNote && (
        <div className='ccxq-voice-wrap' style={{ padding: '0 14px 10px' }}>
          <button className='ccxq-voice-card' type='button' onClick={() => nav({ to: '/guardian' })} style={{ width: '100%', textAlign: 'left', padding: '9px 12px', background: 'rgba(55,230,255,.06)', border: '1px solid rgba(55,230,255,.4)', borderRadius: 8, cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span className='ccxq-voice-badge'><Mic size={12} strokeWidth={1.9} aria-hidden='true' /> VOICE NOTE</span>
              <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)' }}>{relTime(voiceNote.createdAt)}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--d-t1)', lineHeight: 1.35 }}>{voiceNote.deviceName} → dispatch{voiceNote.durationMs ? ` · ${Math.round(voiceNote.durationMs / 1000)}s clip` : ''}</div>
          </button>
        </div>
      )}

      <div style={{ padding: '0 14px 10px' }}><Suspense fallback={null}><ResponseCrewPanel /></Suspense></div>

      <div className='ccxq-record-list'>
        {alertsQuery.isError && <div className='ccxq-source-warning' role='status'>Alert register unavailable. Previously received session events may still be visible; no all-clear state can be inferred.</div>}
        {visibleItems.length === 0 && !panic && !voiceNote && <div className='ccxq-empty'>{items.length > 0 ? 'No records match this filter.' : alertsQuery.isPending ? 'Loading the alert response window…' : alertsQuery.isError ? 'No verified alert register is available.' : 'No alert records were returned in the current response window. This is not a global all-clear.'}</div>}
        {visibleItems.map((it) => (
          <article key={it.id} className={'ccxq-record ccxq-record--' + (it.severity || 'unclassified')} style={{ borderLeftColor: `rgb(${it.chip.hue})` }}>
            <button type='button' className='ccxq-record__select' onClick={() => onSelect?.(it)} disabled={!onSelect} aria-label={`Open ${it.title}`}>
              <span className='ccxq-record__meta'>
                <span className='ccxq-record__type'><it.chip.Icon size={12} strokeWidth={2} aria-hidden='true' /><span>{it.chip.label}</span></span>
                <span className='ccxq-record__source'>{it.recordType === 'alert' ? 'ALERT REGISTER' : 'SESSION EVENT'}</span>
                <time dateTime={it.at}>{relTime(it.at)}</time>
              </span>
              <span className='ccxq-record__title'>{it.title}</span>
              {it.body && <span className='ccxq-record__body'>{it.body}</span>}
              {it.priorityReason && (
                <span className='ccxq-record__priority'>
                  <strong>WHY {(it.severity || 'PRIORITY').toUpperCase()}</strong>
                  <span>{it.priorityReason}</span>
                </span>
              )}
              <span className='ccxq-record__footer'><span>{it.source}</span>{onSelect && <ArrowUpRight size={13} aria-hidden='true' />}</span>
            </button>
            {it.ackId && <button type='button' className='ccxq-record__ack' onClick={() => ackMut.mutate(it.ackId!)} disabled={ackMut.isPending}>{ackMut.isPending ? 'ACKNOWLEDGING…' : 'ACKNOWLEDGE'}</button>}
          </article>
        ))}
      </div>

      {showNextDelivery && (nextDelivery || focusConvoy) && (
        <div style={{ borderTop: '1px solid var(--d-rim2)', padding: '10px 14px 14px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 3, height: 12, background: '#37e6ff', borderRadius: 2, flexShrink: 0 }} />
            <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 10, letterSpacing: '.1em', color: 'var(--d-t1)' }}>CONVOY {(nextDelivery?.convoy_name ?? focusConvoy?.name ?? '').toUpperCase()}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ background: 'var(--d-well)', border: '1px solid var(--d-rim2)', borderRadius: 7, padding: '7px 10px' }}>
              <div style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.1em', color: 'var(--d-t3)', marginBottom: 2 }}>NEXT ETA</div>
              <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 15, color: 'var(--d-t1)' }}>{nextDelivery ? new Date(nextDelivery.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}</div>
            </div>
            <div style={{ background: 'var(--d-well)', border: '1px solid var(--d-rim2)', borderRadius: 7, padding: '7px 10px' }}>
              <div style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.1em', color: 'var(--d-t3)', marginBottom: 2 }}>STATUS</div>
              <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 13, color: '#37e6ff', textTransform: 'uppercase' }}>{focusConvoy?.status ?? 'scheduled'}</div>
            </div>
          </div>
          {focusConvoy?.progress != null && <div style={{ marginTop: 8 }}><div style={{ height: 4, background: 'var(--d-lift2)', borderRadius: 2, overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.min(100, Math.max(0, focusConvoy.progress))}%`, background: '#37e6ff', borderRadius: 2, transition: 'width .6s ease' }} /></div><div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', marginTop: 3, textAlign: 'right' }}>{Math.round(focusConvoy.progress)}% of route</div></div>}
          <button type='button' onClick={() => nav({ to: '/convoys' })} style={{ marginTop: 8, width: '100%', padding: '6px 0', background: 'var(--d-lift2)', color: 'var(--d-t2)', border: '1px solid var(--d-rim2)', borderRadius: 6, cursor: 'pointer', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, letterSpacing: '.08em' }}>ALL CONVOYS →</button>
        </div>
      )}
    </aside>
  );
});

export default PriorityQueue;
