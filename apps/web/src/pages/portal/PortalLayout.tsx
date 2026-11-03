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
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Client Workspace</p>
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

          <p className="px-3 pt-6 pb-2 text-[10px] uppercase tracking-[0.18em] text-white/25">Client workspace</p>
          <div className="space-y-2">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.018] p-3">
              <div className="flex items-center gap-2 text-xs text-white/60"><Truck size={14} className="text-orange-400"/><span>Deep shipment views</span></div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-white/25">Tracking, manifest, security, custody, sensors, replay, documents and POD are opened from the selected shipment.</p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.018] p-3">
              <div className="flex items-center gap-2 text-xs text-white/60"><ShieldCheck size={14} className="text-emerald-400"/><span>Security boundary active</span></div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-white/25">Only sanitised client intelligence is exposed. Internal tactical data remains isolated.</p>
            </div>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.018] p-3">
              <div className="flex items-center gap-2 text-xs text-white/60"><FileText size={14} className="text-sky-400"/><span>Evidence chain</span></div>
              <p className="mt-1.5 text-[10px] leading-relaxed text-white/25">Delivery evidence, custody events and shipment documents remain tied to the authorised client record.</p>
            </div>
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
              <p className="text-[10px] uppercase tracking-[0.16em] text-white/30">Client Workspace</p>
            </div>
            <div className="space-y-1">
              {NAV.map(item => {
                const active = item.path === '/portal/dashboard' ? pathname === item.path : pathname.startsWith(item.path);
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
        <Outlet />
      </div>

      <button
        aria-label="Open client navigation"
        onClick={() => setMobileOpen(true)}
        className="fixed bottom-4 left-4 z-40 lg:hidden h-11 w-11 rounded-full border border-orange-500/25 bg-[#0b1221]/95 text-orange-300 shadow-xl backdrop-blur-md"
      >
        <Menu size={17} className="mx-auto" />
      </button>
    </div>
  );
}
