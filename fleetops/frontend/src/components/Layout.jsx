import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Truck, Shield, Bell, BarChart3,
  MessageSquare, Settings, LogOut, Menu, X, Zap, Radio,
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
  { to: '/settings',  label: 'Settings',   Icon: Settings        },
];

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(id); }, []);
  return (
    <span className="font-mono text-xs text-slate-500 tabular-nums">
      {time.toLocaleTimeString('en-GB', { hour12: false })} UTC
    </span>
  );
}

export default function Layout({ children }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, logout } = useAuthStore();
  const { unreadCount, addLiveAlert } = useAlertStore();
  const navigate = useNavigate();

  // Wire Socket.IO
  useEffect(() => {
    const socket = socketService.connect();
    if (!socket) return;
    socketService.onAlertNew((alert) => addLiveAlert(alert));
    return () => socketService.disconnect();
  }, []);

  const handleLogout = () => { logout(); navigate('/login'); };

  const Sidebar = ({ mobile }) => (
    <aside className={`
      flex flex-col bg-navy-900 border-r border-white/5
      ${mobile ? 'fixed inset-y-0 left-0 z-50 w-64' : `${collapsed ? 'w-16' : 'w-60'} hidden lg:flex`}
      transition-all duration-300
    `}>
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 py-5 border-b border-white/5 ${collapsed && !mobile ? 'justify-center' : ''}`}>
        <div className="w-8 h-8 bg-gold rounded-lg flex items-center justify-center flex-shrink-0">
          <Zap size={16} className="text-navy-950" />
        </div>
        {(!collapsed || mobile) && (
          <div>
            <p className="font-display text-sm font-bold text-gold tracking-wider">FleetOps</p>
            <p className="text-[10px] text-slate-500 font-mono tracking-widest">PRO</p>
          </div>
        )}
        {!mobile && (
          <button onClick={() => setCollapsed(!collapsed)} className="ml-auto p-1 hover:bg-white/5 rounded text-slate-500 hover:text-slate-300">
            <Menu size={14} />
          </button>
        )}
        {mobile && (
          <button onClick={() => setMobileOpen(false)} className="ml-auto p-1 hover:bg-white/5 rounded text-slate-500">
            <X size={16} />
          </button>
        )}
      </div>

      {/* Live indicator */}
      {(!collapsed || mobile) && (
        <div className="mx-3 mt-3 mb-1 px-3 py-2 bg-success/5 border border-success/20 rounded-lg flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse-slow" />
          <span className="text-[11px] font-mono text-success tracking-wider">LIVE</span>
          <Radio size={11} className="text-success ml-auto" />
        </div>
      )}

      {/* Nav links */}
      <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink
            key={to} to={to} end={to === '/'}
            onClick={() => setMobileOpen(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all duration-150 group relative
              ${isActive
                ? 'bg-gold/10 text-gold border border-gold/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }
              ${collapsed && !mobile ? 'justify-center' : ''}`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={16} className={isActive ? 'text-gold' : 'text-slate-500 group-hover:text-slate-300'} />
                {(!collapsed || mobile) && <span>{label}</span>}
                {label === 'Alerts' && unreadCount > 0 && (!collapsed || mobile) && (
                  <span className="ml-auto bg-danger text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
                {label === 'Alerts' && unreadCount > 0 && collapsed && !mobile && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-danger" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      <div className={`border-t border-white/5 p-3 ${collapsed && !mobile ? 'flex justify-center' : ''}`}>
        {(!collapsed || mobile) ? (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gold/20 border border-gold/30 flex items-center justify-center flex-shrink-0">
              <span className="text-gold text-xs font-bold font-mono">{initials(user?.name)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-200 truncate">{user?.name}</p>
              <p className="text-[10px] text-slate-500 font-mono uppercase tracking-wider">{user?.role}</p>
            </div>
            <button onClick={handleLogout} title="Logout" className="p-1.5 rounded hover:bg-danger/10 text-slate-500 hover:text-danger transition-colors">
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <button onClick={handleLogout} title="Logout" className="p-2 rounded hover:bg-danger/10 text-slate-500 hover:text-danger transition-colors">
            <LogOut size={14} />
          </button>
        )}
      </div>
    </aside>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-navy-950">
      <Sidebar />

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}
      {mobileOpen && <Sidebar mobile />}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="bg-navy-900/80 backdrop-blur-sm border-b border-white/5 px-4 lg:px-6 py-3 flex items-center gap-4 flex-shrink-0">
          <button onClick={() => setMobileOpen(true)} className="lg:hidden p-1.5 rounded hover:bg-white/5 text-slate-400">
            <Menu size={18} />
          </button>
          <div className="flex-1" />
          <Clock />
          <div className="flex items-center gap-2 text-xs font-mono text-slate-600">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            <span>SYS NOMINAL</span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
