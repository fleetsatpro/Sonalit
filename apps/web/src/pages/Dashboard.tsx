import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';
import { useDashboardStore } from '../stores/dashboardStore.js';
import { useDashboardRealtime } from '../hooks/useDashboardRealtime.js';
import '../styles/dashboard.css';

import { useEffect, useRef, useState, Suspense, lazy } from 'react';
import EventsTicker from '../components/dashboard/EventsTicker.js';
import ThreatStrip from '../components/dashboard/ThreatStrip.js';
import PanicAlarm from '../components/dashboard/PanicAlarm.js';
import OpsSidebar from '../components/dashboard/OpsSidebar.js';
import KPIStrip from '../components/dashboard/KPIStrip.js';
const TacticalMap = lazy(() => import('../components/dashboard/TacticalMap.js'));
import AlertCards from '../components/dashboard/AlertCards.js';
import ConvoyTracker from '../components/dashboard/ConvoyTracker.js';
import RouteRiskIntelligence from '../components/dashboard/RouteRiskIntelligence.js';
import DriverBehavior from '../components/dashboard/DriverBehavior.js';
import BorderCrossings from '../components/dashboard/BorderCrossings.js';
import PerformanceChart from '../components/dashboard/PerformanceChart.js';
import AIIntelligence from '../components/dashboard/AIIntelligence.js';
import WeatherIntelligence from '../components/dashboard/WeatherIntelligence.js';
import PanicCenter from '../components/dashboard/PanicCenter.js';
import MissionTimeline from '../components/dashboard/MissionTimeline.js';
import CommunicationsStatus from '../components/dashboard/CommunicationsStatus.js';
import QuickActions from '../components/dashboard/QuickActions.js';
import IncidentLog from '../components/dashboard/IncidentLog.js';
import type { DashboardOverview } from '../stores/dashboardStore.js';

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const { setOverview } = useDashboardStore.getState();

  // Fetch overview data
  useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: async () => {
      try {
        const r = await api.get<DashboardOverview>('/dashboard/overview');
        setOverview(r.data);
        return r.data;
      } catch { return null; }
    },
    staleTime: 30000,
    refetchInterval: 60000,
  });

  // Wire realtime
  useDashboardRealtime(user?.org_id ?? '');

  // Right-side OpsSidebar — Dashboard-only chrome. AppShell provides the left
  // Rail + top bar; everything below lives inside the outlet region.
  const [sbOpen, setSbOpen] = useState(true);
  const mainRef = useRef<HTMLDivElement>(null);

  // Staggered section reveals — kept behaviourally identical to the previous
  // DashboardShell IntersectionObserver so the animate-in works the same.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            (entry.target as HTMLElement).classList.add('vis');
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.07 },
    );
    const observeNew = () => {
      mainRef.current?.querySelectorAll('.d-section-reveal:not(.vis)').forEach((el) => io.observe(el));
    };
    observeNew();
    const mo = new MutationObserver(observeNew);
    if (mainRef.current) mo.observe(mainRef.current, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, []);

  const toggleBtnBase: React.CSSProperties = {
    position: 'fixed',
    top: '50%',
    zIndex: 350,
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: 18,
    height: 52,
    background: 'var(--d-carbon)',
    border: '1px solid var(--d-rim2)',
    cursor: 'pointer',
    color: 'var(--d-t3)',
    fontSize: 10,
    padding: 0,
    transition: 'background .15s, color .15s',
  };

  return (
    <div ref={mainRef} className={`d-dashboard-scope${sbOpen ? '' : ' d-sb-collapsed'}`} style={{ background: 'var(--d-void)' }}>
      <EventsTicker />
      <ThreatStrip />

      <Suspense fallback={
        <div style={{ padding: 16 }}>
          <div style={{ height: 420, background: 'var(--d-well)', borderRadius: 12, border: '1px solid var(--d-rim2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ fontSize: 12, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace' }}>Loading tactical map…</div>
          </div>
        </div>
      }>
        <TacticalMap />
      </Suspense>

      <KPIStrip />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 16px 0' }}>
        <AlertCards />
        <ConvoyTracker />
        <div className='d-grid-2col'>
          <RouteRiskIntelligence />
          <DriverBehavior />
          <BorderCrossings />
          <PanicCenter />
          <AIIntelligence />
          <QuickActions />
        </div>
        <MissionTimeline />
        <WeatherIntelligence />
        <PerformanceChart />
        <CommunicationsStatus />
        <IncidentLog />
      </div>

      {/* Desktop ops sidebar (right) — Dashboard only. */}
      <div
        className={`d-ops-sidebar-wrap${sbOpen ? '' : ' d-sb-hidden'}`}
        style={{ display: 'none', position: 'fixed', right: 0, top: 0, width: 'var(--d-sb-w)', zIndex: 100 }}
      >
        <OpsSidebar />
      </div>

      <button
        className='d-sb-toggle'
        onClick={() => setSbOpen((v) => !v)}
        title={sbOpen ? 'Hide sidebar' : 'Show sidebar'}
        style={{
          ...toggleBtnBase,
          right: sbOpen ? 'var(--d-sb-w)' : 0,
          transform: 'translateY(-50%)',
          borderRadius: '6px 0 0 6px',
        }}
      >
        {sbOpen ? '›' : '‹'}
      </button>

      {/* Panic alarm — screen-edge flash + audio (Dashboard-only). */}
      <PanicAlarm />

      <style>{`
        .d-grid-2col {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 14px;
        }
        @media (min-width: 900px) {
          .d-sb-toggle       { display: flex !important; }
          .d-ops-sidebar-wrap{ display: block !important; }
          /* Reserve right gutter for OpsSidebar so page content doesn't slide under it. */
          .d-dashboard-scope { padding-right: var(--d-sb-w); }
          .d-dashboard-scope.d-sb-collapsed { padding-right: 0 !important; }
          .d-sb-hidden       { display: none !important; }
        }
        .d-sb-toggle:hover { background: var(--d-lift2) !important; color: var(--d-t1) !important; }
      `}</style>
    </div>
  );
}
