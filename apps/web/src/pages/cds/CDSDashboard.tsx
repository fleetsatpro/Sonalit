import { useNavigate } from '@tanstack/react-router';
import {
  Search, Bell, ChevronLeft, PanelLeftClose, PanelLeft, Menu, X, ArrowUpRight,
} from 'lucide-react';
import { lazy, memo, Suspense, useState, useEffect, useRef } from 'react';
import './CDSDesignSystem.css';
import './CDSOverviewVisual.css';
import './CDSCosmicVisual.css';
import './CDSOperationalPolish.css';
import './CDSGildedEdgeVisual.css';

import { useAuthStore } from '../../stores/auth.js';
import { NavArtwork } from '../../components/layout/Rail.js';

import { CDSDrawer, CDSToastContainer } from './components.js';
import { CDS_VIEWS } from './constants.js';
import { useDashboardKPIs, useActivity, useLiveTrips, useVehicleTrack, useTransitionTrip, useMarkDeparted } from './hooks.js';
import { useCDSStore, type CDSView } from './store.js';
import { useCDSRealtime } from './useCDSRealtime.js';
import cdsApi from './api.js';

import type { LiveTrip } from './LiveFleetMap.js';

const CDSLiveFleetMap = lazy(() => import('./LiveFleetMap.js').then(module => ({ default: module.LiveFleetMap })));
const ContainersView = lazy(() => import('./CDSDataPage.js').then(module => ({ default: module.ContainersView })));
const BookingsView = lazy(() => import('./CDSDataPage.js').then(module => ({ default: module.BookingsView })));
const TransportersView = lazy(() => import('./CDSDataPage.js').then(module => ({ default: module.TransportersView })));
const LocksView = lazy(() => import('./pages.js').then(module => ({ default: module.LocksView })));
const PortView = lazy(() => import('./pages.js').then(module => ({ default: module.PortView })));
const PulseView = lazy(() => import('./pages.js').then(module => ({ default: module.PulseView })));
const InboxView = lazy(() => import('./pages.js').then(module => ({ default: module.InboxView })));
const ReportsView = lazy(() => import('./pages.js').then(module => ({ default: module.ReportsView })));
const AnalyticsView = lazy(() => import('./pages.js').then(module => ({ default: module.AnalyticsView })));
const SettingsView = lazy(() => import('./pages.js').then(module => ({ default: module.SettingsView })));

function isPositionedTrip(trip: LiveTrip): boolean {
  const valid = (value: number | string | null) =>
    value != null && String(value).trim() !== '' && Number.isFinite(Number(value));
  return valid(trip.lat) && valid(trip.lng);
}

function currentCDSClock(): string {
  const time = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Nairobi',
  }).format(new Date());
  return `${time} EAT`;
}

function CDSClock() {
  const [clock, setClock] = useState(currentCDSClock);
  useEffect(() => {
    let interval: number | undefined;
    const delay = 60_000 - (Date.now() % 60_000);
    const timeout = window.setTimeout(() => {
      setClock(currentCDSClock());
      interval = window.setInterval(() => setClock(currentCDSClock()), 60_000);
    }, delay);
    return () => {
      window.clearTimeout(timeout);
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, []);
  return <div className="cds-topbar-clock">{clock}</div>;
}

function CDSWorkspaceFallback() {
  return (
    <div className="cds-loading-state" role="status" aria-live="polite">
      <div className="cds-loading-title">Opening workspace</div>
      <div className="cds-loading-caption">Loading the selected operational tools</div>
      <div className="mt-2 h-1 w-40 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/2 rounded-full bg-[#83bdff] animate-pulse" />
      </div>
    </div>
  );
}

const CDS_MODULE_HEADINGS: Partial<Record<CDSView, { eyebrow: string; description: string }>> = {
  live: {
    eyebrow: 'MOVEMENT CONTROL / POSITION EVIDENCE',
    description: 'Review open journeys, distinguish current GPS fixes from last-known positions and inspect vehicle movement.',
  },
  locks: {
    eyebrow: 'EQUIPMENT SECURITY / DEVICE CONTROL',
    description: 'Review e-lock connectivity, battery condition, assignments and integrity events across the equipment fleet.',
  },
  port: {
    eyebrow: 'PORT OPERATIONS / RELEASE CONTROL',
    description: 'Verify arrivals and coordinate lock removal against recorded delivery and custody evidence.',
  },
  pulse: {
    eyebrow: 'BOOKING CONTROL / LIFECYCLE MONITORING',
    description: 'Identify ageing bookings, delayed journeys and records that need an operator review.',
  },
  analytics: {
    eyebrow: 'OPERATIONAL INTELLIGENCE / PERFORMANCE',
    description: 'Explore measured throughput, equipment utilisation, delivery performance and recorded operational trends.',
  },
  reports: {
    eyebrow: 'RECORDS & ASSURANCE / REPORTING',
    description: 'Generate and retrieve operational reports from persisted activity and evidence-backed records.',
  },
  settings: {
    eyebrow: 'WORKSPACE GOVERNANCE / CONFIGURATION',
    description: 'Manage Container Management workspace preferences and controlled field access.',
  },
};

function CDSModuleHeading({ activeView }: { activeView: CDSView }) {
  const meta = CDS_MODULE_HEADINGS[activeView];
  const view = CDS_VIEWS.find(item => item.id === activeView);
  if (!meta || !view) return null;

  return (
    <header className="cds-module-heading" aria-labelledby={`cds-module-heading-${activeView}`}>
      <div className="cds-module-heading__copy">
        <span className="cds-module-heading__eyebrow">{meta.eyebrow}</span>
        <h1 id={`cds-module-heading-${activeView}`}>{view.label}</h1>
        <p>{meta.description}</p>
      </div>
      <span className="cds-module-heading__context">CONTAINER MANAGEMENT <i aria-hidden="true">/</i> CDS</span>
    </header>
  );
}

const CDSWorkspace = memo(function CDSWorkspace({ activeView }: { activeView: CDSView }) {
  return (
    <div key={activeView} className="cds-view-stage" data-view={activeView}>
      <CDSModuleHeading activeView={activeView} />
      <Suspense fallback={<CDSWorkspaceFallback />}>
        {activeView === 'dashboard' && <DashboardView />}
        {activeView === 'live' && <LiveView />}
        {activeView === 'containers' && <ContainersView />}
        {activeView === 'bookings' && <BookingsView />}
        {activeView === 'locks' && <LocksView />}
        {activeView === 'transporters' && <TransportersView />}
        {activeView === 'port' && <PortView />}
        {activeView === 'pulse' && <PulseView />}
        {activeView === 'inbox' && <InboxView />}
        {activeView === 'reports' && <ReportsView />}
        {activeView === 'analytics' && <AnalyticsView />}
        {activeView === 'settings' && <SettingsView />}
      </Suspense>
    </div>
  );
});

const CDS_NAV_ARTWORK: Record<CDSView, string> = {
  dashboard: 'nav-command',
  live: 'nav-gps',
  bookings: 'nav-dossier',
  port: 'nav-ship',
  pulse: 'nav-analytics',
  containers: 'nav-ship',
  locks: 'nav-shield',
  transporters: 'nav-suv',
  inbox: 'nav-headset',
  analytics: 'nav-analytics',
  reports: 'nav-dossier',
  settings: 'nav-command',
};

const NAV_SECTIONS: { label: string; ids: string[] }[] = [
  { label: 'Command', ids: ['dashboard', 'live'] },
  { label: 'Movement', ids: ['bookings', 'port', 'pulse'] },
  { label: 'Equipment', ids: ['containers', 'locks'] },
  { label: 'Partners & Carriers', ids: ['transporters'] },
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
        <div className="cds-brand-mark" aria-hidden="true"><NavArtwork name="nav-ship" className="cds-brand-artwork" /></div>
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
              const art = CDS_NAV_ARTWORK[id as CDSView];
              const active = activeView === id;
              return (
                <button key={id} type="button" onClick={() => onSelect(id as CDSView)} title={showLabels ? undefined : view.label} aria-label={view.label} aria-current={active ? 'page' : undefined} className={`cds-nav-item ${active ? 'is-active' : ''}`}>
                  <span className="cds-nav-artwork-tile" aria-hidden="true">
                    <NavArtwork name={art} className="cds-nav-artwork" />
                  </span>
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
  const activeView = useCDSStore(state => state.activeView);
  const setActiveView = useCDSStore(state => state.setActiveView);
  const addToast = useCDSStore(state => state.addToast);
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
  const mobileSearchButtonRef = useRef<HTMLButtonElement>(null);
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
          <button ref={mobileMenuButtonRef} type="button" className="cds-mobile-menu" onClick={() => { setMobileSearchOpen(false); setHeaderSearchOpen(false); setMobileNavOpen(true); }} aria-label="Open Container Management navigation" aria-expanded={mobileNavOpen}>
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

          <button ref={mobileSearchButtonRef} type="button" className="cds-mobile-search-toggle" onClick={() => { setMobileSearchOpen(value => !value); setHeaderSearchOpen(false); }} aria-label={mobileSearchOpen ? 'Close search' : 'Open search'} aria-expanded={mobileSearchOpen}>
            {mobileSearchOpen ? <X size={21} strokeWidth={2.3}/> : <Search size={21} strokeWidth={2.3}/>}
          </button>

          <CDSClock />
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
                  if (event.key === 'Escape') {
                    setHeaderSearchOpen(false);
                    setMobileSearchOpen(false);
                    mobileSearchButtonRef.current?.focus();
                  }
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
          <CDSWorkspace activeView={activeView} />
        </main>
      </div>

      <CDSDrawer />
      <CDSToastContainer />
    </div>
  );
}

interface OverviewMetricCardProps {
  index: string;
  label: string;
  value: string;
  detail: string;
  image: string;
  tone: 'blue' | 'cyan' | 'teal' | 'amber' | 'red' | 'violet';
  onOpen: () => void;
}

function OverviewMetricCard({ index, label, value, detail, image, tone, onOpen }: OverviewMetricCardProps) {
  const [displayValue, setDisplayValue] = useState(value === '—' ? value : '0');
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (hasAnimated.current) {
      setDisplayValue(value);
      return;
    }
    hasAnimated.current = true;
    const target = Number(value);
    if (!Number.isFinite(target)) {
      setDisplayValue(value);
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setDisplayValue(value);
      return;
    }

    const startedAt = performance.now();
    let frame = 0;
    const duration = Math.min(760, Math.max(280, target * 18 + 180));
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(Math.round(target * eased).toLocaleString('en-GB'));
      if (progress < 1) frame = window.requestAnimationFrame(tick);
      else setDisplayValue(value);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  return (
    <button
      type="button"
      onClick={onOpen}
      className={'cds-overview-metric cds-overview-metric--' + tone}
      aria-label={label + ': ' + value + '. ' + detail + '. Open related workspace.'}
      style={{ animationDelay: (Number(index) - 1) * 55 + 'ms' }}
    >
      <span className="cds-overview-metric__head">
        <span className="cds-overview-metric__label">{label}</span>
        <span className="cds-overview-metric__index">{index}</span>
      </span>
      <span className="cds-overview-metric__media" aria-hidden="true">
        <img src={image} alt="" loading="lazy" decoding="async" />
        <span className="cds-overview-metric__media-shade" />
      </span>
      <span className="cds-overview-metric__value" aria-live="off">{displayValue}</span>
      <span className="cds-overview-metric__detail">{detail}</span>
      <span className="cds-overview-metric__trace" aria-hidden="true" />
    </button>
  );
}

function DashboardView() {
  const kpiQuery = useDashboardKPIs();
  const { data: kpis, isLoading, isError: kpiError, refetch: refetchKpis } = kpiQuery;
  const { data: activity, isError: activityError } = useActivity(20);
  const { data: liveData, isLoading: liveLoading, isError: liveError } = useLiveTrips();
  const [selectedMapId, setSelectedMapId] = useState<string | null>(null);
  const { setActiveView } = useCDSStore();
  const trips = liveData?.data ?? [];
  const selectedTrip = trips.find(trip => trip.id === selectedMapId) ?? null;
  const { data: trackData } = useVehicleTrack(selectedTrip?.vehicle_id ?? null);
  const track = ((trackData?.data ?? []) as Record<string, unknown>[])
    .map(point => ({ lat: Number(point['lat']), lng: Number(point['lng']) }));
  const locatedTrips = trips.filter(isPositionedTrip);
  const freshFixes = trips.filter(trip => trip.position_is_live).length;

  if (isLoading) return <LoadingState />;

  const kv = (key: string) => kpis ? String(kpis[key] ?? 0) : '—';
  const delayedCount = Number(kpis?.['delayed_trips'] ?? 0);
  const pendingUnclampCount = Number(kpis?.['pending_unclamp'] ?? 0);
  const unacknowledgedCount = Number(kpis?.['unacknowledged_alerts'] ?? 0);
  const avgHrs = Number(kpis?.['avg_transit_hours'] ?? 0);
  const avgTotalMinutes = Number.isFinite(avgHrs) && avgHrs > 0 ? Math.round(avgHrs * 60) : 0;
  const avgH = Math.floor(avgTotalMinutes / 60);
  const avgM = avgTotalMinutes % 60;
  const avgTransit = avgTotalMinutes > 0 ? String(avgH) + 'h ' + String(avgM).padStart(2, '0') + 'm' : '—';
  const todayLabel = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric',
  }).format(new Date());

  const metrics: OverviewMetricCardProps[] = [
    {
      index: '01',
      label: 'REGISTERED CONTAINERS',
      value: kv('active_containers'),
      detail: 'Organisation-wide equipment register',
      image: 'https://images.unsplash.com/photo-1700716465891-9e5e9f501d7d?auto=format&fit=crop&w=560&q=82',
      tone: 'blue',
      onOpen: () => setActiveView('containers'),
    },
    {
      index: '02',
      label: 'ACTIVE MOVEMENTS',
      value: kv('in_transit'),
      detail: 'Dispatched, checkpoint, delayed or at port',
      image: 'https://images.unsplash.com/photo-1766561994067-dbd575e1cff2?auto=format&fit=crop&w=560&q=82',
      tone: 'cyan',
      onOpen: () => setActiveView('live'),
    },
    {
      index: '03',
      label: 'ACTIVE E-LOCKS',
      value: kv('active_locks'),
      detail: 'Assigned or installed devices',
      image: 'https://images.unsplash.com/photo-1654944932871-20b64b5b800a?auto=format&fit=crop&w=560&q=82',
      tone: 'teal',
      onOpen: () => setActiveView('locks'),
    },
    {
      index: '04',
      label: 'DELAYED TRIPS',
      value: kv('delayed_trips'),
      detail: 'Movements requiring operator review',
      image: 'https://images.unsplash.com/photo-1759273560543-7f0e66af2a4d?auto=format&fit=crop&w=560&q=82',
      tone: delayedCount > 0 ? 'red' : 'blue',
      onOpen: () => setActiveView('pulse'),
    },
  ];

  const secondaryMetrics = [
    { label: 'PENDING UNCLAMP', value: kv('pending_unclamp'), detail: 'Arrived with lock attached', tone: pendingUnclampCount > 0 ? 'amber' : 'neutral', onOpen: () => setActiveView('port') },
    { label: 'LOCKS REMOVED', value: kv('locks_removed'), detail: 'Recorded as unclamped', tone: 'violet', onOpen: () => setActiveView('locks') },
    { label: 'DELIVERED TODAY', value: kv('delivered_today'), detail: 'By recorded delivery time', tone: 'teal', onOpen: () => setActiveView('live') },
    { label: 'UNACKNOWLEDGED ALERTS', value: kv('unacknowledged_alerts'), detail: 'Alerts awaiting acknowledgement', tone: unacknowledgedCount > 0 ? 'red' : 'neutral', onOpen: () => setActiveView('inbox') },
    { label: 'AVERAGE TRANSIT TIME', value: kpis ? avgTransit : '—', detail: 'Completed trips with both timestamps', tone: 'blue', onOpen: () => setActiveView('analytics') },
  ];

  const phaseCounts = [
    { label: 'MOVING', count: trips.filter(trip => trip.phase === 'moving').length, tone: 'moving' },
    { label: 'AT PORT', count: trips.filter(trip => trip.phase === 'at_port').length, tone: 'port' },
    { label: 'AWAITING DEPARTURE', count: trips.filter(trip => trip.phase === 'staged').length, tone: 'staged' },
  ];

  const phaseTotal = phaseCounts.reduce((total, phase) => total + phase.count, 0);

  const activityTags: Record<string, { label: string; tone: string }> = {
    clamp: { label: 'CLAMP', tone: 'blue' },
    depart: { label: 'DEPART', tone: 'cyan' },
    checkpoint: { label: 'CHECKPOINT', tone: 'amber' },
    sync: { label: 'SYNC', tone: 'neutral' },
    arrival: { label: 'ARRIVAL', tone: 'teal' },
    unclamp: { label: 'UNCLAMP', tone: 'violet' },
    ai: { label: 'INTELLIGENCE', tone: 'violet' },
    alert: { label: 'ALERT', tone: 'red' },
    tamper: { label: 'SEAL ALERT', tone: 'red' },
  };

  return (
    <main className="cds-overview">
      <header className="cds-overview-heading">
        <div className="cds-overview-heading__copy">
          <div className="cds-overview-eyebrow">CONTAINER MANAGEMENT <span>/</span> OPERATIONAL INTELLIGENCE</div>
          <h1>Operations overview</h1>
          <p>A consolidated operating picture of container custody, movement phases and equipment readiness.</p>
        </div>
        <div className="cds-overview-date">
          <span className="cds-overview-date__label">OPERATIONAL SNAPSHOT</span>
          <time>{todayLabel}</time>
          <span className="cds-overview-date__sub">Tenant-wide register · Refreshes every 30 seconds</span>
        </div>
      </header>

      {kpiError && !kpis && (
        <div className="cds-overview-error" role="alert">
          <div><strong>Operational metrics unavailable</strong><span>The dashboard could not retrieve its tenant-scoped KPI snapshot. No placeholder totals are being shown.</span></div>
          <button type="button" onClick={() => void refetchKpis()}>Retry metrics</button>
        </div>
      )}

      {(delayedCount > 0 || pendingUnclampCount > 0 || unacknowledgedCount > 0) && (
        <section className="cds-overview-attention" aria-label="Operational attention required">
          <div className="cds-overview-attention__copy">
            <span className="cds-overview-attention__rule" aria-hidden="true" />
            <div>
              <strong>Operator attention</strong>
              <span>
                {[
                  delayedCount > 0 ? delayedCount + ' delayed ' + (delayedCount === 1 ? 'movement' : 'movements') : '',
                  pendingUnclampCount > 0 ? pendingUnclampCount + ' ' + (pendingUnclampCount === 1 ? 'arrival' : 'arrivals') + ' awaiting unclamp' : '',
                  unacknowledgedCount > 0 ? unacknowledgedCount + ' unacknowledged ' + (unacknowledgedCount === 1 ? 'alert' : 'alerts') : '',
                ].filter(Boolean).join(' · ')}
              </span>
            </div>
          </div>
          <div className="cds-overview-attention__actions">
            {delayedCount > 0 && <button type="button" onClick={() => setActiveView('pulse')}>Review delays</button>}
            {pendingUnclampCount > 0 && <button type="button" onClick={() => setActiveView('port')}>Open port queue</button>}
            {unacknowledgedCount > 0 && <button type="button" onClick={() => setActiveView('inbox')}>Review alerts</button>}
          </div>
        </section>
      )}

      <section className="cds-overview-primary" aria-label="Primary operational metrics">
        {metrics.map(metric => <OverviewMetricCard key={metric.index} {...metric} />)}
      </section>

      <section className="cds-overview-secondary" aria-label="Operational flow indicators">
        <div className="cds-overview-secondary__heading">
          <span>OPERATIONS PULSE</span>
          <span>QUEUE · COMPLETION · EFFICIENCY</span>
        </div>
        <div className="cds-overview-secondary__grid">
          {secondaryMetrics.map((metric, index) => (
            <button
              key={metric.label}
              type="button"
              className={'cds-overview-secondary__item cds-overview-secondary__item--' + metric.tone}
              onClick={metric.onOpen}
              style={{ animationDelay: (index * 45) + 'ms' }}
              aria-label={metric.label + ': ' + metric.value + '. ' + metric.detail + '.'}
            >
              <span className="cds-overview-secondary__label">{metric.label}</span>
              <span className="cds-overview-secondary__value">{metric.value}</span>
              <span className="cds-overview-secondary__detail">{metric.detail}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="cds-overview-workspace">
        <section className="cds-overview-panel cds-overview-movement" aria-label="Live movement picture">
          <div className="cds-overview-panel__heading">
            <div>
              <span className="cds-overview-panel__eyebrow">MOVEMENT PICTURE</span>
              <h2>Live movement</h2>
              <p>{liveLoading ? 'Checking the authorised position feed' : trips.length + ' open trips · ' + locatedTrips.length + ' with a recorded position · ' + freshFixes + ' fresh GPS fixes'}</p>
            </div>
            <button type="button" className="cds-overview-panel__link" onClick={() => setActiveView('live')}>Open trip register <ArrowUpRight size={13} aria-hidden="true" /></button>
          </div>

          <div className="cds-overview-phase-strip" aria-label="Open movement phases">
            {phaseCounts.map(phase => (
              <div key={phase.label} className={'cds-overview-phase cds-overview-phase--' + phase.tone}>
                <span className="cds-overview-phase__count">{phase.count.toLocaleString('en-GB')}</span>
                <span className="cds-overview-phase__label">{phase.label}</span>
              </div>
            ))}
          </div>

          <div
            className="cds-overview-phase-distribution"
            role="img"
            aria-label={phaseTotal > 0
              ? 'Open-trip distribution: ' + phaseCounts.map(phase => phase.label.toLowerCase() + ' ' + phase.count).join(', ')
              : 'No open trips to distribute by phase'}
          >
            <div className="cds-overview-phase-distribution__track" aria-hidden="true">
              {phaseCounts.map(phase => (
                <span
                  key={phase.label}
                  className={'cds-overview-phase-distribution__segment cds-overview-phase-distribution__segment--' + phase.tone}
                  style={{ width: phaseTotal > 0 ? (phase.count / phaseTotal * 100) + '%' : '0%' }}
                />
              ))}
            </div>
            <div className="cds-overview-phase-distribution__caption">
              <span>OPEN TRIP DISTRIBUTION</span>
              <span>{phaseTotal.toLocaleString('en-GB')} {phaseTotal === 1 ? 'record' : 'records'} · current movement phase</span>
            </div>
          </div>

          <div className="cds-overview-map">
            {liveError ? (
              <div className="cds-overview-map-state">
                <div className="cds-overview-map-state__title">Live movement feed unavailable</div>
                <div className="cds-overview-map-state__detail">No sample, interpolated or inferred vehicle positions are shown.</div>
              </div>
            ) : locatedTrips.length > 0 ? (
              <CDSLiveFleetMap trips={trips} selectedId={selectedMapId} onSelect={setSelectedMapId} track={track} />
            ) : (
              <div className="cds-overview-map-state">
                <div className="cds-overview-reticle" aria-hidden="true"><span /></div>
                <div className="cds-overview-map-state__title">
                  {liveLoading ? 'Checking position evidence' : trips.length === 0 ? 'No open movements' : 'No current position fixes'}
                </div>
                <div className="cds-overview-map-state__detail">
                  {liveLoading
                    ? 'Authorised GPS evidence is being requested from the tracking service.'
                    : trips.length === 0
                      ? 'Vehicles will appear when open trips have recorded positions.'
                      : trips.length + ' open ' + (trips.length === 1 ? 'trip has' : 'trips have') + ' no available position fix. Operational status is not GPS proof.'}
                </div>
                <button type="button" onClick={() => setActiveView('live')}>Inspect live movement</button>
              </div>
            )}
          </div>
          <div className="cds-overview-map-foot">
            <span>POSITION PROVENANCE</span>
            <span>Fresh fixes are distinguished from last-known positions. Unlocated trips remain visible in the register.</span>
          </div>
        </section>

        <section className="cds-overview-panel cds-overview-activity" aria-label="Recent operational activity">
          <div className="cds-overview-panel__heading cds-overview-activity__heading">
            <div>
              <span className="cds-overview-panel__eyebrow">AUDIT STREAM</span>
              <h2>Recent activity</h2>
              <p>Latest custody and movement events</p>
            </div>
            <button type="button" className="cds-overview-panel__link" onClick={() => setActiveView('inbox')}>View all <ArrowUpRight size={13} aria-hidden="true" /></button>
          </div>
          <div className="cds-overview-activity__list">
            {(activity ?? []).map((item, index) => {
              const rawType = String(item['icon'] ?? item['type'] ?? 'event').toLowerCase();
              const tag = activityTags[rawType] ?? (rawType.includes('tamper') ? activityTags['tamper'] : { label: 'EVENT', tone: 'neutral' });
              const rawTime = item['created_at'] ? new Date(String(item['created_at'])) : null;
              const eventTime = rawTime && Number.isFinite(rawTime.getTime())
                ? rawTime.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                : 'TIME NOT RECORDED';
              const description = String(item['description'] ?? item['text'] ?? 'Operational event');
              const detail = item['meta'] ? String(item['meta']) : '';
              return (
                <article key={String(item['id'] ?? index)} className="cds-overview-event">
                  <span className={'cds-overview-event__rail cds-overview-event__rail--' + tag.tone} aria-hidden="true" />
                  <div className="cds-overview-event__body">
                    <div className="cds-overview-event__topline">
                      <span className={'cds-overview-event__tag cds-overview-event__tag--' + tag.tone}>{tag.label}</span>
                      <time>{eventTime}</time>
                    </div>
                    <p>{description}</p>
                    {detail && <span className="cds-overview-event__detail">{detail}</span>}
                  </div>
                </article>
              );
            })}
            {(activity ?? []).length === 0 && (
              <div className="cds-overview-activity__empty">
                <strong>{activityError ? 'Activity feed unavailable' : 'No recent operational events'}</strong>
                <span>{activityError ? 'The audit stream could not be loaded. Other dashboard measures remain independent.' : 'New custody, movement and lock events will appear here when recorded.'}</span>
              </div>
            )}
          </div>
          <div className="cds-overview-activity__foot">
            <span>20 MOST RECENT EVENTS</span>
            <span>Source: tenant activity feed</span>
          </div>
        </section>
      </div>
    </main>
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
  const withFix = trips.filter(isPositionedTrip);
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
            <CDSLiveFleetMap trips={trips} selectedId={selectedId} onSelect={setSelectedId} track={track} />
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
