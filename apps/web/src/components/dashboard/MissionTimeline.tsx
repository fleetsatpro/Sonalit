import React, { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import DataError from './DataError.js';

interface TimelineEvent {
  type: 'arrival' | 'checkpoint' | 'border' | 'shift';
  label: string; time: string; convoy_id?: string; fraction: number;
}

const TYPE_COLOR = { arrival: 'var(--d-sig)', checkpoint: 'var(--d-ok)', border: 'var(--d-warn)', shift: 'var(--d-purple)' };
const TYPE_ICON = { arrival: '🏁', checkpoint: '📍', border: '🚧', shift: '👤' };

const MissionTimeline = React.memo(function MissionTimeline() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { data, isError, refetch } = useQuery<TimelineEvent[]>({
    queryKey: ['dashboard-timeline'],
    queryFn: async () => { const r = await api.get<{ data: TimelineEvent[] }>('/dashboard/timeline'); return r.data.data ?? []; },
    staleTime: 60000,
  });

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollLeft = 0;
  }, [data]);

  if (isError) return <DataError section='Mission Timeline' onRetry={refetch} />;

  const now = new Date();

  return (
    <div className='d-section-reveal d-card' style={{ padding: 16 }}>
      <SH />
      <div ref={scrollRef} className='d-hscroll' style={{ paddingBottom: 8, alignItems: 'flex-end', gap: 0 }}>
        {/* NOW marker */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, marginRight: 12 }}>
          <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: 'var(--d-sig)', marginBottom: 4, letterSpacing: '.06em' }}>NOW</div>
          <div style={{ width: 2, height: 40, background: 'var(--d-sig)', boxShadow: '0 0 8px var(--d-sglow)' }} />
        </div>

        {(data ?? []).map((evt, i) => {
          const color = TYPE_COLOR[evt.type] ?? 'var(--d-t3)';
          const icon = TYPE_ICON[evt.type] ?? '●';
          const evtTime = new Date(evt.time);
          const timeStr = evtTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
          const isPast = evtTime < now;

          return (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, marginRight: 8, opacity: isPast ? .4 : 1 }}>
              <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color, marginBottom: 4, letterSpacing: '.04em', whiteSpace: 'nowrap', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'center' }}>
                {evt.label}
              </div>
              <div style={{ fontSize: 18, marginBottom: 4 }}>{icon}</div>
              <div style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 10, fontWeight: 700, color, marginBottom: 4 }}>{timeStr}</div>
              <div style={{ width: 2, height: 16, background: color }} />
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, boxShadow: isPast ? 'none' : `0 0 8px ${color}` }} />
            </div>
          );
        })}

        {(!data || data.length === 0) && (
          <div style={{ color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, padding: '16px 0' }}>No scheduled events in next 24h</div>
        )}
      </div>
    </div>
  );
});

function SH() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <div style={{ width: 3, height: 14, background: 'var(--d-sig2)', borderRadius: 2 }} />
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>MISSION TIMELINE</span>
      <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)' }}>Next 24h</span>
    </div>
  );
}

export default MissionTimeline;
