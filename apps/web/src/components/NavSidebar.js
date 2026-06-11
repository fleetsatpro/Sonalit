import { Link } from '@tanstack/react-router';
import { useUIStore } from '../stores/ui.js';
import { LayoutDashboard, Truck, MapPin, Users, Route, Bell, AlertTriangle, MessageSquare, BarChart2, FileText, FileBarChart, Package, DollarSign, Wrench, Map, Shield, BookOpen, Settings, Cpu, Wifi, Bot, ChevronLeft, ChevronRight, Siren, Fuel, Calendar, ClipboardList, } from 'lucide-react';
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
    { to: '/convoy-reports', label: 'Convoy Reports', icon: FileBarChart },
    { to: '/shipments', label: 'Shipments', icon: Package },
    { to: '/finance', label: 'Finance', icon: DollarSign },
    { to: '/maintenance', label: 'Maintenance', icon: Wrench },
    { to: '/fuel', label: 'Fuel', icon: Fuel },
    { to: '/claims', label: 'Claims', icon: ClipboardList },
    { to: '/shifts', label: 'Shifts', icon: Calendar },
    { to: '/geofences', label: 'Geofences', icon: Map },
    { to: '/risk-intel', label: 'Risk Intel', icon: Shield },
    { to: '/route-analysis', label: 'Route Safety', icon: Route },
    { to: '/cargo-portal', label: 'Cargo Portal', icon: Package },
    { to: '/rules', label: 'Rules', icon: BookOpen },
    { to: '/field-officers', label: 'Field Officers', icon: Users },
    { to: '/executive', label: 'Executive', icon: BarChart2 },
    { to: '/devices', label: 'Devices', icon: Cpu },
    { to: '/guardian', label: 'Guardian', icon: Wifi },
    { to: '/ai', label: 'AI Decision', icon: Bot },
    { to: '/copilot', label: 'Copilot', icon: Bot },
    { to: '/settings', label: 'Settings', icon: Settings },
];
export default function NavSidebar() {
    const { sidebarOpen, toggleSidebar } = useUIStore();
    return (<>
      {sidebarOpen && (<div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-20 md:hidden" onClick={toggleSidebar} aria-hidden="true"/>)}

      <aside className={`
          fixed top-0 left-0 h-full flex flex-col z-30 transition-all duration-200
          border-r border-white/[0.06]
          ${sidebarOpen ? 'w-64 translate-x-0' : '-translate-x-full md:translate-x-0 md:w-16'}
        `} style={{ background: 'rgba(5,8,19,0.94)', backdropFilter: 'blur(24px)' }}>
        {/* Brand */}
        <div className="flex items-center justify-between h-14 px-4 border-b border-white/[0.06] shrink-0">
          {sidebarOpen && (<span className="font-black text-xl tracking-wider uppercase select-none" style={{
                fontFamily: "'Barlow Condensed', 'Arial Narrow', sans-serif",
                background: 'linear-gradient(90deg, #ff9040, #f07020)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
            }}>
              SONALIT
            </span>)}
          <button onClick={toggleSidebar} className="p-1.5 rounded transition-colors ml-auto text-gray-600 hover:text-orange-400" aria-label="Toggle sidebar">
            {sidebarOpen ? <ChevronLeft size={18}/> : <ChevronRight size={18}/>}
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto py-2 scrollbar-thin">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (<Link key={to} to={to} onClick={() => { if (window.innerWidth < 768)
            toggleSidebar(); }} className="flex items-center gap-3 px-4 py-2.5 text-sm text-gray-500 hover:text-orange-300 transition-colors [&.active]:text-orange-400 [&.active]:border-l-2 [&.active]:border-orange-500/60 [&.active]:bg-orange-500/[0.06] [&.active]:pl-[14px]" aria-label={label}>
              <Icon size={18} className="shrink-0"/>
              {sidebarOpen && <span className="truncate">{label}</span>}
            </Link>))}
        </nav>

        {/* Bottom accent line */}
        <div className="h-px mx-3 mb-3 rounded-full" style={{ background: 'linear-gradient(90deg, transparent, rgba(240,112,32,0.5), transparent)' }}/>
      </aside>
    </>);
}
