import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useDashboardStore } from '../stores/dashboardStore.js';
import '../styles/dashboard.css';

import { Suspense, lazy } from 'react';
import EventsTicker from '../components/dashboard/EventsTicker.js';
import InstrumentBar from '../components/dashboard/InstrumentBar.js';
import PriorityQueue from '../components/dashboard/PriorityQueue.js';
const TacticalMap = lazy(() => import('../components/dashboard/TacticalMap.js'));
import type { DashboardOverview } from '../stores/dashboardStore.js';

// Command console: a tactical single pane. The living map is the hero, one
// instrument bar on top, one urgency-ranked priority queue on the right, the
// events ticker along the bottom. Analytics detail (driver behaviour,
// weather, performance charts, ...) lives on its own pages — home answers
// only "is anything wrong, and where?".
export default function Dashboard() {
  const { setOverview } = useDashboardStore.getState();

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

  // Realtime subscription + panic alarm are wired globally in AppShell
  // (GlobalPanicAlarm) so they stay active on every route, not just here.

  return (
    <div className='d-console' style={{ background: 'var(--d-void)', display: 'flex', flexDirection: 'column' }}>
      <InstrumentBar />

      <div className='d-console-main'>
        <div className='d-console-map'>
          <Suspense fallback={
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 320 }}>
              <div style={{ fontSize: 12, color: 'var(--d-t3)', fontFamily: 'IBM Plex Mono, monospace' }}>Loading tactical map…</div>
            </div>
          }>
            <TacticalMap fill />
          </Suspense>
        </div>
        <PriorityQueue />
      </div>

      <EventsTicker />

      <style>{`
        .d-console-main {
          flex: 1;
          min-height: 0;
          display: flex;
        }
        .d-console-map {
          flex: 1 1 560px;
          min-width: 0;
          display: flex;
          flex-direction: column;
          min-height: 0;
        }
        .d-console-queue { flex: 0 0 340px; max-width: 100%; }
        /* Single-viewport pane on desktop: the console owns the height and
           the map/queue scroll internally. On narrow screens fall back to a
           normal flowing page — map first, queue below, page scrolls. */
        @media (min-width: 1000px) {
          .d-console { height: 100%; }
        }
        @media (max-width: 999px) {
          .d-console-main { flex-direction: column; }
          .d-console-map { min-height: 380px; }
          .d-console-queue { flex: 1 1 auto; border-left: none; border-top: 1px solid var(--d-rim2); }
        }
      `}</style>
    </div>
  );
}
