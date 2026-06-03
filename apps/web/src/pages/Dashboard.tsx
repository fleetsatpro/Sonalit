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
        {/* KPI Strip — full width, cards fill row */}
        <KPIStrip />

        {/* Main content — unified gutter */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '14px 16px 0' }}>

          {/* Alert cards — only renders when there are alerts */}
          <AlertCards />

          {/* Convoy tracker — full width */}
          <ConvoyTracker />

          {/* 2-col grid: secondary intel panels */}
          <div className='d-grid-2col'>
            <RouteRiskIntelligence />
            <DriverBehavior />
            <BorderCrossings />
            <PanicCenter />
            <AIIntelligence />
            <QuickActions />
          </div>

          {/* Full-width data sections */}
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
        .d-grid-2col {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 14px;
        }
      `}</style>
    </div>
  );
}
