import React from 'react';

interface CompactEmptyProps {
  accent: string;
  title: string;
  message: string;
}

const CompactEmpty = React.memo(function CompactEmpty({ accent, title, message }: CompactEmptyProps) {
  return (
    <div className='d-section-reveal d-card' style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 3, height: 14, background: accent, borderRadius: 2, flexShrink: 0 }} />
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>{title}</span>
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t3)', letterSpacing: '.04em' }}>{message}</span>
    </div>
  );
});

export default CompactEmpty;
