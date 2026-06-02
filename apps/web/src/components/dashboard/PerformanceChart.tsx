import React, { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import DataError from './DataError.js';

interface PerfDay { date: string; label: string; on_time_pct: number | null }

function barColor(pct: number | null): string {
  if (pct == null) return 'var(--d-t4)';
  if (pct >= 95) return 'var(--d-ok)';
  if (pct >= 85) return 'var(--d-sig)';
  if (pct >= 75) return 'var(--d-warn)';
  return 'var(--d-fire)';
}

const LazyBarChart = React.lazy(async () => {
  const { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Cell } = await import('recharts');
  return {
    default: function ChartInner({ data }: { data: PerfDay[] }) {
      return (
        <ResponsiveContainer width='100%' height={160}>
          <BarChart data={data} margin={{ top: 4, right: 0, left: -28, bottom: 0 }} style={{ background: 'var(--d-surf)', borderRadius: 8 }}>
            <CartesianGrid strokeDasharray='3 3' stroke='var(--d-rim)' vertical={false} />
            <XAxis
              dataKey='label'
              tick={{ fill: 'var(--d-t3)', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }}
              tickFormatter={(v: string) => v.slice(0, 3)}
              axisLine={{ stroke: 'var(--d-t3)' }} tickLine={false}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: 'var(--d-t3)', fontSize: 9, fontFamily: 'IBM Plex Mono, monospace' }}
              axisLine={{ stroke: 'var(--d-t3)' }} tickLine={false}
              tickFormatter={(v: number) => `${v}%`}
            />
            <Tooltip
              contentStyle={{ background: 'var(--d-well)', border: '1px solid var(--d-rim2)', borderRadius: 8, fontSize: 11, fontFamily: 'IBM Plex Mono, monospace' }}
              formatter={(v: number) => [`${v?.toFixed(0) ?? '—'}%`, 'On-Time']}
              labelStyle={{ color: 'var(--d-t2)' }}
            />
            <Bar dataKey='on_time_pct' radius={[3, 3, 0, 0]} animationBegin={0} animationDuration={1400}>
              {data.map((entry, i) => (
                <Cell key={i} fill={barColor(entry.on_time_pct)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      );
    },
  };
});

const PerformanceChart = React.memo(function PerformanceChart() {
  const { data, isError, refetch } = useQuery<PerfDay[]>({
    queryKey: ['dashboard-performance'],
    queryFn: async () => { const r = await api.get<{ data: PerfDay[] }>('/dashboard/performance?days=14'); return r.data.data ?? []; },
    staleTime: 300000,
  });

  if (isError) return <DataError section='Performance Chart' onRetry={refetch} />;

  return (
    <div className='d-section-reveal d-card' style={{ padding: 16 }}>
      <SH />
      <Suspense fallback={<div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d-t3)', fontSize: 12 }}>Loading chart…</div>}>
        {data && data.length > 0 ? (
          <LazyBarChart data={data} />
        ) : (
          <div style={{ height: 160, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }}>No trip data for this period</div>
        )}
      </Suspense>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 8 }}>
        {[{ color: 'var(--d-ok)', label: '≥95%' }, { color: 'var(--d-sig)', label: '≥85%' }, { color: 'var(--d-warn)', label: '≥75%' }, { color: 'var(--d-fire)', label: '<75%' }].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: l.color }} />
            <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)' }}>{l.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

function SH() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <div style={{ width: 3, height: 14, background: 'var(--d-purple)', borderRadius: 2 }} />
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>ON-TIME PERFORMANCE</span>
      <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)' }}>14 days</span>
    </div>
  );
}

export default PerformanceChart;
