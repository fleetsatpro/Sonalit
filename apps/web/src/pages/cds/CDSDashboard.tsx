import { useNavigate } from '@tanstack/react-router';
import {
  Search, Bell, ChevronLeft, PanelLeftClose, PanelLeft, Menu, X,
  LayoutDashboard, MapPin, ClipboardList, Package, Lock,
  Users, Truck, Anchor, Activity, FileText, BarChart2, Settings,
  RefreshCw, CheckCircle2, Unlock, BrainCircuit, AlertTriangle,
  type LucideIcon,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import './CDSDesignSystem.css';

import { useAuthStore } from '../../stores/auth.js';

import { ContainersView, BookingsView, DriversView, TransportersView } from './CDSDataPage.js';
import { KPICard, CDSDrawer, CDSToastContainer } from './components.js';
import { CDS_VIEWS } from './constants.js';
import { useDashboardKPIs, useActivity, useLiveTrips, useVehicleTrack, useTransitionTrip, useMarkDeparted } from './hooks.js';
import { LiveFleetMap, positioned } from './LiveFleetMap.js';
import {
  LocksView, PortView, PulseView, InboxView,
  ReportsView, AnalyticsView, SettingsView,
} from './pages.js';
import { useCDSStore, type CDSView } from './store.js';
import { useCDSRealtime } from './useCDSRealtime.js';
import cdsApi from './api.js';

import type { LiveTrip } from './LiveFleetMap.js';

const VIEW_ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  live: MapPin,
  bookings: ClipboardList,
  port: Anchor,
  pulse: Activity,
  containers: Package,
  locks: Lock,
  drivers: Users,
  transporters: Truck,
  inbox: FileText,
  analytics: BarChart2,
  reports: FileText,
  settings: Settings,
};

const NAV_SECTIONS: { label: string; ids: string[] }[] = [
  { label: 'Command', ids: ['dashboard', 'live'] },
  { label: 'Movement', ids: ['bookings', 'port', 'pulse'] },
  { label: 'Equipment', ids: ['containers', 'locks'] },
  { label: 'Partners', ids: ['drivers', 'transporters'] },
  { label: 'Records & Intelligence', ids: ['inbox', 'analytics', 'reports'] },
  { label: 'Administration', ids: ['settings'] },
];

interface CDSNavigationProps {
  expanded: boolean;
  activeView: CDSView;
  mobile?: boolean;
  onSelect: (view: CDSView) => void;
  onBack: () => void;
  onClose?: () => void;
  onToggleExpanded?: () => void;
}

function CDSNavigation({ expanded, activeView, mobile = false, onSelect, onBack, onClose, onToggleExpanded }: CDSNavigationProps) {
  const showLabels = mobile || expanded;
  return (
    <nav className={`cds-navigation ${mobile ? 'cds-navigation--mobile' : 'cds-navigation--desktop'} ${expanded ? 'is-expanded' : 'is-collapsed'}`} aria-label="Container Management workspaces">
      <div className="cds-nav-brand">
        <div className="cds-brand-mark" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 36 36" fill="none">
            <path d="M6 11.5 18 5l12 6.5v13L18 31 6 24.5v-13Z" stroke="currentColor" strokeWidth="2.1" strokeLinejoin="round"/>
            <path d="M6 11.5 18 18l12-6.5M18 18v13M11 8.8l14 7.6M11 27.1V14.4M25 27.1V14.4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
          </svg>
        </div>
        {showLabels && <div className="cds-brand-copy"><strong>CONTAINER MANAGEMENT</strong><span>OPERATIONS SYSTEM <i>/</i> CDS</span></div>}
        {mobile && <button type="button" className="cds-nav-close" onClick={onClose} aria-label="Close navigation"><X size={21} strokeWidth={2.3}/></button>}
      </div>
      <button type="button" onClick={onBack} className="cds-nav-back" title="Back to Sonalit" aria-label="Back to Sonalit">
        <ChevronLeft size={19} strokeWidth={2.4}/>{showLabels && <span>Back to Sonalit</span>}
      </button>
      <div className="cds-nav-sections">
        {NAV_SECTIONS.map(section => (
          <section key={section.label} className="cds-nav-section" aria-label={section.label}>
            {showLabels ? <div className="cds-nav-section-label">{section.label}</div> : <div className="cds-nav-section-rule" aria-hidden="true"/>}
            {section.ids.map(id => {
              const view = CDS_VIEWS.find(item => item.id === id);
              if (!view) return null;
              const Icon = VIEW_ICONS[id];
              const active = activeView === id;
              return (
                <button key={id} type="button" onClick={() => onSelect(id as CDSView)} title={showLabels ? undefined : view.label} aria-label={view.label} aria-current={active ? 'page' : undefined} className={`cds-nav-item ${active ? 'is-active' : ''}`}>
                  {Icon && <Icon className="cds-nav-icon" size={20} strokeWidth={2.25} aria-hidden="true"/>}
                  {showLabels && <span className="cds-nav-label">{view.label}</span>}
                  {active && <span className="cds-nav-active-marker" aria-hidden="true"/>}
                </button>
              );
            })}
          </section>
        ))}
      </div>
      {!mobile && onToggleExpanded && (
        <button type="button" onClick={onToggleExpanded} className="cds-nav-collapse" aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}>
          {expanded ? <PanelLeftClose size={18} strokeWidth={2.2}/> : <PanelLeft size={18} strokeWidth={2.2}/>}
          {expanded && <span className="cds-nav-collapse-label">Collapse navigation</span>}
        </button>
      )}
    </nav>
  );
}

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [expanded, setExpanded] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1200px)').matches);
  const mobileNavLayerRef = useRef<HTMLDivElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => {
      mobileNavLayerRef.current?.querySelector<HTMLElement>('nav button:not([disabled])')?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileNavOpen(false);
        mobileMenuButtonRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab') return;
      const root = mobileNavLayerRef.current;
      if (!root) return;
      const focusable = Array.from(root.querySelectorAll<HTMLElement>('.cds-navigation button:not([disabled]), .cds-navigation a[href], .cds-navigation input:not([disabled]), .cds-navigation [tabindex]:not([tabindex="-1"])'))
        .filter(element => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
      mobileMenuButtonRef.current?.focus();
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileSearchOpen) return;
    const frame = window.requestAnimationFrame(() => mobileSearchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [mobileSearchOpen]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1200px)');
    const onBreakpointChange = (event: MediaQueryListEvent) => setExpanded(event.matches);
    desktop.addEventListener('change', onBreakpointChange);
    return () => desktop.removeEventListener('change', onBreakpointChange);
  }, []);

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


  const currentView = CDS_VIEWS.find(v => v.id === activeView);

  const selectView = (view: CDSView) => {
    setActiveView(view);
    setMobileNavOpen(false);
    setMobileSearchOpen(false);
  };

  const openSearchResult = (result: { id: string; title: string; detail: string; target: CDSView; source: string }) => {
    setActiveView(result.target);
    setHeaderSearchOpen(false);
    setMobileSearchOpen(false);
    useCDSStore.getState().openDrawer(result.source + ' · ' + result.title, (
      <div className="space-y-3 text-sm">
        <div className="text-xs font-semibold uppercase tracking-wider text-cyan-300">{result.source} record search result</div>
        <div className="font-bold text-text-0 break-all">{result.title}</div>
        <div className="text-text-2 break-words">{result.detail || 'No additional summary fields are recorded.'}</div>
        <div className="text-xs text-text-2">Record ID: {result.id || 'not returned by API'}</div>
        <div className="text-xs text-text-2">Search uses live tenant-scoped CDS API results. Open the {result.source.toLowerCase()} workspace to continue operational work.</div>
      </div>
    ));
  };

  const searchResultsPanel = headerSearchOpen ? (
    <div role="listbox" aria-label="CDS search results" className="cds-search-results">
      <div className="cds-search-results-heading">
        {headerSearchPartial ? 'Partial results · one or more sources unavailable' : headerResults.length ? headerResults.length + ' matching records' : 'No matching records'}
      </div>
      {headerResults.map((result, index) => (
        <button key={result.source + ':' + result.id + ':' + index} type="button" role="option" aria-selected={false} onClick={() => openSearchResult(result)} className="cds-search-result">
          <span className="cds-search-result-title">{result.title}</span>
          <span className="cds-search-result-source">{result.source}</span>
          <span className="cds-search-result-detail">{result.detail || 'No secondary fields recorded'}</span>
        </button>
      ))}
      <button type="button" onClick={() => setHeaderSearchOpen(false)} className="cds-search-results-close">Close results · Esc</button>
    </div>
  ) : null;

  return (
    <div className="cds-shell flex h-dvh overflow-hidden">
      <a className="cds-skip-link" href="#cds-main-content">Skip to workspace</a>
      <CDSNavigation expanded={expanded} activeView={activeView} onSelect={selectView} onBack={() => nav({ to: '/' })} onToggleExpanded={() => setExpanded(value => !value)} />

      {mobileNavOpen && (
        <div id="cds-mobile-navigation" ref={mobileNavLayerRef} className="cds-mobile-nav-layer" role="dialog" aria-modal="true" aria-label="Container Management navigation">
          <button type="button" className="cds-mobile-nav-scrim" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />
          <CDSNavigation expanded={true} activeView={activeView} mobile onSelect={selectView} onBack={() => { setMobileNavOpen(false); nav({ to: '/' }); }} onClose={() => setMobileNavOpen(false)} />
        </div>
      )}

      <div className="cds-main">
        <header className="cds-topbar">
          <button ref={mobileMenuButtonRef} type="button" className="cds-mobile-menu" onClick={() => setMobileNavOpen(true)} aria-label="Open Container Management navigation" aria-controls="cds-mobile-navigation" aria-expanded={mobileNavOpen}>
            <Menu size={22} strokeWidth={2.4}/>
          </button>

          <div className="cds-topbar-heading">
            <span className="cds-topbar-eyebrow">CONTAINER MANAGEMENT / CDS</span>
            <strong>{currentView?.label ?? 'Operations overview'}</strong>
            <small>{currentView?.sub ?? 'Operational control workspace'}</small>
          </div>

          <div className="cds-desktop-search">
            <Search size={18} strokeWidth={2.2} className="cds-search-icon"/>
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
              className="cds-search-input"
            />
            {headerSearching && <span className="cds-searching-label">Searching</span>}
            {searchResultsPanel}
          </div>

          <button type="button" className="cds-mobile-search-toggle" onClick={() => { setMobileSearchOpen(value => !value); setHeaderSearchOpen(false); }} aria-label={mobileSearchOpen ? 'Close search' : 'Open search'} aria-expanded={mobileSearchOpen}>
            {mobileSearchOpen ? <X size={21} strokeWidth={2.3}/> : <Search size={21} strokeWidth={2.3}/>}
          </button>

          <div className="cds-topbar-clock">{clock}</div>
          <button type="button" title="Open booking health and exceptions" aria-label="Open booking health and exceptions" onClick={() => setActiveView('pulse')} className="cds-alert-button">
            <Bell size={19} strokeWidth={2.2}/>
          </button>
        </header>

        {mobileSearchOpen && (
          <div className="cds-mobile-search-row">
            <div className="cds-mobile-search-field">
              <Search size={18} strokeWidth={2.2} aria-hidden="true"/>
              <input
                ref={mobileSearchInputRef}
                value={headerQuery}
                onChange={event => setHeaderQuery(event.target.value)}
                onFocus={() => { if (headerResults.length) setHeaderSearchOpen(true); }}
                onKeyDown={event => {
                  if (event.key === 'Enter') { event.preventDefault(); void runHeaderSearch(); }
                  if (event.key === 'Escape') { setHeaderSearchOpen(false); setMobileSearchOpen(false); }
                }}
                aria-label="Search CDS trips, containers and e-locks"
                aria-expanded={headerSearchOpen}
                placeholder="Search trips, containers, locks…"
              />
              {headerSearching && <span>Searching</span>}
            </div>
            {searchResultsPanel}
          </div>
        )}

        <main id="cds-main-content" className="cds-view-scroll" style={{ overscrollBehavior: 'contain' }}>
          <div key={activeView} className="cds-view-stage">
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
            {activeView === 'reports' && <ReportsView />}
            {activeView === 'analytics' && <AnalyticsView />}
            {activeView === 'settings' && <SettingsView />}
          </div>
        </main>
      </div>

      <CDSDrawer />
      <CDSToastContainer />
    </div>
  );
}

function DashboardView() {
  const { data: kpis, isLoading } = useDashboardKPIs();
  const { data: activity } = useActivity(20);
  const { data: liveData, isLoading: liveLoading, isError: liveError } = useLiveTrips();
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const { setActiveView } = useCDSStore();
  const trips = liveData?.data ?? [];
  const selectedTrip = trips.find(trip => trip.id === selectedMapId) ?? null;
  const { data: trackData } = useVehicleTrack(selectedTrip?.vehicle_id ?? null);
  const track = ((trackData?.data ?? []) as Record<string, unknown>[])
    .map(point => ({ lat: Number(point['lat']), lng: Number(point['lng']) }));
  const locatedTrips = trips.filter(positioned);
  const freshFixes = trips.filter(trip => trip.position_is_live).length;

  if (isLoading) return <LoadingState />;

  const kv = (key: string) => String(kpis?.[key] ?? 0);
  const avgHrs = Number(kpis?.['avg_transit_hours'] ?? 0);
  const avgH = Math.floor(avgHrs);
  const avgM = Math.round((avgHrs - avgH) * 60);
  const cards = [
    { label: 'REGISTERED CONTAINERS', value: kv('active_containers'), delta: 'organisation inventory', trend: 'up' as const },
    { label: 'IN TRANSIT', value: kv('in_transit'), delta: 'operational trips', trend: 'up' as const },
    { label: 'ACTIVE LOCKS', value: kv('active_locks'), delta: 'assigned or installed', trend: 'up' as const },
    { label: 'LOCKS REMOVED', value: kv('locks_removed'), delta: 'unclamped', trend: 'up' as const },
    { label: 'PENDING UNCLAMP', value: kv('pending_unclamp'), delta: 'port clearance queue', trend: 'down' as const },
    { label: 'DELIVERED TODAY', value: kv('delivered_today'), delta: 'recorded deliveries', trend: 'up' as const },
    { label: 'DELAYED', value: kv('delayed_trips'), delta: 'needs attention', trend: 'down' as const },
    { label: 'AVG TRANSIT TIME', value: avgHrs ? `${avgH}h ${avgM}m` : '—', delta: 'completed trips', trend: 'up' as const },
  ];

  const actIcons: Record<string, LucideIcon> = {
    clamp: Lock, depart: Truck, checkpoint: MapPin, sync: RefreshCw,
    arrival: CheckCircle2, unclamp: Unlock, ai: BrainCircuit, alert: AlertTriangle,
  };

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        {cards.map(card => <KPICard key={card.label} label={card.label} value={card.value} delta={card.delta} trend={card.trend} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <section className="cds-panel lg:col-span-2 min-w-0 rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-bold text-sm text-text-0">Live movement</div>
            <div className="text-[10px] font-mono text-text-2">
              {liveLoading ? 'Checking position feed' : `${freshFixes} fresh · ${locatedTrips.length} with a recorded position · ${trips.length} open trips`}
            </div>
          </div>
          <div className="h-[300px] overflow-hidden rounded-xl bg-ink-2 relative">
            {liveError ? (
              <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
                <div>
                  <div className="text-[12px] font-semibold text-text-0">Live movement feed unavailable</div>
                  <div className="mt-1 text-[10px] text-text-2">No sample or inferred positions are shown.</div>
                </div>
              </div>
            ) : locatedTrips.length > 0 ? (
              <LiveFleetMap trips={trips} selectedId={selectedMapId} onSelect={setSelectedMapId} track={track} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center px-6"
                style={{ background: 'linear-gradient(rgba(120,190,255,0.055) 1px, transparent 1px) 0 0/40px 40px, linear-gradient(90deg, rgba(120,190,255,0.055) 1px, transparent 1px) 0 0/40px 40px, #0b1627' }}>
                <div className="max-w-sm text-center">
                  <MapPin size={20} strokeWidth={1.6} className="mx-auto mb-2 text-white/30" aria-hidden="true" />
                  <div className="text-[11px] leading-relaxed text-text-2">
                    {liveLoading
                      ? 'Loading authorised position evidence…'
                      : trips.length === 0
                        ? 'No open trips. Vehicles appear when a trip has a recorded position.'
                        : `${trips.length} open trips have no available position fix. Operational status is not GPS proof.`}
                  </div>
                  <button type="button" onClick={() => setActiveView('live')} className="mt-3 rounded-md border border-white/10 px-3 py-2 text-[10px] font-semibold text-text-1 hover:bg-white/[.05]">
                    Open Live Movement
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[9px] text-white/35">
            <span>Fresh fixes are distinguished from last-known positions.</span>
            <button type="button" onClick={() => setActiveView('live')} className="font-semibold text-[#a8c9ee] hover:text-white">View trip register →</button>
          </div>
        </section>

        <section className="cds-panel min-w-0 rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
          <div className="font-bold text-sm text-text-0 mb-3">Recent activity</div>
          <div className="space-y-0 max-h-[340px] overflow-y-auto">
            {(activity ?? []).map((item, index) => {
              const Icon = actIcons[String(item['icon'] ?? item['type'] ?? '')] ?? FileText;
              return (
                <div key={String(item['id'] ?? index)} className="flex items-start gap-2.5 py-2 border-b border-white/[.05] last:border-0">
                  <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md border border-white/[.07] bg-white/[.025] text-text-2">
                    <Icon size={14} strokeWidth={1.8} aria-hidden="true" />
                  </span>
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
              );
            })}
            {(activity ?? []).length === 0 && (
              <div className="text-xs text-text-2 text-center py-8 font-mono">No recent activity</div>
            )}
          </div>
        </section>
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
      <div className="cds-panel rounded-2xl border border-white/[.07] bg-white/[.02] p-4 mb-4">
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
              style={{ background: 'linear-gradient(rgba(120,190,255,0.055) 1px, transparent 1px) 0 0/40px 40px, linear-gradient(90deg, rgba(120,190,255,0.055) 1px, transparent 1px) 0 0/40px 40px, #0b1627' }}>
              <div className="text-center text-text-2 text-[11px] font-mono leading-relaxed">
                {trips.length === 0
                  ? 'No open trips — the map draws vehicles once a trip is dispatched'
                  : `${trips.length} open trip${trips.length === 1 ? '' : 's'}, none reporting GPS yet — check the tracker on ${trips.map(t => t.vehicle_reg || t.trip_number).slice(0, 3).join(', ')}`}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="cds-panel rounded-2xl border border-white/[.07] bg-white/[.02] p-4">
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
    <div className="cds-loading-state" role="status" aria-live="polite">
      <div className="cds-loading-orbit" aria-hidden="true">
        <span className="cds-loading-core" />
        <span className="cds-loading-satellite" />
      </div>
      <div className="cds-loading-title">Synchronising operational data</div>
      <div className="cds-loading-caption">Connecting to the authorised CDS workspace</div>
    </div>
  );
}
