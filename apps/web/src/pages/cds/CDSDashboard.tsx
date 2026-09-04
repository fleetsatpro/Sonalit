import { useNavigate } from '@tanstack/react-router';
import {
  Search, Bell, ChevronLeft, PanelLeftClose,
  PanelLeft, Plus,
} from 'lucide-react';
import { useState, useEffect } from 'react';

import { useAuthStore } from '../../stores/auth.js';

import { ContainersView, BookingsView, DriversView, TransportersView } from './CDSDataPage.js';
import { CDSIntro } from './CDSIntro.js';
import { KPICard, CDSDrawer, CDSToastContainer } from './components.js';
import { CDS_VIEWS } from './constants.js';
import { useDashboardKPIs, useActivity, useLiveTracking, useTrips } from './hooks.js';
import {
  LocksView, PortView, PulseView, InboxView,
  BillingView, ReportsView, AnalyticsView, SettingsView,
} from './pages.js';
import { useCDSStore, type CDSView } from './store.js';
import { useCDSRealtime } from './useCDSRealtime.js';

function NavIcon({ d, from, to, id }: { d: string; from: string; to: string; id: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
      <defs>
        <linearGradient id={id} x1="4" y1="2" x2="20" y2="22" gradientUnits="userSpaceOnUse">
          <stop stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <filter id={`${id}-g`}>
          <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor={from} floodOpacity=".35" />
        </filter>
      </defs>
      <path d={d} fill={`url(#${id})`} filter={`url(#${id}-g)`} />
    </svg>
  );
}

const VIEW_ICON_DATA: Record<string, { d: string; from: string; to: string }> = {
  dashboard: {
    d: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3a1 1 0 0 1 .94.66l1.5 4.5a1 1 0 0 1-.24 1.04l-1.5 1.5a1 1 0 0 1-1.4 0l-1.5-1.5a1 1 0 0 1-.24-1.04l1.5-4.5A1 1 0 0 1 12 5Zm-5 6h2a1 1 0 0 1 0 2H7a1 1 0 0 1 0-2Zm8 0h2a1 1 0 0 1 0 2h-2a1 1 0 0 1 0-2Zm-3 4a1 1 0 0 1 1 1v2a1 1 0 0 1-2 0v-2a1 1 0 0 1 1-1Z',
    from: '#F0B429', to: '#FF8C00',
  },
  live: {
    d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm0 4c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6 2.69-6 6-6Zm0 3c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3Zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z',
    from: '#22D3EE', to: '#0284C7',
  },
  containers: {
    d: 'M20 7H4c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2ZM8 15H6v-6h2v6Zm4 0h-2v-6h2v6Zm4 0h-2v-6h2v6Zm4 0h-2v-6h2v6ZM21 4H3a1 1 0 0 0 0 2h18a1 1 0 0 0 0-2ZM21 18H3a1 1 0 0 0 0 2h18a1 1 0 0 0 0-2Z',
    from: '#FB923C', to: '#EA580C',
  },
  drivers: {
    d: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4Zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4Z',
    from: '#38BDF8', to: '#0369A1',
  },
  transporters: {
    d: 'M20 8h-3V4H3c-1.1 0-2 .9-2 2v11h2c0 1.66 1.34 3 3 3s3-1.34 3-3h6c0 1.66 1.34 3 3 3s3-1.34 3-3h2v-5l-3-4ZM6 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5Zm13.5-9 1.96 2.5H17V9.5h2.5ZM18 18.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5Z',
    from: '#C084FC', to: '#7E22CE',
  },
  bookings: {
    d: 'M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm-3 16H8v-2h6v2Zm2-4H8v-2h8v2Zm0-4H8V8h8v2Zm-2-5a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z',
    from: '#A78BFA', to: '#7C3AED',
  },
  locks: {
    d: 'M12 1a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V6a5 5 0 0 0-5-5Zm3 8H9V6a3 3 0 1 1 6 0v3Zm-3 4a2 2 0 0 1 1 3.73V18a1 1 0 0 1-2 0v-1.27A2 2 0 0 1 12 13Z',
    from: '#34D399', to: '#059669',
  },
  port: {
    d: 'M4 18l1-5h14l1 5H4ZM6.5 5A1.5 1.5 0 0 1 8 3.5h8A1.5 1.5 0 0 1 17.5 5v2H20a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h2.5V5ZM9 7h6V5.5H9V7Zm-5 13h16a1 1 0 0 1 0 2H4a1 1 0 0 1 0-2Z',
    from: '#60A5FA', to: '#2563EB',
  },
  pulse: {
    d: 'M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm6.36-3.36a1 1 0 0 0-1.41 1.41 5.66 5.66 0 0 1 0 7.9 1 1 0 0 0 1.41 1.41 7.66 7.66 0 0 0 0-10.72ZM7.05 8.05a1 1 0 0 0-1.41-1.41 7.66 7.66 0 0 0 0 10.72 1 1 0 0 0 1.41-1.41 5.66 5.66 0 0 1 0-7.9ZM20.49 4.51a1 1 0 0 0-1.41 1.41 9.36 9.36 0 0 1 0 12.16 1 1 0 0 0 1.41 1.41 11.36 11.36 0 0 0 0-14.98ZM4.92 5.92a1 1 0 0 0-1.41-1.41 11.36 11.36 0 0 0 0 14.98 1 1 0 0 0 1.41-1.41 9.36 9.36 0 0 1 0-12.16Z',
    from: '#F472B6', to: '#DB2777',
  },
  inbox: {
    d: 'M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 4-7.12 4.45a2 2 0 0 1-1.76 0L4 8V6l8 5 8-5v2ZM4 18V10l6.94 4.34a3.5 3.5 0 0 0 2.12 0L20 10v8H4Z',
    from: '#818CF8', to: '#4F46E5',
  },
  billing: {
    d: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6ZM12 4c1.85 0 3.55.63 4.9 1.69L12 10l-4.9-4.31A7.96 7.96 0 0 1 12 4Zm-6.31 3.1L10 11.5l-4.31 4.4A7.96 7.96 0 0 1 4 12c0-1.85.63-3.55 1.69-4.9Zm2.41 10.21L12 13l4.9 4.31A7.96 7.96 0 0 1 12 20c-1.85 0-3.55-.63-4.9-1.69Zm10.21-2.41L14 11.5l4.31-4.4A7.96 7.96 0 0 1 20 12c0 1.85-.63 3.55-1.69 4.9Z',
    from: '#4ADE80', to: '#16A34A',
  },
  reports: {
    d: 'M5 21a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5ZM7 7v2h4V7H7Zm0 4v2h10v-2H7Zm0 4v2h10v-2H7Zm8-8v2h2V7h-2Z',
    from: '#FBBF24', to: '#D97706',
  },
  analytics: {
    d: 'M4 20h16a1 1 0 0 1 0 2H4a1 1 0 0 1 0-2ZM6 17a1 1 0 0 1-1-1v-4a1 1 0 0 1 2 0v4a1 1 0 0 1-1 1Zm4 0a1 1 0 0 1-1-1V8a1 1 0 0 1 2 0v8a1 1 0 0 1-1 1Zm4 0a1 1 0 0 1-1-1v-5a1 1 0 0 1 2 0v5a1 1 0 0 1-1 1Zm4 0a1 1 0 0 1-1-1V4a1 1 0 0 1 2 0v12a1 1 0 0 1-1 1Z',
    from: '#F97316', to: '#C2410C',
  },
  settings: {
    d: 'M19.14 12.94a7.12 7.12 0 0 0 .06-.94c0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96a7.04 7.04 0 0 0-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84a.48.48 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.48.48 0 0 0 .12.61l2.03 1.58a7.6 7.6 0 0 0 0 1.88l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.26.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58ZM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2Z',
    from: '#94A3B8', to: '#64748B',
  },
};

const NAV_SECTIONS: { label: string; ids: string[] }[] = [
  { label: 'Overview', ids: ['dashboard', 'live'] },
  { label: 'Operations', ids: ['containers', 'bookings', 'locks'] },
  { label: 'Fleet', ids: ['drivers', 'transporters'] },
  { label: 'Workflow', ids: ['port', 'pulse', 'inbox'] },
  { label: 'Business', ids: ['billing', 'reports', 'analytics'] },
  { label: 'System', ids: ['settings'] },
];

export default function CDSApp() {
  const { activeView, setActiveView, addToast } = useCDSStore();
  const nav = useNavigate();
  // Mounted once for the whole control room rather than per view, so a
  // controller who leaves Trips open all shift sees the yard's clamps land
  // live — and so switching views doesn't churn the subscription.
  const orgId = useAuthStore(s => s.user?.org_id);
  useCDSRealtime(orgId, {
    onEvent: (e) => {
      // Only surface what a controller would want interrupting them. Routine
      // traffic still refreshes the boards silently — a toast per clamp on a
      // busy gate would be noise they learn to ignore, which is worse than
      // nothing when a real one arrives.
      if (e.type === 'cds.container.unclamped' && e.tamper) {
        addToast(`SEAL MISMATCH — ${e.container_number ?? 'container'} reported by ${e.actor ?? 'port team'}`);
      }
    },
  });
  const [clock, setClock] = useState('');
  const [expanded, setExpanded] = useState(() => {
    try { return localStorage.getItem('cds-rail') !== '0'; } catch { return true; }
  });
  // Once per session, not once per navigation.
  const [showIntro, setShowIntro] = useState(() => {
    try { return !sessionStorage.getItem('cds-intro-seen'); } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('cds-rail', expanded ? '1' : '0'); } catch { /* */ }
  }, [expanded]);

  useEffect(() => {
    const tick = () => setClock(`${new Date().toLocaleTimeString('en-GB', { hour12: false })  } EAT`);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const endIntro = () => {
    try { sessionStorage.setItem('cds-intro-seen', '1'); } catch { /* */ }
    setShowIntro(false);
  };
  const currentView = CDS_VIEWS.find(v => v.id === activeView);
  const railW = expanded ? 210 : 64;

  return (
    <div className="flex h-dvh bg-[#0c0e12] text-white overflow-hidden">
      {showIntro && <CDSIntro onDone={endIntro} />}
      {/* ── sidebar ── */}
      <nav
        className="flex flex-col flex-shrink-0 bg-[#08090d] border-r border-white/[.06] overflow-y-auto overflow-x-hidden"
        style={{ width: railW, transition: 'width .2s ease', scrollbarWidth: 'none' }}
      >
        {/* brand */}
        <div className="flex items-center gap-2.5 border-b border-white/[.06] flex-shrink-0"
          style={{ padding: expanded ? '14px 14px 12px' : '14px 0 12px', justifyContent: expanded ? 'flex-start' : 'center' }}
        >
          <button
            onClick={() => nav({ to: '/home' })}
            className="flex items-center justify-center flex-shrink-0 rounded-lg text-[#0c0e12]"
            title="Back to Sonalit"
            style={{ width: 32, height: 32, background: 'linear-gradient(135deg, #F0B429, #ff7a00)', border: 'none', cursor: 'pointer' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M20 7H4c-1.1 0-2 .9-2 2v6c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2ZM8 15H6v-6h2v6Zm4 0h-2v-6h2v6Zm4 0h-2v-6h2v6Zm4 0h-2v-6h2v6ZM21 4H3a1 1 0 0 0 0 2h18a1 1 0 0 0 0-2ZM21 18H3a1 1 0 0 0 0 2h18a1 1 0 0 0 0-2Z" fill="#0c0e12" />
            </svg>
          </button>
          {expanded && (
            <div className="min-w-0">
              <div className="text-[13px] font-bold tracking-wide text-white/90">CONTAINER MANAGEMENT</div>
              <div className="text-[9px] font-mono tracking-widest text-white/30 mt-px">CONTAINERISED LOGISTICS</div>
            </div>
          )}
        </div>

        <button
          onClick={() => nav({ to: '/home' })}
          className="flex items-center gap-2 mx-2 mt-2 mb-1 rounded-lg text-white/40 hover:text-white/70 hover:bg-white/[.04] transition-colors"
          style={{ padding: expanded ? '8px 10px' : '8px 0', justifyContent: expanded ? 'flex-start' : 'center' }}
        >
          <ChevronLeft size={14} strokeWidth={2} />
          {expanded && <span className="text-[11px] font-medium">Back to Sonalit</span>}
        </button>

        <div className="flex-1 py-1">
          {NAV_SECTIONS.map(section => (
            <div key={section.label} className="mb-1">
              {expanded && (
                <div className="px-4 pt-3 pb-1 text-[9px] font-semibold font-mono tracking-[.14em] uppercase text-white/20">
                  {section.label}
                </div>
              )}
              {!expanded && section !== NAV_SECTIONS[0] && (
                <div className="mx-3 my-1.5 border-t border-white/[.06]" />
              )}
              {section.ids.map(id => {
                const v = CDS_VIEWS.find(x => x.id === id);
                if (!v) return null;
                const iconData = VIEW_ICON_DATA[id];
                const active = activeView === id;
                return (
                  <button
                    key={id}
                    onClick={() => setActiveView(id as CDSView)}
                    title={expanded ? undefined : v.label}
                    className="flex items-center w-full border-none cursor-pointer transition-all duration-150"
                    style={{
                      gap: expanded ? 10 : 0,
                      padding: expanded ? '9px 14px' : '9px 0',
                      justifyContent: expanded ? 'flex-start' : 'center',
                      background: active ? 'rgba(240,180,41,.10)' : 'transparent',
                      borderLeft: active ? '3px solid #F0B429' : '3px solid transparent',
                    }}
                  >
                    {iconData && (
                      <span style={{ opacity: active ? 1 : 0.55, transition: 'opacity .15s' }}>
                        <NavIcon d={iconData.d} from={iconData.from} to={iconData.to} id={`ni-${id}`} />
                      </span>
                    )}
                    {expanded && (
                      <span className="text-[12.5px] font-medium truncate"
                        style={{ color: active ? '#F0B429' : 'rgba(255,255,255,.5)' }}>
                        {v.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <button
          onClick={() => setExpanded(e => !e)}
          className="flex items-center justify-center gap-2 mx-2 mb-3 py-2 rounded-lg text-white/25 hover:text-white/50 hover:bg-white/[.04] transition-colors border-none cursor-pointer bg-transparent"
        >
          {expanded ? <PanelLeftClose size={15} /> : <PanelLeft size={15} />}
          {expanded && <span className="text-[11px]">Collapse</span>}
        </button>
      </nav>

      {/* ── main ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-[52px] flex-shrink-0 bg-[#0c0e12]/95 backdrop-blur-xl border-b border-white/[.06] flex items-center px-5 gap-4">
          <div className="flex-1 min-w-0">
            <div className="font-bold text-[15px] text-white leading-tight">{currentView?.label ?? 'Dashboard'}</div>
            <div className="text-[10px] font-mono tracking-wider text-white/30 mt-0.5">{currentView?.sub ?? ''}</div>
          </div>

          {activeView === 'bookings' && (
            <button
              onClick={() => { /* BookingsView handles own form */ }}
              className="flex items-center gap-1.5 px-3 h-8 rounded-lg text-[12px] font-semibold border-none cursor-pointer transition-all hover:brightness-110"
              style={{ background: 'linear-gradient(135deg, #ff7a00, #F0B429)', color: '#0c0e12' }}
            >
              <Plus size={14} strokeWidth={2.5} /> New Booking
            </button>
          )}

          <div className="flex items-center gap-2 bg-white/[.04] border border-white/[.07] rounded-lg px-2.5 h-8">
            <Search size={13} className="text-white/30 flex-shrink-0" />
            <input placeholder="Search…" className="bg-transparent border-none outline-none text-white text-[12px] w-32 md:w-44" />
          </div>

          <div className="font-mono text-[12px] text-white/40 tracking-wider hidden sm:block">{clock}</div>

          <button className="w-8 h-8 rounded-lg bg-white/[.04] border border-white/[.06] text-white/40 cursor-pointer flex items-center justify-center hover:text-white/60 transition-colors">
            <Bell size={15} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto" style={{ overscrollBehavior: 'contain' }}>
          {activeView === 'dashboard' && <DashboardView />}
          {activeView === 'live' && <LiveView />}
          {activeView === 'containers' && <ContainersView />}
          {activeView === 'bookings' && <BookingsView />}
          {activeView === 'locks' && <LocksView />}
          {activeView === 'drivers' && <DriversView />}
          {activeView === 'transporters' && <TransportersView />}
          {activeView === 'port' && <PortView />}
          {activeView === 'pulse' && <PulseView />}
          {activeView === 'inbox' && <InboxView />}
          {activeView === 'billing' && <BillingView />}
          {activeView === 'reports' && <ReportsView />}
          {activeView === 'analytics' && <AnalyticsView />}
          {activeView === 'settings' && <SettingsView />}
        </div>
      </div>

      <CDSDrawer />
      <CDSToastContainer />
    </div>
  );
}

function DashboardView() {
  const { data: kpis, isLoading } = useDashboardKPIs();
  const { data: activity } = useActivity(20);
  if (isLoading) return <LoadingState />;

  const kv = (k: string) => String(kpis?.[k] ?? 0);
  const avgHrs = Number(kpis?.['avg_transit_hours'] ?? 0);
  const avgH = Math.floor(avgHrs);
  const avgM = Math.round((avgHrs - avgH) * 60);
  const cards = [
    { label: 'ACTIVE CONTAINERS', value: kv('active_containers'), delta: 'fleet total', trend: 'up' as const, accent: '#33d6a8' },
    { label: 'IN TRANSIT', value: kv('in_transit'), delta: 'on road now', trend: 'up' as const, accent: '#37e6ff' },
    { label: 'ACTIVE LOCKS', value: kv('active_locks'), delta: 'secured', trend: 'up' as const, accent: '#33d6a8' },
    { label: 'LOCKS REMOVED', value: kv('locks_removed'), delta: 'unclamped', trend: 'up' as const, accent: '#a78bfa' },
    { label: 'PENDING UNCLAMP', value: kv('pending_unclamp'), delta: 'port queue', trend: 'down' as const, accent: '#ffb020' },
    { label: 'DELIVERED TODAY', value: kv('delivered_today'), delta: 'completed', trend: 'up' as const, accent: '#22c55e' },
    { label: 'DELAYED', value: kv('delayed_trips'), delta: 'needs attention', trend: 'down' as const, accent: '#ff5c5c' },
    { label: 'AVG TRANSIT TIME', value: avgHrs ? `${avgH}h ${avgM}m` : '—', delta: 'hours', trend: 'up' as const, accent: '#F0B429' },
  ];

  const actIcons: Record<string, string> = {
    clamp: '🔒', depart: '🚛', checkpoint: '📍', sync: '🔄',
    arrival: '✅', unclamp: '🔓', ai: '🤖', alert: '⚠️',
  };

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        {cards.map(k => <KPICard key={k.label} label={k.label} value={k.value} delta={k.delta} trend={k.trend} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
          <div className="font-bold text-sm text-text-0 mb-3">Live Map</div>
          <div className="h-[300px] rounded-xl bg-ink-3 relative overflow-hidden"
            style={{ background: 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px) 0 0/40px 40px, linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px) 0 0/40px 40px, #14171b' }}>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-2xl mb-2 opacity-40">🗺️</div>
                <div className="text-text-2 text-[11px] font-mono">GPS positions load when vehicles are in transit</div>
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
          <div className="font-bold text-sm text-text-0 mb-3">Recent Activity</div>
          <div className="space-y-0 max-h-[340px] overflow-y-auto">
            {(activity ?? []).map((item, i) => (
              <div key={String(item['id'] ?? i)} className="flex items-start gap-2.5 py-2 border-b border-white/[.05]">
                <span className="text-sm flex-none mt-0.5">{actIcons[String(item['icon'] ?? item['type'] ?? '')] ?? '📋'}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-text-0 truncate">{String(item['description'] ?? item['text'] ?? '—')}</div>
                  <div className="text-[10px] text-text-2 font-mono mt-0.5 truncate">
                    {[
                      item['created_at'] ? new Date(String(item['created_at'])).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
                      item['meta'] ? String(item['meta']) : '',
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            ))}
            {(activity ?? []).length === 0 && (
              <div className="text-xs text-text-2 text-center py-8 font-mono">No recent activity</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Trip statuses that mean "this container is out and not yet delivered". */
const IN_TRANSIT = 'locked,dispatched,checkpoint,delayed,at_port';

function LiveView() {
  // Two different questions, deliberately asked separately:
  //   trips    — what is open on paper (clamped through to at_port)
  //   tracking — what is actually streaming GPS to us right now
  // The panel used to ask only for status='dispatched', so a clamped container
  // whose driver was actively reporting position showed as zero on both the
  // map and the counter.
  const { data, isLoading } = useTrips({ status: IN_TRANSIT });
  const { data: liveData } = useLiveTracking();
  if (isLoading) return <LoadingState />;
  const trips = (data?.data ?? []) as Record<string, unknown>[];
  const live = (liveData?.data ?? []) as Record<string, unknown>[];
  const reporting = live.filter(s => s['position_is_live'] === true).length;

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4 mb-4">
        <div className="font-bold text-sm text-text-0 mb-3">Live Fleet Tracking</div>
        <div className="h-[350px] rounded-xl bg-ink-3 relative overflow-hidden"
          style={{ background: 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px) 0 0/40px 40px, linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px) 0 0/40px 40px, #14171b' }}>
          {live.length > 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-2xl mb-2 opacity-40">📡</div>
                <div className="text-text-2 text-[11px] font-mono">
                  {reporting} of {live.length} vehicle{live.length !== 1 ? 's' : ''} reporting now
                </div>
                {reporting < live.length && (
                  <div className="text-[10px] font-mono text-[#ffb020] mt-1">
                    {live.length - reporting} tracked but not currently reporting
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <div className="text-2xl mb-2 opacity-40">🗺️</div>
                <div className="text-text-2 text-[11px] font-mono">
                  {trips.length > 0
                    ? `${trips.length} open trip${trips.length !== 1 ? 's' : ''} — none tracking yet`
                    : 'No open trips'}
                </div>
                {trips.length > 0 && (
                  <div className="text-[10px] font-mono text-text-2/60 mt-1">
                    Tracking starts when a driver scans their QR
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
        <div className="font-bold text-sm text-text-0 mb-3">Active Trips ({trips.length})</div>
        <div className="space-y-2 max-h-[300px] overflow-y-auto">
          {trips.map((t, i) => (
            <div key={String(t['id'] ?? i)} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-ink-2/50 border border-white/[.06]">
              <div className="w-2 h-2 rounded-full bg-cds-teal shadow-[0_0_8px_rgba(51,214,168,.6)] flex-none" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono font-bold text-cds-orange">{String(t['reference'] ?? t['trip_number'] ?? '—')}</div>
                <div className="text-[11px] text-text-1 truncate">{String(t['customer_name'] ?? '—')} → {String(t['destination'] ?? '—')}</div>
              </div>
              <div className="text-[10px] text-text-2 font-mono">{String(t['vehicleReg'] ?? t['vehicle_reg'] ?? '—')}</div>
            </div>
          ))}
          {trips.length === 0 && (
            <div className="text-xs text-text-2 text-center py-8 font-mono">No active trips</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-3">
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-2 h-2 rounded-full bg-[#F0B429]"
            style={{ animation: 'cds-pulse 1s ease-in-out infinite', animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
      <div className="text-text-2 font-mono text-xs">Loading data...</div>
      <style>{`@keyframes cds-pulse { 0%,100%{opacity:.2;transform:scale(.8)} 50%{opacity:1;transform:scale(1.2)} }`}</style>
    </div>
  );
}
