import React from 'react';
import { useNavigate } from '@tanstack/react-router';

const ACTIONS = [
  { icon: '🚛', label: 'New Convoy',    path: '/convoys/new',      color: 'var(--d-sig)' },
  { icon: '🔔', label: 'Alerts',        path: '/alerts',            color: 'var(--d-fire)' },
  { icon: '📡', label: 'GPS Live',      path: '/gps',              color: 'var(--d-ok)' },
  { icon: '📦', label: 'Shipments',     path: '/shipments',        color: 'var(--d-sig2)' },
  { icon: '👤', label: 'Drivers',       path: '/drivers',          color: 'var(--d-warn)' },
  { icon: '🛡',  label: 'Incidents',    path: '/incidents',        color: 'var(--d-warn)' },
  { icon: '📊', label: 'Analytics',     path: '/analytics',        color: 'var(--d-purple)' },
  { icon: '⚙',  label: 'Settings',     path: '/settings',         color: 'var(--d-t2)' },
];

const QuickActions = React.memo(function QuickActions() {
  const nav = useNavigate();
  return (
    <div className='d-section-reveal d-card' style={{ padding: 16 }}>
      <SH />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {ACTIONS.map(a => (
          <button
            key={a.path}
            onClick={() => nav({ to: a.path })}
            style={{
              background: 'var(--d-surf)',
              border: '1px solid var(--d-rim2)',
              borderRadius: 10,
              padding: '14px 8px',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              position: 'relative',
              overflow: 'hidden',
              transition: 'border-color .15s',
            }}
          >
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 2,
              background: a.color,
            }} />
            <div style={{ fontSize: 22 }}>{a.icon}</div>
            <div style={{ fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', color: 'var(--d-t2)', letterSpacing: '.04em' }}>{a.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
});

function SH() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
      <div style={{ width: 3, height: 14, background: 'var(--d-sig)', borderRadius: 2 }} />
      <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 11, letterSpacing: '.12em', color: 'var(--d-t1)' }}>QUICK ACTIONS</span>
    </div>
  );
}

export default QuickActions;
