import React, { useState } from 'react';
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { Bell, FileText, Gauge, LogOut, Menu, PackageSearch, ShieldCheck, Truck, X } from 'lucide-react';

const NAV = [
  { label: 'Overview', icon: Gauge, path: '/portal/dashboard' },
  { label: 'Notifications', icon: Bell, path: '/portal/notifications' },
];

export default function PortalLayout(): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = location.pathname;
  const isAuth = pathname === '/portal/login' || pathname === '/portal/verify';

  if (isAuth) return <Outlet />;

  const go = (path: string) => {
    setMobileOpen(false);
    void navigate({ to: path as never });
  };

  return (
    <div className="min-h-[100dvh] bg-[var(--p-bg)] text-white">
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-50 w-[244px] flex-col border-r border-white/[0.07]"
        style={{ background: 'linear-gradient(180deg,#0b1221 0%,#070b16 100%)' }}>
        <div className="px-5 py-5 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl border border-orange-500/25 bg-orange-500/10 flex items-center justify-center">
              <PackageSearch size={18} className="text-orange-400" />
            </div>
            <div>
              <p className="font-black tracking-[0.22em] text-sm text-orange-400">SONALIT</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Cargo Owner Workspace</p>
            </div>
          </div>
        </div>

        <div className="px-3 py-4">
          <p className="px-3 pb-2 text-[10px] uppercase tracking-[0.18em] text-white/25">Workspace</p>
          <div className="space-y-1">
            {NAV.map(item => {
              const active = item.path === '/portal/dashboard' ? pathname === item.path : pathname.startsWith(item.path);
              const Icon = item.icon;
              return (
                <button key={item.path} onClick={() => go(item.path)}
                  className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ${active ? 'bg-orange-500/12 text-orange-300 border border-orange-500/20' : 'text-white/45 hover:text-white/80 hover:bg-white/[0.035] border border-transparent'}`}>
                  <Icon size={16} /><span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <p className="px-3 pt-6 pb-2 text-[10px] uppercase tracking-[0.18em] text-white/25">Shipment tools</p>
          <div className="space-y-1">
            <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/32"><Truck size={16} /><span>Shipment tracking</span></div>
            <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/32"><ShieldCheck size={16} /><span>Security & custody</span></div>
            <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/32"><FileText size={16} /><span>Documents & POD</span></div>
            <p className="px-3 pt-1 text-[10px] leading-relaxed text-white/20">Open these from a shipment to preserve access scoping.</p>
          </div>
        </div>

        <div className="mt-auto p-4 border-t border-white/[0.06]">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-white/25 mb-1">Data boundary</p>
            <p className="text-xs text-white/45 leading-relaxed">Only your linked shipments, cargo records and sanitised operational intelligence are visible here.</p>
          </div>
          <button onClick={() => fetch('/api/v1/portal/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => void navigate({ to: '/portal/login' }))}
            className="mt-3 w-full flex items-center gap-2 px-3 py-2 text-xs text-white/35 hover:text-white/70 transition-colors">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-black/65" onClick={() => setMobileOpen(false)} />
          <aside className="relative h-full w-[290px] border-r border-white/[0.07] p-4" style={{ background: '#0a1120' }}>
            <button className="absolute top-4 right-4 p-2 text-white/40" onClick={() => setMobileOpen(false)}><X size={18}/></button>
            <div className="px-2 py-3 mb-5">
              <p className="font-black tracking-[0.22em] text-orange-400">SONALIT</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Cargo Owner Workspace</p>
            </div>
            <div className="space-y-1">
              {NAV.map(item => {
                const active = pathname === item.path;
                const Icon = item.icon;
                return (
                  <button key={item.path} onClick={() => go(item.path)}
                    className={`w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm ${active ? 'bg-orange-500/12 text-orange-300' : 'text-white/50 hover:bg-white/[0.04]'}`}>
                    <Icon size={16}/><span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </aside>
        </div>
      )}

      <div className="lg:pl-[244px]">
        <div className="lg:hidden sticky top-0 z-40 flex items-center justify-between border-b border-white/[0.06] px-4 py-3"
          style={{ background: 'rgba(7,11,22,0.95)', backdropFilter: 'blur(16px)' }}>
          <button onClick={() => setMobileOpen(true)} className="p-2 text-white/50"><Menu size={18}/></button>
          <div className="text-center">
            <p className="font-black tracking-[0.2em] text-xs text-orange-400">SONALIT</p>
            <p className="text-[9px] uppercase tracking-[0.16em] text-white/25">Cargo Owner</p>
          </div>
          <button onClick={() => void navigate({ to: '/portal/notifications' })} className="p-2 text-white/50"><Bell size={17}/></button>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
