import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useDashboardStore } from '../../stores/dashboardStore.js';

interface KPICard {
  key: string;
  label: string;
  color: string;
  path: string;
  unit?: string;
  precision?: number;
}

const CARDS: KPICard[] = [
  { key: 'vehicles_live',   label: 'VEHICLES',    color: 'var(--d-sig)',    path: '/fleet' },
  { key: 'convoys_active',  label: 'CONVOYS',     color: 'var(--d-ok)',     path: '/convoys' },
  { key: 'incidents_open',  label: 'INCIDENTS',   color: 'var(--d-warn)',   path: '/incidents' },
  { key: 'on_time_pct',    label: 'ON-TIME',     color: 'var(--d-purple)', path: '/analytics', unit: '%', precision: 0 },
  { key: 'payload_tonnes', label: 'PAYLOAD',     color: 'var(--d-sig2)',   path: '/shipments', unit: 't', precision: 1 },
];

function useCountUp(target: number, active: boolean): number {
  const [val, setVal] = useState(0);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!active) { setVal(target); return; }
    const start = performance.now();
    const from = 0;
    const dur = Math.min(800, target * 20 + 200);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const ease = 1 - Math.pow(1 - t, 3);
      setVal(from + (target - from) * ease);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return val;
}

function KPICardComp({ card, value }: { card: KPICard; value: number }) {
  const nav = useNavigate();
  const animated = useCountUp(value, true);
  const display = card.precision != null
    ? animated.toFixed(card.precision)
    : Math.round(animated).toString();

  return (
    <button
      onClick={() => nav({ to: card.path })}
      className='d-clip'
      style={{
        flex: '0 0 140px',
        scrollSnapAlign: 'start',
        background: 'var(--d-well)',
        border: '1px solid var(--d-rim2)',
        borderTop: `3px solid ${card.color}`,
        boxShadow: `0 -2px 12px ${card.color}22`,
        borderRadius: 0,
        cursor: 'pointer',
        padding: '14px 16px 12px',
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        transition: 'border-color .2s',
        clipPath: 'polygon(0 0, calc(100% - 13px) 0, 100% 13px, 100% 100%, 0 100%)',
      }}
    >
      <div style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, letterSpacing: '.12em', color: card.color, textTransform: 'uppercase' }}>
        {card.label}
      </div>
      <div style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 36, color: 'var(--d-t1)', lineHeight: 1, letterSpacing: '-.01em' }}>
        {display}{card.unit && <span style={{ fontSize: 14, fontWeight: 600, opacity: .7, marginLeft: 2 }}>{card.unit}</span>}
      </div>
    </button>
  );
}

const KPIStrip = React.memo(function KPIStrip() {
  const kpi = useDashboardStore((s) => s.overview?.kpi);

  if (!kpi) {
    return (
      <div className='d-hscroll' style={{ padding: '0 16px', gap: 10 }}>
        {CARDS.map(c => (
          <div key={c.key} className='d-clip' style={{
            flex: '0 0 140px', height: 90,
            background: 'var(--d-well)', border: '1px solid var(--d-rim)', borderRadius: 0,
            animation: 'd-pulse-warn 1.5s ease-in-out infinite',
          }} />
        ))}
      </div>
    );
  }

  const values: Record<string, number> = {
    vehicles_live:  kpi.vehicles_live,
    convoys_active: kpi.convoys_active,
    incidents_open: kpi.incidents_open,
    on_time_pct:    kpi.on_time_pct,
    payload_tonnes: kpi.payload_tonnes,
  };

  return (
    <div className='d-hscroll' style={{ padding: '16px 16px 0' }}>
      {CARDS.map(card => (
        <KPICardComp key={card.key} card={card} value={values[card.key] ?? 0} />
      ))}
    </div>
  );
});

export default KPIStrip;
