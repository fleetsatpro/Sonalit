import { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Truck, Route, MapPin, Bell, BarChart3,
  MessageSquare, Settings, Shield, Cpu, Zap, FileText,
  LogOut, ChevronLeft, ChevronRight, Menu, X, Package,
  Users, DollarSign, Wrench, Activity, Navigation,
  AlertTriangle, TrendingUp
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore, useAlertStore } from '../store';
import CommandBar from './CommandBar';
import WarRoom from './WarRoom';
import OfflineBanner from './OfflineBanner';

const NAV_SECTIONS = [
  {
    label: 'OPERATIONS',
    items: [
      { to: '/',           icon: LayoutDashboard, label: 'Command Center' },
      { to: '/fleet',      icon: Truck,           label: 'Fleet'          },
      { to: '/convoys',    icon: Route,           label: 'Convoys'        },
      { to: '/shipments',  icon: Package,         label: 'Shipments'      },
      { to: '/drivers',    icon: Users,           label: 'Drivers'        },
      { to: '/gps',        icon: MapPin,          label: 'GPS Track'      },
    ]
  },
  {
    label: 'INTELLIGENCE',
    items: [
      { to: '/alerts',     icon: Bell,            label: 'Alerts',      badge: true },
      { to: '/incidents',  icon: AlertTriangle,   label: 'Incidents'    },
      { to: '/analytics',  icon: BarChart3,       label: 'Analytics'    },
      { to: '/reports',    icon: FileText,        label: 'Reports'      },
    ]
  },
  {
    label: 'MANAGEMENT',
    items: [
      { to: '/maintenance',icon: Wrench,          label: 'Maintenance'  },
      { to: '/finance',    icon: DollarSign,      label: 'Finance'      },
      { to: '/devices',    icon: Cpu,             label: 'Devices'      },
      { to: '/rules',      icon: Zap,             label: 'Rules'        },
      { to: '/messages',   icon: MessageSquare,   label: 'Messages'     },
      { to: '/settings',   icon: Settings,        label: 'Settings'     },
    ]
  }
];

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(t); }, []);
  return (
    <div className="text-right">
      <p className="font-display text-sm font-bold text-slate-200 tabular-nums">
        {time.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}
      </p>
      <p className="text-[9px] font-mono text-slate-500">
        {time.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })} · UTC
      </p>
    </div>
  );
}

export default function Layout({ children }) {
  const { user, logout } = useAuthStore();
  const { unreadCount } = useAlertStore?.() || { unreadCount: 0 };
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => { logout(); navigate('/login'); toast.success('Signed out'); };
  const initials = (name) => (name || 'U').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const NavContent = ({ mobile = false }) => (
    <div className={`${mobile ? 'w-64' : 'w-full'} h-full bg-navy-950 border-r border-white/[0.04] flex flex-col`}>
      {/* Logo */}
      <div className={`flex items-center gap-3 px-4 py-4 border-b border-white/[0.04] ${collapsed && !mobile ? 'justify-center px-3' : ''}`}>
        <div className="w-8 h-8 bg-gold rounded-lg flex items-center justify-center flex-shrink-0">
          <span className="font-display text-navy-950 font-black text-sm">F</span>
        </div>
        {(!collapsed || mobile) && (
          <div>
            <p className="font-display text-sm font-bold text-gold tracking-widest">FLEETOPS</p>
            <p className="text-[8px] font-mono text-slate-500 tracking-widest">ENTERPRISE · v2.0</p>
          </div>
        )}
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {NAV_SECTIONS.map(section => (
          <div key={section.label} className="mb-4">
            {(!collapsed || mobile) && (
              <p className="text-[8px] font-mono text-slate-600 tracking-widest px-3 pb-1">{section.label}</p>
            )}
            <div className="space-y-0.5">
              {section.items.map(({ to, icon: Icon, label, badge }) => {
                const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
                const badgeCount = badge ? unreadCount : 0;
                return (
                  <Link key={to} to={to} onClick={() => setMobileOpen(false)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-all
                      ${active ? 'bg-gold/10 border border-gold/20 text-gold' : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.03]'}
                      ${collapsed && !mobile ? 'justify-center' : ''}`}>
                    <div className="relative flex-shrink-0">
                      <Icon size={14} />
                      {badgeCount > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-danger rounded-full text-[7px] font-bold flex items-center justify-center text-white">
                          {badgeCount > 9 ? '9+' : badgeCount}
                        </span>
                      )}
                    </div>
                    {(!collapsed || mobile) && <span className="font-medium truncate">{label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User */}
      <div className={`border-t border-white/[0.04] p-3 ${collapsed && !mobile ? 'flex flex-col items-center' : ''}`}>
        {(!collapsed || mobile) && (
          <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
            <div className="w-7 h-7 rounded-lg bg-gold/20 border border-gold/30 flex items-center justify-center flex-shrink-0">
              <span className="text-[10px] font-bold font-mono text-gold">{initials(user?.name)}</span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-slate-200 truncate">{user?.name}</p>
              <p className="text-[8px] text-slate-500 font-mono uppercase">{user?.role}</p>
            </div>
          </div>
        )}
        <button onClick={handleLogout}
          className={`flex items-center gap-2 w-full text-slate-500 hover:text-danger px-3 py-2 rounded-lg text-xs transition-colors hover:bg-danger/5
            ${collapsed && !mobile ? 'justify-center' : ''}`}>
          <LogOut size={12} />
          {(!collapsed || mobile) && 'Sign out'}
        </button>
      </div>

      {/* Collapse toggle */}
      {!mobile && (
        <button onClick={() => setCollapsed(c => !c)}
          className="absolute -right-3 top-20 w-6 h-6 bg-navy-900 border border-white/10 rounded-full flex items-center justify-center text-slate-500 hover:text-gold transition-colors z-10">
          {collapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
        </button>
      )}
    </div>
  );

  return (
    <div className="flex h-screen bg-navy-950 overflow-hidden">
      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex" onClick={() => setMobileOpen(false)}>
          <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
            <NavContent mobile />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <div className={`hidden lg:flex relative flex-shrink-0 transition-all duration-200 ${collapsed ? 'w-14' : 'w-52'}`}>
        <NavContent />
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <OfflineBanner />
        <header className="flex-shrink-0 flex items-center justify-between px-5 py-3 border-b border-white/[0.04] bg-navy-950/80 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="lg:hidden p-1.5 text-slate-400 hover:text-white"><Menu size={16}/></button>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
              <span className="text-[9px] font-mono text-success font-bold tracking-widest hidden sm:block">SYSTEM NOMINAL · ALL NODES ONLINE</span>
            </div>
          </div>
          <Clock />
        </header>
        <main className="flex-1 overflow-y-auto p-5 lg:p-6">{children}</main>
      </div>

      <CommandBar />
      <WarRoom />
    </div>
  );
}
