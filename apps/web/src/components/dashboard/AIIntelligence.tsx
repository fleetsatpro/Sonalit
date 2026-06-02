import React, { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import DataError from './DataError.js';

interface Prediction {
  id: string; confidence: number;
  type: 'delay' | 'maintenance' | 'security' | 'performance' | 'risk';
  title: string; detail?: string; recommendation?: string;
}

const TYPE_COLOR: Record<string, string> = {
  risk: 'var(--d-fire)',
  delay: 'var(--d-warn)',
  maintenance: 'var(--d-purple)',
  performance: 'var(--d-ok)',
  security: 'var(--d-fire)',
};
const TYPE_ICON: Record<string, string> = { delay: '⏱', maintenance: '🔧', security: '🛡', performance: '📈', risk: '⚠' };

function ConfidenceBar({ confidence, color }: { confidence: number; color: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const animatedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    const bar = barRef.current;
    if (!container || !bar) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && !animatedRef.current) {
          animatedRef.current = true;
          requestAnimationFrame(() => {
            bar.style.transition = 'width 1s ease';
            bar.style.width = `${confidence}%`;
          });
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [confidence]);

  return (
    <div ref={containerRef} style={{ height: 3, background: 'var(--d-lift2)', borderRadius: 2, overflow: 'hidden' }}>
      <div ref={barRef} style={{ height: '100%', width: 0, background: color, borderRadius: 2 }} />
    </div>
  );
}

const AIIntelligence = React.memo(function AIIntelligence() {
  const { data, isError, refetch } = useQuery<Prediction[]>({
    queryKey: ['dashboard-predictions'],
    queryFn: async () => { const r = await api.get<{ data: Prediction[] }>('/dashboard/predictions'); return r.data.data ?? []; },
    staleTime: 120000,
  });

  if (isError) return <DataError section='AI Intelligence' onRetry={refetch} />;

  return (
    <div className='d-section-reveal d-card' style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 3, height: 14, background: 'var(--d-sig)', borderRadius: 2 }} />
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>INTELLIGENCE ASSESSMENT</span>
        </div>
        <span style={{
          fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600,
          letterSpacing: '.08em', color: 'var(--d-sig)',
          background: 'var(--d-sg)', borderRadius: 4, padding: '3px 8px',
        }}>⬡ Sonalit AI</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(data ?? []).map(p => {
          const color = TYPE_COLOR[p.type] ?? 'var(--d-t3)';
          const icon = TYPE_ICON[p.type] ?? '•';
          return (
            <div key={p.id} style={{ background: 'var(--d-surf)', borderRadius: 8, padding: '12px 14px', border: `1px solid ${color}22` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{
                  fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700,
                  letterSpacing: '.08em', textTransform: 'uppercase',
                  background: color, color: '#000', borderRadius: 4, padding: '2px 6px',
                  flexShrink: 0,
                }}>{icon} {p.type}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--d-t1)' }}>{p.title}</span>
                <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 13, fontWeight: 700, color, flexShrink: 0 }}>{p.confidence}%</span>
              </div>
              <ConfidenceBar confidence={p.confidence} color={color} />
              <div style={{ fontSize: 13, color: 'var(--d-t2)', fontFamily: 'DM Sans, sans-serif', marginTop: 6, lineHeight: 1.5 }}>{p.detail}</div>
              <div style={{ borderLeft: '2px solid var(--d-purple)', paddingLeft: 10, marginTop: 8, fontSize: 12, color: 'var(--d-t1)', fontFamily: 'DM Sans, sans-serif', lineHeight: 1.5 }}>
                {p.recommendation}
              </div>
            </div>
          );
        })}
        {(!data || data.length === 0) && (
          <div style={{ textAlign: 'center', color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, padding: 16 }}>
            AI analysis pending
          </div>
        )}
      </div>
    </div>
  );
});

export default AIIntelligence;
