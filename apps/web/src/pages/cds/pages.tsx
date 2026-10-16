import { useState } from 'react';

import { useAuthStore } from '../../stores/auth.js';
import { LoadingState } from './CDSDashboard.js';
import { Card, KPICard, Button, StatusBadge, DataTable, DrawerField, FilterChip, Badge } from './components.js';
import FieldAccessPanel from './FieldAccessPanel.js';
import { useDashboardKPIs, useCDSAnalytics, useLocks, useTrips, useBookings, useMarkBilled, useActivity, useReports, useGenerateReport, useAlerts, useUnclampTrip, useAcknowledgeAlert } from './hooks.js';
import { useCDSStore } from './store.js';


type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? '—');

export function LocksView() {
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState<'table' | 'grid'>('table');
  const { data, isLoading } = useLocks();
  const { openDrawer } = useCDSStore();
  if (isLoading) return <LoadingState />;

  const all = (data?.data ?? []) as Row[];
  const healthState = (l: Row) => l['tamper'] ? 'tamper' : s(l['signal']) === 'offline' ? 'offline' : Number(l['battery'] ?? 100) < 25 ? 'low' : 'online';
  const online = all.filter(l => healthState(l) === 'online').length;
  const low = all.filter(l => healthState(l) === 'low').length;
  const tamper = all.filter(l => healthState(l) === 'tamper').length;
  const offline = all.filter(l => healthState(l) === 'offline').length;
  const rows = filter === 'all' ? all : all.filter(l => healthState(l) === filter);
  const battColor = (b: number) => b >= 60 ? '#33d6a8' : b >= 25 ? '#ffb020' : '#ff5c5c';

  const kpis = [
    { label: 'TOTAL LOCKS', value: String(all.length), delta: 'onboarded', trend: 'up' as const },
    { label: 'ONLINE', value: String(online), delta: 'reporting', trend: 'up' as const },
    { label: 'LOW BATTERY', value: String(low), delta: 'below 25%', trend: 'down' as const },
    { label: 'TAMPER ALERTS', value: String(tamper), delta: 'active', trend: 'down' as const },
    { label: 'OFFLINE', value: String(offline), delta: 'no signal', trend: 'down' as const },
  ];

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        {kpis.map(k => <KPICard key={k.label} {...k} />)}
      </div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {[
          { id: 'all', label: `All (${all.length})` },
          { id: 'online', label: `Online (${online})` },
          { id: 'low', label: `Low battery (${low})` },
          { id: 'tamper', label: `Tamper (${tamper})` },
          { id: 'offline', label: `Offline (${offline})` },
        ].map(f => <FilterChip key={f.id} label={f.label} active={filter === f.id} onClick={() => setFilter(f.id)} />)}
        <div className="ml-auto flex gap-0 border border-[rgba(255,255,255,.1)] rounded-lg overflow-hidden">
          <button className={`px-3 py-1.5 text-[11px] font-mono border-none cursor-pointer ${view === 'table' ? 'bg-ink-3 text-text-0' : 'bg-transparent text-text-2'}`} onClick={() => setView('table')}>Table</button>
          <button className={`px-3 py-1.5 text-[11px] font-mono border-none cursor-pointer ${view === 'grid' ? 'bg-ink-3 text-text-0' : 'bg-transparent text-text-2'}`} onClick={() => setView('grid')}>Cards</button>
        </div>
      </div>

      {view === 'table' ? (
        <DataTable
          columns={[
            { id: 'id', header: 'Lock ID', accessor: (r: Row) => <span className="font-mono font-bold text-xs">{s(r['serial_number'] ?? r['lock_id'])}</span> },
            { id: 'battery', header: 'Battery', accessor: (r: Row) => {
              const b = Number(r['battery'] ?? 0);
              return (
                <div className="flex items-center gap-1.5">
                  <div className="w-[50px] h-1.5 rounded bg-ink-3 overflow-hidden">
                    <div className="h-full rounded" style={{ width: `${b}%`, background: battColor(b) }} />
                  </div>
                  <span className="font-mono text-[10px]" style={{ color: battColor(b) }}>{b}%</span>
                </div>
              );
            }},
            { id: 'signal', header: 'Signal', accessor: (r: Row) => <span className="font-mono text-xs" style={{ color: s(r['signal']) === 'strong' ? '#33d6a8' : s(r['signal']) === 'weak' ? '#ffb020' : '#ff5c5c' }}>{s(r['signal'])}</span> },
            { id: 'container', header: 'Container', accessor: (r: Row) => <span className="font-mono text-xs">{s(r['container_number'] ?? r['container_id'])}</span> },
            { id: 'status', header: 'Status', accessor: (r: Row) => <StatusBadge status={s(r['status'])} /> },
          ]}
          data={rows}
          keyExtractor={(r: Row) => s(r['id'])}
          searchable
          searchPlaceholder="Search locks…"
          onRowClick={(r: Row) => openDrawer(`Lock ${s(r['serial_number'] ?? r['lock_id'])}`, (
            <>
              <DrawerField label="Serial" value={s(r['serial_number'] ?? r['lock_id'])} />
              <DrawerField label="Battery" value={`${r['battery'] ?? 0}%`} />
              <DrawerField label="Signal" value={s(r['signal'])} />
              <DrawerField label="Container" value={s(r['container_number'] ?? r['container_id'])} />
              <DrawerField label="Status" value={<StatusBadge status={s(r['status'])} />} />
              <DrawerField label="Provider" value={s(r['provider'])} />
              <DrawerField label="Last Heartbeat" value={r['last_heartbeat'] ? new Date(s(r['last_heartbeat'])).toLocaleString() : '—'} />
            </>
          ))}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {rows.map(l => {
            const b = Number(l['battery'] ?? 0);
            const hs = healthState(l);
            const dotColor = hs === 'tamper' || hs === 'offline' ? '#ff5c5c' : hs === 'low' ? '#ffb020' : '#33d6a8';
            return (
              <Card key={s(l['id'])} className="p-4 cursor-pointer hover:border-[rgba(255,255,255,.15)]" onClick={() => openDrawer(`Lock ${s(l['serial_number'] ?? l['lock_id'])}`, (
                <>
                  <DrawerField label="Battery" value={`${b}%`} />
                  <DrawerField label="Signal" value={s(l['signal'])} />
                  <DrawerField label="Container" value={s(l['container_number'] ?? l['container_id'])} />
                  <DrawerField label="Status" value={<StatusBadge status={s(l['status'])} />} />
                </>
              ))}>
                <div className="flex items-center justify-between mb-3">
                  <span className="font-mono font-bold text-xs text-text-0">{s(l['serial_number'] ?? l['lock_id'])}</span>
                  <span className="w-2 h-2 rounded-full" style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }} />
                </div>
                <div className="flex items-center gap-3 mb-2">
                  <div className="relative w-10 h-10 flex-none">
                    <svg width="40" height="40" viewBox="0 0 40 40" style={{ transform: 'rotate(-90deg)' }}>
                      <circle cx="20" cy="20" r="15" fill="none" stroke="rgba(255,255,255,.06)" strokeWidth="4" />
                      <circle cx="20" cy="20" r="15" fill="none" stroke={battColor(b)} strokeWidth="4" strokeLinecap="round"
                        strokeDasharray={`${(b / 100) * 94.2} ${94.2 - (b / 100) * 94.2}`} />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center font-mono text-[9px] font-bold" style={{ color: battColor(b) }}>{b}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] text-text-2 font-mono truncate">{s(l['provider'])}</div>
                  </div>
                </div>
                <div className="text-[11px] text-text-2">{s(l['container_number'] ?? l['container_id'])}</div>
                {hs === 'tamper' && <div className="mt-2"><Badge variant="bad">TAMPER ALERT</Badge></div>}
              </Card>
            );
          })}
          {rows.length === 0 && <div className="col-span-full text-center text-text-2 text-xs py-8 font-mono">No locks match</div>}
        </div>
      )}
    </div>
  );
}

export function PortView() {
  const { data, isLoading } = useTrips({ status: 'at_port' });
  const { openDrawer, addToast } = useCDSStore();
  // This button used to call addToast('Unclamp initiated…') and nothing else:
  // no request was ever sent. The controller saw the confirmation, the lock
  // stayed installed, the trip stayed open, and the port crew was left holding
  // a container the desk believed was released.
  const unclamp = useUnclampTrip();
  if (isLoading) return <LoadingState />;
  const rows = (data?.data ?? []) as Row[];

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <DataTable
        columns={[
          { id: 'container', header: 'Container', accessor: (r: Row) => <span className="font-mono text-xs">{s(r['container_number'])}</span> },
          { id: 'truck', header: 'Truck', accessor: (r: Row) => <span className="font-mono text-xs">{s(r['vehicle_reg'])}</span> },
          { id: 'dest', header: 'Terminal', accessor: (r: Row) => s(r['destination']) },
          { id: 'arrived', header: 'Arrived', accessor: (r: Row) => r['delivered_at'] ? new Date(s(r['delivered_at'])).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—' },
          { id: 'status', header: 'Status', accessor: (r: Row) => <StatusBadge status={s(r['status'])} /> },
          { id: 'action', header: '', accessor: (r: Row) => (
            <Button
              size="sm"
              disabled={unclamp.isPending}
              onClick={(e) => {
                e.stopPropagation();
                unclamp.mutate({ id: s(r['id']) }, {
                  onSuccess: () => addToast(`Lock removed on ${s(r['container_number'])}`),
                  onError: () => addToast(`Could not unclamp ${s(r['container_number'])} — try again`),
                });
              }}
            >
              {unclamp.isPending ? 'Unclamping…' : 'Unclamp'}
            </Button>
          )},
        ]}
        data={rows}
        keyExtractor={(r: Row) => s(r['id'])}
        searchable
        searchPlaceholder="Search port queue…"
        onRowClick={(r: Row) => openDrawer(`Port — ${s(r['container_number'])}`, (
          <>
            <DrawerField label="Container" value={s(r['container_number'])} />
            <DrawerField label="Truck" value={s(r['vehicle_reg'])} />
            <DrawerField label="Driver" value={s(r['driver_name'])} />
            <DrawerField label="Status" value={<StatusBadge status={s(r['status'])} />} />
            <DrawerField label="Destination" value={s(r['destination'])} />
          </>
        ))}
      />
    </div>
  );
}

const ACTIVE_STATUSES = new Set([
  'created', 'draft', 'pending', 'approved', 'assigned', 'vehicle_assigned',
  'driver_assigned', 'awaiting_lock', 'locked', 'installed', 'dispatched',
  'in_transit', 'transit', 'checkpoint', 'delayed', 'at_port',
]);
const COMPLETED_STATUSES = new Set(['delivered', 'completed', 'billed', 'archived']);
const EXCEPTION_STATUSES = new Set(['delayed', 'cancelled', 'failed']);
const TRANSIT_STATUSES = new Set(['dispatched', 'in_transit', 'transit', 'checkpoint']);

const STALE_HOURS = 48;

function isToday(dateStr: unknown): boolean {
  if (!dateStr) return false;
  const d = new Date(String(dateStr));
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function hoursSince(dateStr: unknown): number {
  if (!dateStr) return Infinity;
  return (Date.now() - new Date(String(dateStr)).getTime()) / 3_600_000;
}

function StatusDistribution({ counts, total }: { counts: { label: string; count: number; color: string }[]; total: number }) {
  if (total === 0) return null;
  return (
    <Card className="p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[10px] tracking-wider text-text-2">STATUS DISTRIBUTION</span>
        <span className="font-mono text-[10px] text-text-2">{total} bookings</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden bg-ink-3 mb-3">
        {counts.filter(c => c.count > 0).map(c => (
          <div key={c.label} className="h-full transition-all" style={{ width: `${(c.count / total) * 100}%`, background: c.color }} title={`${c.label}: ${c.count}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {counts.filter(c => c.count > 0).map(c => (
          <div key={c.label} className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full flex-none" style={{ background: c.color }} />
            <span className="text-[10px] text-text-2 font-mono">{c.label}</span>
            <span className="text-[10px] text-text-0 font-mono font-bold">{c.count}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function PulseView() {
  const [filter, setFilter] = useState('all');
  const { data, isLoading } = useBookings();
  const { data: alertData } = useAlerts();
  const { openDrawer } = useCDSStore();
  if (isLoading) return <LoadingState />;
  const all = (data?.data ?? []) as Row[];
  const alerts = (alertData?.data ?? []) as Row[];

  const activeRows = all.filter(r => ACTIVE_STATUSES.has(s(r['status'])));
  const inTransit = all.filter(r => TRANSIT_STATUSES.has(s(r['status'])));
  const completedToday = all.filter(r => COMPLETED_STATUSES.has(s(r['status'])) && isToday(r['updated_at']));
  const exceptions = all.filter(r => {
    if (EXCEPTION_STATUSES.has(s(r['status']))) return true;
    if (ACTIVE_STATUSES.has(s(r['status'])) && hoursSince(r['updated_at']) > STALE_HOURS) return true;
    return false;
  });
  const staleActive = all.filter(r => ACTIVE_STATUSES.has(s(r['status'])) && !EXCEPTION_STATUSES.has(s(r['status'])) && hoursSince(r['updated_at']) > STALE_HOURS);

  const statusGroups = [
    { label: 'Pending', count: all.filter(r => ['created', 'draft', 'pending', 'approved'].includes(s(r['status']))).length, color: '#64748b' },
    { label: 'Assigned', count: all.filter(r => ['assigned', 'vehicle_assigned', 'driver_assigned'].includes(s(r['status']))).length, color: '#ff7a00' },
    { label: 'In Transit', count: inTransit.length, color: '#37e6ff' },
    { label: 'At Port', count: all.filter(r => s(r['status']) === 'at_port').length, color: '#ffb020' },
    { label: 'Delayed', count: all.filter(r => s(r['status']) === 'delayed').length, color: '#ff5c5c' },
    { label: 'Delivered', count: all.filter(r => s(r['status']) === 'delivered').length, color: '#33d6a8' },
    { label: 'Completed', count: all.filter(r => ['completed', 'billed'].includes(s(r['status']))).length, color: '#22c55e' },
  ];

  const filterMap: Record<string, Row[]> = {
    all,
    active: activeRows,
    transit: inTransit,
    exceptions,
    completed: all.filter(r => COMPLETED_STATUSES.has(s(r['status']))),
  };
  const rows = filterMap[filter] ?? all;

  const isException = (r: Row) => EXCEPTION_STATUSES.has(s(r['status'])) || (ACTIVE_STATUSES.has(s(r['status'])) && hoursSince(r['updated_at']) > STALE_HOURS);

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KPICard label="ACTIVE BOOKINGS" value={String(activeRows.length)} delta={`${all.length} total`} trend="up" />
        <KPICard label="IN TRANSIT" value={String(inTransit.length)} delta="moving now" trend="up" />
        <KPICard label="EXCEPTIONS" value={String(exceptions.length)} delta={staleActive.length > 0 ? `${staleActive.length} stale` : 'none flagged'} trend={exceptions.length > 0 ? 'down' : 'up'} />
        <KPICard label="COMPLETED TODAY" value={String(completedToday.length)} delta={`${alerts.length} alerts`} trend={completedToday.length > 0 ? 'up' : 'down'} />
      </div>

      <StatusDistribution counts={statusGroups} total={all.length} />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {[
          { id: 'all', label: `All (${all.length})` },
          { id: 'active', label: `Active (${activeRows.length})` },
          { id: 'transit', label: `In Transit (${inTransit.length})` },
          { id: 'exceptions', label: `Exceptions (${exceptions.length})` },
          { id: 'completed', label: `Completed (${all.filter(r => COMPLETED_STATUSES.has(s(r['status']))).length})` },
        ].map(f => <FilterChip key={f.id} label={f.label} active={filter === f.id} onClick={() => setFilter(f.id)} />)}
      </div>

      <DataTable
        columns={[
          { id: 'ref', header: 'Booking Ref', accessor: (r: Row) => (
            <div className="flex items-center gap-1.5">
              {isException(r) && <span className="w-1.5 h-1.5 rounded-full bg-cds-red flex-none" style={{ boxShadow: '0 0 6px rgba(255,92,92,.6)' }} />}
              <span className="font-mono font-bold text-cds-orange text-xs">{s(r['booking_number'])}</span>
            </div>
          )},
          { id: 'client', header: 'Client', accessor: (r: Row) => <span className="text-xs truncate max-w-[140px] block">{s(r['customer_name'])}</span> },
          { id: 'route', header: 'Route', accessor: (r: Row) => {
            const from = s(r['pickup_location'] ?? r['origin']);
            const to = s(r['delivery_location'] ?? r['destination']);
            if (from === '—' && to === '—') return <span className="text-text-2 text-xs">—</span>;
            return <span className="text-[10px] font-mono text-text-1 truncate max-w-[180px] block">{from} → {to}</span>;
          }},
          { id: 'status', header: 'Status', accessor: (r: Row) => <StatusBadge status={s(r['status'])} /> },
          { id: 'age', header: 'Last Update', accessor: (r: Row) => {
            const h = hoursSince(r['updated_at']);
            const stale = ACTIVE_STATUSES.has(s(r['status'])) && h > STALE_HOURS;
            if (!isFinite(h)) return <span className="text-text-2 text-[10px] font-mono">—</span>;
            const label = h < 1 ? '<1h ago' : h < 24 ? `${Math.floor(h)}h ago` : `${Math.floor(h / 24)}d ago`;
            return <span className={`text-[10px] font-mono ${stale ? 'text-cds-red font-bold' : 'text-text-2'}`}>{label}{stale ? ' !' : ''}</span>;
          }},
        ]}
        data={rows}
        keyExtractor={(r: Row) => s(r['id'])}
        searchable
        searchPlaceholder="Search bookings…"
        onRowClick={(r: Row) => openDrawer(`Pulse — ${s(r['booking_number'])}`, (
          <>
            <DrawerField label="Booking #" value={<span className="text-cds-orange">{s(r['booking_number'])}</span>} />
            {s(r['carrier_reference']) !== '—' && <DrawerField label="Carrier Ref" value={s(r['carrier_reference'])} />}
            <DrawerField label="Client" value={s(r['customer_name'])} />
            <DrawerField label="Status" value={<StatusBadge status={s(r['status'])} />} />
            <DrawerField label="Commodity" value={s(r['commodity'])} />
            {s(r['pickup_location'] ?? r['origin']) !== '—' && <DrawerField label="From" value={s(r['pickup_location'] ?? r['origin'])} />}
            {s(r['delivery_location'] ?? r['destination']) !== '—' && <DrawerField label="To" value={s(r['delivery_location'] ?? r['destination'])} />}
            {s(r['vessel']) !== '—' && <DrawerField label="Vessel" value={`${s(r['vessel'])} / ${s(r['voyage'])}`} />}
            {s(r['shipping_line']) !== '—' && <DrawerField label="Line" value={s(r['shipping_line'])} />}
            {r['eta'] && <DrawerField label="ETA" value={new Date(s(r['eta'])).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} />}
            <DrawerField label="Last Updated" value={r['updated_at'] ? new Date(s(r['updated_at'])).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'} />
            <DrawerField label="Created" value={r['created_at'] ? new Date(s(r['created_at'])).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'} />
            {isException(r) && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-cds-red/10 border border-cds-red/20">
                <div className="text-[10px] font-mono text-cds-red font-bold tracking-wider mb-1">EXCEPTION</div>
                <div className="text-[11px] text-cds-red/80">
                  {EXCEPTION_STATUSES.has(s(r['status'])) ? `Status: ${s(r['status']).toUpperCase()}` : `No update in ${Math.floor(hoursSince(r['updated_at']))}h — possible stall`}
                </div>
              </div>
            )}
          </>
        ))}
      />
    </div>
  );
}

export function InboxView() {
  const { data: activity, isLoading } = useActivity(50);
  if (isLoading) return <LoadingState />;
  const items = (activity ?? []) as Row[];

  const iconMap: Record<string, string> = {
    clamp: '🔒', depart: '🚛', checkpoint: '📍', sync: '🔄',
    arrival: '✅', unclamp: '🔓', ai: '🤖', alert: '⚠️',
    lock: '🔒', unlock: '🔓',
  };

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <Card className="p-4">
        <div className="font-bold text-sm text-text-0">Dispatch Log</div>
        {/* Says where the entries come from, so an empty log reads as "nothing
            has happened yet" rather than "this screen may be broken". */}
        <div className="text-[10px] font-mono text-text-2 mt-0.5 mb-3">
          CUSTODY CHAIN · E-LOCK EVENTS · TRIP TRANSITIONS · ALERTS
        </div>
        <div className="space-y-0 max-h-[600px] overflow-y-auto">
          {items.map((item, i) => (
            <div key={String(item['id'] ?? i)} className="flex items-start gap-2.5 py-2.5 border-b border-white/[.05] last:border-0">
              <span className="text-sm flex-none mt-0.5">{iconMap[String(item['icon'] ?? item['type'] ?? '')] ?? '📋'}</span>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-text-0">{String(item['description'] ?? item['text'] ?? '—')}</div>
                {item['meta'] ? (
                  <div className="text-[11px] text-text-1 mt-0.5 break-words">{String(item['meta'])}</div>
                ) : null}
              </div>
              <div className="text-[10px] text-text-2 font-mono flex-none mt-0.5">
                {item['created_at']
                  ? new Date(String(item['created_at'])).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                  : ''}
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <div className="text-xs text-text-2 text-center py-10 font-mono">
              No field activity recorded yet — clamps, dispatches, lock events and alerts appear here as they happen.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

export function BillingView() {
  const [filter, setFilter] = useState<'all' | 'delivered' | 'completed' | 'billed'>('all');
  const { data, isLoading } = useBookings();
  const markBilled = useMarkBilled();
  const { addToast } = useCDSStore();
  if (isLoading) return <LoadingState />;

  const all = (data?.data ?? []) as Row[];
  const billingRows = all.filter(r => ['delivered', 'completed', 'billed'].includes(s(r['status'])));
  const filtered = filter === 'all' ? billingRows : billingRows.filter(r => r['status'] === filter);
  const readyCount = billingRows.filter(r => ['delivered', 'completed'].includes(s(r['status']))).length;
  const billedCount = billingRows.filter(r => r['status'] === 'billed').length;

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <KPICard label="READY TO BILL" value={String(readyCount)} delta="completed bookings" trend="up" />
        <KPICard label="BILLED" value={String(billedCount)} delta="processed" trend="up" />
        <KPICard label="TOTAL" value={String(billingRows.length)} delta="in billing cycle" trend="up" />
      </div>
      <div className="flex gap-1 mb-4">
        {(['all', 'delivered', 'completed', 'billed'] as const).map(f => (
          <FilterChip key={f} label={f === 'all' ? 'All' : f.toUpperCase()} active={filter === f} onClick={() => setFilter(f)} />
        ))}
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[rgba(255,255,255,.06)]">
              {['Booking #', 'Customer', 'Reference', 'Commodity', 'Status', 'Date', 'Action'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-text-2 font-mono text-[10px] tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(row => (
              <tr key={s(row['id'])} className="border-b border-[rgba(255,255,255,.04)] hover:bg-[rgba(255,255,255,.02)]">
                <td className="px-4 py-3 font-mono text-cds-orange">{s(row['booking_number'])}</td>
                <td className="px-4 py-3">{s(row['customer_name'])}</td>
                <td className="px-4 py-3 font-mono">{s(row['reference'])}</td>
                <td className="px-4 py-3">{s(row['commodity'])}</td>
                <td className="px-4 py-3"><StatusBadge status={s(row['status'])} /></td>
                <td className="px-4 py-3 font-mono text-text-2">
                  {row['created_at'] ? new Date(s(row['created_at'])).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '—'}
                </td>
                <td className="px-4 py-3">
                  {['delivered', 'completed'].includes(s(row['status'])) && (
                    <button
                      onClick={() => markBilled.mutate(s(row['id']), {
                        onSuccess: () => addToast(`Booking ${s(row['booking_number'])} marked as billed`, 'success'),
                      })}
                      disabled={markBilled.isPending}
                      className="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Mark Billed
                    </button>
                  )}
                  {s(row['status']) === 'billed' && (
                    <span className="text-[10px] font-mono text-text-2">Processed</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-text-2 font-mono text-[11px]">
                  No billing records. Completed bookings appear here automatically.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

export function ReportsView() {
  const [selected, setSelected] = useState('daily');
  const { addToast } = useCDSStore();
  const { data: reportData, isLoading } = useReports();
  const generateReport = useGenerateReport();
  const types = [
    { id: 'daily', label: 'Daily Report', desc: 'PDF summary', format: 'pdf' as const },
    { id: 'weekly', label: 'Weekly Report', desc: 'Excel export', format: 'excel' as const },
    { id: 'monthly', label: 'Monthly Report', desc: 'Full analytics', format: 'pdf' as const },
    { id: 'custom', label: 'Custom Report', desc: 'Date range export', format: 'csv' as const },
  ];
  const reports = reportData?.data ?? [];

  const handleGenerate = (format: 'pdf' | 'excel' | 'csv') => {
    const t = types.find(x => x.id === selected);
    generateReport.mutate(
      { name: t?.label ?? 'Report', type: selected as 'daily' | 'weekly' | 'monthly' | 'custom', format, parameters: {} },
      { onSuccess: () => addToast('Report generating…'), onError: () => addToast('Failed to generate report', 'error') },
    );
  };

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {types.map(t => (
          <Card key={t.id} className={`p-4 cursor-pointer transition-colors ${selected === t.id ? 'border-cds-orange/50' : ''}`} onClick={() => setSelected(t.id)}>
            <div className="font-bold text-sm text-text-0">{t.label}</div>
            <div className="text-[11px] text-text-2 mt-1">{t.desc}</div>
          </Card>
        ))}
      </div>
      <div className="flex gap-2 mb-5">
        <Button onClick={() => handleGenerate('pdf')} disabled={generateReport.isPending}>Generate PDF</Button>
        <Button variant="ghost" onClick={() => handleGenerate('excel')} disabled={generateReport.isPending}>Excel export</Button>
        <Button variant="ghost" onClick={() => handleGenerate('csv')} disabled={generateReport.isPending}>CSV export</Button>
      </div>
      <Card className="p-4">
        <div className="font-bold text-sm text-text-0 mb-3">Generated Reports</div>
        {isLoading && <div className="text-xs text-text-2 font-mono py-4 text-center">Loading reports…</div>}
        {reports.map(r => (
          <div key={r.id} className="flex items-center gap-3 py-3 border-b border-[rgba(255,255,255,.04)] last:border-0">
            <span className="text-lg">{r.format === 'pdf' ? '📄' : r.format === 'excel' ? '📊' : '📋'}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text-0">{r.name}</div>
              <div className="text-[10px] text-text-2 font-mono mt-0.5">
                {r.format.toUpperCase()} · {r.generatedAt ? new Date(r.generatedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
              </div>
            </div>
            <StatusBadge status={r.status} />
            {r.status === 'ready' && r.downloadUrl && (
              <Button size="sm" variant="ghost" onClick={() => window.open(r.downloadUrl!, '_blank')}>Download</Button>
            )}
          </div>
        ))}
        {!isLoading && reports.length === 0 && (
          <div className="text-xs text-text-2 font-mono py-6 text-center">No reports generated yet. Select a type and click Generate.</div>
        )}
      </Card>
    </div>
  );
}

export function AnalyticsView() {
  const [days, setDays] = useState<7 | 30 | 90 | 365>(30);
  const [lens, setLens] = useState<'executive' | 'coordinator'>('executive');
  const { data, isLoading, isError, isFetching, refetch, dataUpdatedAt } = useCDSAnalytics(days);
  const acknowledge = useAcknowledgeAlert();
  const { addToast } = useCDSStore();

  if (isLoading) return <LoadingState />;
  if (!data) {
    return (
      <div className="p-5 max-w-[1600px] mx-auto">
        <Card className="p-6 border border-red-400/20">
          <div className="font-bold text-text-0 mb-2">CDS analytics unavailable</div>
          <p className="text-xs text-text-2 mb-4">The live analytics snapshot could not be loaded. No sample figures are shown.</p>
          <Button onClick={() => { void refetch(); }}>Retry analytics</Button>
        </Card>
      </div>
    );
  }

  const s = data.summary;
  const fmt = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat().format(value);
  const pct = (value: number | null | undefined) => value == null ? '—' : Number(value).toFixed(1) + '%';
  const dateLabel = (value: string) => {
    const date = new Date(value + (value.length === 10 ? 'T12:00:00' : ''));
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };
  const label = (value: string) => value.replaceAll('_', ' ');
  const dataQuality = [
    { label: 'Open trips missing vehicle', value: s.trips_missing_vehicle },
    { label: 'Open trips missing driver', value: s.trips_missing_driver },
    { label: 'Open trips missing container', value: s.trips_missing_container },
    { label: 'Open trips missing e-lock', value: s.trips_missing_lock },
    { label: 'Open trips missing ETA', value: s.trips_missing_eta },
  ];
  const hasDataQualityGaps = dataQuality.some(row => row.value > 0);
  const trendMax = Math.max(1, ...data.daily.flatMap(row => [row.trips_started, row.deliveries_completed]));
  const trendStep = Math.max(1, Math.ceil(data.daily.length / 24));
  const trendBuckets = data.daily.reduce<Array<{ label: string; start: string; end: string; started: number; delivered: number }>>((buckets, row, index) => {
    const bucketIndex = Math.floor(index / trendStep);
    if (!buckets[bucketIndex]) buckets[bucketIndex] = { label: dateLabel(row.day), start: row.day, end: row.day, started: 0, delivered: 0 };
    buckets[bucketIndex].end = row.day;
    buckets[bucketIndex].started += row.trips_started;
    buckets[bucketIndex].delivered += row.deliveries_completed;
    return buckets;
  }, []);
  const breakdown = (items: Array<{ label: string; value: number; detail?: string }>, max: number) => (
    <div className="space-y-3">
      {items.map(item => (
        <div key={item.label}>
          <div className="flex justify-between gap-3 text-xs mb-1">
            <span className="text-text-1 capitalize">{item.label}</span>
            <span className="font-mono font-bold text-text-0">{fmt(item.value)}{item.detail ? <span className="text-text-2 font-normal ml-2">{item.detail}</span> : null}</span>
          </div>
          <div className="h-1.5 rounded bg-white/[.06] overflow-hidden">
            <div className="h-full rounded bg-cds-orange" style={{ width: (max > 0 ? Math.max(0, Math.min(100, item.value / max * 100)) : 0) + '%' }} />
          </div>
        </div>
      ))}
      {items.length === 0 && <div className="text-xs text-text-2 py-6 text-center">No records in this view.</div>}
    </div>
  );

  return (
    <div className="p-5 max-w-[1600px] mx-auto space-y-4">
      <div className="flex flex-wrap justify-between items-start gap-4">
        <div>
          <div className="text-[10px] font-mono tracking-[.18em] uppercase text-cds-orange mb-1">CDS / Operations intelligence</div>
          <h2 className="text-xl font-bold tracking-tight text-text-0">Container operations analytics</h2>
          <p className="text-xs text-text-2 mt-1">Live operational records · {dateLabel(data.meta.period_start)} – {dateLabel(data.meta.period_end)} · refreshed {new Date(dataUpdatedAt || data.meta.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <div className="flex rounded-lg border border-white/10 p-1 gap-1">
            {([7, 30, 90, 365] as const).map(windowDays => (
              <button key={windowDays} type="button" onClick={() => setDays(windowDays)} aria-pressed={days === windowDays} className={'rounded-md px-3 py-2 min-h-[36px] text-xs font-mono transition-colors ' + (days === windowDays ? 'bg-cds-orange text-[#170d00] font-bold' : 'text-text-2 hover:text-text-0')}>{windowDays}D</button>
            ))}
          </div>
          <Button variant="ghost" disabled={isFetching} onClick={() => { void refetch(); }}>{isFetching ? 'Refreshing…' : 'Refresh'}</Button>
        </div>
      </div>
      {isError && <div role="status" className="border border-amber-400/20 bg-amber-500/5 rounded-lg px-3 py-2 text-xs text-amber-200">Refresh failed. Showing the last successfully loaded snapshot; retry to reconcile with live data.</div>}

      <div className="flex gap-2" role="group" aria-label="Analytics view">
        <button type="button" onClick={() => setLens('executive')} aria-pressed={lens === 'executive'} className={'px-3 py-2 rounded-lg text-xs border ' + (lens === 'executive' ? 'border-cds-orange/50 bg-cds-orange/10 text-text-0' : 'border-white/10 text-text-2')}>Executive overview</button>
        <button type="button" onClick={() => setLens('coordinator')} aria-pressed={lens === 'coordinator'} className={'px-3 py-2 rounded-lg text-xs border ' + (lens === 'coordinator' ? 'border-cds-orange/50 bg-cds-orange/10 text-text-0' : 'border-white/10 text-text-2')}>Coordinator operations</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'TRIPS STARTED', value: fmt(s.trips_started), detail: 'Created in selected window' },
          { label: 'DELIVERIES COMPLETED', value: fmt(s.deliveries_completed), detail: 'Counted by delivery timestamp' },
          { label: 'ACTIVE TRIP LIFECYCLE', value: fmt(s.active_trips), detail: fmt(s.moving_trips) + ' moving / checkpoint / delayed' },
          { label: 'DELAYED TRIPS', value: fmt(s.delayed_trips), detail: 'Current persisted status', warning: s.delayed_trips > 0 },
          { label: 'ETA ATTAINMENT', value: pct(s.eta_attainment_pct), detail: fmt(s.eta_met) + ' of ' + fmt(s.eta_observed) + ' completed deliveries had an ETA and met it' },
          { label: 'AVERAGE TRANSIT', value: s.avg_transit_hours == null ? '—' : Number(s.avg_transit_hours).toFixed(1) + ' h', detail: 'Completed in window with both timestamps' },
          { label: 'CONTAINER UTILISATION', value: pct(s.container_utilization_pct), detail: fmt(s.containers_in_use) + ' in use of ' + fmt(s.total_containers) + ' registered' },
          { label: 'LOCKS NEEDING ATTENTION', value: fmt(s.locks_needing_attention), detail: fmt(s.unacknowledged_alerts) + ' open alerts · ' + fmt(s.open_incidents) + ' open incidents', warning: s.locks_needing_attention > 0 },
        ].map(k => (
          <Card key={k.label} className="p-3.5 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-[2px] bg-cds-orange/70" />
            <div className="text-[9px] uppercase tracking-[.14em] font-mono text-text-2">{k.label}</div>
            <div className={'text-2xl font-bold font-mono mt-2 ' + (k.warning ? 'text-amber-300' : 'text-text-0')}>{k.value}</div>
            <div className="text-[10px] text-text-2 mt-1 leading-relaxed">{k.detail}</div>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap justify-between gap-2 mb-1">
          <div><h3 className="font-bold text-sm text-text-0">Operational throughput</h3><p className="text-[11px] text-text-2 mt-1">Trips created versus deliveries recorded each day; longer windows are grouped for legibility.</p></div>
          <div className="flex gap-3 text-[10px] items-center"><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-cds-orange" />Started</span><span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-cds-teal" />Delivered</span></div>
        </div>
        {data.daily.length === 0 || data.daily.every(row => row.trips_started === 0 && row.deliveries_completed === 0) ? (
          <div className="py-12 text-center text-xs text-text-2">No trip starts or deliveries were recorded in this period.</div>
        ) : (
          <div className="flex h-[190px] items-end gap-1 pt-4">
            {trendBuckets.map(bucket => (
              <div key={bucket.start} title={bucket.start + ' – ' + bucket.end + ': ' + bucket.started + ' started, ' + bucket.delivered + ' delivered'} className="min-w-0 flex-1 h-full flex flex-col justify-end items-center">
                <div className="h-[155px] w-full flex items-end justify-center gap-[2px]">
                  <div className="w-[42%] rounded-t-sm bg-cds-orange/90" style={{ height: (bucket.started > 0 ? Math.max(2, bucket.started / trendMax * 145) : 0) + 'px' }} />
                  <div className="w-[42%] rounded-t-sm bg-cds-teal/90" style={{ height: (bucket.delivered > 0 ? Math.max(2, bucket.delivered / trendMax * 145) : 0) + 'px' }} />
                </div>
                <span className="mt-2 text-[8px] text-text-2 font-mono">{bucket.label}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {lens === 'executive' ? (
          <>
            <Card className="p-4">
              <h3 className="font-bold text-sm text-text-0 mb-1">Highest-volume lanes</h3>
              <p className="text-[11px] text-text-2 mb-3">Top origin–destination pairs by trip creation in the selected window.</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-xs">
                  <thead><tr className="text-[9px] uppercase tracking-wider text-text-2 border-b border-white/10"><th className="text-left py-2">Lane</th><th className="text-right py-2">Trips</th><th className="text-right py-2">Delivered</th><th className="text-right py-2">Avg transit</th><th className="text-right py-2">Delayed now</th></tr></thead>
                  <tbody>{data.lanes.map((lane, index) => <tr key={lane.origin + '|' + lane.destination + '|' + index} className="border-b border-white/[.05]"><td className="py-2.5 pr-3"><div className="text-text-0">{lane.origin}</div><div className="text-[10px] text-text-2 mt-0.5">to {lane.destination}</div></td><td className="text-right font-mono">{fmt(lane.trips_started)}</td><td className="text-right font-mono">{fmt(lane.deliveries_completed)}</td><td className="text-right font-mono">{lane.avg_transit_hours == null ? '—' : Number(lane.avg_transit_hours).toFixed(1) + ' h'}</td><td className="text-right font-mono">{fmt(lane.currently_delayed)}</td></tr>)}</tbody>
                </table>
                {data.lanes.length === 0 && <div className="text-xs text-text-2 py-8 text-center">No trips were created in this period.</div>}
              </div>
            </Card>
            <Card className="p-4">
              <h3 className="font-bold text-sm text-text-0 mb-1">Booking pipeline</h3>
              <p className="text-[11px] text-text-2 mb-4">Current counts by persisted booking status.</p>
              {breakdown(data.booking_pipeline.map(row => ({ label: label(row.status), value: row.count })), Math.max(1, ...data.booking_pipeline.map(row => row.count)))}
              <div className="grid grid-cols-2 gap-3 mt-4 pt-3 border-t border-white/[.06]">
                <div><div className="text-[9px] uppercase text-text-2">Open incidents</div><div className="text-xl font-mono font-bold text-text-0 mt-1">{fmt(s.open_incidents)}</div></div>
                <div><div className="text-[9px] uppercase text-text-2">Fleet utilisation</div><div className="text-xl font-mono font-bold text-text-0 mt-1">{pct(s.vehicle_utilization_pct)}</div></div>
              </div>
            </Card>
          </>
        ) : (
          <>
            <Card className="p-4">
              <h3 className="font-bold text-sm text-text-0 mb-1">Trip lifecycle</h3>
              <p className="text-[11px] text-text-2 mb-4">All current non-deleted trip records by persisted database status, including zero-count states.</p>
              {breakdown(data.trip_statuses.map(row => ({ label: label(row.status), value: row.count })), Math.max(1, ...data.trip_statuses.map(row => row.count)))}
            </Card>
            <Card className="p-4">
              <h3 className="font-bold text-sm text-text-0 mb-1">Risk exposure</h3>
              <p className="text-[11px] text-text-2 mb-4">Risk classifications on trips not completed or archived.</p>
              {breakdown(data.risk_mix.map(row => ({ label: label(row.risk), value: row.count })), Math.max(1, ...data.risk_mix.map(row => row.count)))}
            </Card>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div><h3 className="font-bold text-sm text-text-0">Fleet and e-lock health</h3><p className="text-[11px] text-text-2 mt-1">Current registered inventory, not period activity.</p></div>
            <span className="text-[9px] uppercase tracking-wider font-mono text-text-2">{fmt(s.total_locks)} locks</span>
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="rounded-lg bg-white/[.025] p-3"><div className="text-[9px] text-text-2 uppercase tracking-wider">Vehicles in use</div><div className="text-xl font-bold font-mono mt-1">{fmt(s.vehicles_in_use)}</div><div className="text-[10px] text-text-2">{fmt(s.vehicles_in_maintenance)} in maintenance</div></div>
            <div className="rounded-lg bg-white/[.025] p-3"><div className="text-[9px] text-text-2 uppercase tracking-wider">Active drivers</div><div className="text-xl font-bold font-mono mt-1">{fmt(s.active_drivers)}</div><div className="text-[10px] text-text-2">{pct(s.vehicle_utilization_pct)} available/in-use vehicle utilisation</div></div>
          </div>
          <div className="text-xs font-bold text-text-1 mb-3">Lock distribution</div>
          {breakdown(data.lock_statuses.map(row => ({ label: label(row.status), value: row.count, detail: row.low_battery || row.tampered ? fmt(row.low_battery) + ' low battery · ' + fmt(row.tampered) + ' tampered' : undefined })), Math.max(1, ...data.lock_statuses.map(row => row.count)))}
          <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-white/[.06] text-center">
            <div><div className="font-mono font-bold text-text-0">{fmt(s.low_battery_locks)}</div><div className="text-[9px] uppercase text-text-2 mt-1">Low battery (under 25%)</div></div>
            <div><div className="font-mono font-bold text-text-0">{fmt(s.tampered_locks)}</div><div className="text-[9px] uppercase text-text-2 mt-1">Tampered</div></div>
            <div><div className="font-mono font-bold text-text-0">{fmt(s.stale_lock_heartbeats)}</div><div className="text-[9px] uppercase text-text-2 mt-1">Stale heartbeat</div></div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div><h3 className="font-bold text-sm text-text-0">Operational data quality</h3><p className="text-[11px] text-text-2 mt-1">Open trips checked for assignment and planning completeness.</p></div>
            <Badge variant={hasDataQualityGaps ? 'warn' : 'ok'}>{hasDataQualityGaps ? 'REVIEW' : 'NO GAPS FOUND'}</Badge>
          </div>
          {dataQuality.map(row => <div key={row.label} className="flex items-center justify-between gap-3 py-2 border-b border-white/[.05] last:border-0 text-xs"><span className="text-text-1">{row.label}</span><span className={'font-mono font-bold ' + (row.value > 0 ? 'text-cds-amber' : 'text-text-0')}>{fmt(row.value)}</span></div>)}
          {hasDataQualityGaps ? <p className="text-[10px] text-text-2 mt-3">A missing assignment may be legitimate in an early lifecycle state. Review the trip status before treating it as an exception.</p> : <p className="text-[10px] text-text-2 mt-3">No missing assignment fields were detected among current open trips in these checks.</p>}
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-3 mb-3"><div><h3 className="font-bold text-sm text-text-0">Priority alerts</h3><p className="text-[11px] text-text-2 mt-1">Unacknowledged alerts ordered by severity and recency. Acknowledge writes through to the backend.</p></div><span className="font-mono text-xs text-text-2">{fmt(s.unacknowledged_alerts)} open</span></div>
        <div className="max-h-[360px] overflow-y-auto">
          {data.alerts.map(alert => <div key={alert.id} className="py-3 border-b border-white/[.05] last:border-0 flex items-start gap-2.5">
            <div className={'w-1.5 h-1.5 mt-1.5 rounded-full shrink-0 ' + (alert.severity === 'critical' || alert.severity === 'high' ? 'bg-cds-red' : alert.severity === 'medium' ? 'bg-cds-amber' : 'bg-cds-teal')} />
            <div className="flex-1 min-w-0"><div className="text-xs text-text-0 font-semibold">{alert.title || alert.message}</div><div className="text-[10px] text-text-2 mt-1">{label(alert.type)} · {new Date(alert.created_at).toLocaleString()}</div></div>
            <StatusBadge status={alert.severity} />
            <Button size="sm" variant="ghost" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate(alert.id, { onSuccess: () => addToast('Alert acknowledged'), onError: () => addToast('Could not acknowledge this alert', 'error') })}>Ack</Button>
          </div>)}
          {data.alerts.length === 0 && <div className="py-8 text-xs text-text-2 text-center">No unacknowledged alerts.</div>}
        </div>
      </Card>
      <div className="text-[10px] text-text-2">Definitions: ETA attainment includes completed deliveries with a recorded ETA. Average transit requires departure and delivery timestamps. Inventory figures are current; activity figures are timestamp-based. Snapshot generated {new Date(data.meta.generated_at).toLocaleString()}.</div>
    </div>
  );
}
export function SettingsView() {
  const [tab, setTab] = useState('profile');
  const tabs = ['profile', 'field access'];

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="flex gap-4" style={{ minHeight: 400 }}>
        <div className="w-[180px] flex-none space-y-1">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`w-full text-left px-4 py-2.5 rounded-lg text-xs font-semibold border-none cursor-pointer transition-colors capitalize ${tab === t ? 'bg-[rgba(255,255,255,.06)] text-cds-orange' : 'bg-transparent text-text-2 hover:text-text-1'}`}>
              {t}
            </button>
          ))}
        </div>
        {tab === 'field access' ? (
          <FieldAccessPanel />
        ) : (
          <ProfilePanel />
        )}
      </div>
    </div>
  );
}

function ProfilePanel() {
  const user = useAuthStore(s => s.user);
  if (!user) return null;
  const rows = [
    { label: 'Full name', value: user.name ?? '—' },
    { label: 'Email', value: user.email ?? '—' },
    { label: 'Role', value: (user.role ?? '—').toUpperCase().replace('_', ' ') },
    { label: 'Organisation ID', value: user.org_id ?? '—' },
  ];
  return (
    <Card className="flex-1 p-5">
      <div className="space-y-0">
        {rows.map((row, i) => (
          <div key={row.label} className={`flex items-center justify-between py-3.5 ${i < rows.length - 1 ? 'border-b border-[rgba(255,255,255,.05)]' : ''}`}>
            <div className="text-xs text-text-0">{row.label}</div>
            <span className="text-xs font-mono text-text-1">{row.value}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
