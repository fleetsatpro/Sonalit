import { useNavigate } from '@tanstack/react-router';
import {
  Gauge, Radar, Container, ClipboardList, ShieldCheck,
  Ship, HeartPulse, BotMessageSquare, Receipt, ChartNoAxesCombined,
  TrendingUpDown, SlidersHorizontal, Search, Bell, ChevronLeft, PanelLeftClose,
  PanelLeft, Plus, Boxes, type LucideIcon,
} from 'lucide-react';
import { useState, useEffect } from 'react';

import { useAuthStore } from '../../stores/auth.js';

import { ContainersView, BookingsView, DriversView, TransportersView } from './CDSDataPage.js';
import { CDSIntro } from './CDSIntro.js';
import { KPICard, CDSDrawer, CDSToastContainer } from './components.js';
import { CDS_VIEWS } from './constants.js';
import { useDashboardKPIs, useActivity, useTrips } from './hooks.js';
import {
  LocksView, PortView, PulseView, InboxView,
  BillingView, ReportsView, AnalyticsView, SettingsView,
} from './pages.js';
import { useCDSStore, type CDSView } from './store.js';
import { useCDSRealtime } from './useCDSRealtime.js';

const VIEW_ICONS: Record<string, LucideIcon> = {
  dashboard: Gauge, live: Radar, containers: Container,
  bookings: ClipboardList, locks: ShieldCheck,
  port: Ship, pulse: HeartPulse, inbox: BotMessageSquare, billing: Receipt,
  reports: ChartNoAxesCombined, analytics: TrendingUpDown, settings: SlidersHorizontal,
};

const NAV_SECTIONS: { label: string; ids: string[] }[] = [
  { label: 'Overview', ids: ['dashboard', 'live'] },
  { label: 'Operations', ids: ['containers', 'bookings', 'locks'] },
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
            onClick={() => nav({ to: '/' })}
            className="flex items-center justify-center flex-shrink-0 rounded-lg text-[#0c0e12]"
            title="Back to Sonalit"
            style={{ width: 32, height: 32, background: 'linear-gradient(135deg, #F0B429, #ff7a00)', border: 'none', cursor: 'pointer' }}
          >
            <Boxes size={18} />
          </button>
          {expanded && (
            <div className="min-w-0">
              <div className="text-[13px] font-bold tracking-wide text-white/90">CONTAINER MANAGEMENT</div>
              <div className="text-[9px] font-mono tracking-widest text-white/30 mt-px">CONTAINERISED LOGISTICS</div>
            </div>
          )}
        </div>

        <button
          onClick={() => nav({ to: '/' })}
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
                const Icon = VIEW_ICONS[id];
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
                      color: active ? '#F0B429' : 'rgba(255,255,255,.45)',
                    }}
                  >
                    {Icon && <Icon size={17} strokeWidth={active ? 2.2 : 1.5} className="flex-shrink-0" />}
                    {expanded && <span className="text-[12.5px] font-medium truncate">{v.label}</span>}
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
  const cards = [
    { label: 'ACTIVE BOOKINGS', value: kv('active_bookings'), delta: 'open orders', trend: 'up' as const, accent: '#F0B429' },
    { label: 'CONTAINERS IN YARD', value: kv('active_containers'), delta: 'fleet total', trend: 'up' as const, accent: '#33d6a8' },
    { label: 'CLAMPED', value: kv('clamped'), delta: 'e-lock secured', trend: 'up' as const, accent: '#33d6a8' },
    { label: 'IN TRANSIT', value: kv('in_transit'), delta: 'on road now', trend: 'up' as const, accent: '#37e6ff' },
    { label: 'AT PORT', value: kv('at_port'), delta: 'awaiting unclamp', trend: 'up' as const, accent: '#ffb020' },
    { label: 'AWAITING UNCLAMP', value: kv('awaiting_unclamp'), delta: 'port queue', trend: 'down' as const, accent: '#ffb020' },
    { label: 'UNCLAMPED', value: kv('unclamped'), delta: 'lock removed', trend: 'up' as const, accent: '#a78bfa' },
    { label: 'COMPLETED TODAY', value: kv('delivered_today'), delta: 'delivered', trend: 'up' as const, accent: '#22c55e' },
    { label: 'DELAYED', value: kv('delayed_trips'), delta: 'needs attention', trend: 'down' as const, accent: '#ff5c5c' },
    { label: 'ACTIVE ALERTS', value: kv('active_alerts'), delta: 'unacknowledged', trend: 'down' as const, accent: '#ff5c5c' },
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
          <div className="h-[300px] rounded-xl bg-ink-3 flex items-center justify-center text-text-2 text-xs font-mono">
            Map integration — GPS feed renders here
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
                  <div className="text-[10px] text-text-2 font-mono mt-0.5">
                    {String(item['meta'] ?? (item['created_at'] ? new Date(String(item['created_at'])).toLocaleTimeString() : ''))}
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

function LiveView() {
  const { data, isLoading } = useTrips({ status: 'dispatched' });
  if (isLoading) return <LoadingState />;
  const trips = (data?.data ?? []) as Record<string, unknown>[];

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4 mb-4">
        <div className="font-bold text-sm text-text-0 mb-3">Live Fleet Tracking</div>
        <div className="h-[350px] rounded-xl bg-ink-3 flex items-center justify-center text-text-2 text-xs font-mono">
          Real-time GPS map — vehicle positions rendered here
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
