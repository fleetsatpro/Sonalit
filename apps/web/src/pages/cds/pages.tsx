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
  const [alertFilter, setAlertFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');
  const [alertSearch, setAlertSearch] = useState('');
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const { data, isLoading, isError, error, isFetching, refetch, dataUpdatedAt } = useCDSAnalytics(days);
  const acknowledge = useAcknowledgeAlert();
  const { addToast } = useCDSStore();

  if (isLoading) return <LoadingState />;
  if (!data || !data.summary) {
    const analyticsError = error && typeof error === 'object'
      ? error as { response?: { status?: unknown; data?: { error?: unknown } }; code?: unknown; message?: unknown }
      : null;
    const responseStatus = analyticsError?.response?.status;
    const failureDetail = typeof responseStatus === 'number'
      ? 'The analytics endpoint returned HTTP ' + responseStatus + (analyticsError?.response?.data?.error ? ' (' + String(analyticsError.response.data.error) + ')' : '') + '. Your CDS data has not been replaced with sample figures.'
      : analyticsError?.code === 'ERR_NETWORK'
        ? 'The same-origin analytics endpoint did not return an HTTP response. The request may have been interrupted by the network or deployment. No sample figures are shown.'
        : 'A live analytics snapshot was not returned. No sample figures are shown.';
    return (
      <div className="p-4 sm:p-6 max-w-[1800px] mx-auto">
        <Card className="overflow-hidden border border-red-400/20">
          <div className="h-1 bg-gradient-to-r from-red-400 via-amber-300 to-transparent" />
          <div className="p-6 sm:p-8">
            <div className="text-[10px] uppercase tracking-[.22em] font-mono text-red-300 mb-3">CDS · Data connection</div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-0">Analytics snapshot unavailable</h2>
            <p role="status" className="text-sm text-text-2 mt-3 max-w-2xl leading-relaxed">{failureDetail}</p>
            <div className="flex flex-wrap gap-3 items-center mt-6">
              <Button disabled={isFetching} onClick={() => { void refetch(); }}>{isFetching ? 'Reconnecting…' : 'Retry snapshot'}</Button>
              <span className="text-[11px] text-text-2">Operational figures remain hidden until an authoritative response is received.</span>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const s = data.summary;
  const fmt = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
  const pct = (value: number | null | undefined) => value == null ? '—' : Number(value).toFixed(1) + '%';
  const dateLabel = (value: string) => {
    const date = new Date(value + (value.length === 10 ? 'T12:00:00' : ''));
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: value.length > 10 ? undefined : undefined });
  };
  const label = (value: string) => value.replaceAll('_', ' ');
  const generatedAt = new Date(data.meta.generated_at);
  const refreshedAt = dataUpdatedAt ? new Date(dataUpdatedAt) : generatedAt;
  const ageMinutes = Number.isFinite(generatedAt.getTime()) ? Math.max(0, Math.round((Date.now() - generatedAt.getTime()) / 60000)) : null;
  const snapshotAge = ageMinutes == null ? 'Age unknown' : ageMinutes < 1 ? 'Generated less than a minute ago' : ageMinutes + ' min old';
  const trendStep = Math.max(1, Math.ceil(data.daily.length / 28));
  const trendBuckets = data.daily.reduce<Array<{ label: string; start: string; end: string; started: number; delivered: number }>>((buckets, row, index) => {
    const bucketIndex = Math.floor(index / trendStep);
    if (!buckets[bucketIndex]) buckets[bucketIndex] = { label: dateLabel(row.day), start: row.day, end: row.day, started: 0, delivered: 0 };
    buckets[bucketIndex].end = row.day;
    buckets[bucketIndex].started += row.trips_started;
    buckets[bucketIndex].delivered += row.deliveries_completed;
    return buckets;
  }, []);
  const maxTrend = Math.max(1, ...trendBuckets.flatMap(row => [row.started, row.delivered]));
  const totalDataGaps = s.trips_missing_vehicle + s.trips_missing_driver + s.trips_missing_container + s.trips_missing_lock + s.trips_missing_eta;
  const exceptionCount = s.delayed_trips + s.locks_needing_attention + s.overdue_inspections + s.containers_missing_location + totalDataGaps + s.unacknowledged_alerts;
  const kpis = [
    { id: 'throughput', label: 'Trips initiated', value: fmt(s.trips_started), detail: 'Created within the selected period', color: 'orange', target: '#cds-throughput', series: data.daily.map(row => row.trips_started) },
    { id: 'delivery', label: 'Deliveries recorded', value: fmt(s.deliveries_completed), detail: 'Delivery timestamps in this period', color: 'teal', target: '#cds-throughput', series: data.daily.map(row => row.deliveries_completed) },
    { id: 'active', label: 'Active trips', value: fmt(s.active_trips), detail: fmt(s.moving_trips) + ' currently moving', color: 'blue', target: '#cds-trip-flow', series: data.daily.map(row => row.trips_started) },
    { id: 'delay', label: 'Delayed now', value: fmt(s.delayed_trips), detail: s.delayed_trips > 0 ? 'Requires operational review' : 'No trips currently marked delayed', color: s.delayed_trips > 0 ? 'red' : 'teal', target: '#cds-exceptions', series: data.daily.map(row => row.deliveries_completed) },
    { id: 'eta', label: 'ETA attainment', value: pct(s.eta_attainment_pct), detail: fmt(s.eta_met) + ' met of ' + fmt(s.eta_observed) + ' observed ETAs', color: 'violet', target: '#cds-throughput', series: data.daily.map(row => row.deliveries_completed) },
    { id: 'utilisation', label: 'Container utilisation', value: pct(s.container_utilization_pct), detail: fmt(s.containers_in_use) + ' in use of ' + fmt(s.total_containers) + ' registered', color: 'amber', target: '#cds-assets', series: data.daily.map(row => row.trips_started) },
  ];
  const tone: Record<string, { text: string; border: string; fill: string; dot: string }> = {
    orange: { text: 'text-cds-orange', border: 'border-cds-orange/20', fill: 'bg-cds-orange', dot: 'bg-cds-orange' },
    teal: { text: 'text-cds-teal', border: 'border-cds-teal/20', fill: 'bg-cds-teal', dot: 'bg-cds-teal' },
    blue: { text: 'text-sky-300', border: 'border-sky-300/20', fill: 'bg-sky-300', dot: 'bg-sky-300' },
    red: { text: 'text-red-300', border: 'border-red-300/25', fill: 'bg-red-300', dot: 'bg-red-300' },
    violet: { text: 'text-violet-300', border: 'border-violet-300/20', fill: 'bg-violet-300', dot: 'bg-violet-300' },
    amber: { text: 'text-amber-300', border: 'border-amber-300/20', fill: 'bg-amber-300', dot: 'bg-amber-300' },
  };
  const rankedPipeline = data.booking_pipeline.slice().sort((a, b) => b.count - a.count);
  const maxPipeline = Math.max(1, ...rankedPipeline.map(row => row.count));
  const maxTripStatus = Math.max(1, ...data.trip_statuses.map(row => row.count));
  const alertRows = data.alerts.filter(alert => {
    const severity = String(alert.severity || 'low').toLowerCase();
    const query = alertSearch.trim().toLowerCase();
    return (alertFilter === 'all' || severity === alertFilter)
      && (!query || [alert.title, alert.message, alert.type, alert.entity_type, alert.entity_id].some(value => String(value || '').toLowerCase().includes(query)));
  });
  const visibleAlerts = showAllAlerts ? alertRows : alertRows.slice(0, 5);
  const barRows = (items: Array<{ label: string; value: number; sub?: string; color?: string }>, maximum: number, palette = 'bg-cds-orange') => (
    <div className="space-y-3">
      {items.length === 0 ? <div className="py-8 text-center text-xs text-text-2">No persisted records in this breakdown.</div> : items.map(item => (
        <div key={item.label}>
          <div className="flex justify-between items-baseline gap-3 mb-1.5">
            <span className="text-xs text-text-1 capitalize truncate">{item.label}</span>
            <span className="font-mono text-xs text-text-0 tabular-nums">{fmt(item.value)}{item.sub ? <span className="text-[10px] text-text-2 ml-2 font-sans">{item.sub}</span> : null}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden bg-white/[.055]">
            <div className={'h-full rounded-full transition-[width] duration-500 ' + (item.color || palette)} style={{ width: Math.max(0, Math.min(100, item.value / Math.max(1, maximum) * 100)) + '%' }} />
          </div>
        </div>
      ))}
    </div>
  );
  const sectionLink = (id: string, text: string) => <a href={'#' + id} className="shrink-0 px-3 py-2 rounded-md text-[11px] text-text-2 hover:text-text-0 hover:bg-white/[.05] transition-colors">{text}</a>;

  return (
    <div className="mx-auto max-w-[1840px] p-3 sm:p-5 xl:p-6 space-y-5 text-text-0">
      <section className="relative overflow-hidden rounded-2xl border border-white/[.075] bg-[#101419]">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 93% 5%, rgba(255,144,48,.15), transparent 36%), radial-gradient(ellipse at 70% 110%, rgba(40,190,176,.08), transparent 42%)' }} />
        <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-cds-orange via-cds-teal/75 to-transparent" />
        <div className="relative p-4 sm:p-6 xl:p-7">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0 max-w-3xl">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-[9px] sm:text-[10px] font-mono uppercase tracking-[.24em] text-cds-orange">SONALIT / CDS INTELLIGENCE</span>
                <span className="rounded-full border border-cds-teal/20 bg-cds-teal/[.07] px-2 py-1 inline-flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-cds-teal"><span className={'w-1.5 h-1.5 rounded-full ' + (isFetching ? 'bg-amber-300 animate-pulse' : 'bg-cds-teal')} />{isFetching ? 'Syncing snapshot' : 'Database snapshot'}</span>
              </div>
              <h2 className="text-2xl sm:text-3xl xl:text-[36px] leading-tight font-semibold tracking-[-.035em] text-text-0">Container operations, <span className="text-cds-orange">in command.</span></h2>
              <p className="mt-3 text-xs sm:text-sm text-text-2 leading-relaxed max-w-2xl">A decision workspace for throughput, fleet capacity, container integrity, e-lock exposure and the exceptions that require action.</p>
              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] sm:text-[11px] text-text-2">
                <span className="inline-flex items-center gap-2"><span className="text-text-1">PERIOD</span><span className="font-mono text-text-0">{dateLabel(data.meta.period_start)} — {dateLabel(data.meta.period_end)}</span></span>
                <span className="hidden sm:block h-3 w-px bg-white/10" />
                <span className="inline-flex items-center gap-2"><span className="text-text-1">GENERATED</span><span className="font-mono text-text-0">{generatedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span></span>
                <span className="hidden sm:block h-3 w-px bg-white/10" />
                <span className="inline-flex items-center gap-2"><span className="text-text-1">AGE</span><span className={ageMinutes != null && ageMinutes > 5 ? 'font-mono text-amber-300' : 'font-mono text-cds-teal'}>{snapshotAge}</span></span>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row xl:flex-col gap-3 xl:items-end shrink-0 w-full sm:w-auto">
              <div className="rounded-xl border border-white/[.08] bg-black/20 p-1 flex gap-1" role="group" aria-label="Reporting window">
                {([7, 30, 90, 365] as const).map(windowDays => (
                  <button key={windowDays} type="button" onClick={() => setDays(windowDays)} aria-pressed={days === windowDays} className={'px-3 py-2 rounded-lg min-h-[36px] text-[11px] font-mono transition-all ' + (days === windowDays ? 'bg-cds-orange text-[#17110a] font-bold shadow-[0_4px_18px_rgba(245,143,44,.15)]' : 'text-text-2 hover:text-text-0 hover:bg-white/[.04]')}>{windowDays}D</button>
                ))}
              </div>
              <Button variant="ghost" disabled={isFetching} onClick={() => { void refetch(); }}>{isFetching ? 'Refreshing…' : 'Refresh snapshot'}</Button>
            </div>
          </div>
          <div className="mt-6 grid grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3">
            <div className="rounded-xl border border-white/[.06] bg-black/20 p-3 sm:p-4">
              <div className="text-[9px] uppercase tracking-[.15em] text-text-2">Operational attention</div>
              <div className={'mt-2 text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums ' + (exceptionCount ? 'text-amber-300' : 'text-cds-teal')}>{fmt(exceptionCount)}</div>
              <div className="mt-1 text-[10px] text-text-2">Counted exception signals, not unique cases</div>
            </div>
            <div className="rounded-xl border border-white/[.06] bg-black/20 p-3 sm:p-4">
              <div className="text-[9px] uppercase tracking-[.15em] text-text-2">Unacknowledged alerts</div>
              <div className={'mt-2 text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums ' + (s.unacknowledged_alerts ? 'text-red-300' : 'text-cds-teal')}>{fmt(s.unacknowledged_alerts)}</div>
              <div className="mt-1 text-[10px] text-text-2">{data.alerts.length} highest-priority records returned</div>
            </div>
            <div className="rounded-xl border border-white/[.06] bg-black/20 p-3 sm:p-4">
              <div className="text-[9px] uppercase tracking-[.15em] text-text-2">Inventory footprint</div>
              <div className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums">{fmt(s.total_containers + s.total_vehicles)}</div>
              <div className="mt-1 text-[10px] text-text-2">{fmt(s.total_containers)} containers · {fmt(s.total_vehicles)} vehicles</div>
            </div>
            <div className="rounded-xl border border-white/[.06] bg-black/20 p-3 sm:p-4">
              <div className="text-[9px] uppercase tracking-[.15em] text-text-2">Fleet utilisation</div>
              <div className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums">{pct(s.vehicle_utilization_pct)}</div>
              <div className="mt-1 text-[10px] text-text-2">{fmt(s.vehicles_in_use)} vehicles currently in use</div>
            </div>
          </div>
        </div>
      </section>

      <nav className="flex gap-1 overflow-x-auto rounded-xl border border-white/[.06] bg-[#101419] p-1" aria-label="Analytics sections">
        {sectionLink('cds-throughput', '01  Throughput')}
        {sectionLink('cds-trip-flow', '02  Flow & lanes')}
        {sectionLink('cds-assets', '03  Assets & integrity')}
        {sectionLink('cds-exceptions', '04  Exceptions')}
      </nav>

      {isError && <div role="status" className="rounded-lg border border-amber-300/20 bg-amber-300/[.05] px-4 py-3 text-xs text-amber-200">The latest refresh failed. The last successfully loaded database snapshot is retained below; values have not been replaced with sample data.</div>}

      <section aria-label="Key operational indicators">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <div><div className="text-[9px] uppercase tracking-[.2em] font-mono text-text-2">01 / Performance indicators</div><h3 className="mt-1 text-base sm:text-lg font-semibold tracking-tight">The operating picture</h3></div>
          <span className="text-[10px] text-text-2">Period activity and current inventory are labelled separately</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-2 sm:gap-3">
          {kpis.map(k => {
            const t = tone[k.color];
            const sparkMax = Math.max(1, ...k.series);
            const points = k.series.slice(-28).map((value, index, rows) => (index / Math.max(1, rows.length - 1) * 100) + ',' + (29 - value / sparkMax * 25)).join(' ');
            return (
              <a key={k.id} href={k.target} className={'group relative min-w-0 overflow-hidden rounded-xl border bg-[#11161b] p-3 sm:p-4 transition-all hover:-translate-y-0.5 hover:bg-[#151b21] ' + t.border}>
                <div className="flex items-start justify-between gap-2"><span className="text-[9px] sm:text-[10px] uppercase leading-relaxed tracking-[.11em] text-text-2">{k.label}</span><span className={'mt-1 w-1.5 h-1.5 rounded-full shrink-0 ' + t.dot} /></div>
                <div className={'mt-3 text-2xl sm:text-[28px] font-semibold leading-none tracking-[-.035em] tabular-nums ' + (k.color === 'red' && s.delayed_trips > 0 ? 'text-red-300' : 'text-text-0')}>{k.value}</div>
                <p className="mt-2 min-h-[29px] text-[10px] leading-relaxed text-text-2">{k.detail}</p>
                <div className="mt-2 h-8 opacity-70 group-hover:opacity-100">
                  {k.series.length > 1 ? <svg viewBox="0 0 100 32" preserveAspectRatio="none" className={'h-full w-full ' + t.text} role="img" aria-label={k.label + ' observed daily trend'}><polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.8" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" /></svg> : <div className={'h-8 flex items-center text-[9px] uppercase tracking-widest ' + t.text}>No trend series</div>}
                </div>
                <div className="mt-2 border-t border-white/[.055] pt-2 text-[9px] uppercase tracking-wider text-text-2 group-hover:text-text-1">Explore signal <span className="float-right">↗</span></div>
              </a>
            );
          })}
        </div>
      </section>

      <section id="cds-throughput" className="scroll-mt-4 grid grid-cols-1 2xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,.8fr)] gap-3 sm:gap-4">
        <Card className="min-w-0 overflow-hidden">
          <div className="flex flex-wrap justify-between gap-3 items-start p-4 sm:p-5 border-b border-white/[.055]">
            <div><div className="text-[9px] uppercase tracking-[.18em] font-mono text-text-2">PERIOD / DAILY SERIES</div><h3 className="text-base font-semibold mt-1">Throughput & delivery cadence</h3><p className="text-[11px] text-text-2 mt-1">Trip creation compared with delivery timestamps, grouped to keep longer periods readable.</p></div>
            <div className="flex flex-wrap gap-3 text-[10px] text-text-2">
              <span className="inline-flex items-center gap-2"><span className="w-2 h-2 rounded-sm bg-cds-orange" />Trips initiated</span>
              <span className="inline-flex items-center gap-2"><span className="w-2 h-2 rounded-sm bg-cds-teal" />Deliveries recorded</span>
            </div>
          </div>
          <div className="p-3 sm:p-5">
            {trendBuckets.length === 0 || trendBuckets.every(row => !row.started && !row.delivered) ? (
              <div className="min-h-[240px] flex flex-col justify-center items-center text-center"><div className="text-2xl text-text-2">—</div><div className="text-sm font-medium mt-2">No recorded throughput in this period</div><p className="text-[11px] text-text-2 mt-1">No trip starts or deliveries were returned for the selected reporting window.</p></div>
            ) : (
              <div className="w-full">
                <svg viewBox="0 0 1000 255" preserveAspectRatio="none" className="w-full h-[190px] sm:h-[250px]" role="img" aria-label="Daily trips initiated and deliveries recorded">
                  <title>Daily CDS throughput. Bars are grouped for readability and are derived from persisted trip timestamps.</title>
                  {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1="0" x2="1000" y1={18 + i * 48} y2={18 + i * 48} stroke="rgba(255,255,255,.075)" strokeDasharray="3 7" /><text x="0" y={13 + i * 48} fill="rgba(255,255,255,.34)" fontSize="10">{Math.round(maxTrend * (4 - i) / 4)}</text></g>)}
                  {trendBuckets.map((row, index) => {
                    const step = 990 / Math.max(1, trendBuckets.length);
                    const x = 12 + index * step;
                    const barWidth = Math.max(2, Math.min(17, step * .27));
                    const startedHeight = row.started / maxTrend * 178;
                    const deliveredHeight = row.delivered / maxTrend * 178;
                    return <g key={row.start}><title>{row.start} – {row.end}: {row.started} started; {row.delivered} delivered</title><rect x={x} y={204 - startedHeight} width={barWidth} height={startedHeight} rx="2" fill="#f59a3c" opacity=".92" /><rect x={x + barWidth + 2} y={204 - deliveredHeight} width={barWidth} height={deliveredHeight} rx="2" fill="#42cbb5" opacity=".92" /></g>;
                  })}
                </svg>
                <div className="flex justify-between gap-2 px-1 text-[9px] font-mono text-text-2"><span>{dateLabel(trendBuckets[0].start)}</span><span>{dateLabel(trendBuckets[Math.floor(trendBuckets.length / 2)].start)}</span><span>{dateLabel(trendBuckets[trendBuckets.length - 1].end)}</span></div>
              </div>
            )}
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="rounded-lg border border-white/[.055] p-3"><div className="text-[9px] uppercase tracking-wider text-text-2">ETA attainment</div><div className="text-xl font-semibold mt-1 tabular-nums">{pct(s.eta_attainment_pct)}</div><div className="text-[10px] text-text-2 mt-1">{fmt(s.eta_met)} / {fmt(s.eta_observed)} with known ETA</div></div>
              <div className="rounded-lg border border-white/[.055] p-3"><div className="text-[9px] uppercase tracking-wider text-text-2">Average transit</div><div className="text-xl font-semibold mt-1 tabular-nums">{s.avg_transit_hours == null ? '—' : Number(s.avg_transit_hours).toFixed(1) + 'h'}</div><div className="text-[10px] text-text-2 mt-1">Completed trips with both timestamps</div></div>
              <div className="rounded-lg border border-white/[.055] p-3"><div className="text-[9px] uppercase tracking-wider text-text-2">Active / moving</div><div className="text-xl font-semibold mt-1 tabular-nums">{fmt(s.active_trips)} <span className="text-sm text-cds-teal">/ {fmt(s.moving_trips)}</span></div><div className="text-[10px] text-text-2 mt-1">Current trip lifecycle</div></div>
              <div className="rounded-lg border border-white/[.055] p-3"><div className="text-[9px] uppercase tracking-wider text-text-2">Delayed now</div><div className={'text-xl font-semibold mt-1 tabular-nums ' + (s.delayed_trips ? 'text-red-300' : 'text-cds-teal')}>{fmt(s.delayed_trips)}</div><div className="text-[10px] text-text-2 mt-1">Current persisted status</div></div>
            </div>
          </div>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <div className="p-4 sm:p-5 border-b border-white/[.055]"><div className="text-[9px] uppercase tracking-[.18em] font-mono text-text-2">CURRENT STATE / BOOKING FLOW</div><h3 className="text-base font-semibold mt-1">Demand pipeline</h3><p className="text-[11px] text-text-2 mt-1">Current bookings by persisted lifecycle status; not a period-only count.</p></div>
          <div className="p-4 sm:p-5">
            <div className="flex justify-between items-end mb-4"><div><div className="text-3xl font-semibold tracking-tight tabular-nums">{fmt(rankedPipeline.reduce((sum, row) => sum + row.count, 0))}</div><div className="text-[10px] text-text-2 mt-1">Bookings across returned states</div></div><div className="text-right"><div className="text-lg font-semibold tabular-nums">{fmt(s.active_trips)}</div><div className="text-[10px] text-text-2 mt-1">Active trips</div></div></div>
            <div className="flex h-2 rounded-full overflow-hidden bg-white/[.045] mb-5" aria-label="Booking status distribution">
              {rankedPipeline.map((row, i) => <div key={row.status} title={label(row.status) + ': ' + row.count} style={{ width: (row.count / maxPipeline * 100) + '%', background: ['#f59a3c', '#42cbb5', '#7eb7ef', '#b69cff', '#f2c36b', '#f08787', '#6a9e91', '#8b9aaa', '#66717d'][i % 9] }} />)}
            </div>
            {barRows(rankedPipeline.map((row, i) => ({ label: label(row.status), value: row.count, color: ['bg-cds-orange', 'bg-cds-teal', 'bg-sky-300', 'bg-violet-300', 'bg-amber-300', 'bg-red-300', 'bg-emerald-300', 'bg-slate-300', 'bg-slate-500'][i % 9] })), maxPipeline)}
          </div>
        </Card>
      </section>

      <section id="cds-trip-flow" className="scroll-mt-4 space-y-3">
        <div className="flex flex-wrap justify-between items-end gap-3">
          <div><div className="text-[9px] uppercase tracking-[.2em] font-mono text-text-2">02 / Movement analysis</div><h3 className="text-base sm:text-lg font-semibold mt-1">Flow, lanes & operational pressure</h3></div>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#101419] border border-white/[.06]" role="group" aria-label="Analytics lens">
            <button type="button" onClick={() => setLens('executive')} aria-pressed={lens === 'executive'} className={'px-3 py-2 rounded-md text-[10px] transition-colors ' + (lens === 'executive' ? 'bg-white/[.09] text-text-0' : 'text-text-2 hover:text-text-0')}>Executive lens</button>
            <button type="button" onClick={() => setLens('coordinator')} aria-pressed={lens === 'coordinator'} className={'px-3 py-2 rounded-md text-[10px] transition-colors ' + (lens === 'coordinator' ? 'bg-cds-orange/15 text-cds-orange' : 'text-text-2 hover:text-text-0')}>Coordinator lens</button>
          </div>
        </div>
        <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,.8fr)] gap-3 sm:gap-4">
          <Card className="min-w-0 overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-white/[.055] flex justify-between gap-3 items-start"><div><div className="text-[9px] uppercase tracking-[.17em] font-mono text-text-2">LANE PERFORMANCE</div><h3 className="font-semibold mt-1">Highest-volume corridors</h3><p className="text-[11px] text-text-2 mt-1">Ranked by trip creation in the selected window. Transit is reported only when both timestamps exist.</p></div><span className="text-[10px] font-mono text-text-2">{data.lanes.length} corridors</span></div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[570px] text-left">
                <thead><tr className="border-b border-white/[.06] text-[9px] uppercase tracking-wider text-text-2"><th className="p-3 sm:p-4 font-medium">Corridor</th><th className="p-3 font-medium text-right">Started</th><th className="p-3 font-medium text-right">Delivered</th><th className="p-3 font-medium text-right">Transit</th><th className="p-3 sm:p-4 font-medium text-right">Delayed now</th></tr></thead>
                <tbody>{data.lanes.map((lane, i) => <tr key={lane.origin + '|' + lane.destination + '|' + i} className="border-b border-white/[.04] last:border-0 hover:bg-white/[.025]"><td className="p-3 sm:p-4"><div className="flex items-start gap-3"><span className="mt-0.5 font-mono text-[10px] text-text-2">{String(i + 1).padStart(2, '0')}</span><div className="min-w-0"><div className="text-xs font-medium text-text-0">{lane.origin}</div><div className="flex items-center gap-2 mt-1 text-[10px] text-text-2"><span>to {lane.destination}</span></div></div></div></td><td className="p-3 text-right font-mono text-xs tabular-nums">{fmt(lane.trips_started)}</td><td className="p-3 text-right font-mono text-xs tabular-nums">{fmt(lane.deliveries_completed)}</td><td className="p-3 text-right font-mono text-xs tabular-nums">{lane.avg_transit_hours == null ? '—' : Number(lane.avg_transit_hours).toFixed(1) + 'h'}</td><td className="p-3 sm:p-4 text-right"><span className={'inline-flex min-w-7 justify-center rounded-md px-2 py-1 font-mono text-[11px] ' + (lane.currently_delayed ? 'bg-red-300/10 text-red-300' : 'bg-white/[.04] text-text-2')}>{fmt(lane.currently_delayed)}</span></td></tr>)}</tbody>
              </table>
              {data.lanes.length === 0 && <div className="p-8 text-center text-xs text-text-2">No trip-created lanes in this reporting window.</div>}
            </div>
          </Card>
          {lens === 'executive' ? (
            <Card className="min-w-0 overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-white/[.055]"><div className="text-[9px] uppercase tracking-[.17em] font-mono text-text-2">PORTFOLIO / CURRENT STATE</div><h3 className="font-semibold mt-1">Live trip portfolio</h3><p className="text-[11px] text-text-2 mt-1">How operational workload is distributed across persisted lifecycle statuses.</p></div>
              <div className="p-4 sm:p-5"><div className="grid grid-cols-2 gap-2 mb-5"><div className="rounded-lg border border-white/[.06] p-3"><div className="text-[9px] uppercase tracking-wider text-text-2">Active trips</div><div className="text-2xl font-semibold tabular-nums mt-1">{fmt(s.active_trips)}</div></div><div className="rounded-lg border border-red-300/15 bg-red-300/[.035] p-3"><div className="text-[9px] uppercase tracking-wider text-text-2">Delayed now</div><div className="text-2xl font-semibold tabular-nums mt-1 text-red-300">{fmt(s.delayed_trips)}</div></div></div>{barRows(data.trip_statuses.map(row => ({ label: label(row.status), value: row.count, color: ['delayed','cancelled'].includes(row.status) ? 'bg-red-300' : ['delivered','completed','lock_removed'].includes(row.status) ? 'bg-cds-teal' : 'bg-cds-orange' })), maxTripStatus)}<div className="border-t border-white/[.055] pt-4 mt-5"><div className="text-[10px] uppercase tracking-wider text-text-2 mb-3">Risk exposure</div>{barRows(data.risk_mix.map(row => ({ label: label(row.risk), value: row.count, color: row.risk === 'critical' || row.risk === 'high' ? 'bg-red-300' : 'bg-amber-300' })), Math.max(1, ...data.risk_mix.map(row => row.count)))}</div></div>
            </Card>
          ) : (
            <Card className="min-w-0 overflow-hidden">
              <div className="p-4 sm:p-5 border-b border-white/[.055]"><div className="text-[9px] uppercase tracking-[.17em] font-mono text-cds-orange">COORDINATOR / DISPATCH GATE</div><h3 className="font-semibold mt-1">Readiness exceptions</h3><p className="text-[11px] text-text-2 mt-1">Stage-aware gaps that can block a clean dispatch hand-off.</p></div>
              <div className="p-4 sm:p-5"><div className="grid grid-cols-2 gap-2 mb-5"><div className="rounded-lg border border-white/[.06] p-3"><div className="text-[9px] uppercase tracking-wider text-text-2">Missing-field signals</div><div className={'text-2xl font-semibold tabular-nums mt-1 ' + (totalDataGaps ? 'text-amber-300' : 'text-cds-teal')}>{fmt(totalDataGaps)}</div></div><div className="rounded-lg border border-white/[.06] p-3"><div className="text-[9px] uppercase tracking-wider text-text-2">Open incidents</div><div className={'text-2xl font-semibold tabular-nums mt-1 ' + (s.open_incidents ? 'text-red-300' : 'text-text-0')}>{fmt(s.open_incidents)}</div></div></div>{barRows([{label:'Vehicle assignment missing',value:s.trips_missing_vehicle,color:'bg-amber-300'},{label:'Driver assignment missing',value:s.trips_missing_driver,color:'bg-amber-300'},{label:'Container assignment missing',value:s.trips_missing_container,color:'bg-amber-300'},{label:'E-lock missing after locked',value:s.trips_missing_lock,color:'bg-red-300'},{label:'ETA missing after locked',value:s.trips_missing_eta,color:'bg-red-300'}], Math.max(1,totalDataGaps))}<div className="border-t border-white/[.055] pt-4 mt-5"><div className="text-[10px] uppercase tracking-wider text-text-2 mb-3">Trip risk by classification</div>{barRows(data.risk_mix.map(row => ({ label: label(row.risk), value: row.count, color: ['critical','high'].includes(row.risk) ? 'bg-red-300' : 'bg-amber-300' })), Math.max(1, ...data.risk_mix.map(row => row.count)))}</div></div>
            </Card>
          )}
        </div>
      </section>

      <section id="cds-assets" className="scroll-mt-4 space-y-3">
        <div><div className="text-[9px] uppercase tracking-[.2em] font-mono text-text-2">03 / Fleet & container integrity</div><h3 className="text-base sm:text-lg font-semibold mt-1">Assets, utilisation & readiness</h3></div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-3 sm:gap-4">
          <Card className="min-w-0 overflow-hidden">
            <div className="p-4 border-b border-white/[.055]"><div className="text-[9px] uppercase tracking-[.17em] font-mono text-text-2">CONTAINER REGISTER</div><h3 className="font-semibold mt-1">Availability & condition</h3><p className="text-[11px] text-text-2 mt-1">Physical condition is from recorded inventory—not a modelled score.</p></div>
            <div className="p-4 space-y-5">
              <div><div className="flex justify-between gap-2 items-end mb-2"><div><div className="text-2xl font-semibold tabular-nums">{fmt(s.total_containers)}</div><div className="text-[10px] text-text-2">Registered containers</div></div><div className="text-right"><div className="text-lg font-semibold tabular-nums">{pct(s.container_utilization_pct)}</div><div className="text-[10px] text-text-2">Utilisation</div></div></div><div className="flex h-2 rounded-full bg-white/[.05] overflow-hidden"><div className="bg-cds-orange" style={{ width: (s.total_containers > 0 ? s.containers_in_use / s.total_containers * 100 : 0) + '%' }} /><div className="bg-cds-teal" style={{ width: (s.total_containers > 0 ? s.available_containers / s.total_containers * 100 : 0) + '%' }} /><div className="bg-amber-300" style={{ width: (s.total_containers > 0 ? s.containers_in_maintenance / s.total_containers * 100 : 0) + '%' }} /></div><div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[9px] text-text-2"><span><i className="inline-block w-1.5 h-1.5 rounded-full bg-cds-orange mr-1.5" />In use {fmt(s.containers_in_use)}</span><span><i className="inline-block w-1.5 h-1.5 rounded-full bg-cds-teal mr-1.5" />Available {fmt(s.available_containers)}</span><span><i className="inline-block w-1.5 h-1.5 rounded-full bg-amber-300 mr-1.5" />Maintenance {fmt(s.containers_in_maintenance)}</span></div></div>
              <div className="border-t border-white/[.055] pt-4"><div className="text-[10px] uppercase tracking-wider text-text-2 mb-3">Recorded physical condition</div>{barRows(data.container_conditions.map(row => ({ label: label(row.condition), value: row.count, color: ['damaged', 'poor'].includes(row.condition) ? 'bg-red-300' : ['fair'].includes(row.condition) ? 'bg-amber-300' : 'bg-cds-teal' })), Math.max(1, ...data.container_conditions.map(row => row.count)))}</div>
              <div className="grid grid-cols-3 gap-2 border-t border-white/[.055] pt-4">
                <div><div className="text-lg font-semibold tabular-nums text-red-300">{fmt(s.damaged_containers)}</div><div className="text-[9px] text-text-2 mt-1">Damaged</div></div>
                <div><div className="text-lg font-semibold tabular-nums text-amber-300">{fmt(s.fair_condition_containers)}</div><div className="text-[9px] text-text-2 mt-1">Fair condition</div></div>
                <div><div className="text-lg font-semibold tabular-nums">{fmt(s.retired_containers)}</div><div className="text-[9px] text-text-2 mt-1">Retired</div></div>
              </div>
            </div>
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <div className="p-4 border-b border-white/[.055]"><div className="text-[9px] uppercase tracking-[.17em] font-mono text-text-2">FLEET CAPACITY</div><h3 className="font-semibold mt-1">Vehicles & driver coverage</h3><p className="text-[11px] text-text-2 mt-1">Live registered fleet state at snapshot generation.</p></div>
            <div className="p-4">
              <div className="flex justify-between items-end"><div><div className="text-3xl font-semibold tracking-tight tabular-nums">{fmt(s.total_vehicles)}</div><div className="text-[10px] text-text-2 mt-1">Registered vehicles</div></div><div className="text-right"><div className="text-xl font-semibold tabular-nums">{pct(s.vehicle_utilization_pct)}</div><div className="text-[10px] text-text-2 mt-1">Utilisation</div></div></div>
              <div className="mt-5">{barRows([{ label: 'In use', value: s.vehicles_in_use, color: 'bg-cds-orange' }, { label: 'Available', value: s.available_vehicles, color: 'bg-cds-teal' }, { label: 'Maintenance', value: s.vehicles_in_maintenance, color: 'bg-amber-300' }], Math.max(1, s.total_vehicles))}</div>
              <div className="grid grid-cols-2 gap-2 mt-5">
                <div className="rounded-lg bg-white/[.025] border border-white/[.05] p-3"><div className="text-[9px] text-text-2 uppercase tracking-wider">Active drivers</div><div className="text-2xl font-semibold mt-1 tabular-nums">{fmt(s.active_drivers)}</div></div>
                <div className="rounded-lg bg-white/[.025] border border-white/[.05] p-3"><div className="text-[9px] text-text-2 uppercase tracking-wider">Maintenance fleet</div><div className="text-2xl font-semibold mt-1 tabular-nums">{fmt(s.vehicles_in_maintenance)}</div></div>
              </div>
              <div className="mt-5 rounded-lg border border-white/[.06] p-3 flex items-start gap-3"><span className="mt-1 w-2 h-2 rounded-full bg-sky-300 shrink-0" /><div><div className="text-xs font-medium">Fleet capacity context</div><p className="mt-1 text-[10px] text-text-2 leading-relaxed">Utilisation reflects the current registered vehicle state. It should not be interpreted as a period fleet productivity rate.</p></div></div>
            </div>
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <div className="p-4 border-b border-white/[.055]"><div className="text-[9px] uppercase tracking-[.17em] font-mono text-text-2">E-LOCK HEALTH</div><h3 className="font-semibold mt-1">Security telemetry posture</h3><p className="text-[11px] text-text-2 mt-1">Persisted lock-state indicators and reporting freshness.</p></div>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-white/[.06] p-3"><div className="text-[9px] text-text-2 uppercase tracking-wider">Total locks</div><div className="text-2xl font-semibold mt-1 tabular-nums">{fmt(s.total_locks)}</div></div>
                <div className="rounded-lg border border-red-300/15 bg-red-300/[.035] p-3"><div className="text-[9px] text-text-2 uppercase tracking-wider">Need attention</div><div className="text-2xl font-semibold mt-1 tabular-nums text-red-300">{fmt(s.locks_needing_attention)}</div></div>
                <div className="rounded-lg border border-amber-300/15 p-3"><div className="text-[9px] text-text-2 uppercase tracking-wider">Battery below 25%</div><div className="text-xl font-semibold mt-1 tabular-nums text-amber-300">{fmt(s.low_battery_locks)}</div></div>
                <div className="rounded-lg border border-white/[.06] p-3"><div className="text-[9px] text-text-2 uppercase tracking-wider">Stale heartbeat</div><div className="text-xl font-semibold mt-1 tabular-nums">{fmt(s.stale_lock_heartbeats)}</div></div>
              </div>
              <div className="mt-5"><div className="text-[10px] uppercase tracking-wider text-text-2 mb-3">Lock state distribution</div>{barRows(data.lock_statuses.map(row => ({ label: label(row.status), value: row.count, sub: row.low_battery || row.tampered ? fmt(row.low_battery) + ' low batt · ' + fmt(row.tampered) + ' tamper' : undefined, color: ['tampered', 'offline', 'fault'].includes(row.status) ? 'bg-red-300' : ['low_battery', 'warning'].includes(row.status) ? 'bg-amber-300' : 'bg-cds-teal' })), Math.max(1, ...data.lock_statuses.map(row => row.count)))}</div>
              <div className="mt-4 border-t border-white/[.055] pt-3 text-[10px] text-text-2">Tamper signals: <span className="text-red-300 font-mono">{fmt(s.tampered_locks)}</span> · Open incidents: <span className="text-text-0 font-mono">{fmt(s.open_incidents)}</span></div>
            </div>
          </Card>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-4">
          <Card className="overflow-hidden min-w-0">
            <div className="p-4 sm:p-5 border-b border-white/[.055] flex justify-between gap-3"><div><div className="text-[9px] uppercase tracking-[.17em] font-mono text-text-2">INSPECTION CONTROL</div><h3 className="font-semibold mt-1">Inspection & location readiness</h3><p className="text-[11px] text-text-2 mt-1">Current inventory conditions based on stored inspection dates and location fields.</p></div><span className={'shrink-0 h-fit rounded-md px-2 py-1 text-[9px] uppercase tracking-wider ' + (s.overdue_inspections || s.containers_missing_location ? 'bg-amber-300/10 text-amber-300' : 'bg-cds-teal/10 text-cds-teal')}>{s.overdue_inspections || s.containers_missing_location ? 'Review needed' : 'No flags returned'}</span></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-white/[.05]">
              {[{label:'Overdue',value:s.overdue_inspections,tone:'text-red-300',note:'Inspection date passed'},{label:'Due in 30 days',value:s.inspections_due_30_days,tone:'text-amber-300',note:'Upcoming inspection'},{label:'No location',value:s.containers_missing_location,tone:'text-amber-300',note:'No recorded location'},{label:'Damaged + retired',value:s.damaged_containers+s.retired_containers,tone:'text-text-0',note:'Inventory status flags'}].map(row=><div key={row.label} className="bg-[#11161b] p-3 sm:p-4"><div className="text-[9px] uppercase tracking-wider text-text-2">{row.label}</div><div className={'text-2xl font-semibold mt-2 tabular-nums '+row.tone}>{fmt(row.value)}</div><div className="text-[10px] text-text-2 mt-1">{row.note}</div></div>)}
            </div>
            <div className="p-4 text-[10px] text-text-2 leading-relaxed">Containers without a scheduled next-inspection date are not counted as overdue; the absence of a date is a separate scheduling limitation.</div>
          </Card>
          <Card className="overflow-hidden min-w-0">
            <div className="p-4 sm:p-5 border-b border-white/[.055]"><div className="text-[9px] uppercase tracking-[.17em] font-mono text-text-2">DATA COMPLETENESS</div><h3 className="font-semibold mt-1">Assignment & planning integrity</h3><p className="text-[11px] text-text-2 mt-1">Open trips checked only when their lifecycle stage requires the field.</p></div>
            <div className="p-4 sm:p-5">
              {barRows([{label:'Vehicle missing',value:s.trips_missing_vehicle,color:'bg-amber-300'},{label:'Driver missing',value:s.trips_missing_driver,color:'bg-amber-300'},{label:'Container missing',value:s.trips_missing_container,color:'bg-amber-300'},{label:'E-lock missing',value:s.trips_missing_lock,color:'bg-red-300'},{label:'ETA missing',value:s.trips_missing_eta,color:'bg-red-300'}], Math.max(1,s.trips_missing_vehicle,s.trips_missing_driver,s.trips_missing_container,s.trips_missing_lock,s.trips_missing_eta))}
              <div className={'mt-4 rounded-lg border p-3 text-[10px] leading-relaxed ' + (totalDataGaps ? 'border-amber-300/20 bg-amber-300/[.04] text-amber-100' : 'border-cds-teal/15 bg-cds-teal/[.035] text-text-2')}>{totalDataGaps ? fmt(totalDataGaps) + ' missing-field signals are present across stage-aware trip checks. Investigate assignment and readiness before dispatch.' : 'No missing assignment fields were returned for lifecycle stages where these fields are required.'}</div>
            </div>
          </Card>
        </div>
      </section>

      <section id="cds-exceptions" className="scroll-mt-4 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><div className="text-[9px] uppercase tracking-[.2em] font-mono text-text-2">04 / Action queue</div><h3 className="text-base sm:text-lg font-semibold mt-1">Exceptions requiring attention</h3><p className="text-[11px] text-text-2 mt-1">Acknowledgement writes through to the backend. Filtering changes this list only; it does not mutate alert state.</p></div><div className="rounded-lg border border-white/[.06] bg-[#101419] px-3 py-2"><span className="text-[9px] uppercase tracking-wider text-text-2">Open incidents</span><span className="ml-3 font-mono text-sm font-semibold">{fmt(s.open_incidents)}</span></div></div>
        <Card className="overflow-hidden">
          <div className="p-3 sm:p-4 border-b border-white/[.055] flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter alerts by severity">
              {(['all','critical','high','medium','low'] as const).map(level=><button key={level} type="button" aria-pressed={alertFilter===level} onClick={()=>{setAlertFilter(level);setShowAllAlerts(false);}} className={'rounded-md px-3 py-2 text-[10px] capitalize border transition-colors '+(alertFilter===level?'border-cds-orange/30 bg-cds-orange/10 text-cds-orange':'border-white/[.06] text-text-2 hover:text-text-0')}>{level === 'all' ? 'All levels' : level}</button>)}
            </div>
            <div className="lg:ml-auto relative w-full lg:w-72"><input aria-label="Search alert records" value={alertSearch} onChange={e=>{setAlertSearch(e.target.value);setShowAllAlerts(false);}} placeholder="Search alert, entity or type…" className="w-full rounded-lg border border-white/[.08] bg-black/20 px-3 py-2.5 text-xs text-text-0 placeholder:text-text-2 outline-none focus:border-cds-orange/50" /></div>
          </div>
          <div className="divide-y divide-white/[.055]">
            {visibleAlerts.map(alert=><div key={alert.id} className="p-4 flex items-start gap-3 sm:gap-4 hover:bg-white/[.018]">
              <div className={'mt-1 w-1.5 h-10 rounded-full shrink-0 '+(['critical','high'].includes(String(alert.severity).toLowerCase())?'bg-red-300':String(alert.severity).toLowerCase()==='medium'?'bg-amber-300':'bg-cds-teal')} />
              <div className="flex-1 min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs sm:text-sm font-medium text-text-0 break-words">{alert.title || alert.message || 'Untitled alert'}</span><StatusBadge status={alert.severity} /></div><p className="text-[11px] text-text-2 mt-1.5 leading-relaxed">{alert.message && alert.title ? alert.message : 'No additional message was recorded.'}</p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[9px] uppercase tracking-wider text-text-2"><span>{label(alert.type || 'alert')}</span><span>{alert.entity_type ? label(alert.entity_type) : 'Unlinked entity'}</span><span>{new Date(alert.created_at).toLocaleString()}</span>{alert.entity_id ? <span className="font-mono normal-case tracking-normal">ID {alert.entity_id}</span> : null}</div></div>
              <Button size="sm" variant="ghost" disabled={acknowledge.isPending} onClick={()=>acknowledge.mutate(alert.id,{onSuccess:()=>addToast('Alert acknowledged'),onError:()=>addToast('Could not acknowledge this alert','error')})}>Acknowledge</Button>
            </div>)}
            {visibleAlerts.length===0 && <div className="p-10 text-center"><div className="text-sm font-medium">No alerts match this view</div><p className="text-[11px] text-text-2 mt-1">Try another severity or search term. The underlying alert records are unchanged.</p></div>}
          </div>
          {alertRows.length>5 && <div className="p-3 border-t border-white/[.055] flex justify-center"><button type="button" onClick={()=>setShowAllAlerts(value=>!value)} className="px-4 py-2 rounded-md text-[11px] text-text-2 hover:text-text-0 hover:bg-white/[.04]">{showAllAlerts?'Show fewer alerts':'Show all ' + alertRows.length + ' matching alerts'}</button></div>}
        </Card>
      </section>

      <footer className="rounded-xl border border-white/[.055] bg-[#101419] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div><div className="text-[9px] uppercase tracking-[.18em] font-mono text-text-2">DATA & METHOD</div><p className="text-[10px] text-text-2 leading-relaxed mt-1 max-w-4xl">Period activity is timestamp-based. Inventory, booking, fleet and open-alert counts describe current persisted state. ETA attainment uses completed deliveries with a recorded ETA; transit time requires departure and delivery timestamps. No synthetic, projected or inferred operational figures are included.</p></div>
        <div className="shrink-0 text-[10px] sm:text-right text-text-2"><div>Snapshot generated</div><div className="font-mono text-text-1 mt-1">{generatedAt.toLocaleString()}</div><div className="mt-1">{refreshedAt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</div></div>
      </footer>
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
