import { useState } from 'react';

import { useAuthStore } from '../../stores/auth.js';
import { LoadingState } from './CDSDashboard.js';
import { Card, KPICard, Button, StatusBadge, DataTable, DrawerField, FilterChip, Badge } from './components.js';
import FieldAccessPanel from './FieldAccessPanel.js';
import { useLocks, useTrips, useBookings, useMarkBilled } from './hooks.js';
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
            <Button size="sm" onClick={(e) => { e.stopPropagation(); addToast(`Unclamp initiated for ${s(r['container_number'])}`); }}>
              Unclamp
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

export function PulseView() {
  const { data, isLoading } = useBookings();
  const { openDrawer, addToast } = useCDSStore();
  if (isLoading) return <LoadingState />;
  const rows = (data?.data ?? []) as Row[];

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <KPICard label="BOOKINGS ON PULSE" value={String(rows.length)} delta="active" trend="up" />
        <KPICard label="SENT TODAY" value="0" delta="auto-sent" trend="up" />
        <KPICard label="SUPPRESSED" value="0" delta="no material change" trend="up" />
        <KPICard label="EXCEPTIONS FIRED" value="0" delta="instant alerts" trend="down" />
      </div>
      <DataTable
        columns={[
          { id: 'ref', header: 'Booking Ref', accessor: (r: Row) => <span className="font-mono font-bold text-cds-orange text-xs">{s(r['booking_number'])}</span> },
          { id: 'client', header: 'Client', accessor: (r: Row) => s(r['customer_name']) },
          { id: 'status', header: 'Status', accessor: (r: Row) => <StatusBadge status={s(r['status'])} /> },
          { id: 'action', header: '', accessor: (r: Row) => (
            <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); addToast(`Pulse sent for ${s(r['booking_number'])}`); }}>
              Send now
            </Button>
          )},
        ]}
        data={rows}
        keyExtractor={(r: Row) => s(r['id'])}
        searchable
        searchPlaceholder="Search bookings…"
        onRowClick={(r: Row) => openDrawer(`Pulse — ${s(r['booking_number'])}`, (
          <>
            <DrawerField label="Booking" value={s(r['booking_number'])} />
            <DrawerField label="Client" value={s(r['customer_name'])} />
            <DrawerField label="Status" value={<StatusBadge status={s(r['status'])} />} />
          </>
        ))}
      />
    </div>
  );
}

export function InboxView() {
  return (
    <div className="flex items-center justify-center h-full" style={{ minHeight: 400 }}>
      <div className="text-center max-w-sm">
        <div className="text-[11px] text-text-2 font-mono uppercase tracking-widest mb-2">Comms Centre</div>
        <p className="text-[12px] text-text-2 leading-relaxed">
          Field messages and dispatch logs will appear here once operations are running.
        </p>
      </div>
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
  const types = [
    { id: 'daily', label: 'Daily Report', desc: 'PDF summary' },
    { id: 'weekly', label: 'Weekly Report', desc: 'Excel export' },
    { id: 'monthly', label: 'Monthly Report', desc: 'Full analytics' },
    { id: 'manager', label: 'Manager Deck', desc: 'Slide summary' },
  ];

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
        <Button onClick={() => addToast('Report generating…')}>Generate report</Button>
        <Button variant="ghost" onClick={() => addToast('Excel export started')}>Excel export</Button>
        <Button variant="ghost" onClick={() => addToast('PDF export started')}>PDF export</Button>
      </div>
      <Card className="p-4">
        <div className="font-bold text-sm text-text-0 mb-3">Generated Reports</div>
        {[
          { name: 'Daily Ops Summary — Aug 1', type: 'PDF', date: 'Aug 1, 2026' },
          { name: 'Weekly Transporter Performance', type: 'Excel', date: 'Jul 28, 2026' },
          { name: 'Monthly Manager Deck', type: 'PowerPoint', date: 'Jul 1, 2026' },
        ].map(r => (
          <div key={r.name} className="flex items-center gap-3 py-3 border-b border-[rgba(255,255,255,.04)] last:border-0">
            <span className="text-lg">{r.type === 'PDF' ? '\u{1F4C4}' : r.type === 'Excel' ? '\u{1F4CA}' : '\u{1F4FD}'}</span>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-text-0">{r.name}</div>
              <div className="text-[10px] text-text-2 font-mono mt-0.5">{r.type} · {r.date}</div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => addToast(`Downloading ${r.name}`)}>Download</Button>
          </div>
        ))}
      </Card>
    </div>
  );
}

export function AnalyticsView() {
  return (
    <div className="flex items-center justify-center h-full" style={{ minHeight: 400 }}>
      <div className="text-center max-w-sm">
        <div className="text-[11px] text-text-2 font-mono uppercase tracking-widest mb-2">Analytics</div>
        <p className="text-[12px] text-text-2 leading-relaxed">
          Fleet performance metrics will populate here once enough operational data has been recorded.
        </p>
      </div>
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
