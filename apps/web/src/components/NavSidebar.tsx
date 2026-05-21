import { Link } from '@tanstack/react-router';
import { useUIStore } from '../stores/ui.js';
import {
  LayoutDashboard, Truck, MapPin, Users, Route, Bell, AlertTriangle,
  MessageSquare, BarChart2, FileText, Package, DollarSign, Wrench,
  Map, Shield, BookOpen, Settings, Cpu, Wifi, Bot, ChevronLeft,
  ChevronRight, Siren,
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/fleet', label: 'Fleet', icon: Truck },
  { to: '/gps', label: 'GPS Live', icon: MapPin },
  { to: '/drivers', label: 'Drivers', icon: Users },
  { to: '/convoys', label: 'Convoys', icon: Route },
  { to: '/alerts', label: 'Alerts', icon: Bell },
  { to: '/incidents', label: 'Incidents', icon: AlertTriangle },
  { to: '/panic-center', label: 'Panic Center', icon: Siren },
  { to: '/messages', label: 'Messages', icon: MessageSquare },
  { to: '/analytics', label: 'Analytics', icon: BarChart2 },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/shipments', label: 'Shipments', icon: Package },
  { to: '/finance', label: 'Finance', icon: DollarSign },
  { to: '/maintenance', label: 'Maintenance', icon: Wrench },
  { to: '/geofences', label: 'Geofences', icon: Map },
  { to: '/risk-intel', label: 'Risk Intel', icon: Shield },
  { to: '/rules', label: 'Rules', icon: BookOpen },
  { to: '/field-officers', label: 'Field Officers', icon: Users },
  { to: '/executive', label: 'Executive', icon: BarChart2 },
  { to: '/devices', label: 'Devices', icon: Cpu },
  { to: '/guardian', label: 'Guardian', icon: Wifi },
  { to: '/ai', label: 'AI Decision', icon: Bot },
  { to: '/copilot', label: 'Copilot', icon: Bot },
  { to: '/settings', label: 'Settings', icon: Settings },
] as const;

export default function NavSidebar() {
  const { sidebarOpen, toggleSidebar } = useUIStore();
  return (
    <>
      {/* Mobile backdrop — tap to close */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 md:hidden"
          onClick={toggleSidebar}
          aria-hidden="true"
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 h-full bg-slate-900 border-r border-slate-800
          flex flex-col z-30 transition-all duration-200
          ${sidebarOpen ? 'w-64 translate-x-0' : '-translate-x-full md:translate-x-0 md:w-16'}
        `}
      >
        <div className="flex items-center justify-between h-14 px-4 border-b border-slate-800 shrink-0">
          {sidebarOpen && <span className="font-bold text-lg text-blue-400">Sonalit</span>}
          <button
            onClick={toggleSidebar}
            className="p-1.5 rounded hover:bg-slate-800 ml-auto text-slate-400 hover:text-white"
            aria-label="Toggle sidebar"
          >
            {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={() => { if (window.innerWidth < 768) toggleSidebar(); }}
              className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors [&.active]:text-blue-400 [&.active]:bg-slate-800/80"
              aria-label={label}
            >
              <Icon size={18} className="shrink-0" />
              {sidebarOpen && <span className="truncate">{label}</span>}
            </Link>
          ))}
        </nav>
      </aside>
    </>
  );
}
