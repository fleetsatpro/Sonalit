import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Truck, MapPin, Bell, Menu } from 'lucide-react';
const TABS_LEFT = [
    { path: '/convoys', icon: Truck, label: 'Convoys' },
    { path: '/gps', icon: MapPin, label: 'GPS Live' },
];
const TABS_RIGHT = [
    { path: '/alerts', icon: Bell, label: 'Alerts' },
];
const BottomNav = React.memo(function BottomNav({ onMenuOpen, onDispatch }) {
    const routerState = useRouterState();
    const currentPath = routerState.location.pathname;
    const tabStyle = (active) => ({
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
        padding: '6px 14px', textDecoration: 'none',
        color: active ? 'var(--d-orange)' : 'var(--d-t3)',
        minWidth: 54,
    });
    return (<div style={{
            position: 'fixed',
            bottom: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 500,
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(0,2,8,.96)',
            backdropFilter: 'blur(32px)',
            borderRadius: 24,
            border: '1px solid var(--d-rim2)',
            padding: '6px 10px',
        }}>
      {TABS_LEFT.map(tab => {
            const active = currentPath === tab.path || (tab.path !== '/' && currentPath.startsWith(tab.path));
            const Icon = tab.icon;
            return (<Link key={tab.path} to={tab.path} style={tabStyle(active)}>
            <Icon size={18} strokeWidth={active ? 2.2 : 1.6}/>
            <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.04em' }}>{tab.label}</span>
          </Link>);
        })}

      {/* FAB — SONALIT hexagon */}
      <button onClick={onDispatch} style={{
            width: 50, height: 50,
            background: 'linear-gradient(135deg, #ff9040, #f07020)',
            border: 'none',
            clipPath: 'polygon(50% 0%, 95% 25%, 95% 75%, 50% 100%, 5% 75%, 5% 25%)',
            cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 0 20px rgba(249,115,22,.4)',
            margin: '0 6px',
            flexShrink: 0,
        }} aria-label="Quick dispatch">
        <span style={{ fontFamily: 'Orbitron, sans-serif', fontWeight: 800, fontSize: 9, color: '#fff', letterSpacing: '.08em' }}>SN</span>
      </button>

      {TABS_RIGHT.map(tab => {
            const active = currentPath === tab.path || (tab.path !== '/' && currentPath.startsWith(tab.path));
            const Icon = tab.icon;
            return (<Link key={tab.path} to={tab.path} style={tabStyle(active)}>
            <Icon size={18} strokeWidth={active ? 2.2 : 1.6}/>
            <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.04em' }}>{tab.label}</span>
          </Link>);
        })}

      <button onClick={onMenuOpen} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            padding: '6px 14px', background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--d-t3)', minWidth: 54,
        }}>
        <Menu size={18} strokeWidth={1.6}/>
        <span style={{ fontSize: 9, fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.04em' }}>Menu</span>
      </button>
    </div>);
});
export default BottomNav;
