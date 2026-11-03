import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import DataError from './DataError.js';

interface Incident {
  id: string; type: string; title: string; status: string;
  severity: string; occurred_at: string; location: string | null;
  assigned_to: string | null;
}

const SEV_COLOR: Record<string, string> = { critical: 'var(--d-fire)', high: 'var(--d-fire)', medium: 'var(--d-warn)', low: 'var(--d-ok)' };

function IncidentRow({ inc }: { inc: Incident }) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();
  const color = SEV_COLOR[inc.severity] ?? 'var(--d-t3)';

  const resolveMut = useMutation({
    mutationFn: () => api.patch(`/incidents/${inc.id}`, { status: 'resolved' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard-incidents'] }),
  });

  const escalateMut = useMutation({
    mutationFn: () => api.patch(`/incidents/${inc.id}`, { status: 'escalated' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard-incidents'] }),
  });

  const timeStr = new Date(inc.occurred_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

  return (
    <div style={{ background: 'var(--d-surf)', borderRadius: 8, marginBottom: 8, border: `1px solid ${color}22`, overflow: 'hidden' }}>
      <button
        onClick={() => setExpanded(e => !e)}
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: '10px 12px', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }}
      >
        <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, letterSpacing: '.1em', color, background: `${color}1a`, borderRadius: 4, padding: '2px 6px', textTransform: 'uppercase', flexShrink: 0 }}>{inc.severity}</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, color: 'var(--d-t1)' }}>{inc.title}</span>
        <span style={{ fontSize: 10, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', flexShrink: 0 }}>{timeStr}</span>
        <span style={{ color: 'var(--d-t3)', flexShrink: 0 }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div style={{ padding: '0 12px 12px', borderTop: '1px solid var(--d-rim)', paddingTop: 10 }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <Detail label='Type' value={inc.type} />
            <Detail label='Status' value={inc.status} />
            {inc.location && <Detail label='Location' value={inc.location} />}
            {inc.assigned_to && <Detail label='Assigned' value={inc.assigned_to} />}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <ActionBtn label='RESOLVE' onClick={() => resolveMut.mutate()} loading={resolveMut.isPending} color='var(--d-ok)' />
            <ActionBtn label='ESCALATE' onClick={() => escalateMut.mutate()} loading={escalateMut.isPending} color='var(--d-fire)' />
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', letterSpacing: '.08em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--d-t1)' }}>{value}</div>
    </div>
  );
}

function ActionBtn({ label, onClick, loading, color }: { label: string; onClick: () => void; loading: boolean; color: string }) {
  return (
    <button onClick={onClick} disabled={loading} style={{ padding: '5px 12px', background: 'transparent', border: `1px solid ${color}66`, borderRadius: 6, color, fontSize: 10, cursor: 'pointer', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.06em' }}>
      {loading ? '…' : label}
    </button>
  );
}

const IncidentLog = React.memo(function IncidentLog() {
  const { data, isError, refetch } = useQuery<Incident[]>({
    queryKey: ['dashboard-incidents'],
    queryFn: async () => {
      try {
        const r = await api.get<{ data: Incident[] }>('/incidents?status=active&limit=10');
        return r.data.data ?? [];
      } catch { return []; }
    },
    staleTime: 30000,
  });

  if (isError) return <DataError section='Incident Log' onRetry={refetch} />;

  return (
    <div className='d-section-reveal d-card' style={{ padding: 16 }}>
      <SH count={data?.length} />
      {(data ?? []).map(inc => <IncidentRow key={inc.id} inc={inc} />)}
      {(!data || data.length === 0) && (
        <div style={{ textAlign: 'center', color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, padding: 16 }}>No active incidents</div>
      )}
    </div>
  );
});

function SH({ count }: { count?: number | undefined }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <div style={{ width: 3, height: 14, background: 'var(--d-fire)', borderRadius: 2 }} />
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>INCIDENT LOG</span>
      {count != null && count > 0 && (
        <span style={{ fontSize: 10, background: 'var(--d-fg)', color: 'var(--d-fire)', borderRadius: 10, padding: '1px 8px', fontFamily: 'Orbitron, sans-serif', fontWeight: 700 }}>{count}</span>
      )}
    </div>
  );
}

export default IncidentLog;
