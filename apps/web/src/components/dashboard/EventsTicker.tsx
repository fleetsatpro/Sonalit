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

const EventsTicker = React.memo(function EventsTicker() {
  const tickerEvents = useDashboardStore((state) => state.tickerEvents);
  const containerRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = React.useState(false);
  const doubled = tickerEvents.length > 0 ? [...tickerEvents, ...tickerEvents] : [];

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    element.style.animationPlayState = paused ? 'paused' : 'running';
  }, [paused]);

  const getColor = (severity: string): string =>
    SEVERITY_COLOR[severity] ?? (SEVERITY_COLOR.default as string);

  return (
    <div
      className='cc-event-ticker'
      role='status'
      aria-label='Recent operational events'
      style={{
        flexShrink: 0,
        minHeight: 45,
        overflow: 'hidden',
        maskImage: 'linear-gradient(90deg, transparent, black 3%, black 97%, transparent)',
        WebkitMaskImage: 'linear-gradient(90deg, transparent, black 3%, black 97%, transparent)',
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {tickerEvents.length === 0 ? (
        <span className='cc-event-ticker__empty'>NO RECENT OPERATIONAL EVENTS RECEIVED</span>
      ) : (
        <div
          ref={containerRef}
          style={{
            display: 'flex',
            alignItems: 'center',
            height: '100%',
            width: 'max-content',
            animation: 'd-tick 52s linear infinite',
            willChange: 'transform',
          }}
        >
          {doubled.map((event, index) => (
            <span key={event.id + '-' + index} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 18px', flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: getColor(event.severity) }} />
              <span style={{ color: getColor(event.severity), fontSize: 8, fontFamily: 'var(--d-font-mono, monospace)', fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase' }}>
                {event.severity.toUpperCase()}
              </span>
              <span style={{ color: 'var(--d-t2)', fontSize: 9, fontFamily: 'var(--d-font-mono, monospace)', letterSpacing: '.015em' }}>
                {event.message}
              </span>
              <span style={{ width: 1, height: 12, margin: '0 7px', background: 'var(--d-rim2)' }} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
});

export default EventsTicker;
