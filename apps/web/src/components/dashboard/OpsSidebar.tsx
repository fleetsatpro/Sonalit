import React, { useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useDashboardStore } from '../../stores/dashboardStore.js';
import type { DashboardAlert, FeedItem } from '../../stores/dashboardStore.js';

const SEV_COLOR: Record<string, string> = { critical: 'var(--d-fire)', high: 'var(--d-fire)', alert: 'var(--d-fire)', incident: 'var(--d-warn)', medium: 'var(--d-warn)', convoy: 'var(--d-sig)', panic: 'var(--d-fire)', low: 'var(--d-ok)' };

function relTime(iso: string): string {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h`;
}

function FeedItemRow({ item }: { item: FeedItem }) {
  const color = SEV_COLOR[item.severity ?? item.type] ?? 'var(--d-t3)';
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 8,
      padding: '8px 0', borderBottom: '1px solid var(--d-rim)',
      animation: 'd-slide-in .25s ease',
    }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0, marginTop: 4 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, color: 'var(--d-t1)', lineHeight: 1.4 }}>{item.message}</div>
        <div style={{ fontSize: 9, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', marginTop: 2 }}>{relTime(item.timestamp)}</div>
      </div>
    </div>
  );
}

function DonutGauge({ label, value, color }: { label: string; value: number; color: string }) {
  const circleRef = useRef<SVGCircleElement>(null);
  const ARC = 188;
  const offset = ARC * (1 - value / 100);
  useEffect(() => {
    const el = circleRef.current;
    if (!el) return;
    el.style.strokeDashoffset = String(ARC);
    requestAnimationFrame(() => { el.style.transition = 'stroke-dashoffset 1s ease'; el.style.strokeDashoffset = String(offset); });
  }, [offset]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <svg viewBox='0 0 60 60' width={52} height={52}>
        <circle cx={30} cy={30} r={24} fill='none' stroke='var(--d-lift2)' strokeWidth={6} />
        <circle ref={circleRef} cx={30} cy={30} r={24} fill='none' stroke={color} strokeWidth={6}
          strokeDasharray={ARC} strokeDashoffset={ARC} strokeLinecap='round'
          style={{ transform: 'rotate(-90deg)', transformOrigin: '30px 30px', willChange: 'stroke-dashoffset' }} />
        <text x={30} y={34} textAnchor='middle' fill={color} fontFamily='Orbitron, sans-serif' fontSize={11} fontWeight={700}>{value}%</text>
      </svg>
      <div style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', letterSpacing: '.06em', textAlign: 'center' }}>{label}</div>
    </div>
  );
}

const OpsSidebar = React.memo(function OpsSidebar() {
  const feedItems = useDashboardStore((s) => s.feedItems);
  const storeAlerts = useDashboardStore((s) => s.alerts);
  const { setAlerts, removeAlert } = useDashboardStore.getState();
  const qc = useQueryClient();

  const { data: vehicles } = useQuery({
    queryKey: ['dashboard-vehicles-ops'],
    queryFn: async () => { try { const r = await api.get<{ data: Array<{ fuel_pct: number | null; engine_temp_c: number | null }> }>('/dashboard/vehicles'); return r.data.data ?? []; } catch { return []; } },
    staleTime: 30000,
  });

  useQuery({
    queryKey: ['dashboard-alerts-ops'],
    queryFn: async () => { const r = await api.get<{ data: DashboardAlert[] }>('/dashboard/alerts?limit=10'); setAlerts(r.data.data ?? []); return r.data.data; },
    staleTime: 30000,
  });

  const ackMut = useMutation({
    mutationFn: (id: string) => api.patch(`/alerts/${id}/acknowledge`),
    onSuccess: (_, id) => { removeAlert(id); qc.invalidateQueries({ queryKey: ['alerts-unread-count'] }); },
  });

  // Fleet health averages
  const avgFuel = vehicles?.length
    ? Math.round(vehicles.filter(v => v.fuel_pct != null).reduce((s, v) => s + (v.fuel_pct ?? 0), 0) / Math.max(1, vehicles.filter(v => v.fuel_pct != null).length))
    : 0;
  const avgTemp = vehicles?.length
    ? Math.round(vehicles.filter(v => v.engine_temp_c != null).reduce((s, v) => s + (v.engine_temp_c ?? 0), 0) / Math.max(1, vehicles.filter(v => v.engine_temp_c != null).length))
    : 0;
  const tempPct = Math.round((1 - Math.min(1, avgTemp / 120)) * 100);

  const GAUGES = [
    { label: 'ENGINE', value: tempPct, color: tempPct < 20 ? 'var(--d-fire)' : 'var(--d-ok)' },
    { label: 'FUEL', value: avgFuel, color: avgFuel <= 25 ? 'var(--d-fire)' : avgFuel <= 50 ? 'var(--d-warn)' : 'var(--d-sig)' },
    { label: 'TYRES', value: 82, color: 'var(--d-ok)' },
    { label: 'BRAKES', value: 30, color: 'var(--d-fire)' },
  ];

  return (
    <aside style={{
      width: 'var(--d-sb-w)',
      background: 'var(--d-carbon)',
      borderLeft: '1px solid var(--d-rim2)',
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      overflowY: 'auto',
      scrollbarWidth: 'none',
      position: 'sticky',
      top: 0,
    }}>
      {/* Live feed */}
      <div style={{ padding: '16px 16px 0', borderBottom: '1px solid var(--d-rim2)', paddingBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ width: 3, height: 12, background: 'var(--d-sig)', borderRadius: 2 }} />
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 10, letterSpacing: '.12em', color: 'var(--d-t1)' }}>LIVE OPS FEED</span>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--d-sig)', animation: 'd-sonar 2s ease-out infinite', flexShrink: 0 }} />
        </div>
        <div style={{ maxHeight: 200, overflowY: 'auto', scrollbarWidth: 'none' }}>
          {feedItems.length === 0
            ? <div style={{ fontSize: 11, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', padding: '8px 0' }}>Awaiting events…</div>
            : feedItems.map(f => <FeedItemRow key={f.id} item={f} />)
          }
        </div>
      </div>

      {/* Alerts */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--d-rim2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ width: 3, height: 12, background: 'var(--d-fire)', borderRadius: 2 }} />
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 10, letterSpacing: '.12em', color: 'var(--d-t1)' }}>ALERTS</span>
          {storeAlerts.length > 0 && <span style={{ fontSize: 9, background: 'var(--d-fg)', color: 'var(--d-fire)', borderRadius: 10, padding: '1px 6px', fontFamily: 'Orbitron, sans-serif', fontWeight: 700 }}>{storeAlerts.length}</span>}
        </div>
        {storeAlerts.slice(0, 5).map(a => (
          <div key={a.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--d-rim)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: SEV_COLOR[a.severity] ?? 'var(--d-t3)', flexShrink: 0, marginTop: 3 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: 'var(--d-t1)', lineHeight: 1.3, marginBottom: 3 }}>{a.title}</div>
            </div>
            {!a.acknowledged && (
              <button onClick={() => ackMut.mutate(a.id)} style={{ background: 'none', border: '1px solid var(--d-rim2)', borderRadius: 4, color: 'var(--d-t3)', fontSize: 9, cursor: 'pointer', padding: '2px 6px', flexShrink: 0 }}>ACK</button>
            )}
          </div>
        ))}
        {storeAlerts.length === 0 && <div style={{ fontSize: 11, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace' }}>No active alerts</div>}
      </div>

      {/* Fleet health rings */}
      <div style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{ width: 3, height: 12, background: 'var(--d-sig2)', borderRadius: 2 }} />
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 10, letterSpacing: '.12em', color: 'var(--d-t1)' }}>FLEET HEALTH</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          {GAUGES.map(g => <DonutGauge key={g.label} label={g.label} value={g.value} color={g.color} />)}
        </div>
      </div>
    </aside>
  );
});

export default OpsSidebar;
