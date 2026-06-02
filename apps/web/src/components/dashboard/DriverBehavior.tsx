import React, { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import DataError from './DataError.js';

interface Driver {
  id: string; name: string; initials: string;
  convoy_id: string | null; score: number;
  grade: 'excellent' | 'good' | 'monitor' | 'flagged';
  flags: string[]; on_duty: boolean;
}

function scoreColor(score: number): string {
  if (score >= 85) return 'var(--d-ok)';
  if (score >= 70) return 'var(--d-sig)';
  if (score >= 55) return 'var(--d-warn)';
  return 'var(--d-fire)';
}

function ScoreBar({ score }: { score: number }) {
  const barRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const color = scoreColor(score);

  useEffect(() => {
    const container = containerRef.current;
    const bar = barRef.current;
    if (!container || !bar) return;

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            requestAnimationFrame(() => {
              bar.style.transition = 'width 1s ease';
              bar.style.width = `${score}%`;
              bar.style.background = color;
            });
            io.unobserve(container);
          }
        });
      },
      { threshold: 0.1 }
    );

    io.observe(container);
    return () => io.disconnect();
  }, [score, color]);

  return (
    <div ref={containerRef} style={{ height: 4, background: 'var(--d-lift2)', borderRadius: 2, overflow: 'hidden', flex: 1 }}>
      <div ref={barRef} style={{ height: '100%', width: 0, borderRadius: 2 }} />
    </div>
  );
}

const DriverBehavior = React.memo(function DriverBehavior() {
  const { data, isError, refetch } = useQuery<Driver[]>({
    queryKey: ['dashboard-drivers'],
    queryFn: async () => { const r = await api.get<{ data: Driver[] }>('/dashboard/drivers'); return r.data.data ?? []; },
    staleTime: 60000,
  });

  if (isError) return <DataError section='Driver Behavior' onRetry={refetch} />;

  return (
    <div className='d-section-reveal d-card' style={{ padding: 16 }}>
      <SH />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(data ?? []).map(d => {
          const color = scoreColor(d.score);
          const flagged = d.score < 65;
          return (
            <div
              key={d.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 0', borderBottom: '1px solid var(--d-rim)',
                background: flagged ? 'rgba(255,68,34,.03)' : 'transparent',
              }}
            >
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: flagged ? 'var(--d-fg)' : 'var(--d-lift2)',
                  border: `1.5px solid ${color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 12,
                  color,
                }}>{d.initials}</div>
                {/* On-duty status dot */}
                <div style={{
                  position: 'absolute', bottom: 0, right: 0,
                  width: 8, height: 8, borderRadius: '50%',
                  background: d.on_duty ? 'var(--d-ok)' : 'var(--d-t4)',
                  border: '1.5px solid var(--d-well)',
                  animation: flagged ? 'd-pfz 1.2s ease-in-out infinite' : 'none',
                }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-t1)' }}>{d.name}</span>
                  <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, letterSpacing: '.08em', color, textTransform: 'uppercase' }}>{d.grade}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ScoreBar score={d.score} />
                  <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 13, fontWeight: 700, color, flexShrink: 0 }}>{d.score}</span>
                </div>
                {d.flags.length > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--d-fire)', fontFamily: 'IBM Plex Mono, monospace', marginTop: 3 }}>
                    {d.flags.join(' · ')}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {(!data || data.length === 0) && (
          <div style={{ textAlign: 'center', color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, padding: 16 }}>No driver data</div>
        )}
      </div>
    </div>
  );
});

function SH() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <div style={{ width: 3, height: 14, background: 'var(--d-ok)', borderRadius: 2 }} />
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>DRIVER BEHAVIOR</span>
    </div>
  );
}

export default DriverBehavior;
