import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import DataError from './DataError.js';

interface Border {
  name: string; countries: string; status: 'clear' | 'busy' | 'held' | 'open' | 'moderate' | 'critical';
  queue_minutes: number | null; active_convoys: string[]; flag_emojis: string;
}

function queueColor(status: Border['status']): string {
  if (status === 'held' || status === 'critical') return 'var(--d-fire)';
  if (status === 'busy' || status === 'moderate') return 'var(--d-warn)';
  return 'var(--d-ok)';
}

function statusPillColor(status: Border['status']): string {
  if (status === 'held' || status === 'critical') return 'var(--d-fire)';
  if (status === 'busy' || status === 'moderate') return 'var(--d-warn)';
  return 'var(--d-ok)';
}

const BorderCrossings = React.memo(function BorderCrossings() {
  const { data, isError, refetch } = useQuery<Border[]>({
    queryKey: ['dashboard-borders'],
    queryFn: async () => { const r = await api.get<{ data: Border[] }>('/dashboard/borders'); return r.data.data ?? []; },
    staleTime: 120000,
  });

  if (isError) return <DataError section='Border Crossings' onRetry={refetch} />;

  const borders = data ?? [];

  return (
    <div className='d-section-reveal d-card' style={{ padding: 16 }}>
      <SH />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {borders.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, padding: 16 }}>
            No border data
          </div>
        )}
        {borders.map((b, i) => {
          const isHeld = b.status === 'held' || b.status === 'critical';
          const qColor = queueColor(b.status);
          const pillColor = statusPillColor(b.status);

          return (
            <div
              key={i}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 0', borderBottom: '1px solid var(--d-rim)',
                animation: isHeld ? 'd-crit 1.8s ease-in-out infinite' : 'none',
              }}
            >
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
                {/* Status pill — IBM Plex Mono, uppercase, letter-spaced */}
                <div style={{
                  fontFamily: 'IBM Plex Mono, monospace',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  color: pillColor,
                  background: `${pillColor}1a`,
                  borderRadius: 4,
                  padding: '2px 6px',
                  display: 'inline-block',
                  marginBottom: 4,
                }}>
                  {b.status}
                </div>
                {b.queue_minutes != null && (
                  <div style={{
                    fontFamily: 'Orbitron, sans-serif',
                    fontSize: 10,
                    fontWeight: 700,
                    color: qColor,
                  }}>
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
