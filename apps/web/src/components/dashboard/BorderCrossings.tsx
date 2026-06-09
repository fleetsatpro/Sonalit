import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import DataError from './DataError.js';
import CompactEmpty from './CompactEmpty.js';

interface Border {
  name: string; countries: string; status: 'clear' | 'busy' | 'held';
  queue_minutes: number | null; active_convoys: string[]; flag_emojis: string;
}

const STATUS_COLOR = { clear: 'var(--d-ok)', busy: 'var(--d-warn)', held: 'var(--d-fire)' };

const BorderCrossings = React.memo(function BorderCrossings() {
  const { data, isError, refetch } = useQuery<Border[]>({
    queryKey: ['dashboard-borders'],
    queryFn: async () => { const r = await api.get<{ data: Border[] }>('/dashboard/borders'); return r.data.data ?? []; },
    staleTime: 120000,
  });

  if (isError) return <DataError section='Border Crossings' onRetry={refetch} />;

  const borders = data ?? [];
  if (borders.length === 0) {
    return <CompactEmpty accent='var(--d-sig2)' title='BORDER CROSSINGS' message='No border crossing data' />;
  }

  return (
    <div className='d-section-reveal d-card' style={{ padding: 16 }}>
      <SH />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {borders.map((b, i) => {
          const color = STATUS_COLOR[b.status];
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--d-rim)' }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>{b.flag_emojis || '🌍'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-t1)', marginBottom: 2 }}>{b.name}</div>
                <div style={{ fontSize: 11, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace' }}>{b.countries}</div>
                {b.active_convoys.length > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--d-sig)', fontFamily: 'IBM Plex Mono, monospace', marginTop: 2 }}>
                    {b.active_convoys.join(', ')}
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, letterSpacing: '.1em', color, textTransform: 'uppercase', marginBottom: 2 }}>
                  {b.status}
                </div>
                {b.queue_minutes != null && (
                  <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 16, fontWeight: 700, color: b.status === 'held' ? 'var(--d-fire)' : b.status === 'busy' ? 'var(--d-warn)' : 'var(--d-t2)' }}>
                    {b.queue_minutes}m
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

function SH() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <div style={{ width: 3, height: 14, background: 'var(--d-sig2)', borderRadius: 2 }} />
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>BORDER CROSSINGS</span>
    </div>
  );
}

export default BorderCrossings;
