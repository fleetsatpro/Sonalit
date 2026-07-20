import React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useDashboardStore } from '../../stores/dashboardStore.js';
import type { DashboardAlert } from '../../stores/dashboardStore.js';

// One priority queue: panic, alerts, voice notes & feed events fold into a
// single urgency-ranked list — SOS locked to the top with a target-lock
// treatment. Replaces the OpsSidebar (feed/alerts/health) on the console.

const SEV_RANK: Record<string, number> = { critical: 0, high: 1, alert: 1, medium: 2, incident: 2, low: 3, convoy: 3 };

interface Chip { label: string; hue: string }

// Type → chip. Amber = command/geofence events, cyan = sensor/device events,
// red = threats — mirrors the console's duotone coding.
function chipFor(type: string, severity?: string): Chip {
  const t = type.toLowerCase();
  if (t.includes('panic') || t.includes('sos')) return { label: 'SOS', hue: '255,59,92' };
  if (t.includes('voice')) return { label: 'VOICE NOTE', hue: '55,230,255' };
  if (t.includes('capture') || t.includes('photo')) return { label: 'CAPTURE', hue: '55,230,255' };
  if (t.includes('geofence') || t.includes('corridor') || t.includes('deviation')) return { label: 'GEOFENCE', hue: '255,178,62' };
  if (t.includes('brak') || t.includes('speed') || t.includes('driver') || t.includes('accel')) return { label: 'DRIVER', hue: '55,230,255' };
  if (t.includes('fuel')) return { label: 'FUEL', hue: '255,178,62' };
  if (t.includes('convoy')) return { label: 'CONVOY', hue: '34,227,154' };
  if (severity === 'critical' || severity === 'high') return { label: 'ALERT', hue: '255,59,92' };
  return { label: 'EVENT', hue: '255,178,62' };
}

function relTime(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${Math.max(sec, 0)}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

interface QueueItem {
  id: string;
  chip: Chip;
  title: string;
  body?: string;
  at: string;
  rank: number;
  ackId?: string;
}

// Corner brackets for the SOS target-lock card.
function LockCorner({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const base: React.CSSProperties = { position: 'absolute', width: 10, height: 10, borderColor: 'var(--d-fire)', borderStyle: 'solid', borderWidth: 0 };
  const map: Record<string, React.CSSProperties> = {
    tl: { top: -1, left: -1, borderTopWidth: 2, borderLeftWidth: 2 },
    tr: { top: -1, right: -1, borderTopWidth: 2, borderRightWidth: 2 },
    bl: { bottom: -1, left: -1, borderBottomWidth: 2, borderLeftWidth: 2 },
    br: { bottom: -1, right: -1, borderBottomWidth: 2, borderRightWidth: 2 },
  };
  return <span style={{ ...base, ...map[pos] }} />;
}

function SectionHeader({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 8px' }}>
      <span style={{ width: 3, height: 12, background: 'var(--d-orange)', borderRadius: 2, flexShrink: 0 }} />
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 10, letterSpacing: '.12em', color: 'var(--d-t1)' }}>{children}</span>
      {count != null && count > 0 && (
        <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-fire)' }}>{count} active</span>
      )}
    </div>
  );
}

const PriorityQueue = React.memo(function PriorityQueue() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const alerts = useDashboardStore((s) => s.alerts);
  const feedItems = useDashboardStore((s) => s.feedItems);
  const panic = useDashboardStore((s) => s.panicState);
  const voiceNote = useDashboardStore((s) => s.voiceNoteAlert);
  const overview = useDashboardStore((s) => s.overview);
  const convoys = useDashboardStore((s) => s.convoys);
  const { setAlerts, removeAlert } = useDashboardStore.getState();

  useQuery({
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
      chip: chipFor(a.type, a.severity),
      title: a.title,
      // Some alert types mirror the title into summary — showing both would
      // print the same sentence twice on the card.
      ...(a.summary && a.summary.trim() !== a.title.trim() ? { body: a.summary } : {}),
      at: a.occurred_at,
      rank: SEV_RANK[a.severity] ?? 3,
      ...(!a.acknowledged ? { ackId: a.id } : {}),
    })),
    ...feedItems
      .filter(f => !alerts.some(a => a.id === f.id))
      .map((f): QueueItem => ({
        id: `f-${f.id}`,
        chip: chipFor(f.type, f.severity),
        title: f.message,
        at: f.timestamp,
        rank: SEV_RANK[f.severity ?? f.type] ?? 3,
      })),
  ].sort((x, y) => x.rank - y.rank || new Date(y.at).getTime() - new Date(x.at).getTime());

  const nextDelivery = overview?.next_delivery ?? null;
  const focusConvoy = nextDelivery ? convoys.find(c => c.id === nextDelivery.convoy_id) ?? null : convoys[0] ?? null;

  return (
    <aside className='d-console-queue' style={{
      background: 'var(--d-carbon)',
      borderLeft: '1px solid var(--d-rim2)',
      display: 'flex',
      flexDirection: 'column',
      overflowY: 'auto',
      scrollbarWidth: 'none',
      minHeight: 0,
    }}>
      <SectionHeader count={items.length + (panic ? 1 : 0)}>PRIORITY QUEUE</SectionHeader>

      {/* SOS — locked to the top while a panic is active */}
      {panic && (
        <div style={{ padding: '0 14px 10px' }}>
          <div style={{
            position: 'relative', padding: '10px 12px',
            background: 'rgba(255,59,92,.08)', border: '1px solid var(--d-fire)', borderRadius: 8,
            animation: 'd-crit 1.8s ease-in-out infinite',
          }}>
            <LockCorner pos='tl' /><LockCorner pos='tr' /><LockCorner pos='bl' /><LockCorner pos='br' />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, letterSpacing: '.12em', color: '#fff', background: 'var(--d-fire)', borderRadius: 4, padding: '1px 6px' }}>SOS</span>
              <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, color: 'var(--d-fire)', letterSpacing: '.06em' }}>PANIC ACTIVE</span>
              <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)' }}>{relTime(panic.triggered_at)}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--d-t1)', marginBottom: 8 }}>
              {panic.mode ? `${panic.mode.replace(/_/g, ' ')} · ` : ''}{panic.vehicle_id ?? 'unassigned device'}
            </div>
            <button
              onClick={() => nav({ to: '/panic-center' })}
              style={{ width: '100%', padding: '6px 0', background: 'var(--d-fire)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 10, letterSpacing: '.1em' }}
            >OPEN PANIC CENTER</button>
          </div>
        </div>
      )}

      {/* Voice note — transient toast state surfaced in the queue too */}
      {voiceNote && (
        <div style={{ padding: '0 14px 10px' }}>
          <button
            onClick={() => nav({ to: '/guardian' })}
            style={{ width: '100%', textAlign: 'left', padding: '8px 12px', background: 'rgba(55,230,255,.06)', border: '1px solid rgba(55,230,255,.4)', borderRadius: 8, cursor: 'pointer' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, letterSpacing: '.1em', color: '#37e6ff', border: '1px solid rgba(55,230,255,.5)', borderRadius: 4, padding: '1px 5px' }}>VOICE NOTE</span>
              <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)' }}>{relTime(voiceNote.createdAt)}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--d-t1)' }}>
              {voiceNote.deviceName} → dispatch{voiceNote.durationMs ? ` · ${Math.round(voiceNote.durationMs / 1000)}s clip` : ''}
            </div>
          </button>
        </div>
      )}

      {/* Ranked feed */}
      <div style={{ flex: 1, padding: '0 14px' }}>
        {items.length === 0 && !panic && !voiceNote && (
          <div style={{ fontSize: 11, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', padding: '6px 0' }}>All quiet — awaiting events…</div>
        )}
        {items.map(it => (
          <div key={it.id} style={{
            padding: '8px 10px', marginBottom: 8,
            background: 'var(--d-well)', borderRadius: 8,
            border: '1px solid var(--d-rim2)',
            borderLeft: `3px solid rgb(${it.chip.hue})`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, letterSpacing: '.1em', color: `rgb(${it.chip.hue})`, border: `1px solid rgba(${it.chip.hue},.5)`, borderRadius: 4, padding: '1px 5px', flexShrink: 0 }}>{it.chip.label}</span>
              <span style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', flexShrink: 0 }}>{relTime(it.at)}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--d-t1)', lineHeight: 1.35 }}>{it.title}</div>
            {it.body && <div style={{ fontSize: 10, color: 'var(--d-t2)', lineHeight: 1.35, marginTop: 2 }}>{it.body}</div>}
            {it.ackId && (
              <button
                onClick={() => ackMut.mutate(it.ackId!)}
                style={{ marginTop: 6, background: 'none', border: '1px solid var(--d-rim2)', borderRadius: 4, color: 'var(--d-t3)', fontSize: 9, cursor: 'pointer', padding: '2px 8px', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.06em' }}
              >ACK</button>
            )}
          </div>
        ))}
      </div>

      {/* Convoy focus — next delivery */}
      {(nextDelivery || focusConvoy) && (
        <div style={{ borderTop: '1px solid var(--d-rim2)', padding: '10px 14px 14px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ width: 3, height: 12, background: '#37e6ff', borderRadius: 2, flexShrink: 0 }} />
            <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 10, letterSpacing: '.1em', color: 'var(--d-t1)' }}>
              CONVOY {(nextDelivery?.convoy_name ?? focusConvoy?.name ?? '').toUpperCase()}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div style={{ background: 'var(--d-well)', border: '1px solid var(--d-rim2)', borderRadius: 7, padding: '6px 10px' }}>
              <div style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.1em', color: 'var(--d-t3)', marginBottom: 2 }}>NEXT ETA</div>
              <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 15, color: 'var(--d-t1)' }}>
                {nextDelivery ? new Date(nextDelivery.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'}
              </div>
            </div>
            <div style={{ background: 'var(--d-well)', border: '1px solid var(--d-rim2)', borderRadius: 7, padding: '6px 10px' }}>
              <div style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.1em', color: 'var(--d-t3)', marginBottom: 2 }}>STATUS</div>
              <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 13, color: '#37e6ff', textTransform: 'uppercase' }}>
                {focusConvoy?.status ?? 'scheduled'}
              </div>
            </div>
          </div>
          {focusConvoy?.progress != null && (
            <div style={{ marginTop: 8 }}>
              <div style={{ height: 4, background: 'var(--d-lift2)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, focusConvoy.progress))}%`, background: '#37e6ff', borderRadius: 2, transition: 'width .6s ease' }} />
              </div>
              <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', marginTop: 3, textAlign: 'right' }}>{Math.round(focusConvoy.progress)}% of route</div>
            </div>
          )}
          <button
            onClick={() => nav({ to: '/convoys' })}
            style={{ marginTop: 8, width: '100%', padding: '5px 0', background: 'var(--d-lift2)', color: 'var(--d-t2)', border: '1px solid var(--d-rim2)', borderRadius: 6, cursor: 'pointer', fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, letterSpacing: '.08em' }}
          >ALL CONVOYS →</button>
        </div>
      )}
    </aside>
  );
});

export default PriorityQueue;
