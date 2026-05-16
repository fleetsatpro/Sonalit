import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Truck, Route, MapPin, Bell, BarChart3,
  MessageSquare, Settings, Cpu, Zap, FileText,
  LogOut, ChevronLeft, ChevronRight, Menu, X, Package,
  Users, DollarSign, Wrench, AlertTriangle, Search, Shield,
  Smartphone, AlertOctagon, FileWarning, Home, Radio,
  Globe, Target, Brain,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore, useAlertStore } from '../store';
import CommandBar from './CommandBar';
import WarRoom from './WarRoom';
import OfflineBanner from './OfflineBanner';

// ─── MLOS colour tokens ──────────────────────────────────────────────────────
const C = {
  bg:          '#060e1a',
  panel:       '#0b1829',
  surface:     '#0d2240',
  cyan:        '#00d4ff',
  blue:        '#0066ff',
  border:      'rgba(0,212,255,0.10)',
  borderFaint: 'rgba(0,212,255,0.08)',
  muted:       '#4a7090',
  light:       '#c8ddf0',
  danger:      '#ff3b5c',
  success:     '#00e5a0',
};

// ─── NAV definition ──────────────────────────────────────────────────────────
const NAV = [
  {
    label: 'MOVEMENT',
    items: [
      { to: '/fleet',      icon: Truck,          label: 'Fleet',            desc: 'Vehicles & assets'   },
      { to: '/convoys',    icon: Route,           label: 'Convoys',          desc: 'Active missions'     },
      { to: '/shipments',  icon: Package,         label: 'Shipments',        desc: 'Cargo tracking'      },
      { to: '/gps',        icon: MapPin,          label: 'Live Tracking',    desc: 'GPS positions'       },
    ],
  },
  {
    label: 'COMMERCIAL',
    items: [
      { to: '/drivers',    icon: Users,           label: 'Drivers',          desc: 'Personnel'           },
      { to: '/finance',    icon: DollarSign,      label: 'Finance',          desc: 'Revenue & billing'   },
      { to: '/shipments',  icon: Package,         label: 'Load Board',       desc: 'Available loads'     },
      { to: '/reports',    icon: FileText,        label: 'Reports',          desc: 'Generated reports'   },
    ],
  },
  {
    label: 'INTELLIGENCE',
    items: [
      { to: '/risk-intel',   icon: Globe,         label: 'Risk Intelligence', desc: 'Threat map'         },
      { to: '/ai-decisions', icon: Cpu,           label: 'AI Decisions',      desc: 'Copilot engine'     },
      { to: '/analytics',    icon: BarChart3,     label: 'Analytics',         desc: 'Performance data'   },
      { to: '/geofences',    icon: Shield,        label: 'Geofences',         desc: 'Zone management'    },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { to: '/incidents',  icon: AlertTriangle,   label: 'Incidents',        desc: 'Case management'     },
      { to: '/guardian',   icon: Smartphone,      label: 'Guardian Agents',  desc: 'Field devices'       },
      { to: '/devices',    icon: Radio,           label: 'IoT Sensors',      desc: 'Device telemetry'    },
      { to: '/maintenance',icon: Wrench,          label: 'Maintenance',      desc: 'Service records'     },
    ],
  },
  {
    label: 'SAFETY',
    items: [
      { to: '/panic-center',    icon: AlertOctagon, label: 'Panic Center',  desc: 'Emergency SOS',    badge: 'panic' },
      { to: '/alerts',          icon: Bell,         label: 'Alerts',         desc: 'Active incidents', badge: true    },
      { to: '/incident-center', icon: FileWarning,  label: 'Field Reports',  desc: 'Guardian reports'               },
      { to: '/rules',           icon: Zap,          label: 'Rules Engine',   desc: 'Automation'                     },
    ],
  },
  {
    label: 'COMMUNICATIONS',
    items: [
      { to: '/messages',   icon: MessageSquare,   label: 'Messages',         desc: 'Comms channels'      },
      { to: '/documents',  icon: FileText,        label: 'Documents',        desc: 'File management'     },
    ],
  },
  {
    label: 'COMMAND',
    items: [
      { to: '/',           icon: LayoutDashboard, label: 'Command Center',   desc: 'Global overview'     },
      { to: '/executive',  icon: Target,          label: 'Executive Suite',  desc: 'Boardroom analytics' },
      { to: '/copilot',    icon: Brain,           label: 'Copilot',          desc: 'AI assistant'        },
      { to: '/settings',   icon: Settings,        label: 'Settings',         desc: 'Configuration'       },
    ],
  },
];

// ─── LiveClock ───────────────────────────────────────────────────────────────
function LiveClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const i = setInterval(() => setT(new Date()), 1000);
    return () => clearInterval(i);
  }, []);
  return (
    <div style={{ textAlign: 'right', userSelect: 'none' }}>
      <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12, fontWeight: 700, color: C.light, letterSpacing: '0.08em', lineHeight: 1 }}>
        {t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </p>
      <p style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: C.muted, letterSpacing: '0.2em', marginTop: 2 }}>
        {t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()} · UTC
      </p>
    </div>
  );
}

// ─── SystemBadge ─────────────────────────────────────────────────────────────
function SystemBadge({ alerts }) {
  const critical = alerts?.filter(a => a.severity === 'critical' && !a.resolved_at).length || 0;
  if (critical > 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'rgba(255,59,92,0.08)', border: `1px solid rgba(255,59,92,0.25)`, borderRadius: 4 }}>
        <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.danger, animation: 'pulse 2s infinite' }} />
        <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, fontWeight: 700, color: C.danger, letterSpacing: '0.2em' }}>
          {critical} CRITICAL
        </span>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'rgba(0,229,160,0.07)', border: `1px solid rgba(0,229,160,0.18)`, borderRadius: 4 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.success, animation: 'pulse 2s infinite' }} />
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, fontWeight: 700, color: C.success, letterSpacing: '0.2em' }}>
        ALL SYSTEMS NOMINAL
      </span>
    </div>
  );
}

// ─── SessionIndicator ────────────────────────────────────────────────────────
function SessionIndicator() {
  const [latency, setLatency] = useState(null);
  useEffect(() => {
    const measure = async () => {
      const t0 = performance.now();
      try {
        await fetch('/api/ping', { method: 'HEAD', cache: 'no-store' });
      } catch {
        // ignore fetch errors — latency stays null
      }
      setLatency(Math.round(performance.now() - t0));
    };
    measure();
    const id = setInterval(measure, 30000);
    return () => clearInterval(id);
  }, []);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.success, boxShadow: `0 0 6px ${C.success}`, flexShrink: 0 }} />
      <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: C.success, letterSpacing: '0.15em' }}>
        LIVE{latency !== null ? ` · ${latency}ms` : ''}
      </span>
    </div>
  );
}

// ─── AlertBell ───────────────────────────────────────────────────────────────
function AlertBell({ alerts }) {
  const { unreadCount } = useAlertStore?.() || {};
  const navigate = useNavigate();
  const critical = alerts?.filter(a => a.severity === 'critical' && !a.resolved_at).length || 0;
  const count = unreadCount || 0;
  return (
    <button
      onClick={() => navigate('/alerts')}
      style={{ position: 'relative', padding: 6, background: 'none', border: 'none', cursor: 'pointer', color: critical > 0 ? C.danger : C.muted, display: 'flex', alignItems: 'center' }}
      title="Alerts"
    >
      <Bell size={16} />
      {count > 0 && (
        <span style={{
          position: 'absolute', top: 2, right: 2,
          minWidth: 14, height: 14, padding: '0 2px',
          background: critical > 0 ? C.danger : '#f59e0b',
          borderRadius: 7, fontSize: 7, fontWeight: 700,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', border: `2px solid ${C.bg}`,
          fontFamily: 'IBM Plex Mono, monospace',
        }}>
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}

// ─── NavItem ─────────────────────────────────────────────────────────────────
function NavItem({ item, collapsed, onClick }) {
  const location = useLocation();
  const { unreadCount } = useAlertStore?.() || {};
  const active = item.to === '/'
    ? location.pathname === '/'
    : location.pathname.startsWith(item.to);

  const badgeCount = item.badge === true ? (unreadCount || 0) : 0;
  const isPanicBadge = item.badge === 'panic';
  const [hovered, setHovered] = useState(false);

  const iconColor = active ? C.cyan : hovered ? C.light : C.muted;
  const textColor = active ? C.cyan : hovered ? C.light : C.muted;

  return (
    <Link
      to={item.to}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: collapsed ? 0 : 10,
        padding: collapsed ? '8px 0' : '8px 10px',
        justifyContent: collapsed ? 'center' : 'flex-start',
        borderRadius: 4,
        textDecoration: 'none',
        transition: 'background 0.15s, border-color 0.15s',
        background: active
          ? 'rgba(0,212,255,0.07)'
          : hovered
          ? 'rgba(0,212,255,0.04)'
          : 'transparent',
        border: `1px solid ${active ? 'rgba(0,212,255,0.15)' : 'transparent'}`,
        cursor: 'pointer',
        userSelect: 'none',
      }}
    >
      {/* Active left-edge bar */}
      {active && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          width: 2,
          height: 14,
          background: C.cyan,
          borderRadius: '0 2px 2px 0',
          boxShadow: `0 0 8px ${C.cyan}`,
        }} />
      )}

      {/* Icon */}
      <div style={{ position: 'relative', flexShrink: 0, color: iconColor, display: 'flex', alignItems: 'center' }}>
        <item.icon size={14} />
        {badgeCount > 0 && (
          <span style={{
            position: 'absolute', top: -6, right: -6,
            minWidth: 13, height: 13, padding: '0 2px',
            background: C.danger, borderRadius: 7,
            fontSize: 7, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', border: `2px solid ${C.bg}`,
            fontFamily: 'IBM Plex Mono, monospace',
          }}>
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
        {isPanicBadge && (
          <span style={{
            position: 'absolute', top: -4, right: -4,
            width: 7, height: 7, background: C.danger,
            borderRadius: '50%', border: `2px solid ${C.bg}`,
            animation: 'pulse 1.5s infinite',
          }} />
        )}
      </div>

      {/* Label + desc */}
      {!collapsed && (
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            display: 'block',
            fontFamily: 'Space Grotesk, sans-serif',
            fontWeight: 500,
            fontSize: 11,
            lineHeight: 1,
            marginBottom: 2,
            color: textColor,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {item.label}
          </span>
          <span style={{
            display: 'block',
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 9,
            color: C.muted,
            lineHeight: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {item.desc}
          </span>
        </div>
      )}
    </Link>
  );
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────
function Sidebar({ collapsed, setCollapsed, mobile, onClose }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const initials = (n) =>
    (n || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  const handleLogout = () => {
    logout();
    navigate('/login');
    toast.success('Signed out');
  };

  const sidebarWidth = mobile ? '100%' : collapsed ? 52 : 220;

  return (
    <div style={{
      width: sidebarWidth,
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: C.panel,
      borderRight: `1px solid ${C.borderFaint}`,
      position: 'relative',
      flexShrink: 0,
      transition: 'width 0.2s ease',
    }}>

      {/* ── Logo ── */}
      <div style={{
        padding: '16px 14px',
        borderBottom: `1px solid ${C.borderFaint}`,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexShrink: 0,
      }}>
        {/* MLOS mark */}
        <div style={{
          width: 36, height: 36, flexShrink: 0,
          background: 'linear-gradient(135deg, rgba(0,212,255,0.2), rgba(0,102,255,0.3))',
          border: '1px solid rgba(0,212,255,0.4)',
          borderRadius: 6,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 16px rgba(0,212,255,0.2)',
        }}>
          <span style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, color: C.cyan, letterSpacing: '-0.05em' }}>
            F
          </span>
        </div>

        {(!collapsed || mobile) && (
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 11, color: C.cyan, letterSpacing: '0.2em', lineHeight: 1 }}>
              FLEETOPS
            </div>
            <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 8, color: C.muted, letterSpacing: '0.2em', marginTop: 3 }}>
              PRO · v2.1 · ENTERPRISE
            </div>
          </div>
        )}

        {/* Mobile close */}
        {mobile && (
          <button onClick={onClose} style={{ marginLeft: 'auto', color: C.muted, background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
            <X size={14} />
          </button>
        )}

        {/* Desktop collapse toggle */}
        {!mobile && (
          <button onClick={() => setCollapsed(c => !c)} style={{ marginLeft: 'auto', color: C.muted, background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
            {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
          </button>
        )}
      </div>

      {/* ── Nav ── */}
      <nav style={{ flex: 1, overflowY: 'auto', padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {NAV.map(section => (
          <div key={section.label}>
            {(!collapsed || mobile) && (
              <p style={{
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 9,
                color: C.muted,
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                padding: '0 10px',
                marginBottom: 4,
                lineHeight: 1,
              }}>
                {section.label}
              </p>
            )}
            {collapsed && !mobile && (
              <div style={{ height: 1, background: 'rgba(0,212,255,0.06)', margin: '0 4px 6px' }} />
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {section.items.map(item => (
                <NavItem
                  key={`${item.to}-${item.label}`}
                  item={item}
                  collapsed={collapsed && !mobile}
                  onClick={onClose}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* ── User profile ── */}
      <div style={{
        borderTop: `1px solid ${C.borderFaint}`,
        padding: '10px 8px',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: collapsed && !mobile ? 'center' : 'stretch',
      }}>
        {(!collapsed || mobile) ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 10px',
            background: 'rgba(0,212,255,0.03)',
            border: `1px solid rgba(0,212,255,0.08)`,
            borderRadius: 4,
          }}>
            <div style={{
              width: 30, height: 30, flexShrink: 0,
              background: C.surface,
              border: `1px solid ${C.cyan}`,
              borderRadius: 4,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, fontWeight: 700, color: C.cyan }}>
                {initials(user?.name)}
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 11, fontWeight: 500, color: C.light, lineHeight: 1, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user?.name || 'Admin'}
              </p>
              <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, color: C.cyan, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                {user?.role || 'admin'}
              </span>
            </div>
          </div>
        ) : (
          <div style={{
            width: 30, height: 30,
            background: C.surface,
            border: `1px solid ${C.cyan}`,
            borderRadius: 4,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, fontWeight: 700, color: C.cyan }}>
              {initials(user?.name)}
            </span>
          </div>
        )}

        <button
          onClick={handleLogout}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed && !mobile ? 'center' : 'flex-start',
            gap: 8,
            width: '100%',
            padding: '7px 10px',
            background: 'none',
            border: '1px solid transparent',
            borderRadius: 4,
            cursor: 'pointer',
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 10,
            color: C.muted,
            transition: 'color 0.15s, background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = C.danger;
            e.currentTarget.style.background = 'rgba(255,59,92,0.05)';
            e.currentTarget.style.borderColor = 'rgba(255,59,92,0.15)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = C.muted;
            e.currentTarget.style.background = 'none';
            e.currentTarget.style.borderColor = 'transparent';
          }}
        >
          <LogOut size={13} />
          {(!collapsed || mobile) && 'Sign out'}
        </button>
      </div>
    </div>
  );
}

// ─── Topbar ──────────────────────────────────────────────────────────────────
function Topbar({ alerts, onMenuClick, pageTitle }) {
  return (
    <header style={{
      flexShrink: 0,
      height: 48,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      background: 'rgba(6,14,26,0.95)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderBottom: `1px solid ${C.borderFaint}`,
      zIndex: 10,
      gap: 12,
    }}>

      {/* Left: hamburger (mobile) + breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <button
          onClick={onMenuClick}
          className="lg:hidden"
          style={{ padding: 6, background: 'none', border: 'none', cursor: 'pointer', color: C.muted, display: 'flex', alignItems: 'center' }}
        >
          <Menu size={16} />
        </button>

        {/* Breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, color: C.muted, letterSpacing: '0.15em', flexShrink: 0 }}
                className="hidden sm:block">
            FLEETOPS
          </span>
          <ChevronRight size={10} style={{ color: C.muted, flexShrink: 0 }} className="hidden sm:block" />
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 10, fontWeight: 700, color: C.light, letterSpacing: '0.12em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pageTitle}
          </span>
        </div>
      </div>

      {/* Center: Search bar */}
      <div className="hidden md:flex" style={{ flex: '0 0 280px' }}>
        <div style={{ position: 'relative', width: '100%' }}>
          <Search size={11} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: C.muted, pointerEvents: 'none' }} />
          <input
            readOnly
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))}
            placeholder="Search shipments, vehicles, drivers, alerts…"
            style={{
              width: '100%',
              height: 30,
              paddingLeft: 28,
              paddingRight: 44,
              background: 'rgba(13,34,64,0.8)',
              border: `1px solid rgba(0,212,255,0.15)`,
              borderRadius: 4,
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: 10,
              color: C.muted,
              outline: 'none',
              cursor: 'pointer',
              boxSizing: 'border-box',
            }}
          />
          <kbd style={{
            position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
            fontFamily: 'IBM Plex Mono, monospace', fontSize: 9,
            background: 'rgba(0,212,255,0.06)', border: `1px solid rgba(0,212,255,0.12)`,
            borderRadius: 3, padding: '1px 5px', color: C.muted,
          }}>⌘K</kbd>
        </div>
      </div>

      {/* Right: system badge + bell + session + clock */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div className="hidden md:flex">
          <SystemBadge alerts={alerts} />
        </div>

        <AlertBell alerts={alerts} />

        <div style={{ borderLeft: `1px solid rgba(0,212,255,0.08)`, paddingLeft: 10 }} className="hidden sm:flex">
          <SessionIndicator />
        </div>

        <div style={{ borderLeft: `1px solid rgba(0,212,255,0.08)`, paddingLeft: 10 }} className="hidden sm:block">
          <LiveClock />
        </div>
      </div>
    </header>
  );
}

// ─── Layout (default export) ─────────────────────────────────────────────────
export default function Layout({ children }) {
  const location = useLocation();
  const { alerts, unreadCount } = useAlertStore?.() || { alerts: [], unreadCount: 0 };
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Derive page title from current path
  const pageTitle = (() => {
    const p = location.pathname;
    if (p === '/') return 'Command Center';
    return p.slice(1).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  })();

  return (
    <div style={{ display: 'flex', height: '100vh', background: C.bg, overflow: 'hidden' }}>

      {/* ── Mobile sidebar overlay ── */}
      {mobileOpen && (
        <>
          {/* Full-screen backdrop — tapping closes the drawer */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.85)' }}
            onClick={() => setMobileOpen(false)}
          />
          {/* Drawer — slides in on top of backdrop */}
          <div
            style={{ position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 51, width: '82vw', maxWidth: 320 }}
            onClick={e => e.stopPropagation()}
          >
            <Sidebar
              collapsed={false}
              setCollapsed={() => {}}
              mobile
              onClose={() => setMobileOpen(false)}
            />
          </div>
        </>
      )}

      {/* ── Desktop sidebar ── */}
      <div
        className="hidden lg:flex"
        style={{
          width: collapsed ? 52 : 220,
          flexShrink: 0,
          transition: 'width 0.2s ease',
          height: '100%',
        }}
      >
        <Sidebar
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          mobile={false}
          onClose={() => {}}
        />
      </div>

      {/* ── Main column ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        {/* Offline banner */}
        <OfflineBanner />

        {/* Topbar */}
        <Topbar
          alerts={alerts}
          onMenuClick={() => setMobileOpen(true)}
          pageTitle={pageTitle}
        />

        {/* Page content */}
        <main style={{ flex: 1, overflowY: 'auto' }}>
          <div style={{ padding: '16px 24px', minHeight: '100%', paddingBottom: 80 }}
               className="lg:pb-6">
            {children}
          </div>
        </main>
      </div>

      {/* ── Mobile bottom navigation ── */}
      <nav className="mobile-bottom-nav lg:hidden">
        {[
          { to: '/',         icon: Home,       label: 'HOME'     },
          { to: '/gps',      icon: MapPin,     label: 'MAP'      },
          { to: '/guardian', icon: Smartphone, label: 'GUARDIAN' },
          { to: '/alerts',   icon: Bell,       label: 'ALERTS',  danger: true },
          { to: '/convoys',  icon: Route,      label: 'CONVOYS'  },
        ].map(({ to, icon: Icon, label, danger }) => {
          const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
          const alertCount = danger ? (unreadCount || 0) : 0;
          return (
            <Link
              key={to}
              to={to}
              className={`mobile-nav-item ${active ? 'active' : ''} ${danger && !active ? 'nav-danger' : ''}`}
            >
              <div style={{ position: 'relative' }}>
                <Icon size={19} />
                {alertCount > 0 && (
                  <span style={{
                    position: 'absolute', top: -6, right: -6,
                    minWidth: 13, height: 13, padding: '0 2px',
                    background: C.danger, borderRadius: 7,
                    fontSize: 7, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', border: `2px solid ${C.bg}`,
                    fontFamily: 'IBM Plex Mono, monospace',
                  }}>
                    {alertCount > 9 ? '9+' : alertCount}
                  </span>
                )}
              </div>
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* ── Global overlays ── */}
      <CommandBar />
      <WarRoom />
    </div>
  );
}
