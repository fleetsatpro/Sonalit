// Sidebar Navigation

import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Ship,
  Container,
  Users,
  Truck,
  User,
  Car,
  Lock,
  MapPin,
  Map,
  AlertTriangle,
  Bell,
  FileText,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Box,
} from 'lucide-react';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Shipments', href: '/shipments', icon: Ship },
  { name: 'Containers', href: '/containers', icon: Container },
  { name: 'Customers', href: '/customers', icon: Users },
  { name: 'Transporters', href: '/transporters', icon: Truck },
  { name: 'Drivers', href: '/drivers', icon: User },
  { name: 'Vehicles', href: '/vehicles', icon: Car },
  { name: 'Electronic Locks', href: '/locks', icon: Lock },
  { name: 'GPS Tracking', href: '/tracking', icon: MapPin },
  { name: 'Geofences', href: '/geofences', icon: Map },
  { name: 'Incidents', href: '/incidents', icon: AlertTriangle },
  { name: 'Alerts', href: '/alerts', icon: Bell },
  { name: 'Reports', href: '/reports', icon: FileText },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation();

  return (
    <aside
      className={`fixed top-0 left-0 z-40 h-screen bg-slate-900 text-white transition-all duration-300 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      <div className="flex flex-col h-full">
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-slate-700">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <Box className="w-8 h-8 text-blue-400" />
              <span className="font-bold text-lg">CDS</span>
            </div>
          )}
          {collapsed && <Box className="w-8 h-8 text-blue-400 mx-auto" />}
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 overflow-y-auto">
          <ul className="space-y-1 px-2">
            {navigation.map((item) => {
              const isActive = location.pathname === item.href || 
                (item.href !== '/dashboard' && location.pathname.startsWith(item.href));
              
              return (
                <li key={item.name}>
                  <NavLink
                    to={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <item.icon className="w-5 h-5 flex-shrink-0" />
                    {!collapsed && <span className="text-sm font-medium">{item.name}</span>}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Collapse Toggle */}
        <div className="p-4 border-t border-slate-700">
          <button
            onClick={onToggle}
            className="flex items-center justify-center w-full p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
