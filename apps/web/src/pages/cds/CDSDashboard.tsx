import { useNavigate } from '@tanstack/react-router';
import { Activity, BarChart3, Boxes, ChevronLeft, ClipboardList, LayoutDashboard, Package, PanelLeft, PanelLeftClose, Search, Settings2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState, useEffect } from 'react';

import './cds-modern.css';
import { CDSActivityIcon } from './CDSActivityIcon.js';

import { useAuthStore } from '../../stores/auth.js';

import { ContainersView, BookingsView, DriversView, TransportersView } from './CDSDataPage.js';
import { CDSIntro } from './CDSIntro.js';
import { CDSDrawer, CDSToastContainer } from './components.js';
import { CDS_VIEWS } from './constants.js';
import { useDashboardKPIs, useActivity, useLiveTrips, useVehicleTrack, useTransitionTrip, useMarkDeparted } from './hooks.js';
import { LiveFleetMap, positioned } from './LiveFleetMap.js';
import {
  LocksView, PortView, PulseView, InboxView, AuditView,
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
      { id: 'operations', label: 'Operations', description: 'Movement, yard and exceptions', icon: Activity, view: 'live', views: ['live', 'port', 'pulse', 'inbox', 'audit'] },
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
    { view: 'audit', label: 'Audit trail' },
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
    <div className="cds-modern flex h-dvh text-white overflow-hidden">
      {showIntro && <CDSIntro onDone={endIntro} />}
      {/* ── Primary navigation ── */}
      <nav
        aria-label="Container Management navigation"
        className="cds-sidebar hidden md:flex flex-col flex-shrink-0 overflow-y-auto overflow-x-hidden"
        style={{ width: railW, transition: 'width 220ms cubic-bezier(.2,.75,.25,1)', scrollbarWidth: 'none' }}
      >
        <div className="cds-sidebar-brand flex items-center gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={() => nav({ to: '/' })}
            className="cds-brand-mark flex items-center justify-center flex-shrink-0"
            aria-label="Back to Sonalit"
            title="Back to Sonalit"
          >
            <span aria-hidden="true">C</span>
          </button>
          {expanded && (
            <div className="min-w-0">
              <div className="text-[15px] font-semibold tracking-tight text-white">Container Management</div>
              <div className="text-[11px] font-medium text-slate-300 mt-0.5">SONALIT OPERATIONS</div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => nav({ to: '/' })}
          className="cds-back-link flex items-center gap-2 mx-3 mt-3 mb-2 rounded-lg"
          style={{ padding: expanded ? '10px 12px' : '10px 0', justifyContent: expanded ? 'flex-start' : 'center' }}
          title="Back to Sonalit"
        >
          <ChevronLeft size={17} strokeWidth={1.9} />
          {expanded && <span className="text-[13px] font-medium">Back to Sonalit</span>}
        </button>

        <div className="flex-1 py-2">
          {NAV_SECTIONS.map(section => (
            <div key={section.label} className="mb-2">
              {expanded && (
                <div className="cds-nav-section-label px-5 pt-4 pb-2">{section.label}</div>
              )}
              {!expanded && section !== NAV_SECTIONS[0] && (
                <div className="mx-4 my-3 border-t border-white/[.09]" />
              )}
              {section.items.map(item => {
                const Icon = item.icon;
                const active = item.views.includes(activeView);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveView(item.view)}
                    title={expanded ? undefined : item.label}
                    aria-current={active ? 'page' : undefined}
                    className={'cds-nav-link flex items-center w-full text-left ' + (active ? 'is-active' : '')}
                    style={{
                      gap: expanded ? 12 : 0,
                      padding: expanded ? '11px 18px' : '11px 0',
                      justifyContent: expanded ? 'flex-start' : 'center',
                    }}
                  >
                    <Icon size={19} strokeWidth={1.85} className="flex-shrink-0" aria-hidden="true" />
                    {expanded && (
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-semibold truncate">{item.label}</span>
                        <span className="cds-nav-description block text-[11px] mt-0.5 truncate">{item.description}</span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="cds-collapse-control flex items-center justify-center gap-2 mx-3 mb-4 py-3 rounded-xl"
          aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
          title={expanded ? 'Collapse navigation' : 'Expand navigation'}
        >
          {expanded ? <PanelLeftClose size={17} /> : <PanelLeft size={17} />}
          {expanded && <span className="text-[13px] font-medium">Collapse navigation</span>}
        </button>
      </nav>

      {/* ── Main workspace ── */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="cds-topbar flex-shrink-0 flex items-center gap-4 px-4 sm:px-6">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-[19px] sm:text-[21px] font-semibold tracking-tight text-white leading-tight">{activeSection.label}</h1>
              {secondaryTabs.length > 0 && (
                <span className="cds-current-view hidden sm:inline-flex">{currentView?.label ?? ''}</span>
              )}
            </div>
            <p className="text-[12px] sm:text-[13px] text-slate-300 mt-1 truncate">{currentView?.sub ?? activeSection.description}</p>
          </div>

          <div className="cds-search relative flex items-center gap-2 rounded-xl px-3 h-10 flex-shrink-0">
            <Search size={17} className="text-slate-300 flex-shrink-0" aria-hidden="true" />
            <input
              value={headerQuery}
              onChange={event => setHeaderQuery(event.target.value)}
              onFocus={() => { if (headerResults.length) setHeaderSearchOpen(true); }}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); void runHeaderSearch(); }
                if (event.key === 'Escape') setHeaderSearchOpen(false);
              }}
              aria-label="Search trips, containers and e-locks"
              aria-expanded={headerSearchOpen}
              placeholder="Search records…"
              className="bg-transparent border-none outline-none text-white text-[13px] w-28 sm:w-48"
            />
            {headerSearching && <span className="text-[11px] text-slate-300">Searching</span>}
            {headerSearchOpen && (
              <div role="listbox" aria-label="CDS search results" className="cds-search-results absolute z-[90] top-full right-0 mt-2 w-[min(440px,85vw)] max-h-[360px] overflow-y-auto rounded-xl shadow-2xl">
                <div className="px-4 py-3 text-[11px] font-semibold text-slate-200 border-b border-white/[.08]">
                  {headerSearchPartial ? 'Partial results · one or more sources unavailable' : headerResults.length ? headerResults.length + ' matching records' : 'No matching records'}
                </div>
                {headerResults.map((result, index) => (
                  <button key={result.source + ':' + result.id + ':' + index} type="button" role="option" aria-selected={false}
                    onClick={() => {
                      setActiveView(result.target);
                      setHeaderSearchOpen(false);
                      useCDSStore.getState().openDrawer(result.source + ' · ' + result.title, (
                        <div className="space-y-3 text-sm">
                          <div className="text-[12px] uppercase tracking-wider font-mono text-cyan-300">{result.source} record</div>
                          <div className="font-semibold text-text-0 break-all">{result.title}</div>
                          <div className="text-text-2 break-words">{result.detail || 'No additional summary fields are recorded.'}</div>
                          <div className="text-[12px] text-text-2">Record ID: {result.id || 'not returned by API'}</div>
                        </div>
                      ));
                    }}
                    className="block w-full px-4 py-3 text-left border-b border-white/[.06] last:border-0 hover:bg-white/[.05]"
                  >
                    <div className="flex items-center justify-between gap-3"><span className="truncate text-[14px] font-semibold text-white">{result.title}</span><span className="text-[11px] uppercase font-mono tracking-wider text-cyan-300">{result.source}</span></div>
                    <div className="text-[12px] text-slate-300 mt-1 truncate">{result.detail || 'No secondary fields recorded'}</div>
                  </button>
                ))}
                <button type="button" onClick={() => setHeaderSearchOpen(false)} className="w-full px-4 py-3 text-left text-[12px] text-slate-300 hover:text-white">Close results · Esc</button>
              </div>
            )}
          </div>

          <div className="cds-clock font-mono text-[13px] hidden lg:block flex-shrink-0">{clock}</div>
        </header>

        <nav className="cds-mobile-nav md:hidden flex-shrink-0" aria-label="Primary workspace navigation">
          {NAV_SECTIONS.flatMap(section => section.items).map(item => {
            const Icon = item.icon;
            const active = item.views.includes(activeView);
            return (
              <button key={item.id} type="button" onClick={() => setActiveView(item.view)}
                aria-current={active ? 'page' : undefined} className={'cds-mobile-nav-item ' + (active ? 'is-active' : '')}>
                <Icon size={17} aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {secondaryTabs.length > 0 && (
          <nav className="cds-context-nav flex-shrink-0 flex items-center gap-1 px-4 sm:px-6 overflow-x-auto" aria-label={activeSection.label + ' views'}>
            {secondaryTabs.map(tab => (
              <button key={tab.view} type="button" onClick={() => setActiveView(tab.view)}
                aria-current={activeView === tab.view ? 'page' : undefined}
                className={'cds-context-tab flex-shrink-0 ' + (activeView === tab.view ? 'is-active' : '')}>
                {tab.label}
              </button>
            ))}
          </nav>
        )}

        <div className="cds-content-scroll flex-1 overflow-y-auto" style={{ overscrollBehavior: "contain" }}>
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
          {activeView === 'audit' && <AuditView />}
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
  const { data: activity, isLoading: activityLoading, isError: activityError, refetch: refetchActivity } = useActivity(20);
  const { setActiveView } = useCDSStore();
  if (isLoading) return <LoadingState />;

  const kv = (k: string) => String(kpis?.[k] ?? 0);
  const avgHrs = Number(kpis?.['avg_transit_hours'] ?? 0);
  const avgH = Math.floor(avgHrs);
  const avgM = Math.round((avgHrs - avgH) * 60);
  const cards = [
    { label: 'ACTIVE CONTAINERS', value: kv('active_containers'), delta: 'registered in operation' },
    { label: 'IN TRANSIT', value: kv('in_transit'), delta: 'currently assigned to movement' },
    { label: 'ACTIVE E-LOCKS', value: kv('active_locks'), delta: 'installed or assigned' },
    { label: 'UNCLAMPED', value: kv('locks_removed'), delta: 'locks removed' },
    { label: 'PENDING UNCLAMP', value: kv('pending_unclamp'), delta: 'awaiting port action' },
    { label: 'DELIVERED TODAY', value: kv('delivered_today'), delta: 'recorded today' },
    { label: 'DELAYED', value: kv('delayed_trips'), delta: 'requires review' },
    { label: 'AVERAGE TRANSIT', value: avgHrs ? avgH + 'h ' + avgM + 'm' : '—', delta: 'completed trips with timestamps' },
  ];

  return (
    <div className="cds-dashboard p-4 sm:p-6 max-w-[1680px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
        <div>
          <div className="cds-eyebrow">OPERATIONAL SNAPSHOT</div>
          <h2 className="text-[21px] sm:text-[24px] font-semibold text-white tracking-tight mt-1">Container activity, at a glance</h2>
          <p className="text-[13px] text-slate-300 mt-1">A clear view of the current workload, movement and delivery position.</p>
        </div>
        <button type="button" onClick={() => setActiveView('pulse')} className="cds-secondary-action">
          <Activity size={16} aria-hidden="true" />
          Review exceptions
        </button>
      </div>

      <section aria-label="Operational key figures" className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8 gap-3">
        {cards.map(k => (
          <div key={k.label} className="cds-kpi-panel min-w-0 rounded-xl border p-3 sm:p-3.5">
            <div className="text-[11px] font-semibold tracking-[.08em] text-slate-300 leading-snug min-h-[30px]">{k.label}</div>
            <div className="cds-kpi-value font-semibold font-mono text-white text-[25px] sm:text-[27px] leading-none mt-3 tabular-nums">{k.value}</div>
            <div className="text-[11px] text-slate-300 mt-2 leading-snug">{k.delta}</div>
          </div>
        ))}
      </section>

      <section className="cds-activity-panel mt-4 rounded-2xl border overflow-hidden" aria-labelledby="cds-recent-activity-title">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5 py-4 border-b border-white/[.08]">
          <div>
            <h3 id="cds-recent-activity-title" className="text-[16px] sm:text-[17px] font-semibold text-white">Recent activity</h3>
            <p className="text-[12px] text-slate-300 mt-1">Recorded operational events from the activity feed.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => { void refetchActivity(); }} className="cds-tertiary-action" disabled={activityLoading}>
              Refresh
            </button>
            <button type="button" onClick={() => setActiveView('inbox')} className="cds-secondary-action">
              Open activity log
            </button>
          </div>
        </div>

        {activityError ? (
          <div role="alert" className="px-5 py-6">
            <div className="text-[14px] font-semibold text-white">Activity feed unavailable</div>
            <p className="text-[13px] text-slate-300 mt-1">The operational snapshot is still available. Retry the activity feed without changing any records.</p>
            <button type="button" onClick={() => { void refetchActivity(); }} className="cds-secondary-action mt-3">Retry activity feed</button>
          </div>
        ) : activityLoading && !activity ? (
          <div className="px-5 py-8 text-[13px] text-slate-300">Loading recorded activity…</div>
        ) : (activity ?? []).length === 0 ? (
          <div className="px-5 py-9 text-center">
            <Activity size={22} className="mx-auto text-slate-400" aria-hidden="true" />
            <div className="text-[14px] font-semibold text-white mt-3">No recent activity</div>
            <p className="text-[13px] text-slate-300 mt-1">Recorded clamps, departures, checkpoints and delivery events will appear here.</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[.06]">
            {(activity ?? []).map((item, i) => (
              <div key={String(item['id'] ?? i)} className="flex items-start gap-3 px-4 sm:px-5 py-3">
                <CDSActivityIcon kind={item['icon'] ?? item['type']} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-slate-100 break-words">{String(item['description'] ?? item['text'] ?? '—')}</div>
                  <div className="text-[12px] text-slate-300 mt-1 break-words">
                    {[
                      item['created_at'] ? new Date(String(item['created_at'])).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '',
                      item['meta'] ? String(item['meta']) : '',
                    ].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
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
