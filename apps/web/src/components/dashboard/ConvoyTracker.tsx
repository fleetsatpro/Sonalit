import React, { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useDashboardStore } from '../../stores/dashboardStore.js';
import DataError from './DataError.js';

interface Checkpoint { name: string; status: string; reached_at: string | null }
interface ConvoyRow {
  id: string; name: string; status: string;
  origin: string | null; destination: string | null; eta: string | null;
  truck_count: number; seal_intact: boolean | null;
  checkpoints: Checkpoint[];
}

const STATUS_COLOR: Record<string, string> = {
  active: 'var(--d-sig)', in_transit: 'var(--d-sig)', delayed: 'var(--d-warn)',
  alert: 'var(--d-fire)', completed: 'var(--d-t3)', idle: 'var(--d-t3)',
};

function CheckpointDot({ cp }: { cp: Checkpoint }) {
  const done = cp.status === 'done' || cp.reached_at != null;
  const isAlert = cp.status === 'alert';
  const isCurrent = cp.status === 'current';
  const color = isAlert ? 'var(--d-fire)' : done ? 'var(--d-ok)' : isCurrent ? 'var(--d-sig)' : 'var(--d-lift2)';

  return (
    <div title={cp.name} style={{
      width: 10, height: 10, borderRadius: '50%',
      background: color,
      boxShadow: done ? `0 0 6px ${color}` : isCurrent ? `0 0 8px ${color}` : 'none',
      animation: isCurrent ? 'd-sonar 2s ease-out infinite' : isAlert ? 'd-pfz 1.2s ease-in-out infinite' : 'none',
      flexShrink: 0,
      border: `1.5px solid ${done || isCurrent ? color : 'var(--d-rim2)'}`,
    }} />
  );
}

function ConvoyRowComp({ convoy }: { convoy: ConvoyRow }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded(e => !e), []);
  const statusColor = STATUS_COLOR[convoy.status] ?? 'var(--d-t3)';

  const etaStr = convoy.eta
    ? new Date(convoy.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';

  return (
    <div
      style={{
        background: 'var(--d-well)', border: '1px solid var(--d-rim2)',
        borderRadius: 10, overflow: 'hidden', marginBottom: 8,
        borderLeft: `3px solid ${statusColor}`,
      }}
    >
      <button
        onClick={toggle}
        style={{
          width: '100%', background: 'none', border: 'none',
          cursor: 'pointer', padding: '12px 14px',
          display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
        }}
      >
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 12, color: 'var(--d-t1)', letterSpacing: '.06em', flex: 1 }}>
          {convoy.name}
        </span>
        <span style={{
          fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700,
          letterSpacing: '.1em', color: statusColor,
          background: `${statusColor}1a`, borderRadius: 4, padding: '2px 6px',
          textTransform: 'uppercase',
        }}>{convoy.status.replace('_', ' ')}</span>
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 12, color: 'var(--d-t2)' }}>ETA {etaStr}</span>
        <span style={{ color: 'var(--d-t3)', fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Route + checkpoints */}
      <div style={{ padding: '0 14px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t2)' }}>
          {convoy.origin ?? '—'} → {convoy.destination ?? '—'}
        </div>
        {convoy.checkpoints.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {convoy.checkpoints.map((cp, i) => (
              <React.Fragment key={i}>
                <CheckpointDot cp={cp} />
                {i < convoy.checkpoints.length - 1 && (
                  <div style={{ flex: 1, height: 1, background: 'var(--d-rim2)', minWidth: 6 }} />
                )}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div style={{ borderTop: '1px solid var(--d-rim)', padding: '10px 14px', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Detail label='Trucks' value={convoy.truck_count.toString()} />
          <Detail label='Seal' value={convoy.seal_intact === true ? '✓ Intact' : convoy.seal_intact === false ? '✗ Compromised' : 'Unverified'}
            color={convoy.seal_intact === true ? 'var(--d-ok)' : convoy.seal_intact === false ? 'var(--d-fire)' : 'var(--d-t3)'} />
          {convoy.checkpoints.map((cp, i) => (
            <Detail key={i} label={`CP${i+1}: ${cp.name}`} value={cp.reached_at ? new Date(cp.reached_at).toLocaleTimeString([], { hour12: false }) : 'Pending'}
              color={cp.reached_at ? 'var(--d-ok)' : 'var(--d-t3)'} />
          ))}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', letterSpacing: '.08em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: color ?? 'var(--d-t1)' }}>{value}</div>
    </div>
  );
}

const ConvoyTracker = React.memo(function ConvoyTracker() {
  const storeConvoys = useDashboardStore((s) => s.convoys);
  const { setConvoys } = useDashboardStore.getState();

  const { isError, refetch } = useQuery({
    queryKey: ['dashboard-convoys'],
    queryFn: async () => {
      const r = await api.get<{ data: ConvoyRow[] }>('/dashboard/convoys');
      setConvoys(r.data.data ?? []);
      return r.data.data ?? [];
    },
    staleTime: 30000,
  });

  if (isError) return <DataError section='Convoy Tracker' onRetry={refetch} />;

  return (
    <div className='d-section-reveal'>
      <SectionHeader />
      {storeConvoys.length === 0
        ? <div style={{ padding: 24, textAlign: 'center', color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }}>No active convoys</div>
        : storeConvoys.map(c => <ConvoyRowComp key={c.id} convoy={c as ConvoyRow} />)
      }
    </div>
  );
});

function SectionHeader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
      <div style={{ width: 3, height: 14, background: 'var(--d-orange)', borderRadius: 2 }} />
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>CONVOY TRACKER</span>
    </div>
  );
}

export default ConvoyTracker;
