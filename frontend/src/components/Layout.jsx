import { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Truck, Route, MapPin, Bell, BarChart3,
  MessageSquare, Settings, Shield, Cpu, Zap, FileText,
  LogOut, ChevronLeft, ChevronRight, Menu, X, Package,
  Users, DollarSign, Wrench, AlertTriangle, Search,
  Radio, Activity, ChevronDown, Globe
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore, useAlertStore } from '../store';
import CommandBar from './CommandBar';
import WarRoom from './WarRoom';
import OfflineBanner from './OfflineBanner';

const NAV = [
  {
    label: 'OPERATIONS',
    items: [
      { to: '/',           icon: LayoutDashboard, label: 'Command Center', desc: 'Live overview'     },
      { to: '/fleet',      icon: Truck,           label: 'Fleet',          desc: 'Vehicles & assets' },
      { to: '/convoys',    icon: Route,           label: 'Convoys',        desc: 'Missions'          },
      { to: '/shipments',  icon: Package,         label: 'Shipments',      desc: 'Cargo tracking'   },
      { to: '/drivers',    icon: Users,           label: 'Drivers',        desc: 'Personnel'         },
      { to: '/gps',        icon: MapPin,          label: 'GPS Track',      desc: 'Live positions'    },
    ],
  },
  {
    label: 'INTELLIGENCE',
    items: [
      { to: '/alerts',     icon: Bell,            label: 'Alerts',         desc: 'Active incidents', badge: true },
      { to: '/incidents',  icon: AlertTriangle,   label: 'Incidents',      desc: 'Case management'  },
      { to: '/analytics',  icon: BarChart3,       label: 'Analytics',      desc: 'Performance data' },
      { to: '/reports',    icon: FileText,        label: 'Reports',        desc: 'Generated reports' },
    ],
  },
  {
    label: 'MANAGEMENT',
    items: [
      { to: '/maintenance', icon: Wrench,         label: 'Maintenance',    desc: 'Service records'  },
      { to: '/finance',     icon: DollarSign,     label: 'Finance',        desc: 'Revenue & costs'  },
      { to: '/devices',     icon: Cpu,            label: 'Devices',        desc: 'GPS hardware'     },
      { to: '/rules',       icon: Zap,            label: 'Rules',          desc: 'Automation'       },
      { to: '/messages',    icon: MessageSquare,  label: 'Messages',       desc: 'Comms channels'   },
      { to: '/settings',    icon: Settings,       label: 'Settings',       desc: 'Configuration'    },
    ],
  },
];

function LiveClock() {
  const [t, setT] = useState(new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i); }, []);
  return (
    <div className="text-right select-none">
      <p className="font-display text-sm font-bold text-slate-100 tabular-nums tracking-wider">
        {t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </p>
      <p className="text-[9px] font-mono text-slate-500 tracking-widest">
        {t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()} · UTC
      </p>
    </div>
  );
}

function SystemBadge({ alerts }) {
  const critical = alerts?.filter(a => a.severity === 'critical' && !a.resolved_at).length || 0;
  if (critical > 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-danger/10 border border-danger/25 rounded-xl">
        <div className="w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
        <span className="text-[9px] font-mono font-bold text-danger tracking-widest">{critical} CRITICAL</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-success/10 border border-success/20 rounded-xl">
      <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
      <span className="text-[9px] font-mono font-bold text-success tracking-widest">ALL SYSTEMS NOMINAL</span>
    </div>
  );
}

function NavItem({ item, collapsed, onClick }) {
  const location = useLocation();
  const { unreadCount } = useAlertStore?.() || {};
  const active = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
  const badgeCount = item.badge ? (unreadCount || 0) : 0;

  return (
    <Link
      to={item.to}
      onClick={onClick}
      title={collapsed ? item.label : undefined}
      className={`
        group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium
        transition-all duration-150 cursor-pointer select-none
        ${active
          ? 'bg-gradient-to-r from-gold/15 to-gold/5 border border-gold/25 text-gold shadow-sm'
          : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.04] border border-transparent'}
        ${collapsed ? 'justify-center' : ''}
      `}
    >
      {/* Active indicator bar */}
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-gold rounded-r-full" />
      )}

      {/* Icon */}
      <div className={`relative flex-shrink-0 ${active ? 'text-gold' : 'text-slate-500 group-hover:text-slate-300'}`}>
        <item.icon size={15} />
        {badgeCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[14px] h-3.5 px-0.5 bg-danger rounded-full text-[7px] font-bold flex items-center justify-center text-white border border-navy-950">
            {badgeCount > 9 ? '9+' : badgeCount}
          </span>
        )}
      </div>

      {/* Label + desc */}
      {!collapsed && (
        <div className="flex-1 min-w-0">
          <span className={`block font-semibold text-xs leading-none mb-0.5 ${active ? 'text-gold' : ''}`}>
            {item.label}
          </span>
          <span className="block text-[9px] text-slate-600 leading-none truncate">{item.desc}</span>
        </div>
      )}
    </Link>
  );
}

function Sidebar({ collapsed, setCollapsed, mobile, onClose }) {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const initials = (n) => (n || 'U').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const roleColor = { admin: 'text-gold', dispatcher: 'text-blue-400', operator: 'text-success', analyst: 'text-purple-400' };

  return (
    <div className={`
      ${mobile ? 'w-72' : 'w-full'} h-full flex flex-col
      bg-[#080C14] border-r border-white/[0.05]
      ${!mobile ? 'relative' : ''}
    `}>

      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 py-4 border-b border-white/[0.05] flex-shrink-0 ${collapsed && !mobile ? 'justify-center px-3' : ''}`}>
        <div className="relative flex-shrink-0">
          <div className="w-9 h-9 bg-gradient-to-br from-gold to-gold/60 rounded-xl flex items-center justify-center shadow-lg shadow-gold/20">
            <span className="font-display text-navy-950 font-black text-base">F</span>
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-success rounded-full border-2 border-[#080C14]" />
        </div>
        {(!collapsed || mobile) && (
          <div className="min-w-0">
            <p className="font-display text-sm font-black text-gold tracking-[0.2em] leading-none">FLEETOPS</p>
            <div className="flex items-center gap-1.5 mt-1">
              <span className="text-[8px] font-mono text-slate-600 tracking-widest">ENTERPRISE</span>
              <span className="text-[8px] font-mono text-slate-700">·</span>
              <span className="text-[8px] font-mono text-slate-600">v2.1</span>
            </div>
          </div>
        )}
        {mobile && (
          <button onClick={onClose} className="ml-auto p-1.5 text-slate-500 hover:text-white rounded-lg hover:bg-white/5">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-5">
        {NAV.map(section => (
          <div key={section.label}>
            {(!collapsed || mobile) && (
              <p className="text-[8px] font-mono text-slate-700 tracking-[0.2em] px-3 mb-1.5 uppercase">
                {section.label}
              </p>
            )}
            {collapsed && !mobile && <div className="h-px bg-white/[0.04] mx-2 mb-2" />}
            <div className="space-y-0.5">
              {section.items.map(item => (
                <NavItem key={item.to} item={item} collapsed={collapsed && !mobile} onClick={onClose} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* User profile */}
      <div className={`border-t border-white/[0.05] p-3 flex-shrink-0 ${collapsed && !mobile ? 'flex flex-col items-center gap-2' : ''}`}>
        {(!collapsed || mobile) ? (
          <div className="flex items-center gap-3 px-2 py-2.5 rounded-xl bg-white/[0.02] border border-white/[0.04] mb-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gold/30 to-gold/10 border border-gold/20 flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold font-mono text-gold">{initials(user?.name)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-200 truncate leading-none mb-0.5">{user?.name || 'Admin'}</p>
              <span className={`text-[9px] font-mono font-bold uppercase ${roleColor[user?.role] || 'text-slate-500'}`}>
                {user?.role || 'admin'}
              </span>
            </div>
          </div>
        ) : (
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-gold/30 to-gold/10 border border-gold/20 flex items-center justify-center mb-2">
            <span className="text-[10px] font-bold font-mono text-gold">{initials(user?.name)}</span>
          </div>
        )}
        <button
          onClick={() => { logout(); navigate('/login'); toast.success('Signed out'); }}
          className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-xl text-[11px] font-medium
            text-slate-600 hover:text-danger hover:bg-danger/5 border border-transparent
            hover:border-danger/10 transition-all ${collapsed && !mobile ? 'justify-center' : ''}`}
        >
          <LogOut size={13} />
          {(!collapsed || mobile) && 'Sign out'}
        </button>
      </div>

      {/* Collapse toggle — desktop only */}
      {!mobile && (
        <button
          onClick={() => setCollapsed(c => !c)}
          className="absolute -right-3.5 top-1/2 -translate-y-1/2 w-7 h-7 bg-[#0D1321] border border-white/10 rounded-full flex items-center justify-center text-slate-500 hover:text-gold hover:border-gold/30 transition-all z-20 shadow-xl"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      )}
    </div>
  );
}

export default function Layout({ children }) {
  const location = useLocation();
  const { alerts } = useAlertStore?.() || { alerts: [] };
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Page title from path
  const pageTitle = (() => {
    const p = location.pathname;
    if (p === '/') return 'Command Center';
    return p.slice(1).replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  })();

  return (
    <div className="flex h-screen bg-navy-950 overflow-hidden">

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex" onClick={() => setMobileOpen(false)}>
          <div className="relative" onClick={e => e.stopPropagation()}>
            <Sidebar collapsed={false} setCollapsed={() => {}} mobile onClose={() => setMobileOpen(false)} />
          </div>
          <div className="flex-1 bg-black/60 backdrop-blur-sm" />
        </div>
      )}

      {/* Desktop sidebar */}
      <div className={`hidden lg:flex relative flex-shrink-0 transition-all duration-200 ${collapsed ? 'w-[60px]' : 'w-[220px]'}`}>
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} mobile={false} onClose={() => {}} />
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Offline banner */}
        <OfflineBanner />

        {/* Top header */}
        <header className="flex-shrink-0 h-14 flex items-center justify-between px-4 lg:px-6 bg-[#080C14]/90 backdrop-blur-md border-b border-white/[0.05] z-10">

          {/* Left: hamburger + breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setMobileOpen(true)} className="lg:hidden p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors flex-shrink-0">
              <Menu size={16} />
            </button>

            {/* Breadcrumb */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] font-mono text-slate-600 hidden sm:block tracking-widest">FLEETOPS</span>
              <ChevronRight size={10} className="text-slate-700 hidden sm:block flex-shrink-0" />
              <span className="text-[11px] font-mono font-bold text-slate-300 uppercase tracking-widest truncate">
                {pageTitle}
              </span>
            </div>
          </div>

          {/* Center: system status */}
          <div className="hidden md:flex items-center">
            <SystemBadge alerts={alerts} />
          </div>

          {/* Right: search hint + clock + alerts */}
          <div className="flex items-center gap-3">
            {/* Search hint */}
            <button
              className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-white/[0.03] border border-white/[0.06] rounded-xl text-[10px] font-mono text-slate-500 hover:text-slate-300 hover:border-white/10 transition-all"
              onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))}
            >
              <Search size={11} />
              <span>Search…</span>
              <kbd className="text-[9px] bg-white/5 px-1.5 py-0.5 rounded border border-white/10 text-slate-600">⌘K</kbd>
            </button>

            {/* Alert bell */}
            <AlertBell alerts={alerts} />

            {/* Clock */}
            <div className="hidden sm:block border-l border-white/[0.06] pl-3">
              <LiveClock />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="p-4 lg:p-6 min-h-full">
            {children}
          </div>
        </main>
      </div>

      {/* Global overlays */}
      <CommandBar />
      <WarRoom />
    </div>
  );
}

function AlertBell({ alerts }) {
  const { unreadCount } = useAlertStore?.() || {};
  const navigate = useNavigate();
  const critical = alerts?.filter(a => a.severity === 'critical' && !a.resolved_at).length || 0;
  const count = unreadCount || 0;

  return (
    <button
      onClick={() => navigate('/alerts')}
      className="relative p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors"
    >
      <Bell size={16} className={critical > 0 ? 'text-danger' : ''} />
      {count > 0 && (
        <span className={`absolute top-1 right-1 min-w-[16px] h-4 px-0.5 rounded-full text-[8px] font-bold flex items-center justify-center text-white border-2 border-[#080C14] ${critical > 0 ? 'bg-danger' : 'bg-amber-500'}`}>
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  );
}
