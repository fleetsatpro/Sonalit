import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { api } from '@/lib/api.js';
import { KPICard } from '@/components/ui/KPICard.js';
import { Card } from '@/components/ui/Card.js';
import { StatusBadge } from '@/components/ui/Badge.js';
import { useDashboard, useActivityFeed } from '@/hooks/useDashboard.js';
import { useShipments } from '@/hooks/useShipments.js';

const iconPaths: Record<string, string> = {
  clamp: 'M5 11h14v9H5zM8 11V7a4 4 0 0 1 8 0v4',
  depart: 'M3 12h13M13 6l7 6-7 6',
  checkpoint: 'M12 8v4l3 2',
  sync: 'M21 12a9 9 0 1 1-2.6-6.36M21 3v6h-6',
  arrival: 'M3 21h18M4 21V10l8-6 8 6v11',
  unclamp: 'M5 11h14v9H5zM8 11V9a4 4 0 0 1 7.5-1.9',
  ai: 'M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
};

const s = (v: unknown) => String(v ?? '—');

export default function Dashboard() {
  const { data: dashboard, isLoading: dashLoading } = useDashboard();
  const { data: activityData } = useActivityFeed();
  const { data: shipmentData } = useShipments();
  const { data: liveData, isLoading: liveLoading, isError: liveError, refetch: refetchLive } = useQuery<Record<string, unknown>[]>({
    queryKey: ['cds', 'dashboard-live-trips'],
    queryFn: async () => {
      const { data: body } = await api.get('/trips/live');
      return Array.isArray(body.data) ? body.data as Record<string, unknown>[] : [];
    },
    staleTime: 5_000,
    refetchInterval: 15_000,
    retry: 1,
  });

  if (dashLoading) return <div className="flex items-center justify-center h-64"><div className="text-text-2 font-mono text-xs">Loading…</div></div>;

  const d = dashboard as Record<string, unknown> | undefined;

  const kpis = [
    { label: 'ACTIVE CONTAINERS', value: s(d?.['active_containers']), delta: '', trend: 'up' as const, sparkline: [] as number[] },
    { label: 'IN TRANSIT', value: s(d?.['in_transit']), delta: '', trend: 'up' as const, sparkline: [] as number[] },
    { label: 'DELIVERED TODAY', value: s(d?.['delivered_today']), delta: '', trend: 'up' as const, sparkline: [] as number[] },
    { label: 'ACTIVE LOCKS', value: s(d?.['active_locks']), delta: '', trend: 'up' as const, sparkline: [] as number[] },
    { label: 'LOCKS REMOVED TODAY', value: s(d?.['locks_removed']), delta: '', trend: 'up' as const, sparkline: [] as number[] },
    { label: 'PENDING UNCLAMP', value: s(d?.['pending_unclamp']), delta: '', trend: 'down' as const, sparkline: [] as number[] },
    { label: 'DELAYED TRIPS', value: s(d?.['delayed_trips']), delta: '', trend: 'down' as const, sparkline: [] as number[] },
    { label: 'AVG TRANSIT TIME', value: s(d?.['avg_transit_hours']), delta: '', trend: 'up' as const, sparkline: [] as number[] },
  ];

  const activities = (Array.isArray(activityData) ? activityData : (d?.['recent_activity'] as unknown[] ?? [])) as Record<string, unknown>[];
  const activeTrips = (shipmentData?.data ?? [])
    .filter(row => row.status !== 'completed' && row.status !== 'archived') as unknown as Record<string, unknown>[];
  const liveTrips = liveData ?? [];
  const tripsWithPosition = liveTrips.filter(trip => trip['lat'] != null && trip['lng'] != null);
  const tripsReportingLive = liveTrips.filter(trip => trip['position_is_live'] === true);

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <div className="grid grid-cols-4 gap-3.5 mb-5">
        {kpis.map((kpi) => (
          <KPICard key={kpi.label} {...kpi} />
        ))}
      </div>

      <div className="grid grid-cols-[1.7fr_1fr] gap-4 items-start">
        <Card className="h-[360px] p-4 relative overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <div className="font-display font-bold text-[13px]">Live GPS coverage</div>
              <div className="text-2xs text-text-2 font-mono mt-1">Canonical trip feed · refreshes every 15 seconds</div>
            </div>
            <Link to="/cds/live" className="text-[11px] font-semibold text-cds-orange hover:text-text-0">Open live tracking →</Link>
          </div>
          {liveError && !liveData ? (
            <div className="rounded-lg border border-red-400/20 p-4">
              <div className="text-xs font-semibold text-text-0">Live tracking feed unavailable</div>
              <div className="text-2xs text-text-2 mt-1">No synthetic positions are shown.</div>
              <button type="button" onClick={() => { void refetchLive(); }} className="text-xs text-cds-orange mt-3">Retry feed</button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="rounded-lg border border-white/[.06] bg-white/[.025] p-2.5">
                  <div className="text-[9px] uppercase tracking-wider text-text-2">Open trips</div>
                  <div className="text-xl font-bold font-mono text-text-0 mt-1">{liveLoading && !liveData ? '—' : liveTrips.length}</div>
                </div>
                <div className="rounded-lg border border-white/[.06] bg-white/[.025] p-2.5">
                  <div className="text-[9px] uppercase tracking-wider text-text-2">Position available</div>
                  <div className="text-xl font-bold font-mono text-text-0 mt-1">{liveLoading && !liveData ? '—' : tripsWithPosition.length}</div>
                </div>
                <div className="rounded-lg border border-white/[.06] bg-white/[.025] p-2.5">
                  <div className="text-[9px] uppercase tracking-wider text-text-2">Fresh live fix</div>
                  <div className="text-xl font-bold font-mono text-text-0 mt-1">{liveLoading && !liveData ? '—' : tripsReportingLive.length}</div>
                </div>
              </div>
              <div className="max-h-[205px] overflow-y-auto">
                {liveTrips.slice(0, 7).map((trip, index) => (
                  <div key={String(trip['id'] ?? index)} className="flex items-start gap-2.5 py-2.5 border-t border-hair">
                    <div className={'w-2 h-2 mt-1.5 rounded-full flex-none ' + (trip['position_is_live'] === true ? 'bg-cds-teal' : trip['lat'] != null && trip['lng'] != null ? 'bg-cds-orange' : 'bg-text-2')} />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-text-0 truncate">{s(trip['trip_number'])} · {s(trip['vehicle_reg'] ?? 'Vehicle unassigned')}</div>
                      <div className="text-2xs text-text-2 mt-0.5 truncate">{s(trip['origin'])} → {s(trip['destination'])}</div>
                      <div className="text-[9px] text-text-2 font-mono mt-1">
                        {trip['lat'] != null && trip['lng'] != null ? Number(trip['lat']).toFixed(4) + ', ' + Number(trip['lng']).toFixed(4) : 'No position fix'}
                        {' · ' + s(trip['position_source'] ?? 'No source')}
                        {trip['last_seen'] ? ' · ' + new Date(String(trip['last_seen'])).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                      </div>
                    </div>
                    <StatusBadge status={s(trip['status'])} />
                  </div>
                ))}
                {!liveLoading && liveTrips.length === 0 && <div className="py-8 text-center text-2xs text-text-2">No open trip records in the live feed.</div>}
              </div>
            </>
          )}
        </Card>

        <Card className="p-4 max-h-[360px] overflow-y-auto">
          <div className="font-display font-bold text-[13px] mb-1.5">Recent Activity</div>
          {activities.map((a, i) => {
            const icon = s(a['icon'] ?? a['type'] ?? 'checkpoint');
            return (
              <div key={i} className="flex gap-2.5 py-2.5 border-b border-hair last:border-b-0">
                <div className="w-[26px] h-[26px] rounded-lg flex-none flex items-center justify-center bg-ink-3 text-cds-orange">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    {icon === 'checkpoint' && <circle cx="12" cy="12" r="9" />}
                    <path d={iconPaths[icon] ?? iconPaths['checkpoint']!} />
                  </svg>
                </div>
                <div>
                  <div className="text-xs-tight text-text-0">{s(a['text'] ?? a['message'])}</div>
                  <div className="text-2xs text-text-2 mt-0.5 font-mono">{s(a['meta'] ?? a['timestamp'])}</div>
                </div>
              </div>
            );
          })}
          {activities.length === 0 && <div className="text-2xs text-text-2 py-4 text-center">No recent activity.</div>}
        </Card>
      </div>

      <div className="mt-5">
        <h3 className="font-display font-bold text-[15px] mb-3">Active Shipments</h3>
        <div className="glass p-0">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs-tight">
              <thead>
                <tr>
                  {['Trip reference', 'Status', 'Vehicle / driver', 'Route', 'ETA'].map((h) => (
                    <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeTrips.map((c, i) => (
                  <tr key={s(c['reference'] ?? c['id'] ?? i)} className="border-t border-hair hover:bg-ink-2 transition-colors">
                    <td className="px-3.5 py-3 font-mono text-text-0"><Link to="/cds/shipments" className="hover:text-cds-orange">{s(c['reference'] ?? c['id'])}</Link></td>
                    <td className="px-3.5 py-3"><StatusBadge status={s(c['status'])} /></td>
                    <td className="px-3.5 py-3 text-text-0">{s(c['vehicleReg'])}<div className="text-2xs text-text-2 mt-0.5">{s(c['driverName'])}</div></td>
                    <td className="px-3.5 py-3 text-text-0">{s(c['origin'])} → {s(c['destination'] ?? c['dest'])}</td>
                    <td className={`px-3.5 py-3 font-mono ${s(c['status']) === 'delayed' ? 'text-cds-red' : 'text-text-1'}`}>{s(c['eta'])}</td>
                  </tr>
                ))}
                {activeTrips.length === 0 && <tr><td colSpan={5} className="px-3.5 py-8 text-center text-text-2">No active shipments.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
