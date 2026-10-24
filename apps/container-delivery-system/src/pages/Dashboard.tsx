import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api.js';
import { ageLabel, freshnessLabel, getLiveFeedState, hasValidCoordinates, hasVerifiedLiveFix, isValidLiveTripPayload } from '../lib/liveOperationsEvidence.js';
import { KPICard } from '@/components/ui/KPICard.js';
import { Card } from '@/components/ui/Card.js';
import { StatusBadge } from '@/components/ui/Badge.js';
import { useUIStore } from '@/stores/ui.js';
import { useDashboard, useActivityFeed } from '@/hooks/useDashboard.js';
import { useContainers } from '@/hooks/useContainers.js';

const iconPaths: Record<string, string> = {
  clamp: 'M5 11h14v9H5zM8 11V7a4 4 0 0 1 8 0v4',
  depart: 'M3 12h13M13 6l7 6-7 6',
  checkpoint: 'M12 8v4l3 2',
  sync: 'M21 12a9 9 0 1 1-2.6-6.36M21 3v6h-6',
  arrival: 'M3 21h18M4 21V10l8-6 8 6v11',
  unclamp: 'M5 11h14v9H5zM8 11V9a4 4 0 0 1 7.5-1.9',
  ai: 'M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5',
};

interface DashboardLiveTrip {
  id: string;
  trip_number: string | null;
  status: string;
  phase: string;
  origin: string | null;
  destination: string | null;
  eta: string | null;
  vehicle_reg: string | null;
  lat: number | null;
  lng: number | null;
  last_seen: string | null;
  position_is_live: boolean;
  tracking_health: string | null;
  position_source: string | null;
}

const s = (v: unknown) => String(v ?? '—');

export default function Dashboard() {
  const { addToast } = useUIStore();
  const { data: dashboard, isLoading: dashLoading } = useDashboard();
  const { data: activityData } = useActivityFeed();
  const { data: containerData } = useContainers();
  const {
    data: liveTripData,
    isPending: liveTripsPending,
    isError: liveTripsError,
    dataUpdatedAt: liveTripsUpdatedAt,
  } = useQuery<{ data: DashboardLiveTrip[] }>({
    queryKey: ['trips', 'live'],
    queryFn: async () => {
      const response = await api.get<unknown>('/trips/live');
      if (!isValidLiveTripPayload<DashboardLiveTrip>(response.data)) {
        throw new Error('Tracking endpoint returned an invalid live-trip payload');
      }
      return response.data;
    },
    refetchInterval: 15_000,
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
  const containers = ((containerData as Record<string, unknown> | undefined)?.['data'] as Record<string, unknown>[] | undefined) ?? [];
  const liveTrips = Array.isArray(liveTripData?.data) ? liveTripData.data : [];
  const locatedTrips = liveTrips.filter(hasValidCoordinates);
  const verifiedLiveFixes = locatedTrips.filter(hasVerifiedLiveFix).length;
  const liveFeedState = getLiveFeedState({
    isPending: liveTripsPending && !liveTripData,
    isError: liveTripsError,
    hasData: Boolean(liveTripData),
    dataUpdatedAt: liveTripsUpdatedAt,
  });
  const liveFeedTone = liveFeedState === 'FEED CURRENT'
    ? 'border-emerald-500/20 bg-emerald-500/[0.04] text-emerald-300'
    : liveFeedState === 'FEED DEGRADED'
      ? 'border-amber-500/20 bg-amber-500/[0.04] text-amber-300'
      : liveFeedState === 'FEED UNAVAILABLE'
        ? 'border-red-500/20 bg-red-500/[0.04] text-red-300'
        : 'border-white/10 bg-black/20 text-white/45';

  return (
    <div className="p-6 pb-10 animate-fade-in">
      <div className="grid grid-cols-4 gap-3.5 mb-5">
        {kpis.map((kpi) => (
          <KPICard key={kpi.label} {...kpi} />
        ))}
      </div>

      <div className="grid grid-cols-[1.7fr_1fr] gap-4 items-start">
        <Card className="h-[360px] p-0 overflow-hidden">
          <div className="flex items-start justify-between gap-3 border-b border-hair px-4 py-4">
            <div className="min-w-0">
              <div className="font-display font-bold text-[13px]">GPS Evidence</div>
              <div className="mt-1 text-2xs text-text-2 font-mono">
                {locatedTrips.length} of {liveTrips.length} open trips have valid coordinates
              </div>
            </div>
            <span className={`shrink-0 rounded-md border px-2 py-1 font-mono text-[9px] font-semibold tracking-[.05em] ${liveFeedTone}`} role="status" aria-live="polite">
              {liveFeedState}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hair px-4 py-3 text-2xs font-mono text-text-2">
            <span><span className="text-emerald-300">{verifiedLiveFixes}</span> verified live fixes</span>
            <span className="text-text-2/50">/</span>
            <span>{locatedTrips.length - verifiedLiveFixes} last-known positions</span>
          </div>

          <div className="max-h-[242px] overflow-y-auto">
            {liveTrips.slice(0, 6).map(trip => {
              const validPosition = hasValidCoordinates(trip);
              const verifiedLiveFix = hasVerifiedLiveFix(trip);
              return (
                <div key={trip.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-hair px-4 py-3 last:border-0">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-xs font-bold text-text-0">{s(trip.trip_number)}</span>
                      <span className="font-mono text-2xs text-text-2">{s(trip.vehicle_reg)}</span>
                      <StatusBadge status={trip.status} />
                    </div>
                    <div className="mt-1 text-2xs text-text-2">
                      {s(trip.origin)} → {s(trip.destination)}
                    </div>
                    <div className="mt-1 break-words font-mono text-[10px] text-text-2">
                      {validPosition ? `${trip.lat.toFixed(5)}, ${trip.lng.toFixed(5)}` : 'No verified GPS coordinates'}
                    </div>
                    <div className="mt-1 text-[10px] text-text-2">
                      {validPosition
                        ? `${trip.position_source ?? 'Source unavailable'} · ${ageLabel(trip.last_seen)}`
                        : `Location ${ageLabel(trip.last_seen)}`}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded-md border px-2 py-1 font-mono text-[9px] ${verifiedLiveFix ? 'border-emerald-500/20 text-emerald-300' : 'border-white/10 text-text-2'}`}>
                    {verifiedLiveFix ? 'LIVE FIX' : validPosition ? freshnessLabel(trip) : 'NO GPS FIX'}
                  </span>
                </div>
              );
            })}
            {liveTrips.length === 0 && (
              <div className="min-h-[220px] flex items-center justify-center px-8 text-center text-xs text-text-2">
                {liveFeedState === 'CHECKING FEED'
                  ? 'Checking the tracking endpoint…'
                  : liveFeedState === 'FEED UNAVAILABLE'
                    ? 'Tracking feed unavailable; no empty-state conclusion can be drawn.'
                    : 'No open trips were returned by the tracking endpoint.'}
              </div>
            )}
          </div>
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
                  {['Container', 'Status', 'Truck / Driver', 'Route', 'ETA'].map((h) => (
                    <th key={h} className="text-left font-mono text-2xs tracking-[0.06em] text-text-2 uppercase px-3.5 pb-2.5 pt-3 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {containers.map((c, i) => (
                  <tr key={s(c['number'] ?? c['id'] ?? i)} className="border-t border-hair cursor-pointer hover:bg-ink-2 transition-colors" onClick={() => addToast(`Viewing ${s(c['number'] ?? c['id'])}`)}>
                    <td className="px-3.5 py-3 font-mono text-text-0">{s(c['number'] ?? c['id'])}</td>
                    <td className="px-3.5 py-3"><StatusBadge status={s(c['status'])} /></td>
                    <td className="px-3.5 py-3 text-text-0">{s(c['truck'])}<div className="text-2xs text-text-2 mt-0.5">{s(c['driver'])}</div></td>
                    <td className="px-3.5 py-3 text-text-0">{s(c['origin'])} → {s(c['destination'] ?? c['dest'])}</td>
                    <td className={`px-3.5 py-3 font-mono ${s(c['status']) === 'delayed' ? 'text-cds-red' : 'text-text-1'}`}>{s(c['eta'])}</td>
                  </tr>
                ))}
                {containers.length === 0 && <tr><td colSpan={5} className="px-3.5 py-8 text-center text-text-2">No active shipments.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
