import { useNavigate } from '@tanstack/react-router';
import { Activity, BarChart3, Boxes, ChevronLeft, ClipboardList, LayoutDashboard, Package, PanelLeft, PanelLeftClose, Search, Settings2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState, useEffect } from 'react';

import './cds-modern.css';
import { CDSActivityIcon } from './CDSActivityIcon.js';

import { useAuthStore } from '../../stores/auth.js';

import { ContainersView, BookingsView, DriversView, TransportersView } from './CDSDataPage.js';
import { CDSIntro } from './CDSIntro.js';
import { KPICard, CDSDrawer, CDSToastContainer } from './components.js';
import { CDS_VIEWS } from './constants.js';
import { useDashboardKPIs, useActivity, useLiveTrips, useVehicleTrack, useTransitionTrip, useMarkDeparted } from './hooks.js';
import { LiveFleetMap, positioned } from './LiveFleetMap.js';
import {
  LocksView, PortView, PulseView, InboxView,
  BillingView, ReportsView, AnalyticsView, SettingsView,
} from './pages.js';
import { useCDSStore, type CDSView } from './store.js';
import { useCDSRealtime } from './useCDSRealtime.js';
import cdsApi from './api.js';

import type { LiveTrip } from './LiveFleetMap.js';

type CDSNavSection = {
  label: string;
  items: Array<{
    id: string;
    label: string;
    description: string;
    icon: LucideIcon;
    view: CDSView;
    views: CDSView[];
  }>;
};

const NAV_SECTIONS: CDSNavSection[] = [
  {
    label: 'WORKSPACE',
    items: [
      { id: 'overview', label: 'Overview', description: 'Today at a glance', icon: LayoutDashboard, view: 'dashboard', views: ['dashboard'] },
      { id: 'containers', label: 'Containers', description: 'Inventory and custody', icon: Package, view: 'containers', views: ['containers'] },
      { id: 'bookings', label: 'Bookings', description: 'Customer requests and billing', icon: ClipboardList, view: 'bookings', views: ['bookings', 'billing'] },
    ],
  },
  {
    label: 'CONTROL',
    items: [
      { id: 'operations', label: 'Operations', description: 'Movement, yard and exceptions', icon: Activity, view: 'live', views: ['live', 'port', 'pulse', 'inbox'] },
    ],
  },
  {
    label: 'MANAGE',
    items: [
      { id: 'resources', label: 'Resources', description: 'Locks and field partners', icon: Boxes, view: 'locks', views: ['locks', 'drivers', 'transporters'] },
    ],
  },
  {
    label: 'INTELLIGENCE',
    items: [
      { id: 'insights', label: 'Insights', description: 'Performance and reports', icon: BarChart3, view: 'analytics', views: ['analytics', 'reports'] },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { id: 'administration', label: 'Administration', description: 'Account and field access', icon: Settings2, view: 'settings', views: ['settings'] },
    ],
  },
];

const SECONDARY_NAV: Record<string, Array<{ view: CDSView; label: string }>> = {
  bookings: [
    { view: 'bookings', label: 'Bookings' },
    { view: 'billing', label: 'Billing' },
  ],
  operations: [
    { view: 'live', label: 'Live tracking' },
    { view: 'port', label: 'Yard & port' },
    { view: 'pulse', label: 'Exceptions' },
    { view: 'inbox', label: 'Activity log' },
  ],
  resources: [
    { view: 'locks', label: 'E-locks' },
    { view: 'drivers', label: 'Drivers' },
    { view: 'transporters', label: 'Transporters' },
  ],
  insights: [
    { view: 'analytics', label: 'Performance' },
    { view: 'reports', label: 'Reports' },
  ],
};

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
  const [headerQuery, setHeaderQuery] = useState('');
  const [headerResults, setHeaderResults] = useState<Array<{ id: string; title: string; detail: string; target: CDSView; source: string }>>([]);
  const [headerSearchOpen, setHeaderSearchOpen] = useState(false);
  const [headerSearching, setHeaderSearching] = useState(false);
  const [headerSearchPartial, setHeaderSearchPartial] = useState(false);
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
  const runHeaderSearch = async () => {
    const query = headerQuery.trim();
    if (!query || headerSearching) return;
    setHeaderSearching(true);
    setHeaderSearchOpen(false);
    setHeaderSearchPartial(false);
    try {
      const requests = await Promise.allSettled([
        cdsApi.get('/trips', { params: { search: query, limit: 8 } }),
        cdsApi.get('/containers', { params: { search: query, limit: 8 } }),
        cdsApi.get('/locks', { params: { search: query, limit: 8 } }),
      ]);
      const results: Array<{ id: string; title: string; detail: string; target: CDSView; source: string }> = [];
      const rows = (index: number): Record<string, unknown>[] => {
        const result = requests[index];
        if (result.status !== 'fulfilled') return [];
        const body = result.value.data as { data?: unknown };
        return Array.isArray(body.data) ? body.data as Record<string, unknown>[] : [];
      };
      rows(0).forEach(row => results.push({
        id: String(row['id'] ?? ''),
        title: String(row['trip_number'] ?? row['reference'] ?? row['id'] ?? 'Trip'),
        detail: [row['status'], row['origin'] && row['destination'] ? String(row['origin']) + ' → ' + String(row['destination']) : null].filter(Boolean).join(' · '),
        target: 'live',
        source: 'Trip',
      }));
      rows(1).forEach(row => results.push({
        id: String(row['id'] ?? ''),
        title: String(row['number'] ?? row['id'] ?? 'Container'),
        detail: [row['status'], row['current_location'] ?? row['container_type']].filter(Boolean).join(' · '),
        target: 'containers',
        source: 'Container',
      }));
      rows(2).forEach(row => results.push({
        id: String(row['id'] ?? ''),
        title: String(row['serial'] ?? row['id'] ?? 'E-lock'),
        detail: [row['status'], row['truck'] ?? row['container_number']].filter(Boolean).join(' · '),
        target: 'locks',
        source: 'E-lock',
      }));
      setHeaderResults(results.slice(0, 12));
      setHeaderSearchPartial(requests.some(result => result.status === 'rejected'));
      setHeaderSearchOpen(true);
      if (requests.every(result => result.status === 'rejected')) {
        addToast('CDS search is unavailable; no source returned results.', 'error');
      }
    } catch {
      setHeaderResults([]);
      setHeaderSearchPartial(true);
      setHeaderSearchOpen(true);
      addToast('CDS search failed. No records were changed.', 'error');
    } finally {
      setHeaderSearching(false);
    }
  };


  const endIntro = () => {
    try { sessionStorage.setItem('cds-intro-seen', '1'); } catch { /* */ }
    setShowIntro(false);
  };
  const currentView = CDS_VIEWS.find(v => v.id === activeView);
  const activeSection = NAV_SECTIONS.flatMap(section => section.items).find(item => item.views.includes(activeView)) ?? NAV_SECTIONS[0].items[0];
  const secondaryTabs = SECONDARY_NAV[activeSection.id] ?? [];
  const railW = expanded ? 248 : 72;

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



          <div className="relative flex items-center gap-2 bg-white/[.04] border border-white/[.07] rounded-lg px-2.5 h-8">
            <Search size={13} className="text-white/30 flex-shrink-0" />
            <input
              value={headerQuery}
              onChange={event => setHeaderQuery(event.target.value)}
              onFocus={() => { if (headerResults.length) setHeaderSearchOpen(true); }}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); void runHeaderSearch(); }
                if (event.key === 'Escape') setHeaderSearchOpen(false);
              }}
              aria-label="Search CDS trips, containers and e-locks"
              aria-expanded={headerSearchOpen}
              placeholder="Search trips, containers, locks…"
              className="bg-transparent border-none outline-none text-white text-[12px] w-32 md:w-44"
            />
            {headerSearching && <span className="text-[9px] text-white/40">Searching</span>}
            {headerSearchOpen && (
              <div role="listbox" aria-label="CDS search results" className="absolute z-[90] top-full right-0 mt-2 w-[min(420px,85vw)] max-h-[360px] overflow-y-auto rounded-xl border border-white/[.12] bg-[#0e1117] shadow-2xl">
                <div className="px-3 py-2 text-[9px] uppercase tracking-widest font-mono text-white/45 border-b border-white/[.06]">
                  {headerSearchPartial ? 'Partial results · one or more sources unavailable' : headerResults.length ? headerResults.length + ' matching records' : 'No matching records'}
                </div>
                {headerResults.map((result, index) => (
                  <button key={result.source + ':' + result.id + ':' + index} type="button" role="option" aria-selected={false}
                    onClick={() => {
                      setActiveView(result.target);
                      setHeaderSearchOpen(false);
                      useCDSStore.getState().openDrawer(result.source + ' · ' + result.title, (
                        <div className="space-y-3 text-xs">
                          <div className="text-[10px] uppercase tracking-wider font-mono text-cds-orange">{result.source} record search result</div>
                          <div className="font-bold text-text-0 break-all">{result.title}</div>
                          <div className="text-text-2 break-words">{result.detail || 'No additional summary fields are recorded.'}</div>
                          <div className="text-[10px] text-text-2">Record ID: {result.id || 'not returned by API'}</div>
                          <div className="text-[10px] text-text-2">Search uses live tenant-scoped CDS API results. Open the {result.source.toLowerCase()} workspace to continue operational work.</div>
                        </div>
                      ));
                    }}
                    className="block w-full px-3 py-2.5 text-left border-b border-white/[.05] last:border-0 hover:bg-white/[.04]"
                  >
                    <div className="flex items-center justify-between gap-3"><span className="truncate text-xs font-semibold text-white/90">{result.title}</span><span className="text-[9px] uppercase font-mono tracking-wider text-cds-orange">{result.source}</span></div>
                    <div className="text-[10px] text-white/45 mt-1 truncate">{result.detail || 'No secondary fields recorded'}</div>
                  </button>
                ))}
                <button type="button" onClick={() => setHeaderSearchOpen(false)} className="w-full px-3 py-2 text-left text-[10px] text-white/45 hover:text-white/80">Close results · Esc</button>
              </div>
            )}
          </div>

          <div className="font-mono text-[12px] text-white/40 tracking-wider hidden sm:block">{clock}</div>

          <button
            type="button"
            title="Open Client Pulse and dispatch alerts"
            aria-label="Open Client Pulse and dispatch alerts"
            onClick={() => setActiveView('pulse')}
            className="w-8 h-8 rounded-lg bg-white/[.04] border border-white/[.06] text-white/55 cursor-pointer flex items-center justify-center hover:text-white transition-colors"
          ><Bell size={15} /></button>
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

const PHASE_META: Record<LiveTrip['phase'], { label: string; dot: string; text: string }> = {
  moving:  { label: 'On the road', dot: 'bg-cds-teal shadow-[0_0_8px_rgba(51,214,168,.6)]', text: 'text-cds-teal' },
  at_port: { label: 'At port',     dot: 'bg-[#37e6ff] shadow-[0_0_8px_rgba(55,230,255,.6)]', text: 'text-[#37e6ff]' },
  staged:  { label: 'Awaiting departure', dot: 'bg-[#f0b429]', text: 'text-[#f0b429]' },
};

function ago(iso: string | null): string {
  if (!iso) return 'no GPS yet';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(mins) || mins < 0) return 'just now';
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * What a trip may become next, mirroring TRIP_TRANSITIONS in routes/cds.js.
 *
 * The server is the authority — it rejects anything not on its own list with a
 * 422 — so this exists only to avoid offering a button that is guaranteed to
 * fail. Keep the two in step: an entry here that the server refuses is a dead
 * button, and one missing here is a transition an operator cannot reach.
 *
 * 'dispatched' is deliberately absent from the 'locked' row. Departure is not
 * a status change to be picked off a menu — it is a fact with a source and a
 * time, so it goes through Mark departed and lands in departure_source.
 */
const NEXT_STATUS: Record<string, string[]> = {
  locked: [],
  dispatched: ['checkpoint', 'delayed', 'at_port', 'delivered'],
  checkpoint: ['dispatched', 'delayed', 'at_port', 'delivered'],
  delayed: ['dispatched', 'checkpoint'],
  at_port: ['delivered'],
};

const STATUS_LABEL: Record<string, string> = {
  checkpoint: 'At checkpoint', delayed: 'Delayed', at_port: 'At port',
  delivered: 'Delivered', dispatched: 'Back on road',
};

/**
 * The control room's half of the trip lifecycle.
 *
 * Every one of these transitions had a working endpoint and no caller: no
 * screen imported useTransitionTrip, so no trip could ever be marked at a
 * checkpoint, delayed, at the port or delivered. The Port view filters on
 * status='at_port' and was therefore permanently empty, the delayed-trips KPI
 * was permanently zero, and the whole state machine in routes/cds.js was
 * unreachable from the product.
 */
function TripActions({ trip }: { trip: LiveTrip }) {
  const transition = useTransitionTrip();
  const depart = useMarkDeparted();
  const { addToast } = useCDSStore();
  const next = NEXT_STATUS[trip.status] ?? [];
  const busy = transition.isPending || depart.isPending;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 px-3 pb-2.5">
      {trip.status === 'locked' && (
        <button
          type="button"
          disabled={busy}
          onClick={() => depart.mutate({ tripId: trip.id }, {
            onSuccess: (r) => addToast(r?.data?.already_departed
              ? `${trip.trip_number} was already marked departed`
              : `${trip.trip_number} marked departed`),
            onError: () => addToast(`Could not mark ${trip.trip_number} departed`, 'error'),
          })}
          className="h-7 px-2.5 rounded-md text-[11px] font-bold disabled:opacity-50 cursor-pointer"
          style={{ background: 'linear-gradient(135deg, #ff7a00, #F0B429)', color: '#170d00' }}
        >
          Mark departed
        </button>
      )}
      {next.map(to => (
        <button
          type="button"
          key={to}
          disabled={busy}
          onClick={() => transition.mutate({ id: trip.id, to_status: to }, {
            onSuccess: () => addToast(`${trip.trip_number} → ${STATUS_LABEL[to] ?? to}`),
            onError: () => addToast(`Could not move ${trip.trip_number} to ${to}`, 'error'),
          })}
          className="h-7 px-2.5 rounded-md text-[11px] font-mono bg-white/[.06] border border-white/10 text-text-1 hover:border-white/25 disabled:opacity-50 cursor-pointer"
        >
          {STATUS_LABEL[to] ?? to}
        </button>
      ))}
      {trip.status === 'locked' && (
        <span className="text-[10px] font-mono text-text-2">
          {/* Says why there is only one button: everything else waits on the
              truck actually having left. */}
          awaiting departure — tracking will mark it automatically once it moves
        </span>
      )}
    </div>
  );
}

export function LiveView() {
  const { data, isLoading } = useLiveTrips();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const trips = data?.data ?? [];
  const selected = trips.find(t => t.id === selectedId) ?? null;
  const { data: trackData } = useVehicleTrack(selected?.vehicle_id ?? null);
  const track = ((trackData?.data ?? []) as Record<string, unknown>[])
    .map(p => ({ lat: Number(p['lat']), lng: Number(p['lng']) }));

  if (isLoading) return <LoadingState />;

  const onRoad = trips.filter(t => t.phase === 'moving');
  const atPort = trips.filter(t => t.phase === 'at_port');
  const staged = trips.filter(t => t.phase === 'staged');
  const withFix = trips.filter(positioned);
  // "Positioned" and "live" are different claims: a fix can be hours old. The
  // tracking engine decides which is which; this panel only reports it.
  const liveNow = trips.filter(t => t.position_is_live).length;

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4 mb-4">
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <div className="font-bold text-sm text-text-0">Live Fleet Tracking</div>
          <div className="text-[10px] font-mono text-text-2">
            {liveNow} of {trips.length} open trip{trips.length === 1 ? '' : 's'} reporting now
            {withFix.length > liveNow ? ` · ${withFix.length - liveNow} last known` : ''}
          </div>
        </div>
        <div className="h-[350px] rounded-xl overflow-hidden bg-ink-2 relative">
          {withFix.length > 0 ? (
            <LiveFleetMap trips={trips} selectedId={selectedId} onSelect={setSelectedId} track={track} />
          ) : (
            // No map is drawn with nothing to draw on it, and the reason is
            // stated rather than implied: whether there are no trips at all or
            // trips with no fix are two very different problems for an operator.
            <div className="absolute inset-0 flex items-center justify-center px-6"
              style={{ background: 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px) 0 0/40px 40px, linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px) 0 0/40px 40px, #14171b' }}>
              <div className="text-center text-text-2 text-[11px] font-mono leading-relaxed">
                {trips.length === 0
                  ? 'No open trips — the map draws vehicles once a trip is dispatched'
                  : `${trips.length} open trip${trips.length === 1 ? '' : 's'}, none reporting GPS yet — check the tracker on ${trips.map(t => t.vehicle_reg || t.trip_number).slice(0, 3).join(', ')}`}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
        <div className="flex items-baseline justify-between mb-3 gap-3 flex-wrap">
          <div className="font-bold text-sm text-text-0">Open Trips ({trips.length})</div>
          <div className="text-[10px] font-mono text-text-2">
            {onRoad.length} on the road · {atPort.length} at port · {staged.length} awaiting departure
          </div>
        </div>
        <div className="space-y-2 max-h-[420px] overflow-y-auto">
          {[...onRoad, ...atPort, ...staged].map(t => {
            const meta = PHASE_META[t.phase];
            const isSel = t.id === selectedId;
            return (
              <div
                key={t.id}
                className={`rounded-xl bg-ink-2/50 border transition-colors ${isSel ? 'border-cds-orange/60' : 'border-white/[.06] hover:border-white/20'}`}
              >
              <button
                type="button"
                onClick={() => setSelectedId(isSel ? null : t.id)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer"
              >
                <div className={`w-2 h-2 rounded-full flex-none ${meta.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono font-bold text-cds-orange">
                    {t.trip_number}
                    {t.vehicle_reg ? <span className="text-text-2 font-normal"> · {t.vehicle_reg}</span> : null}
                  </div>
                  <div className="text-[11px] text-text-1 truncate">
                    {t.customer_name ?? '—'} → {t.destination ?? '—'}
                  </div>
                </div>
                <div className="text-right flex-none">
                  <div className={`text-[10px] font-mono ${meta.text}`}>{meta.label}</div>
                  <div className="text-[10px] font-mono text-text-2">
                    {t.position_is_live ? 'live' : ago(t.last_seen)}
                    {t.position_source === 'device_telematics' && t.lat != null ? ' · telematics' : ''}
                  </div>
                </div>
              </button>
              {/* Actions live behind the selection rather than on every row: a
                  board of twenty trips each carrying four buttons is a board
                  nobody can read, and a mis-tap here changes a trip's state. */}
              {isSel && <TripActions trip={t} />}
              </div>
            );
          })}
          {trips.length === 0 && (
            <div className="text-xs text-text-2 text-center py-8 font-mono">No open trips</div>
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
