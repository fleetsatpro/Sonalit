import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useDashboardStore } from '../../stores/dashboardStore.js';
import type { ThreatLevel } from '../../stores/dashboardStore.js';
import { NAV_GROUPS } from '../layout/Rail.js';

// One instrument bar: threat gauge + KPI tiles with sparklines & deltas +
// guards + shift clock + ⌘K jump. Replaces the separate ThreatStrip and
// KPIStrip rows on the command console.

const THREAT_STYLE: Record<ThreatLevel, { color: string; segs: number }> = {
  secure: { color: 'var(--d-sig)', segs: 1 },
  elevated: { color: 'var(--d-warn)', segs: 2 },
  critical: { color: 'var(--d-fire)', segs: 3 },
};

interface TileDef { key: string; label: string; color: string; path: string; unit?: string; precision?: number }

const TILES: TileDef[] = [
  { key: 'vehicles_live', label: 'VEHICLES', color: 'var(--d-sig)', path: '/fleet' },
  { key: 'convoys_active', label: 'CONVOYS', color: '#37e6ff', path: '/convoys' },
  { key: 'incidents_open', label: 'INCIDENTS', color: 'var(--d-warn)', path: '/incidents' },
  { key: 'on_time_pct', label: 'ON-TIME', color: 'var(--d-purple)', path: '/analytics', unit: '%' },
  { key: 'payload_tonnes', label: 'PAYLOAD', color: '#ffb23e', path: '/shipments', unit: 't', precision: 1 },
];

// In-session KPI history for sparklines/deltas. Module-level so route
// round-trips keep the trace; capped so a long-open console stays bounded.
const KPI_HIST: Record<string, number[]> = {};
const HIST_MAX = 32;

function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return <svg width={44} height={14} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const pts = points.map((v, i) => `${(i / (points.length - 1)) * 42 + 1},${13 - ((v - min) / span) * 11}`).join(' ');
  return (
    <svg width={44} height={14} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill='none' stroke={color} strokeWidth={1.4} strokeLinejoin='round' strokeLinecap='round' opacity={0.85} />
    </svg>
  );
}

function useShiftTimer(shiftStartedAt: string | null): string {
  // '—' rather than a fake 00:00:00 when no shift is active.
  const [elapsed, setElapsed] = useState('—');
  useEffect(() => {
    if (!shiftStartedAt) { setElapsed('—'); return; }
    const start = new Date(shiftStartedAt).getTime();
    const tick = () => {
      const sec = Math.max(0, Math.floor((Date.now() - start) / 1000));
      const h = String(Math.floor(sec / 3600)).padStart(2, '0');
      const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
      const s = String(sec % 60).padStart(2, '0');
      setElapsed(`${h}:${m}:${s}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [shiftStartedAt]);
  return elapsed;
}

const JUMP_ITEMS = NAV_GROUPS.flatMap(g => g.items.map(i => ({ ...i, group: g.label, hue: g.hue })));

function JumpSearch() {
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return JUMP_ITEMS.slice(0, 6);
    return JUMP_ITEMS.filter(i => i.label.toLowerCase().includes(needle) || i.group.toLowerCase().includes(needle)).slice(0, 6);
  }, [q]);

  const go = (path: string) => { setOpen(false); setQ(''); nav({ to: path }); };

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <input
        ref={inputRef}
        value={q}
        placeholder='Jump to…  ⌘K'
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) go(matches[0].path); }}
        style={{
          width: 148, height: 28, padding: '0 10px',
          background: 'var(--d-well)', border: '1px solid var(--d-rim2)', borderRadius: 7,
          color: 'var(--d-t1)', fontSize: 11, fontFamily: 'IBM Plex Mono, monospace',
          outline: 'none',
        }}
      />
      {open && matches.length > 0 && (
        <div style={{
          position: 'absolute', top: 32, right: 0, width: 220, zIndex: 400,
          background: 'var(--d-carbon)', border: '1px solid var(--d-rim2)', borderRadius: 8,
          boxShadow: '0 12px 32px rgba(0,0,0,.5)', overflow: 'hidden',
        }}>
          {matches.map(m => (
            <button
              key={m.path}
              onMouseDown={(e) => { e.preventDefault(); go(m.path); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--d-t1)', fontSize: 12, textAlign: 'left',
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: `rgb(${m.hue})`, flexShrink: 0 }} />
              {m.label}
              <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace' }}>{m.group}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const InstrumentBar = React.memo(function InstrumentBar() {
  const overview = useDashboardStore((s) => s.overview);
  const level: ThreatLevel = overview?.threat?.level ?? 'secure';
  const threat = THREAT_STYLE[level];
  const shift = useShiftTimer(overview?.shift_started_at ?? null);
  const kpi = overview?.kpi;

  // Accumulate per-poll KPI history (dedupe identical consecutive snapshots).
  useEffect(() => {
    if (!kpi) return;
    TILES.forEach(t => {
      const v = (kpi as unknown as Record<string, number>)[t.key] ?? 0;
      const hist = (KPI_HIST[t.key] ??= []);
      if (hist[hist.length - 1] !== v) {
        hist.push(v);
        if (hist.length > HIST_MAX) hist.shift();
      }
    });
  }, [kpi]);

  return (
    <div style={{
      display: 'flex', alignItems: 'stretch', gap: 10,
      padding: '8px 14px', flexWrap: 'wrap',
      background: 'var(--d-carbon)', borderBottom: '1px solid var(--d-rim2)',
    }}>
      {/* Threat gauge */}
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 5, paddingRight: 12, borderRight: '1px solid var(--d-rim2)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', background: threat.color,
            boxShadow: `0 0 8px ${threat.color}`, flexShrink: 0,
            animation: level !== 'secure' ? 'd-pulse-warn 1.2s ease-in-out infinite' : 'none',
          }} />
          <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', letterSpacing: '.1em' }}>THREAT</span>
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 12, letterSpacing: '.1em', color: threat.color }}>{level.toUpperCase()}</span>
        </div>
        <div style={{ display: 'flex', gap: 3 }}>
          {[0, 1, 2].map(i => (
            <span key={i} style={{ width: 26, height: 4, borderRadius: 2, background: i < threat.segs ? threat.color : 'var(--d-lift2)' }} />
          ))}
        </div>
      </div>

      {/* KPI tiles */}
      {TILES.map(t => {
        const raw = kpi ? ((kpi as unknown as Record<string, number>)[t.key] ?? 0) : null;
        const hist = KPI_HIST[t.key] ?? [];
        const prev = hist.length >= 2 ? hist[hist.length - 2] : null;
        const delta = raw != null && prev != null ? raw - prev : null;
        const display = raw == null ? '—' : t.precision != null ? raw.toFixed(t.precision) : String(Math.round(raw));
        return (
          <div key={t.key} style={{
            display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2,
            padding: '4px 12px', minWidth: 92,
            background: 'var(--d-well)', border: '1px solid var(--d-rim2)',
            borderTop: `2px solid ${t.color}`, borderRadius: 7,
          }}>
            <div style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600, letterSpacing: '.12em', color: t.color }}>{t.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 21, lineHeight: 1, color: 'var(--d-t1)' }}>
                {display}{t.unit && <span style={{ fontSize: 11, fontWeight: 600, opacity: .6, marginLeft: 2 }}>{t.unit}</span>}
              </span>
              {delta != null && delta !== 0 && (
                <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', color: delta > 0 ? 'var(--d-ok)' : 'var(--d-fire)' }}>
                  {delta > 0 ? '▲' : '▼'}{Math.abs(t.precision != null ? +delta.toFixed(t.precision) : Math.round(delta))}
                </span>
              )}
              <Sparkline points={hist} color={t.color} />
            </div>
          </div>
        );
      })}

      <div style={{ flex: 1 }} />

      {/* Guards + shift + jump */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 16, lineHeight: 1, color: 'var(--d-t1)' }}>{kpi?.guards_active ?? '—'}</span>
          <span style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.1em', color: 'var(--d-t3)' }}>GUARDS ACTIVE</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1 }}>
          <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 13, lineHeight: 1.2, color: 'var(--d-t2)', letterSpacing: '.06em' }}>{shift}</span>
          <span style={{ fontSize: 8, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.1em', color: 'var(--d-t3)' }}>SHIFT</span>
        </div>
        <JumpSearch />
      </div>
    </div>
  );
});

export default InstrumentBar;
