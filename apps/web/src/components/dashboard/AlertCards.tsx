import React, { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useDashboardStore } from '../../stores/dashboardStore.js';
import DataError from './DataError.js';
import type { DashboardAlert } from '../../stores/dashboardStore.js';

const SEV_COLOR: Record<string, string> = {
  critical: 'var(--d-fire)',
  high:     'var(--d-fire)',
  medium:   'var(--d-warn)',
  low:      'var(--d-ok)',
};

function useElapsed(iso: string): string {
  const [val, setVal] = useState('');
  useEffect(() => {
    const tick = () => {
      const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
      if (sec < 60) setVal(`${sec}s`);
      else if (sec < 3600) setVal(`${Math.floor(sec / 60)}m`);
      else setVal(`${Math.floor(sec / 3600)}h`);
    };
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, [iso]);
  return val;
}

function AlertCard({ alert, onAck }: { alert: DashboardAlert; onAck: (id: string) => void }) {
  const elapsed = useElapsed(alert.occurred_at);
  const isCrit = alert.severity === 'critical' || alert.severity === 'high';
  const color = SEV_COLOR[alert.severity] ?? 'var(--d-t3)';

  return (
    <div
      style={{
        flex: '0 0 240px',
        scrollSnapAlign: 'start',
        background: 'var(--d-well)',
        border: `1px solid ${color}44`,
        borderRadius: 10,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        animation: isCrit ? 'd-crit 1.8s ease-in-out infinite' : 'none',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{
          fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700,
          letterSpacing: '.1em', color,
          background: `${color}1a`, borderRadius: 4, padding: '2px 6px',
          textTransform: 'uppercase',
        }}>{alert.severity}</span>
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 14, fontWeight: 700, color }}>{elapsed}</span>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-t1)', lineHeight: 1.3 }}>{alert.title}</div>
      {alert.summary && (
        <div style={{ fontSize: 11, color: 'var(--d-t2)', fontFamily: 'IBM Plex Mono, monospace', lineHeight: 1.4 }}>{alert.summary}</div>
      )}
      {!alert.acknowledged && (
        <button
          onClick={() => onAck(alert.id)}
          style={{
            marginTop: 4, padding: '6px 10px',
            background: 'transparent', border: `1px solid ${color}66`,
            borderRadius: 6, color, fontSize: 10,
            cursor: 'pointer', fontFamily: 'IBM Plex Mono, monospace',
            letterSpacing: '.06em', textAlign: 'center',
          }}
        >ACK ✓</button>
      )}
    </div>
  );
}

const AlertCards = React.memo(function AlertCards() {
  const storeAlerts = useDashboardStore((s) => s.alerts);
  const { setAlerts, removeAlert } = useDashboardStore.getState();
  const qc = useQueryClient();

  const { isError, refetch } = useQuery({
    queryKey: ['dashboard-alerts'],
    queryFn: async () => {
      const r = await api.get<{ data: DashboardAlert[] }>('/dashboard/alerts?limit=10');
      setAlerts(r.data.data ?? []);
      return r.data.data ?? [];
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  const ackMut = useMutation({
    mutationFn: (id: string) => api.patch(`/alerts/${id}/acknowledge`),
    onSuccess: (_, id) => {
      removeAlert(id);
      qc.invalidateQueries({ queryKey: ['alerts-unread-count'] });
    },
  });

  const handleAck = useCallback((id: string) => ackMut.mutate(id), [ackMut]);

  if (isError) return <DataError section='Alert Cards' onRetry={refetch} />;

  if (storeAlerts.length === 0) return null;

  return (
    <div className='d-section-reveal'>
      <SectionHeader label='ACTIVE ALERTS' count={storeAlerts.length} />
      <div className='d-hscroll' style={{ paddingBottom: 4 }}>
        {storeAlerts.map(a => <AlertCard key={a.id} alert={a} onAck={handleAck} />)}
      </div>
    </div>
  );
});

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <div style={{ width: 3, height: 14, background: 'var(--d-fire)', borderRadius: 2 }} />
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>{label}</span>
      {count != null && (
        <span style={{ fontSize: 10, background: 'var(--d-fg)', color: 'var(--d-fire)', borderRadius: 10, padding: '1px 8px', fontFamily: 'Orbitron, sans-serif', fontWeight: 700 }}>{count}</span>
      )}
    </div>
  );
}

export default AlertCards;
