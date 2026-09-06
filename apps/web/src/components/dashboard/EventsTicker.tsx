import React, { useEffect, useRef } from 'react';
import { useDashboardStore } from '../../stores/dashboardStore.js';

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--d-fire)',
  high: 'var(--d-fire)',
  alert: 'var(--d-fire)',
  panic: 'var(--d-fire)',
  medium: 'var(--d-warn)',
  incident: 'var(--d-warn)',
  convoy: 'var(--d-sig)',
  low: 'var(--d-ok)',
  default: 'var(--d-t3)',
};

const SEED_EVENTS = [
  { id: 's1', severity: 'convoy', message: 'SONALIT Command Center online — all systems nominal' },
  { id: 's2', severity: 'low', message: 'Fleet telemetry streaming live' },
  { id: 's3', severity: 'convoy', message: 'GPS positioning active on all tracked vehicles' },
];

const EventsTicker = React.memo(function EventsTicker() {
  const tickerEvents = useDashboardStore((s) => s.tickerEvents);
  const containerRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = React.useState(false);

  const events = tickerEvents.length > 0 ? tickerEvents : SEED_EVENTS;
  const doubled = [...events, ...events];

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.animationPlayState = paused ? 'paused' : 'running';
  }, [paused]);

  const getColor = (severity: string): string => SEVERITY_COLOR[severity] ?? (SEVERITY_COLOR['default'] as string);

  return (
    <div
      style={{
        // Bottom rail of the command console — a fixed-height flex row, so
        // no sticky positioning needed.
        flexShrink: 0,
        height: 'var(--d-tick-h)',
        background: 'rgba(8,14,24,.95)',
        borderTop: '1px solid var(--d-rim)',
        overflow: 'hidden',
        maskImage: 'linear-gradient(90deg, transparent, black 3%, black 97%, transparent)',
        WebkitMaskImage: 'linear-gradient(90deg, transparent, black 3%, black 97%, transparent)',
        cursor: 'default',
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        ref={containerRef}
        style={{
          display: 'flex',
          alignItems: 'center',
          height: '100%',
          width: 'max-content',
          animation: 'd-tick 45s linear infinite',
          willChange: 'transform',
        }}
      >
        {doubled.map((evt, i) => (
          <span key={`${evt.id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 24px', flexShrink: 0 }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
              background: getColor(evt.severity),
            }} />
            <span style={{
              fontSize: 10,
              fontFamily: 'IBM Plex Mono, monospace',
              fontWeight: 600,
              letterSpacing: '.06em',
              textTransform: 'uppercase',
              color: getColor(evt.severity),
            }}>{evt.severity.toUpperCase()}</span>
            <span style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t2)', letterSpacing: '.02em' }}>
              {evt.message}
            </span>
            <span style={{ width: 1, height: 12, background: 'var(--d-rim2)', margin: '0 8px' }} />
          </span>
        ))}
      </div>
    </div>
  );
});

export default EventsTicker;
