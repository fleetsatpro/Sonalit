import React, { useState, useEffect, useRef } from 'react';
import { useDashboardStore } from '../../stores/dashboardStore.js';
import type { ThreatLevel } from '../../stores/dashboardStore.js';

const LEVEL_STYLE: Record<ThreatLevel, { bg: string; border: string; dot: string; label: string }> = {
  secure:   { bg: 'rgba(0,255,204,.04)',   border: 'rgba(0,255,204,.18)',  dot: 'var(--d-sig)',  label: 'SECURE' },
  elevated: { bg: 'rgba(255,190,46,.06)',  border: 'rgba(255,190,46,.22)', dot: 'var(--d-warn)', label: 'ELEVATED' },
  critical: { bg: 'rgba(255,68,34,.08)',   border: 'rgba(255,68,34,.28)',  dot: 'var(--d-fire)', label: 'CRITICAL' },
};

function useShiftTimer(shiftStartedAt: string | null): string {
  const [elapsed, setElapsed] = useState('00:00:00');
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!shiftStartedAt) return;
    const start = new Date(shiftStartedAt).getTime();
    const tick = () => {
      const sec = Math.floor((Date.now() - start) / 1000);
      const h = String(Math.floor(sec / 3600)).padStart(2, '0');
      const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
      const s = String(sec % 60).padStart(2, '0');
      setElapsed(`${h}:${m}:${s}`);
    };
    tick();
    ref.current = setInterval(tick, 1000);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [shiftStartedAt]);

  return elapsed;
}

const ThreatStrip = React.memo(function ThreatStrip() {
  const overview = useDashboardStore((s) => s.overview);
  const level: ThreatLevel = overview?.threat?.level ?? 'secure';
  const style = LEVEL_STYLE[level];
  const shiftTimer = useShiftTimer(overview?.shift_started_at ?? null);

  const kpi = overview?.kpi;

  return (
    <div style={{
      position: 'sticky',
      top: `calc(var(--d-top-h) + var(--d-tick-h))`,
      zIndex: 180,
      height: 'var(--d-str-h)',
      background: style.bg,
      borderBottom: `1px solid ${style.border}`,
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      padding: '0 16px',
      overflow: 'hidden',
      animation: level === 'critical' ? 'd-crit 1.8s ease-in-out infinite' : 'none',
    }}>
      {/* Threat level */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 8, flexShrink: 0 }}>
        <div style={{
          width: 7, height: 7, borderRadius: '50%',
          background: style.dot,
          boxShadow: `0 0 8px ${style.dot}`,
          animation: level !== 'secure' ? 'd-pulse-warn 1.2s ease-in-out infinite' : 'none',
        }} />
        <span style={{
          fontFamily: 'Orbitron, sans-serif', fontWeight: 800,
          fontSize: 9, letterSpacing: '.14em',
          color: style.dot,
        }}>THREAT {style.label}</span>
      </div>

      <div style={{ width: 1, height: 16, background: 'var(--d-rim2)', margin: '0 8px', flexShrink: 0 }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, overflow: 'hidden', flex: 1 }}>
        <StripItem label='Vehicles' value={kpi?.vehicles_live?.toString() ?? '—'} />
        <StripItem label='Alerts' value={overview?.threat?.alerts_open?.toString() ?? '—'} color={overview?.threat?.alerts_open ? 'var(--d-fire)' : undefined} />
        <StripItem label='Convoys' value={kpi?.convoys_active?.toString() ?? '—'} />
        <StripItem label='Incidents' value={overview?.threat?.incidents_active?.toString() ?? '—'} color={overview?.threat?.incidents_active ? 'var(--d-warn)' : undefined} />
        <StripItem label='On-Time' value={kpi?.on_time_pct != null ? `${kpi.on_time_pct}%` : '—'} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
          <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', letterSpacing: '.06em' }}>SHIFT</span>
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 11, fontWeight: 700, color: 'var(--d-t2)', letterSpacing: '.06em' }}>{shiftTimer}</span>
        </div>
      </div>
    </div>
  );
});

function StripItem({ label, value, color }: { label: string; value: string; color?: string | undefined }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', letterSpacing: '.06em' }}>{label}</span>
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontSize: 12, fontWeight: 700, color: color ?? 'var(--d-t1)', letterSpacing: '.04em' }}>{value}</span>
    </div>
  );
}

export default ThreatStrip;
