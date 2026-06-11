import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { LayoutDashboard, MapPin, ShieldAlert, Siren, Bell, AlertTriangle, Eye, Map, Route, Truck, Users, Fuel, Wrench, Package, Link2, BarChart2, DollarSign, Settings, } from 'lucide-react';
import { useAuthStore } from '../../stores/auth.js';
const NAV_GROUPS = [
    {
        label: 'Command',
        items: [
            { path: '/', icon: LayoutDashboard, label: 'Command Center' },
            { path: '/gps', icon: MapPin, label: 'GPS Live' },
            { path: '/incident-center', icon: ShieldAlert, label: 'Incident Center' },
            { path: '/panic-center', icon: Siren, label: 'Panic Center' },
        ],
    },
    {
        label: 'Security',
        items: [
            { path: '/alerts', icon: Bell, label: 'Alerts' },
            { path: '/risk-intel', icon: AlertTriangle, label: 'Risk Intel' },
            { path: '/guardian', icon: Eye, label: 'Guardian AI' },
            { path: '/geofences', icon: Map, label: 'Geofences' },
        ],
    },
    {
        label: 'Fleet',
        items: [
            { path: '/convoys', icon: Route, label: 'Convoys' },
            { path: '/fleet', icon: Truck, label: 'Fleet' },
            { path: '/drivers', icon: Users, label: 'Drivers' },
            { path: '/fuel', icon: Fuel, label: 'Fuel' },
            { path: '/maintenance', icon: Wrench, label: 'Maintenance' },
        ],
    },
    {
        label: 'Business',
        items: [
            { path: '/shipments', icon: Package, label: 'Shipments' },
            { path: '/cargo-portal', icon: Link2, label: 'Cargo Portal' },
            { path: '/analytics', icon: BarChart2, label: 'Analytics' },
            { path: '/finance', icon: DollarSign, label: 'Finance' },
            { path: '/settings', icon: Settings, label: 'Settings' },
        ],
    },
];
const Rail = React.memo(function Rail({ onClose }) {
    const user = useAuthStore((s) => s.user);
    const routerState = useRouterState();
    const currentPath = routerState.location.pathname;
    const initials = user?.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) ?? 'OP';
    return (<nav style={{
            display: 'flex',
            flexDirection: 'column',
            width: 'var(--d-rail-w)',
            height: '100vh',
            background: 'var(--d-carbon)',
            borderRight: '1px solid var(--d-rim2)',
            position: 'fixed',
            left: 0,
            top: 0,
            zIndex: 300,
            overflowY: 'auto',
            scrollbarWidth: 'none',
        }}>
      {/* Wordmark */}
      <div style={{ padding: '20px 20px 12px', borderBottom: '1px solid var(--d-rim)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32,
            background: 'linear-gradient(135deg, #ff9040, #f07020)',
            clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
            flexShrink: 0,
        }}/>
          <span style={{
            fontFamily: 'Orbitron, sans-serif',
            fontWeight: 800,
            fontSize: 16,
            background: 'linear-gradient(90deg, #ff9040, #f07020)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            letterSpacing: '.12em',
        }}>SONALIT</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 10, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.06em' }}>
          COMMAND CENTER v3
        </div>
      </div>

      {/* Nav groups */}
      <div style={{ flex: 1, padding: '12px 0', overflowY: 'auto', scrollbarWidth: 'none' }}>
        {NAV_GROUPS.map(group => (<div key={group.label} style={{ marginBottom: 8 }}>
            <div style={{
                padding: '6px 20px 4px',
                fontSize: 9,
                fontFamily: 'IBM Plex Mono, monospace',
                fontWeight: 600,
                letterSpacing: '.12em',
                textTransform: 'uppercase',
                color: 'var(--d-t3)',
            }}>{group.label}</div>
            {group.items.map(item => {
                const active = currentPath === item.path || (item.path !== '/' && currentPath.startsWith(item.path));
                const Icon = item.icon;
                return (<Link key={item.path} to={item.path} onClick={onClose} style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '9px 20px',
                        textDecoration: 'none',
                        color: active ? 'var(--d-orange)' : 'var(--d-t2)',
                        background: active ? 'linear-gradient(90deg, rgba(249,115,22,.08), transparent)' : 'transparent',
                        borderLeft: active ? '3px solid var(--d-orange)' : '3px solid transparent',
                        boxShadow: active ? 'inset 4px 0 12px rgba(249,115,22,.12)' : 'none',
                        fontSize: 13,
                        fontFamily: 'DM Sans, sans-serif',
                        fontWeight: active ? 600 : 400,
                        transition: 'all .15s',
                    }}>
                  <Icon size={15} strokeWidth={active ? 2.2 : 1.6} style={{ flexShrink: 0, opacity: active ? 1 : 0.65 }}/>
                  {item.label}
                </Link>);
            })}
          </div>))}
      </div>

      {/* User section */}
      <div style={{
            padding: '16px 20px',
            borderTop: '1px solid var(--d-rim)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
        }}>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 36, height: 36, borderRadius: '50%',
            background: 'linear-gradient(135deg, #f07020, #ff9040)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'Orbitron, sans-serif', fontWeight: 700, fontSize: 12,
            color: '#fff',
        }}>{initials}</div>
          <div style={{
            position: 'absolute', inset: -4, borderRadius: '50%',
            border: '1.5px solid var(--d-orange)',
            animation: 'd-sonar 2.5s ease-out infinite',
            opacity: 0,
        }}/>
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-t1)' }}>{user?.name ?? 'Operator'}</div>
          <div style={{ fontSize: 10, color: 'var(--d-t3)', textTransform: 'uppercase', letterSpacing: '.08em', fontFamily: 'IBM Plex Mono, monospace' }}>
            {user?.role ?? 'operator'}
          </div>
        </div>
      </div>
    </nav>);
});
export default Rail;
