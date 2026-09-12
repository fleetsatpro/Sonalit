import React, { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import DataError from './DataError.js';

interface Prediction {
  id: string; confidence: number;
  type: 'delay' | 'maintenance' | 'security' | 'performance';
  title: string; detail: string; recommendation: string;
}

const TYPE_COLOR = { delay: 'var(--d-warn)', maintenance: 'var(--d-sig2)', security: 'var(--d-fire)', performance: 'var(--d-ok)' };
const TYPE_ICON = { delay: '⏱', maintenance: '🔧', security: '🛡', performance: '📈' };

function ConfidenceBar({ confidence, color }: { confidence: number; color: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.style.transition = 'width 1s ease';
      el.style.width = `${confidence}%`;
    });
  }, [confidence]);
  return (
    <div style={{ height: 3, background: 'var(--d-lift2)', borderRadius: 2, overflow: 'hidden' }}>
      <div ref={ref} style={{ height: '100%', width: 0, background: color, borderRadius: 2 }} />
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
          <div style={{ width: 3, height: 14, background: 'var(--d-orange)', borderRadius: 2 }} />
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>INTELLIGENCE ASSESSMENT</span>
        </div>
        <span style={{
          fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600,
          letterSpacing: '.08em', color: 'var(--d-orange)',
          background: 'var(--d-og)', borderRadius: 4, padding: '3px 8px',
        }}>⬡ Sonalit AI</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(data ?? []).map(p => {
          const color = TYPE_COLOR[p.type];
          const icon = TYPE_ICON[p.type];
          return (
            <div key={p.id} style={{ background: 'var(--d-surf)', borderRadius: 8, padding: '12px 14px', border: `1px solid ${color}22` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 14 }}>{icon}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: 'var(--d-t1)' }}>{p.title}</span>
                <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 13, fontWeight: 700, color, flexShrink: 0 }}>{p.confidence}%</span>
              </div>
              <ConfidenceBar confidence={p.confidence} color={color} />
              <div style={{ fontSize: 11, color: 'var(--d-t2)', fontFamily: 'IBM Plex Mono, monospace', marginTop: 6, lineHeight: 1.5 }}>{p.detail}</div>
              <div style={{ fontSize: 11, color, marginTop: 4 }}>→ {p.recommendation}</div>
            </div>
          );
        })}
        {(!data || data.length === 0) && <div style={{ textAlign: 'center', color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, padding: 16 }}>No predictions available</div>}
      </div>
    </div>
  );
});

export default AIIntelligence;
