import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';

const TABS = [
  { path: '/', icon: '⬡', label: 'Command' },
  { path: '/gps', icon: '📡', label: 'GPS Live' },
  { path: '/alerts', icon: '🔔', label: 'Alerts' },
];

interface BottomNavProps {
  onMenuOpen: () => void;
  onDispatch: () => void;
}

const BottomNav = React.memo(function BottomNav({ onMenuOpen, onDispatch }: BottomNavProps) {
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  return (
    <div style={{
      position: 'fixed',
      bottom: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 500,
      display: 'flex',
      alignItems: 'center',
      gap: 0,
      background: 'rgba(0,2,8,.96)',
      backdropFilter: 'blur(32px)',
      borderRadius: 22,
      border: '1px solid var(--d-rim2)',
      padding: '8px 12px',
    }}>
      {TABS.slice(0, 2).map(tab => {
        const active = currentPath === tab.path || (tab.path !== '/' && currentPath.startsWith(tab.path));
        return (
          <Link key={tab.path} to={tab.path} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            padding: '6px 16px', textDecoration: 'none',
            color: active ? 'var(--d-sig)' : 'var(--d-t3)',
            borderTop: active ? '3px solid var(--d-sig)' : '3px solid transparent',
            borderRadius: '12px 12px 0 0',
            minWidth: 56,
          }}>
            <span style={{ fontSize: 18 }}>{tab.icon}</span>
            <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.04em' }}>{tab.label}</span>
          </Link>
        );
      })}

      {/* FAB dispatch */}
      <button
        onClick={onDispatch}
        style={{
          width: 52, height: 52,
          background: 'linear-gradient(135deg, var(--d-sig), var(--d-sig2))',
          border: 'none',
          clipPath: 'polygon(50% 0%, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%)',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20,
          boxShadow: '0 0 20px rgba(0,255,204,.4)',
          margin: '0 8px',
          flexShrink: 0,
        }}
        aria-label="Quick dispatch"
      >⚡</button>

      {TABS.slice(2).map(tab => {
        const active = currentPath === tab.path || (tab.path !== '/' && currentPath.startsWith(tab.path));
        return (
          <Link key={tab.path} to={tab.path} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
            padding: '6px 16px', textDecoration: 'none',
            color: active ? 'var(--d-sig)' : 'var(--d-t3)',
            borderTop: active ? '3px solid var(--d-sig)' : '3px solid transparent',
            borderRadius: '12px 12px 0 0',
            minWidth: 56,
          }}>
            <span style={{ fontSize: 18 }}>{tab.icon}</span>
            <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.04em' }}>{tab.label}</span>
          </Link>
        );
      })}

      {/* Menu tab */}
      <button
        onClick={onMenuOpen}
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          padding: '6px 16px', background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--d-t3)', minWidth: 56,
        }}
      >
        <span style={{ fontSize: 18 }}>☰</span>
        <span style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.04em' }}>Menu</span>
      </button>
    </div>
  );
});

export default BottomNav;
