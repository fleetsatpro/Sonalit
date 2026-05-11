import { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Truck, Shield, Bell, BarChart3,
  MessageSquare, Settings, LogOut, Menu, X, Zap, Radio,
  Search, ChevronRight,
} from 'lucide-react';
import { useAuthStore, useAlertStore } from '../store';
import socketService from '../services/socket';
import { initials, timeAgo } from '../utils/helpers';

const NAV = [
  { to: '/',          label: 'Dashboard',  Icon: LayoutDashboard },
  { to: '/fleet',     label: 'Fleet',      Icon: Truck           },
  { to: '/convoys',   label: 'Convoys',    Icon: Shield          },
  { to: '/alerts',    label: 'Alerts',     Icon: Bell            },
  { to: '/analytics', label: 'Analytics',  Icon: BarChart3       },
  { to: '/messages',  label: 'Messages',   Icon: MessageSquare   },
  { to: '/gps', label: 'GPS Track', Icon: Navigation },
  { to: '/settings',  label: 'Settings',   Icon: Settings        },
];

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="hidden lg:flex flex-col items-end">
      <span className="font-mono text-sm font-bold text-slate-200 tabular-nums tracking-wider">
        {time.toLocaleTimeString('en-GB', { hour12: false })}
      </span>
      <span className="font-mono text-[10px] text-slate-600 tracking-widest">
        {time.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · UTC
      </span>
    </div>
  );
}

function NotificationPanel({ open, onClose, alerts }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onClose]);
  const severityColor = { critical: 'bg-red-500', high: 'bg-amber-500', medium: 'bg-blue-400', low: 'bg-success' };
  return (
    <div ref={ref} className={`absolute top-full right-0 mt-2 w-80 bg-navy-900 border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden transition-all duration-200 origin-top-right
      ${open ? 'opacity-100 scale-100 pointer-events-auto' : 'opacity-0 scale-95 pointer-events-none'}`}>
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
        <span className="text-xs font-mono font-bold text-slate-300 tracking-wider">NOTIFICATIONS</span>
        <button onClick={onClose} className="text-slate-600 hover:text-slate-400"><X size={13} /></button>
      </div>
      <div className="max-h-72 overflow-y-auto divide-y divide-white/5">
        {alerts.slice(0, 8).map((a, i) => (
          <div key={i} className="px-4 py-3 hover:bg-white/3 transition-colors flex items-start gap-3">
            <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${severityColor[a.severity] || 'bg-slate-500'} ${a.severity === 'critical' ? 'animate-pulse' : ''}`} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-slate-300 leading-snug line-clamp-2">{a.message}</p>
              <p className="text-[10px] font-mono text-slate-600 mt-1">{timeAgo(a.created_at)}</p>
            </div>
          </div>
        ))}
        {alerts.length === 0 && (
          <div className="px-4 py-8 text-center text-slate-600 text-xs font-mono">NO ACTIVE ALERTS</div>
        )}
      </div>
      <div className="px-4 py-2 border-t border-white/5">
        <NavLink to="/alerts" onClick={onClose} className="text-xs text-gold hover:text-gold-light font-mono flex items-center gap-1 justify-center">
          View all alerts <ChevronRight size={11} />
        </NavLink>
      </div>
    </div>
  );
}

function GlobalSearch({ open, onClose }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (open) { setTimeout(() => inputRef.current?.focus(), 50); setQuery(''); }
  }, [open]);
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);
  const quickLinks = [
    { label: 'Dashboard',       to: '/',          hint: 'Overview'  },
    { label: 'Fleet Management',to: '/fleet',      hint: 'Vehicles'  },
    { label: 'Active Convoys',  to: '/convoys',    hint: 'Missions'  },
    { label: 'Alert Center',    to: '/alerts',     hint: 'Incidents' },
    { label: 'Analytics',       to: '/analytics',  hint: 'Reports'   },
  ];
  const filtered = quickLinks.filter(l => l.label.toLowerCase().includes(query.toLowerCase()));
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-24 px-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg bg-navy-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5">
          <Search size={16} className="text-slate-500 flex-shrink-0" />
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search pages, convoys, vehicles..."
            className="flex-1 bg-transparent text-sm text-slate-200 placeholder-slate-600 outline-none" />
          <kbd className="hidden sm:flex items-center px-1.5 py-0.5 bg-navy-800 border border-white/10 rounded text-[10px] text-slate-500 font-mono">ESC</kbd>
        </div>
        <div className="py-2">
          {filtered.length === 0
            ? <p className="px-4 py-6 text-center text-xs text-slate-600 font-mono">NO RESULTS</p>
            : filtered.map(l => (
              <button key={l.to} onClick={() => { navigate(l.to); onClose(); }}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/5 transition-colors text-left">
                <span className="text-sm text-slate-300">{l.label}</span>
                <span className="text-xs text-slate-600 font-mono">{l.hint}</span>
              </button>
            ))
          }
        </div>
      </div>
    </div>
  );
}

function SidebarContent({ collapsed, mobile, onClose, user, unreadCount, onLogout }) {
  return (
    <aside className={`flex flex-col h-full bg-[#0A0F1A] border-r border-white/[0.06] transition-all duration-300 ${mobile ? 'w-64' : collapsed ? 'w-16' : 'w-60'}`}>
      <div className={`flex items-center gap-3 px-4 py-5 border-b border-white/[0.06] flex-shrink-0 ${collapsed && !mobile ? 'justify-center px-2' : ''}`}>
        <div className="relative w-8 h-8 flex-shrink-0">
          <div className="absolute inset-0 bg-gold/20 rounded-lg blur-sm" />
          <div className="relative w-8 h-8 bg-gradient-to-br from-gold to-amber-600 rounded-lg flex items-center justify-center shadow-lg">
            <Zap size={15} className="text-navy-950" />
          </div>
        </div>
        {(!collapsed || mobile) && (
          <div className="flex-1 min-w-0">
            <p className="font-display text-sm font-bold text-gold tracking-[0.15em] leading-none">FleetOps</p>
            <p className="text-[9px] text-slate-600 font-mono tracking-[0.3em] mt-0.5">PRO · TACTICAL</p>
          </div>
        )}
        {mobile && (
          <button onClick={onClose} className="p-1 hover:bg-white/5 rounded text-slate-500 hover:text-slate-300 flex-shrink-0">
            <X size={15} />
          </button>
        )}
      </div>

      {(!collapsed || mobile) && (
        <div className="mx-3 mt-3 mb-1">
          <div className="px-3 py-2 bg-success/5 border border-success/15 rounded-lg flex items-center gap-2">
            <span className="relative flex-shrink-0">
              <span className="absolute inline-flex h-2 w-2 rounded-full bg-success opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
            </span>
            <span className="text-[10px] font-mono text-success tracking-[0.2em]">LIVE · CONNECTED</span>
            <Radio size={10} className="text-success/60 ml-auto" />
          </div>
        </div>
      )}
      {collapsed && !mobile && (
        <div className="flex justify-center mt-3 mb-1">
          <span className="relative">
            <span className="absolute inline-flex h-2 w-2 rounded-full bg-success opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
          </span>
        </div>
      )}

      {(!collapsed || mobile) && (
        <p className="px-5 mt-3 mb-1 text-[9px] font-mono text-slate-700 tracking-[0.25em]">NAVIGATION</p>
      )}

      <nav className="flex-1 px-2 py-1 space-y-0.5 overflow-y-auto">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} end={to === '/'}
            onClick={() => mobile && onClose()}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-lg transition-all duration-150 relative
              ${collapsed && !mobile ? 'justify-center px-0 py-3' : 'px-3 py-2.5'}
              ${isActive ? 'bg-gold/10 text-gold' : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.04]'}`
            }>
            {({ isActive }) => (
              <>
                {isActive && !collapsed && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gold rounded-r-full" />}
                <Icon size={15} className={`flex-shrink-0 transition-colors ${isActive ? 'text-gold' : 'text-slate-600 group-hover:text-slate-400'}`} />
                {(!collapsed || mobile) && <span className={`text-sm font-medium flex-1 ${isActive ? 'text-gold' : ''}`}>{label}</span>}
                {collapsed && !mobile && (
                  <span className="absolute left-full ml-3 bg-navy-800 border border-white/10 text-slate-200 text-xs font-mono px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-50">
                    {label}
                  </span>
                )}
                {label === 'Alerts' && unreadCount > 0 && (
                  (!collapsed || mobile)
                    ? <span className="ml-auto bg-danger text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center font-mono">{unreadCount > 99 ? '99+' : unreadCount}</span>
                    : <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-danger animate-pulse" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className={`border-t border-white/[0.06] p-3 flex-shrink-0 ${collapsed && !mobile ? 'flex justify-center' : ''}`}>
        {(!collapsed || mobile) ? (
          <div className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/[0.04] transition-colors group">
            <div className="w-8 h-8 rounded-lg bg-gold/15 border border-gold/25 flex items-center justify-center flex-shrink-0">
              <span className="text-gold text-xs font-bold font-mono">{initials(user?.name)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-300 truncate leading-tight">{user?.name}</p>
              <p className="text-[9px] text-slate-600 font-mono uppercase tracking-wider">{user?.role}</p>
            </div>
            <button onClick={onLogout} className="p-1.5 rounded-md hover:bg-danger/10 text-slate-600 hover:text-danger transition-colors opacity-0 group-hover:opacity-100">
              <LogOut size={13} />
            </button>
          </div>
        ) : (
          <button onClick={onLogout} className="p-2 rounded-lg hover:bg-danger/10 text-slate-600 hover:text-danger transition-colors">
            <LogOut size={14} />
          </button>
        )}
      </div>
    </aside>
  );
}

export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const { user, logout } = useAuthStore();
  const { alerts, unreadCount, addLiveAlert } = useAlertStore();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const socket = socketService.connect();
    if (!socket) return;
    socketService.onAlertNew((alert) => addLiveAlert(alert));
    return () => socketService.disconnect();
  }, []);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  useEffect(() => {
    const handler = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); } };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleLogout = () => { logout(); navigate('/login'); };
  const pageTitle = NAV.find(n => n.to === location.pathname || (n.to !== '/' && location.pathname.startsWith(n.to)))?.label || 'Dashboard';

  return (
    <div className="flex h-screen overflow-hidden bg-[#060B14]">
      <div className={`hidden lg:flex flex-shrink-0 transition-all duration-300 ${collapsed ? 'w-16' : 'w-60'}`}>
        <SidebarContent collapsed={collapsed} user={user} unreadCount={unreadCount} onLogout={handleLogout} />
      </div>

      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 lg:hidden">
            <SidebarContent mobile user={user} unreadCount={unreadCount} onClose={() => setMobileOpen(false)} onLogout={handleLogout} />
          </div>
        </>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="bg-[#0A0F1A]/90 backdrop-blur-md border-b border-white/[0.06] px-4 lg:px-5 py-3 flex items-center gap-3 flex-shrink-0 z-30">
          <button onClick={() => setMobileOpen(true)} className="lg:hidden p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-slate-300 transition-colors">
            <Menu size={18} />
          </button>
          <button onClick={() => setCollapsed(!collapsed)} className="hidden lg:flex p-1.5 rounded-lg hover:bg-white/5 text-slate-600 hover:text-slate-400 transition-colors">
            <Menu size={15} />
          </button>
          <div className="hidden lg:flex items-center gap-2 text-xs font-mono">
            <span className="text-slate-600">FLEETOPS</span>
            <ChevronRight size={12} className="text-slate-700" />
            <span className="text-slate-400 uppercase tracking-wider">{pageTitle}</span>
          </div>
          <div className="flex-1" />
          <button onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 bg-navy-800/60 border border-white/[0.08] rounded-lg px-3 py-1.5 text-slate-500 hover:text-slate-300 hover:border-white/15 transition-all text-xs font-mono">
            <Search size={13} />
            <span className="hidden sm:inline">Search...</span>
            <span className="hidden sm:flex items-center gap-0.5 ml-2 opacity-50">
              <kbd className="bg-navy-700 px-1 rounded text-[10px]">⌘</kbd>
              <kbd className="bg-navy-700 px-1 rounded text-[10px]">K</kbd>
            </span>
          </button>
          <Clock />
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 bg-success/5 border border-success/15 rounded-lg">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            <span className="text-[10px] font-mono text-success/80 tracking-wider">NOMINAL</span>
          </div>
          <div className="relative">
            <button onClick={() => setNotifOpen(!notifOpen)}
              className={`relative p-2 rounded-lg border transition-all duration-150 ${notifOpen ? 'bg-gold/10 border-gold/30 text-gold' : 'border-white/[0.08] hover:border-white/15 text-slate-500 hover:text-slate-300'}`}>
              <Bell size={15} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-danger rounded-full flex items-center justify-center text-[9px] font-bold text-white font-mono">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <NotificationPanel open={notifOpen} onClose={() => setNotifOpen(false)} alerts={alerts} />
          </div>
          <div className="w-7 h-7 rounded-lg bg-gold/15 border border-gold/25 flex items-center justify-center cursor-pointer hover:bg-gold/20 transition-colors"
               onClick={handleLogout} title="Logout">
            <span className="text-gold text-[10px] font-bold font-mono">{initials(user?.name)}</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="p-4 lg:p-6 min-h-full">{children}</div>
        </main>
      </div>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
