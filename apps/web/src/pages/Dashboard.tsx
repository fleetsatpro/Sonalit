import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useDashboardStore } from '../stores/dashboardStore.js';
import '../styles/dashboard.css';

import { useEffect, useRef, Suspense, lazy } from 'react';
import EventsTicker from '../components/dashboard/EventsTicker.js';
import ThreatStrip from '../components/dashboard/ThreatStrip.js';
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

  // Realtime subscription + panic alarm are wired globally in AppShell now
  // (GlobalPanicAlarm) so they stay active on every route, not just here.

  const mainRef = useRef<HTMLDivElement>(null);

  // Staggered section reveals for the analytics deck below the console —
  // kept behaviourally identical to the previous IntersectionObserver.
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

  return (
    <div ref={mainRef} className='d-console-scope' style={{ background: 'var(--d-void)' }}>
      {/* Instrument band — live feed ticker, threat status, KPI tiles */}
      <EventsTicker />
      <ThreatStrip />
      <KPIStrip />

      {/* Command console — tactical map hero beside the live ops / priority queue */}
      <div className='d-console-row'>
        <div className='d-console-map'>
          <Suspense fallback={
            <div style={{ padding: 16 }}>
              <div style={{ height: 420, background: 'var(--d-well)', borderRadius: 12, border: '1px solid var(--d-rim2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: 12, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace' }}>Loading tactical map…</div>
              </div>
            </div>
          }>
            <TacticalMap />
          </Suspense>
        </div>
        <OpsSidebar inline />
      </div>

      {/* Analytics deck — full operational detail below the console fold */}
      <div className='d-analytics-deck' style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 16px 24px' }}>
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

      <style>{`
        /* Map hero beside the priority-queue panel whenever there is room for
           both; the panel wraps below the map (full-width) on narrow screens.
           Flex-wrap instead of a media query so browser zoom / OS display
           scaling can't silently drop the panel. */
        .d-console-row {
          display: flex;
          flex-wrap: wrap;
          align-items: stretch;
        }
        .d-console-map {
          flex: 1 1 560px;
          min-width: 0;
        }
        .d-console-row > aside {
          flex: 1 0 var(--d-sb-w);
          max-width: 100%;
        }
        @media (min-width: 900px) {
          .d-console-row > aside { flex: 0 0 var(--d-sb-w); }
        }
        .d-grid-2col {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 14px;
        }
      `}</style>
    </div>
  );
}
