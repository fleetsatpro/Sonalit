import React from 'react';
import { UsersRound, ScanLine, Map, ShieldAlert, BrainCircuit, RadioTower, type LucideIcon } from 'lucide-react';

interface CompactEmptyProps {
  accent: string;
  title: string;
  message: string;
}

const ICONS: Record<string, LucideIcon> = {
  'DRIVER BEHAVIOR': UsersRound,
  'BORDER CROSSINGS': ScanLine,
  'ROUTE RISK INTELLIGENCE': Map,
  'PANIC CENTER': ShieldAlert,
  'AI INTELLIGENCE': BrainCircuit,
};

const CompactEmpty = React.memo(function CompactEmpty({ accent, title, message }: CompactEmptyProps) {
  const Icon = ICONS[title] || RadioTower;
  return (
    <div className='d-section-reveal d-card' style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <div style={{ width: 3, height: 14, background: accent, borderRadius: 2, flexShrink: 0 }} />
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>{title}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'var(--d-lift)', borderRadius: 8, border: '1px solid var(--d-rim)' }}>
        <span className="son-icon-tile" style={{ color: accent }} aria-hidden="true"><Icon size={21} strokeWidth={2.7} /></span>
        <div>
          <div style={{ fontSize: 11, color: 'var(--d-t2)', fontFamily: 'IBM Plex Mono, monospace' }}>{message}</div>
          <div style={{ fontSize: 10, color: 'var(--d-t4)', fontFamily: 'IBM Plex Mono, monospace', marginTop: 2, letterSpacing: '.04em' }}>Awaiting data feed</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 3, alignItems: 'center' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: 4, height: 4, borderRadius: '50%', background: accent, opacity: 0.25 + i * 0.25 }} />
          ))}
        </div>
      </div>
    </div>
  );
});

export default CompactEmpty;
