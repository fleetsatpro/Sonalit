import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';
import { useDashboardStore } from '../stores/dashboardStore.js';
import { useDashboardRealtime } from '../hooks/useDashboardRealtime.js';
import '../styles/dashboard.css';

import DashboardShell from '../components/layout/DashboardShell.js';
import OpsSidebar from '../components/dashboard/OpsSidebar.js';
import KPIStrip from '../components/dashboard/KPIStrip.js';
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

  return (
    <div style={{ minHeight: '100vh', background: 'var(--d-void)' }}>
      <DashboardShell>
        {/* §6 KPI Strip */}
        <KPIStrip />

        {/* §7 Alert Cards */}
        <div style={{ padding: '16px 16px 0' }}>
          <AlertCards />
        </div>

        {/* §8 Convoy Tracker */}
        <div style={{ padding: '16px 16px 0' }}>
          <ConvoyTracker />
        </div>

        {/* §9 Remaining sections — 2-col grid on desktop */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12, padding: '16px 16px 0' }}>
          <RouteRiskIntelligence />
          <DriverBehavior />
          <BorderCrossings />
          <PanicCenter />
          <AIIntelligence />
          <QuickActions />
        </div>

        {/* Full-width sections */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 16px 0' }}>
          <MissionTimeline />
          <WeatherIntelligence />
          <PerformanceChart />
          <CommunicationsStatus />
          <IncidentLog />
        </div>
      </DashboardShell>

      {/* Desktop ops sidebar */}
      <div className='d-ops-sidebar-wrap' style={{ display: 'none', position: 'fixed', right: 0, top: 0, width: 'var(--d-sb-w)', zIndex: 100 }}>
        <OpsSidebar />
      </div>

      <style>{`
        @media (min-width: 900px) {
          .d-ops-sidebar-wrap { display: block !important; }
        }
      `}</style>
    </div>
  );
}
