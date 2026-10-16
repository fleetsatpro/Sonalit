import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/Card.js';
import { PageHeader } from '@/components/ui/PageHeader.js';
import { api } from '@/lib/api.js';

type WindowDays = 7 | 30 | 90 | 365;
type BreakdownRow = { status?: string; risk?: string; count: number; low_battery?: number; tampered?: number };
interface AnalyticsPayload {
  meta: { window_days: WindowDays; period_start: string; period_end: string; generated_at: string };
  summary: {
    trips_started: number; deliveries_completed: number; active_trips: number; moving_trips: number;
    delayed_trips: number; eta_met: number; eta_observed: number; eta_attainment_pct: number | null;
    avg_transit_hours: number | null; trips_missing_vehicle: number; trips_missing_driver: number;
    trips_missing_container: number; trips_missing_lock: number; trips_missing_eta: number;
    total_containers: number; available_containers: number; containers_in_use: number;
    containers_in_maintenance: number; damaged_containers: number; fair_condition_containers: number;
    retired_containers: number; overdue_inspections: number; inspections_due_30_days: number;
    containers_missing_location: number; container_utilization_pct: number | null; total_vehicles: number; available_vehicles: number;
    vehicles_in_use: number; vehicles_in_maintenance: number; vehicle_utilization_pct: number | null;
    total_locks: number; locks_needing_attention: number; low_battery_locks: number;
    tampered_locks: number; stale_lock_heartbeats: number; active_drivers: number;
    open_incidents: number; unacknowledged_alerts: number;
  };
  daily: Array<{ day: string; trips_started: number; deliveries_completed: number }>;
  container_statuses: Array<{ status: string; count: number }>;
  container_conditions: Array<{ condition: string; count: number }>;
  trip_statuses: Array<{ status: string; count: number }>;
  risk_mix: Array<{ risk: string; count: number }>;
  lock_statuses: Array<{ status: string; count: number; low_battery: number; tampered: number }>;
  booking_pipeline: Array<{ status: string; count: number }>;
  lanes: Array<{ origin: string; destination: string; trips_started: number; deliveries_completed: number; currently_delayed: number; avg_transit_hours: number | null }>;
  alerts: Array<{ id: string; type: string; severity: string; title: string; message: string; entity_type: string; entity_id: string; created_at: string }>;
}

const windows: WindowDays[] = [7, 30, 90, 365];
const fmt = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat().format(value);
const pct = (value: number | null | undefined) => value == null ? '—' : Number(value).toFixed(1) + '%';
const label = (value: string) => value.replaceAll('_', ' ');
const dateText = (value: string) => {
  const date = new Date(value + (value.length === 10 ? 'T12:00:00' : ''));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

function MetricCard({ label: title, value, detail, tone = 'neutral' }: { label: string; value: string; detail: string; tone?: string }) {
  const toneClass = tone === 'warning' ? 'text-amber-300' : tone === 'critical' ? 'text-red-300' : 'text-text-0';
  return (
    <Card className="p-4 min-w-0 relative overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-cds-orange/70" />
      <div className="text-[9px] uppercase tracking-[.16em] font-mono text-text-2">{title}</div>
      <div className={'text-2xl sm:text-3xl font-bold font-mono mt-3 tabular-nums ' + toneClass}>{value}</div>
      <div className="text-[10px] text-text-2 mt-2 leading-relaxed">{detail}</div>
    </Card>
  );
}

function EmptyPanel({ message }: { message: string }) {
  return <div className="py-8 px-4 text-center text-xs text-text-2 border border-dashed border-white/10 rounded-lg">{message}</div>;
}

function Breakdown({ title, description, rows, keyName }: { title: string; description: string; rows: BreakdownRow[]; keyName: 'status' | 'risk'; }) {
  const maximum = Math.max(1, ...rows.map(row => row.count));
  const sorted = rows.slice().sort((a, b) => b.count - a.count || String(a[keyName] || '').localeCompare(String(b[keyName] || '')));
  return (
    <Card className="p-4 min-w-0">
      <h3 className="font-bold text-sm text-text-0">{title}</h3>
      <p className="text-[11px] text-text-2 mt-1 mb-4">{description}</p>
      {sorted.length === 0 ? <EmptyPanel message="No persisted records are available for this breakdown." /> : (
        <div className="space-y-3">
          {sorted.map(row => {
            const name = String(row[keyName] || 'Unspecified');
            const barTone = ['critical', 'high', 'delayed', 'offline'].includes(name) ? 'bg-red-400' :
              ['medium', 'maintenance', 'at_port', 'awaiting_lock'].includes(name) ? 'bg-amber-300' :
              ['low', 'available', 'completed', 'delivered'].includes(name) ? 'bg-emerald-300' : 'bg-cds-orange';
            return (
              <div key={name}>
                <div className="flex justify-between items-baseline gap-3 mb-1.5 text-xs">
                  <span className="capitalize text-text-1 truncate">{label(name)}</span>
                  <span className="font-mono font-bold text-text-0">{fmt(row.count)}</span>
                </div>
                <div className="h-1.5 bg-white/[.07] rounded-full overflow-hidden">
                  <div className={'h-full rounded-full ' + barTone} style={{ width: (row.count / maximum * 100) + '%' }} />
                </div>
                {(row.low_battery || row.tampered) ? <div className="text-[10px] text-text-2 mt-1">{fmt(row.low_battery)} low battery · {fmt(row.tampered)} tamper detected</div> : null}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function Throughput({ rows }: { rows: AnalyticsPayload['daily'] }) {
  const bucketSize = Math.max(1, Math.ceil(rows.length / 24));
  const buckets: Array<{ start: string; end: string; label: string; started: number; delivered: number }> = [];
  rows.forEach((row, index) => {
    const bucketIndex = Math.floor(index / bucketSize);
    let bucket = buckets[bucketIndex];
    if (!bucket) {
      bucket = { start: row.day, end: row.day, label: dateText(row.day), started: 0, delivered: 0 };
      buckets.push(bucket);
    }
    bucket.end = row.day;
    bucket.started += row.trips_started;
    bucket.delivered += row.deliveries_completed;
  });
  const maxValue = Math.max(1, ...buckets.flatMap(bucket => [bucket.started, bucket.delivered]));
  const hasActivity = buckets.some(bucket => bucket.started > 0 || bucket.delivered > 0);
  return (
    <Card className="p-4 min-w-0">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h3 className="font-bold text-sm text-text-0">Delivery throughput</h3>
          <p className="text-[11px] text-text-2 mt-1">Trip creation compared with delivery timestamps. Longer windows are grouped for readability.</p>
        </div>
        <div className="flex gap-3 text-[10px] items-center">
          <span className="inline-flex gap-1.5 items-center"><i className="w-2 h-2 rounded-sm bg-cds-orange" />Started</span>
          <span className="inline-flex gap-1.5 items-center"><i className="w-2 h-2 rounded-sm bg-emerald-300" />Delivered</span>
        </div>
      </div>
      {!hasActivity ? <EmptyPanel message="No trips were created and no deliveries were recorded in this period." /> : (
        <div className="mt-5 flex h-[190px] items-end gap-1">
          {buckets.map(bucket => (
            <div key={bucket.start} title={bucket.start + ' – ' + bucket.end + ': ' + bucket.started + ' started, ' + bucket.delivered + ' delivered'} className="flex-1 min-w-0 h-full flex flex-col justify-end items-center">
              <div className="h-[154px] w-full flex items-end justify-center gap-[2px]">
                <div className="w-[43%] rounded-t-sm bg-cds-orange/90" style={{ height: bucket.started ? Math.max(2, bucket.started / maxValue * 145) + 'px' : '0px' }} />
                <div className="w-[43%] rounded-t-sm bg-emerald-300/90" style={{ height: bucket.delivered ? Math.max(2, bucket.delivered / maxValue * 145) + 'px' : '0px' }} />
              </div>
              <span className="mt-2 text-[8px] text-text-2 font-mono">{bucket.label}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function Analytics() {
  const [days, setDays] = useState<WindowDays>(30);
  const [lens, setLens] = useState<'executive' | 'coordinator'>('executive');
  const query = useQuery<AnalyticsPayload>({
    queryKey: ['cds-analytics', days],
    queryFn: async () => {
      const response = await api.get('/analytics', { params: { days } });
      return response.data.data as AnalyticsPayload;
    },
    staleTime: 20_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  const data = query.data;
  const summary = data?.summary;

  if (query.isLoading) {
    return <div className="p-6 space-y-4"><div className="h-8 rounded bg-white/[.05] animate-pulse w-1/3" /><div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[1, 2, 3, 4, 5, 6, 7, 8].map(n => <div key={n} className="h-28 rounded-xl bg-white/[.04] animate-pulse" />)}</div><div className="h-72 rounded-xl bg-white/[.04] animate-pulse" /></div>;
  }
  if (!data || !summary) {
    return (
      <div className="p-6">
        <PageHeader title="Container operations analytics" description="Tenant-scoped CDS operational intelligence." />
        <Card className="p-6 border border-red-400/20">
          <div className="font-bold text-text-0">Analytics could not be loaded</div>
          <p className="text-xs text-text-2 mt-2">No sample values are displayed. Check the CDS API connection and retry.</p>
          {query.error ? <p className="text-[11px] text-red-300 mt-2">{query.error instanceof Error ? query.error.message : 'The server returned an unexpected response.'}</p> : null}
          <button type="button" onClick={() => { void query.refetch(); }} className="mt-4 px-4 py-2 rounded-lg bg-cds-orange text-[#170d00] font-semibold text-xs">Retry analytics</button>
        </Card>
      </div>
    );
  }

  const qualityRows = [
    { name: 'Open trips missing a vehicle', count: summary.trips_missing_vehicle },
    { name: 'Open trips missing a driver', count: summary.trips_missing_driver },
    { name: 'Open trips missing a container', count: summary.trips_missing_container },
    { name: 'Open trips missing an e-lock', count: summary.trips_missing_lock },
    { name: 'Open trips missing an ETA', count: summary.trips_missing_eta },
  ];
  const hasQualityGaps = qualityRows.some(row => row.count > 0);
  const selectedWindow = windows;

  return (
    <div className="p-5 sm:p-6 pb-10 space-y-4">
      <PageHeader
        title="Container operations analytics"
        description={'Live database snapshot · ' + dateText(data.meta.period_start) + ' – ' + dateText(data.meta.period_end) + ' · refreshed ' + new Date(data.meta.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        actions={
          <div className="flex gap-2 flex-wrap items-center">
            <div className="flex gap-1 p-1 rounded-lg border border-white/10">
              {selectedWindow.map(windowDays => <button key={windowDays} type="button" onClick={() => setDays(windowDays)} aria-pressed={days === windowDays} className={'px-3 py-2 min-h-[36px] rounded-md text-xs font-mono ' + (days === windowDays ? 'bg-cds-orange text-[#170d00] font-bold' : 'text-text-2 hover:text-text-0')}>{windowDays}D</button>)}
            </div>
            <button type="button" disabled={query.isFetching} onClick={() => { void query.refetch(); }} className="px-3 py-2 min-h-[36px] rounded-lg border border-white/10 text-xs font-semibold text-text-1 disabled:opacity-50">{query.isFetching ? 'Refreshing…' : 'Refresh'}</button>
          </div>
        }
      />
      {query.isError && data ? <div role="status" className="rounded-lg border border-amber-300/20 bg-amber-300/5 px-3 py-2 text-xs text-amber-100">Refresh failed. The last successfully loaded snapshot is retained; retry when the API is available.</div> : null}
      <div className="flex gap-2" role="group" aria-label="Analytics lens">
        <button type="button" onClick={() => setLens('executive')} aria-pressed={lens === 'executive'} className={'px-3 py-2 rounded-lg border text-xs ' + (lens === 'executive' ? 'border-cds-orange/50 bg-cds-orange/10 text-text-0' : 'border-white/10 text-text-2')}>Executive overview</button>
        <button type="button" onClick={() => setLens('coordinator')} aria-pressed={lens === 'coordinator'} className={'px-3 py-2 rounded-lg border text-xs ' + (lens === 'coordinator' ? 'border-cds-orange/50 bg-cds-orange/10 text-text-0' : 'border-white/10 text-text-2')}>Coordinator operations</button>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <MetricCard label="TRIPS STARTED" value={fmt(summary.trips_started)} detail={'Created in the selected ' + days + '-day window.'} />
        <MetricCard label="DELIVERIES COMPLETED" value={fmt(summary.deliveries_completed)} detail="Counted using delivery timestamps." />
        <MetricCard label="ACTIVE TRIP LIFECYCLE" value={fmt(summary.active_trips)} detail={fmt(summary.moving_trips) + ' moving, checkpoint or delayed.'} />
        <MetricCard label="DELAYED TRIPS" value={fmt(summary.delayed_trips)} detail="Current persisted delayed status." tone={summary.delayed_trips > 0 ? 'warning' : 'neutral'} />
        <MetricCard label="ETA ATTAINMENT" value={pct(summary.eta_attainment_pct)} detail={fmt(summary.eta_met) + ' of ' + fmt(summary.eta_observed) + ' completed deliveries had an ETA and met it.'} />
        <MetricCard label="AVERAGE TRANSIT" value={summary.avg_transit_hours == null ? '—' : Number(summary.avg_transit_hours).toFixed(1) + ' h'} detail="Completed in this window, with departure and delivery timestamps." />
        <MetricCard label="CONTAINER UTILISATION" value={pct(summary.container_utilization_pct)} detail={fmt(summary.containers_in_use) + ' in use of ' + fmt(summary.total_containers) + ' registered containers.'} />
        <MetricCard label="LOCKS NEEDING ATTENTION" value={fmt(summary.locks_needing_attention)} detail={fmt(summary.unacknowledged_alerts) + ' unacknowledged alerts · ' + fmt(summary.open_incidents) + ' open incidents.'} tone={summary.locks_needing_attention > 0 ? 'warning' : 'neutral'} />
      </div>

      <Throughput rows={data.daily} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {lens === 'executive' ? (
          <>
            <Card className="p-4 min-w-0">
              <h3 className="font-bold text-sm text-text-0">Highest-volume lanes</h3>
              <p className="text-[11px] text-text-2 mt-1 mb-4">Origin–destination pairs ranked by trips created in the selected window.</p>
              {data.lanes.length === 0 ? <EmptyPanel message="No trips were created in the selected period." /> : (
                <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-xs">
                  <thead><tr className="text-[9px] uppercase tracking-wider text-text-2 border-b border-white/10"><th className="text-left py-2">Lane</th><th className="text-right py-2">Trips</th><th className="text-right py-2">Delivered</th><th className="text-right py-2">Avg transit</th><th className="text-right py-2">Delayed now</th></tr></thead>
                  <tbody>{data.lanes.map((lane, index) => <tr key={lane.origin + '|' + lane.destination + '|' + index} className="border-b border-white/[.05]"><td className="py-3 pr-3 text-text-0"><div>{lane.origin}</div><div className="text-[10px] text-text-2 mt-1">to {lane.destination}</div></td><td className="text-right font-mono">{fmt(lane.trips_started)}</td><td className="text-right font-mono">{fmt(lane.deliveries_completed)}</td><td className="text-right font-mono">{lane.avg_transit_hours == null ? '—' : Number(lane.avg_transit_hours).toFixed(1) + ' h'}</td><td className="text-right font-mono">{fmt(lane.currently_delayed)}</td></tr>)}</tbody>
                </table></div>
              )}
            </Card>
            <Breakdown title="Booking pipeline" description="Current bookings grouped by persisted database status." rows={data.booking_pipeline.map(row => ({ status: row.status, count: row.count }))} keyName="status" />
          </>
        ) : (
          <>
            <Breakdown title="Trip lifecycle" description="All current trip records grouped by the exact database status contract, including zero-count states." rows={data.trip_statuses.map(row => ({ status: row.status, count: row.count }))} keyName="status" />
            <Breakdown title="Active-trip risk distribution" description="Risk levels among trips not yet completed or archived." rows={data.risk_mix.map(row => ({ risk: row.risk, count: row.count }))} keyName="risk" />
          </>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="p-4 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-4"><div><h3 className="font-bold text-sm text-text-0">Fleet and e-lock health</h3><p className="text-[11px] text-text-2 mt-1">Current inventory, not period totals.</p></div><span className="text-[9px] uppercase tracking-wider font-mono text-text-2">{fmt(summary.total_locks)} locks</span></div>
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="rounded-lg bg-white/[.025] border border-white/[.04] p-3"><div className="text-[9px] text-text-2 uppercase tracking-wider">Vehicles in use</div><div className="text-xl font-bold font-mono text-text-0 mt-1">{fmt(summary.vehicles_in_use)}</div><div className="text-[10px] text-text-2 mt-1">{fmt(summary.vehicles_in_maintenance)} in maintenance</div></div>
            <div className="rounded-lg bg-white/[.025] border border-white/[.04] p-3"><div className="text-[9px] text-text-2 uppercase tracking-wider">Active drivers</div><div className="text-xl font-bold font-mono text-text-0 mt-1">{fmt(summary.active_drivers)}</div><div className="text-[10px] text-text-2 mt-1">{pct(summary.vehicle_utilization_pct)} available/in-use vehicle utilisation</div></div>
          </div>
          <Breakdown title="Lock status" description="Current persisted lock status, including device exception counts." rows={data.lock_statuses.map(row => ({ status: row.status, count: row.count, low_battery: row.low_battery, tampered: row.tampered }))} keyName="status" />
          <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-white/[.06] text-center">
            <div><div className="font-mono font-bold text-text-0">{fmt(summary.low_battery_locks)}</div><div className="text-[9px] uppercase text-text-2 mt-1">Low battery (under 25%)</div></div>
            <div><div className="font-mono font-bold text-text-0">{fmt(summary.tampered_locks)}</div><div className="text-[9px] uppercase text-text-2 mt-1">Tampered</div></div>
            <div><div className="font-mono font-bold text-text-0">{fmt(summary.stale_lock_heartbeats)}</div><div className="text-[9px] uppercase text-text-2 mt-1">Stale heartbeat</div></div>
          </div>
        </Card>
        <Card className="p-4 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-4"><div><h3 className="font-bold text-sm text-text-0">Operational data quality</h3><p className="text-[11px] text-text-2 mt-1">Open trip records checked for assignment and planning completeness.</p></div><span className={'text-[9px] uppercase tracking-wider font-mono ' + (hasQualityGaps ? 'text-amber-300' : 'text-emerald-300')}>{hasQualityGaps ? 'Review' : 'No gaps found'}</span></div>
          {qualityRows.map(row => <div key={row.name} className="flex justify-between items-center gap-3 py-2.5 border-b border-white/[.05] last:border-0 text-xs"><span className="text-text-1">{row.name}</span><span className={'font-mono font-bold ' + (row.count > 0 ? 'text-amber-300' : 'text-text-0')}>{fmt(row.count)}</span></div>)}
          {hasQualityGaps ? <p className="text-[10px] text-text-2 mt-3">An unassigned field may be appropriate in an early lifecycle state. Review the status before treating it as an exception.</p> : <p className="text-[10px] text-text-2 mt-3">No missing assignment fields were detected among current open trip records in these checks.</p>}
        </Card>
      </div>


      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Breakdown title="Container lifecycle" description="Current registered inventory by persisted operational status." rows={data.container_statuses.map(row => ({ status: row.status, count: row.count }))} keyName="status" />
        <Breakdown title="Physical condition" description="Saved container condition; no modelled grades." rows={data.container_conditions.map(row => ({ status: row.condition, count: row.count }))} keyName="status" />
        <Card className="p-4 min-w-0">
          <h3 className="font-bold text-sm text-text-0">Inspection and location readiness</h3>
          <p className="text-[11px] text-text-2 mt-1 mb-4">Current inventory flags derived from stored dates and location.</p>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Overdue inspection', value: summary.overdue_inspections, warn: summary.overdue_inspections > 0 },
              { label: 'Due within 30 days', value: summary.inspections_due_30_days, warn: summary.inspections_due_30_days > 0 },
              { label: 'No recorded location', value: summary.containers_missing_location, warn: summary.containers_missing_location > 0 },
              { label: 'Damaged / retired', value: summary.damaged_containers + summary.retired_containers, warn: summary.damaged_containers + summary.retired_containers > 0 },
            ].map(row => <div key={row.label} className="rounded-lg bg-white/[.025] border border-white/[.04] p-3"><div className="text-[9px] uppercase tracking-wider text-text-2">{row.label}</div><div className={'text-xl font-bold font-mono mt-1 ' + (row.warn ? 'text-amber-300' : 'text-text-0')}>{fmt(row.value)}</div></div>)}
          </div>
          <p className="text-[10px] text-text-2 mt-3">Missing next-inspection dates are not counted as overdue.</p>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-3 mb-4"><div><h3 className="font-bold text-sm text-text-0">Priority alerts</h3><p className="text-[11px] text-text-2 mt-1">Latest unacknowledged alerts sorted by severity and recency.</p></div><span className="font-mono text-xs text-text-2">{fmt(summary.unacknowledged_alerts)} open</span></div>
        {data.alerts.length === 0 ? <EmptyPanel message="There are no unacknowledged CDS alerts." /> : (
          <div className="divide-y divide-white/[.05]">{data.alerts.map(alert => <div key={alert.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span className={'mt-1.5 w-2 h-2 rounded-full shrink-0 ' + (alert.severity === 'critical' || alert.severity === 'high' ? 'bg-red-400' : alert.severity === 'medium' ? 'bg-amber-300' : 'bg-emerald-300')} />
            <div className="flex-1 min-w-0"><div className="text-xs font-semibold text-text-0">{alert.title || alert.message}</div><div className="text-[10px] text-text-2 mt-1">{label(alert.type)} · {new Date(alert.created_at).toLocaleString()}</div></div>
            <span className="text-[9px] uppercase font-mono rounded-md px-2 py-1 bg-white/[.05] text-text-1">{label(alert.severity)}</span>
          </div>)}</div>
        )}
      </Card>
      <div className="text-[10px] text-text-2">Definitions: ETA attainment only includes completed deliveries with a recorded ETA. Average transit only includes trips with both departure and delivery timestamps. Live asset counts are current inventory; period activity is timestamp-based. Snapshot generated {new Date(data.meta.generated_at).toLocaleString()}.</div>
    </div>
  );
}
