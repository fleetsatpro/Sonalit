import React from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  LayoutDashboard, MapPin, Siren,
  Bell, AlertTriangle, Eye, Map,
  Route, Truck, Users, Fuel, Wrench,
  Package, Link2, BarChart2, DollarSign, Settings,
  MessageSquare, Bot, FileText, FileBarChart,
  ClipboardList, Cpu, BookOpen, Star, CalendarClock,
  Camera, History,
  type LucideIcon,
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth.js';

export interface NavItem { path: string; icon: LucideIcon; label: string }
interface NavGroup { label: string; hue: string; items: NavItem[] }

// Groups merged from the legacy NavSidebar so consolidating to Rail loses no
// nav entry. When adding routes: put them in the smallest section that fits
// so the rail stays scannable — don't grow "Command" past ~8 items.
// `hue` is an "r,g,b" triple: each section carries its own accent so a
// section is found by colour before the label is read (amber=command,
// red=security, cyan=fleet, green=business).
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Command',
    hue: '255,178,62',
    items: [
      { path: '/command',         icon: LayoutDashboard, label: 'Command Center' },
      { path: '/gps',             icon: MapPin,          label: 'GPS Live' },
      { path: '/replay',          icon: History,         label: 'Ops Replay' },
      { path: '/panic-center',    icon: Siren,           label: 'Panic Center' },
      { path: '/messages',        icon: MessageSquare,   label: 'Messages' },
      { path: '/ai',              icon: Bot,             label: 'AI Decision' },
      { path: '/copilot',         icon: Bot,             label: 'Copilot' },
    ],
  },
  {
    label: 'Security',
    hue: '255,59,92',
    items: [
      { path: '/alerts',         icon: Bell,          label: 'Alerts & Incidents' },
      { path: '/risk-intel',     icon: AlertTriangle, label: 'Risk Intel' },
      { path: '/guardian',       icon: Eye,           label: 'Guardian AI' },
      { path: '/geofences',      icon: Map,           label: 'Geofences' },
      { path: '/rules',          icon: BookOpen,      label: 'Rules' },
      { path: '/route-analysis', icon: Route,         label: 'Route Safety' },
    ],
  },
  {
    label: 'Surveillance',
    hue: '183,157,255',
    items: [
      { path: '/surveillance', icon: Camera, label: 'Covert Captures' },
      { path: '/guardian',     icon: Eye,    label: 'Guardian AI' },
    ],
  },
  {
    label: 'Fleet',
    hue: '55,230,255',
    items: [
      { path: '/convoys',        icon: Route,   label: 'Convoys' },
      { path: '/fleet',          icon: Truck,   label: 'Fleet' },
      { path: '/drivers',        icon: Users,   label: 'Drivers' },
      { path: '/field-officers', icon: Users,   label: 'Field Officers' },
      { path: '/devices',        icon: Cpu,     label: 'Devices' },
      { path: '/fuel',           icon: Fuel,    label: 'Fuel' },
      { path: '/maintenance',    icon: Wrench,  label: 'Maintenance' },
      { path: '/shifts',         icon: CalendarClock, label: 'Shifts' },
    ],
  },
  {
    label: 'Business',
    hue: '34,227,154',
    items: [
      { path: '/shipments',      icon: Package,      label: 'Shipments' },
      { path: '/cargo-portal',   icon: Link2,        label: 'Cargo Portal' },
      { path: '/analytics',      icon: BarChart2,    label: 'Analytics' },
      { path: '/reports',        icon: FileText,     label: 'Reports' },
      { path: '/convoy-reports', icon: FileBarChart, label: 'Convoy Reports' },
      { path: '/finance',        icon: DollarSign,   label: 'Finance' },
      { path: '/claims',         icon: ClipboardList, label: 'Claims' },
      { path: '/executive',      icon: Star,         label: 'Executive' },
      { path: '/settings',       icon: Settings,     label: 'Settings' },
    ],
  },
];

const Rail = React.memo(function Rail({ onClose }: { onClose?: () => void }) {
  const user = useAuthStore((s) => s.user);
  const routerState = useRouterState();
  const currentPath = routerState.location.pathname;

  const initials = user?.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) ?? 'OP';

  return (
    <nav style={{
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
      {/* Wordmark — links home to the Orbit launcher */}
      <Link to="/" onClick={onClose} style={{ display: 'block', textDecoration: 'none', padding: '20px 20px 12px', borderBottom: '1px solid var(--d-rim)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32,
            background: 'linear-gradient(135deg, #ff9040, #f07020)',
            clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
            flexShrink: 0,
          }} />
          <span className="d-rail-wordmark" style={{
            fontSize: 17,
            background: 'linear-gradient(90deg, #ff9040, #f07020)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            letterSpacing: '.1em',
          }}>SONALIT</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 10, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '.06em' }}>
          COMMAND CENTER v3
        </div>
      </Link>

      {/* Nav groups */}
      <div style={{ flex: 1, padding: '12px 0', overflowY: 'auto', scrollbarWidth: 'none' }}>
        {NAV_GROUPS.map(group => (
          <div key={group.label} style={{ marginBottom: 8 }}>
            <div style={{
              padding: '6px 20px 4px',
              fontSize: 9,
              fontFamily: 'IBM Plex Mono, monospace',
              fontWeight: 600,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: `rgba(${group.hue},.75)`,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              <span style={{ width: 3, height: 8, borderRadius: 2, background: `rgba(${group.hue},.85)`, flexShrink: 0 }} />
              {group.label}
            </div>
            {group.items.map(item => {
              const active = currentPath === item.path || (item.path !== '/' && currentPath.startsWith(item.path));
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={onClose}
                  className={`d-rail-navlabel${active ? ' is-active' : ''}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '9px 20px',
                    textDecoration: 'none',
                    color: active ? `rgb(${group.hue})` : 'var(--d-t2)',
                    background: active ? `linear-gradient(90deg, rgba(${group.hue},.10), transparent)` : 'transparent',
                    borderLeft: active ? `3px solid rgb(${group.hue})` : '3px solid transparent',
                    boxShadow: active ? `inset 4px 0 12px rgba(${group.hue},.14)` : 'none',
                    fontSize: 14,
                    transition: 'all .15s',
                  }}
                >
                  <Icon size={15} strokeWidth={active ? 2.2 : 1.6} style={{ flexShrink: 0, opacity: active ? 1 : 0.65, color: active ? `rgb(${group.hue})` : `rgba(${group.hue},.55)` }} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
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
          }} />
        </div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--d-t1)' }}>{user?.name ?? 'Operator'}</div>
          <div style={{ fontSize: 10, color: 'var(--d-t3)', textTransform: 'uppercase', letterSpacing: '.08em', fontFamily: 'IBM Plex Mono, monospace' }}>
            {user?.role ?? 'operator'}
          </div>
        </div>
      </div>
    </nav>
  );
});

export default Rail;
