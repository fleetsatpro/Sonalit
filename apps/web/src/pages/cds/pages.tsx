import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, KeyRound, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';

import { api } from '../../lib/api.js';
import { useAuthStore } from '../../stores/auth.js';

import { LoadingState } from './CDSDashboard.js';
import { Card, KPICard, Button, StatusBadge, DataTable, DrawerField, FilterChip, Badge } from './components.js';
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
  const [activeConv, setActiveConv] = useState(0);
  const conversations = [
    { id: 'c1', name: 'Ground Team — Nakuru', initials: 'GT', status: 'review', preview: 'Clamp completed at 09:17, truck KDK 456P departing…', time: '14:18', unread: 3,
      messages: [
        { mine: false, time: '09:12', text: 'Starting clamp on truck KDK 456P for container TGHU3456789.' },
        { mine: false, time: '09:15', text: 'Driver John Kamau, transporter Kentrans Logistics, commodity Coffee. Booking ref MSC56789.' },
        { mine: false, time: '09:17', text: 'Lock SL23891 attached. Seal number SN-88213.' },
        { mine: true, time: '09:18', text: 'Received — extraction complete. Safe travels.' },
      ],
      fields: [['Container', 'TGHU3456789'], ['Booking', 'MSC56789'], ['Driver', 'John Kamau'], ['Lock', 'SL23891']] as [string, string][] },
    { id: 'c2', name: 'Port Team — Mombasa', initials: 'PT', status: 'synced', preview: 'Lock SL23881 removed, container cleared for vessel', time: '13:54', unread: 0,
      messages: [
        { mine: false, time: '13:40', text: 'Container MSCU7712340 arrived at gate 4.' },
        { mine: false, time: '13:54', text: 'Lock SL23881 removed, container cleared for vessel MV Nordic Star.' },
        { mine: true, time: '13:55', text: 'Logged and synced to voyage manifest. Thank you.' },
      ],
      fields: [['Container', 'MSCU7712340'], ['Vessel', 'MV Nordic Star'], ['Lock', 'SL23881']] as [string, string][] },
    { id: 'c3', name: 'Supervisor — J. Mwangi', initials: 'SP', status: 'pending', preview: 'Please confirm ETA for booking MSC56789', time: '13:40', unread: 1,
      messages: [{ mine: false, time: '13:40', text: 'Please confirm ETA for booking MSC56789.' }],
      fields: [['Booking', 'MSC56789']] as [string, string][] },
  ];
  const conv = conversations[activeConv]!;

  return (
    <div className="flex h-full" style={{ minHeight: 0 }}>
      <div className="w-[280px] flex-none border-r border-[rgba(255,255,255,.06)] flex flex-col">
        <div className="p-4 border-b border-[rgba(255,255,255,.06)]">
          <div className="font-bold text-sm text-text-0">Conversations</div>
          <div className="text-[11px] text-text-2 mt-1">{conversations.reduce((a, c) => a + c.unread, 0)} unread</div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.map((c, i) => (
            <div key={c.id} onClick={() => setActiveConv(i)}
              className={`flex items-start gap-3 px-4 py-3 cursor-pointer border-b border-[rgba(255,255,255,.04)] transition-colors ${i === activeConv ? 'bg-[rgba(255,255,255,.04)]' : 'hover:bg-[rgba(255,255,255,.02)]'}`}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-ink flex-none"
                style={{ background: c.status === 'synced' ? 'linear-gradient(140deg,#33d6a8,#1fae86)' : 'linear-gradient(140deg,#F0B429,#FFCE6B)' }}>
                {c.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-0 truncate">{c.name}</span>
                  <span className="text-[10px] text-text-2 flex-none ml-2">{c.time}</span>
                </div>
                <div className="text-[11px] text-text-2 truncate mt-0.5">{c.preview}</div>
                <div className="flex items-center gap-1.5 mt-1">
                  <Badge variant={c.status === 'synced' ? 'ok' : c.status === 'review' ? 'warn' : 'bad'}>{c.status.toUpperCase()}</Badge>
                  {c.unread > 0 && <span className="text-[9px] bg-cds-orange text-ink rounded-full w-4 h-4 flex items-center justify-center font-bold">{c.unread}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-3 border-b border-[rgba(255,255,255,.06)] flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-ink flex-none"
            style={{ background: conv.status === 'synced' ? 'linear-gradient(140deg,#33d6a8,#1fae86)' : 'linear-gradient(140deg,#F0B429,#FFCE6B)' }}>
            {conv.initials}
          </div>
          <div>
            <div className="text-sm font-semibold text-text-0">{conv.name}</div>
            <div className="text-[10px] text-text-2">{conv.status === 'synced' ? 'Synced' : 'AI extracting'}</div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {conv.messages.map((m, i) => (
            <div key={i} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-xl px-3.5 py-2.5 text-xs ${m.mine ? 'bg-[rgba(255,255,255,.06)] text-text-1' : 'bg-ink-2 border border-[rgba(255,255,255,.06)] text-text-0'}`}>
                <div>{m.text}</div>
                <div className="text-[10px] text-text-2 mt-1 text-right font-mono">{m.time}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="w-[280px] flex-none border-l border-[rgba(255,255,255,.06)] p-4 overflow-y-auto">
        <div className="font-bold text-sm text-text-0 mb-3">AI Extraction</div>
        <div className="space-y-2">
          {conv.fields.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between py-2 border-b border-[rgba(255,255,255,.04)]">
              <span className="text-[10px] text-text-2 font-mono">{label}</span>
              <span className="text-xs text-text-0 font-mono">{value}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" variant="ghost" className="flex-1">Reject</Button>
          <Button size="sm" className="flex-1">Approve</Button>
        </div>
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
  const commodities = [
    { label: 'Coffee', pct: 34, color: '#F0B429' },
    { label: 'Tea', pct: 28, color: '#33d6a8' },
    { label: 'Avocado', pct: 16, color: '#FF9A3C' },
    { label: 'Textiles', pct: 12, color: '#8a8f9a' },
    { label: 'Other', pct: 10, color: '#5a5f68' },
  ];

  const bars = [
    { label: 'Avg clamp time', value: '6m 40s', pct: 62, color: 'bg-cds-orange' },
    { label: 'Avg unclamp time', value: '4m 12s', pct: 44, color: 'bg-cds-teal' },
    { label: 'Late deliveries', value: '18%', pct: 18, color: 'bg-cds-red' },
    { label: 'Lock utilization', value: '81%', pct: 81, color: 'bg-cds-orange' },
  ];

  return (
    <div className="p-5 max-w-[1600px] mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="font-bold text-sm text-text-0 mb-4">Trips by Commodity</div>
          <div className="flex flex-wrap gap-2 mb-4">
            {commodities.map(c => (
              <div key={c.label} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
                <span className="text-xs text-text-1">{c.label} — {c.pct}%</span>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {commodities.map(c => (
              <div key={c.label} className="flex items-center gap-3">
                <span className="text-xs text-text-2 w-16">{c.label}</span>
                <div className="flex-1 h-2 rounded bg-ink-3 overflow-hidden">
                  <div className="h-full rounded" style={{ width: `${c.pct}%`, background: c.color }} />
                </div>
                <span className="text-xs font-mono text-text-1 w-8 text-right">{c.pct}%</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="font-bold text-sm text-text-0 mb-4">Avg Clamp vs Unclamp Time</div>
          <div className="space-y-3">
            {bars.map(b => (
              <div key={b.label} className="flex items-center gap-3">
                <span className="text-xs text-text-2 w-28">{b.label}</span>
                <div className="flex-1 h-2 rounded bg-ink-3 overflow-hidden">
                  <div className={`h-full rounded ${b.color}`} style={{ width: `${b.pct}%` }} />
                </div>
                <span className="text-xs font-mono text-text-1 w-14 text-right">{b.value}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5 md:col-span-2">
          <div className="font-bold text-sm text-text-0 mb-2">Peak Operating Hours</div>
          <div className="text-[11px] text-text-2 mb-4">Clamp events by hour of day</div>
          <div className="h-[140px] rounded-xl bg-ink-3/50 flex items-end px-4 pb-2 gap-1">
            {[6, 14, 22, 38, 54, 71, 88, 95, 80, 62, 48, 30].map((v, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full rounded-t" style={{ height: `${v * 1.2}px`, background: 'linear-gradient(180deg, #F0B429, rgba(240,180,41,.2))' }} />
                <span className="text-[8px] font-mono text-text-2">{(6 + i * 1.5).toFixed(0)}h</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

export function SettingsView() {
  const [tab, setTab] = useState('profile');
  // 'field agents' replaced what used to be a hardcoded "Field & Port Teams:
  // 42 members" row — that number came from nowhere. This tab is real: it
  // lists and provisions the yard_agent/port_agent accounts added in
  // migration 077, the same way GuardianConvoySettings does for CFOs.
  const tabs = ['profile', 'notifications', 'integrations', 'field agents', 'security'];

  const panels: Record<string, { label: string; value: string }[]> = {
    profile: [
      { label: 'Full name', value: 'R. Kariuki' },
      { label: 'Role', value: 'OPS CONTROLLER' },
      { label: 'Shift', value: 'Bravo · 06:00–18:00' },
      { label: 'Timezone', value: 'EAT (UTC+3)' },
    ],
    notifications: [
      { label: 'Auto WhatsApp on clamp/unclamp', value: 'On' },
      { label: 'Delayed trip alerts', value: 'On' },
      { label: 'Tamper alerts', value: 'On' },
      { label: 'Low battery warnings', value: 'On' },
      { label: 'Daily report email', value: 'Off' },
    ],
    integrations: [
      { label: 'Targa Telematics', value: 'Connected' },
      { label: 'Securisat', value: 'Connected' },
      { label: 'WhatsApp Business API', value: 'Connected' },
      { label: 'Excel / SharePoint sync', value: 'Connected' },
      { label: 'GPS beacon network', value: 'Connected' },
      { label: 'SAP freight module', value: 'Not connected' },
    ],
    security: [
      { label: 'Two-factor authentication', value: 'Required' },
      { label: 'Session timeout', value: '15 min' },
      { label: 'Audit log retention', value: '7 years' },
    ],
  };

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
        {tab === 'field agents' ? (
          <FieldAgentsPanel />
        ) : (
          <Card className="flex-1 p-5">
            <div className="space-y-0">
              {(panels[tab] ?? []).map((row, i) => (
                <div key={row.label} className={`flex items-center justify-between py-3.5 ${i < (panels[tab]?.length ?? 0) - 1 ? 'border-b border-[rgba(255,255,255,.05)]' : ''}`}>
                  <div>
                    <div className="text-xs text-text-0">{row.label}</div>
                  </div>
                  <span className={`text-xs font-mono ${row.value === 'Not connected' ? 'text-text-2' : row.value === 'Connected' || row.value === 'On' || row.value === 'Required' ? 'text-cds-teal' : 'text-text-1'}`}>
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

type FieldAgent = { id: string; name: string; email: string; role: 'yard_agent' | 'port_agent'; status: string };

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

// Mirrors GuardianConvoySettings' CFO account panel (components/GuardianConvoySettings.tsx)
// — same POST /auth/users + role field, same admin-only PATCH/DELETE — but
// for the two CDS field-crew roles instead of 'cfo'.
function FieldAgentsPanel() {
  const qc = useQueryClient();
  const { addToast } = useCDSStore();
  const myRole = useAuthStore(s => s.user?.role);
  const isAdmin = myRole === 'admin';
  // GET /auth/users is authorize('admin','dispatcher') server-side — same
  // gate GuardianConvoySettings relies on for the CFO list.
  const canView = isAdmin || myRole === 'dispatcher';
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'yard_agent' | 'port_agent'>('yard_agent');
  const [error, setError] = useState('');
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['field-agents'],
    queryFn: async () => {
      const [yard, port] = await Promise.all([
        api.get<{ data: FieldAgent[] }>('/auth/users', { params: { role: 'yard_agent', limit: 200 } }),
        api.get<{ data: FieldAgent[] }>('/auth/users', { params: { role: 'port_agent', limit: 200 } }),
      ]);
      return [...yard.data.data, ...port.data.data];
    },
    enabled: canView,
  });
  const agents = data ?? [];

  const reset = () => { setShowForm(false); setName(''); setEmail(''); setPassword(''); setRole('yard_agent'); setError(''); };

  // Hooks must run unconditionally, so these sit above the !canView return
  // even though a dispatcher (view-only, no mutate access server-side) will
  // never actually trigger them from the UI below.
  const createMut = useMutation({
    mutationFn: () => api.post('/auth/users', { name: name.trim(), email: email.trim(), password, role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['field-agents'] });
      addToast(`${role === 'yard_agent' ? 'Yard' : 'Port'} agent account created`);
      reset();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to create account.');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/users/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['field-agents'] }); addToast('Account removed'); },
  });

  const resetPasswordMut = useMutation({
    mutationFn: ({ id, password: p }: { id: string; password: string }) => api.patch(`/auth/users/${id}`, { password: p }),
    onSuccess: () => { addToast('Password reset'); setResetFor(null); setNewPassword(''); },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!name.trim() || !isValidEmail(email) || password.length < 8) {
      setError('Name, a valid email, and a password of at least 8 characters are required.');
      return;
    }
    createMut.mutate();
  };

  if (!canView) {
    return (
      <Card className="flex-1 p-5">
        <p className="text-[12px] text-text-2 font-mono py-6 text-center">
          Only admins and dispatchers can manage field accounts.
        </p>
      </Card>
    );
  }

  return (
    <Card className="flex-1 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm font-bold text-text-0">Yard &amp; Port field accounts</div>
          <p className="text-[11px] text-text-2 mt-0.5">
            Scoped logins for shared yard/port devices — a Yard account can only clamp, a Port account can only unclamp.
          </p>
        </div>
        {isAdmin && (
          <Button size="sm" icon={<Plus size={13} />} onClick={() => setShowForm(v => !v)}>New account</Button>
        )}
      </div>

      {showForm && isAdmin && (
        <form onSubmit={submit} className="mb-4 p-3 rounded-lg border border-white/[.08] bg-white/[.02] space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input required placeholder="Full name" value={name} onChange={e => setName(e.target.value)}
              className="h-9 px-3 rounded-lg bg-white/[.04] border border-white/[.08] text-text-0 text-[13px] outline-none focus:border-cds-orange/50" />
            <select value={role} onChange={e => setRole(e.target.value as 'yard_agent' | 'port_agent')}
              className="h-9 px-3 rounded-lg bg-white/[.04] border border-white/[.08] text-text-0 text-[13px] outline-none cursor-pointer">
              <option value="yard_agent">Yard agent</option>
              <option value="port_agent">Port agent</option>
            </select>
          </div>
          <input required type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
            className="w-full h-9 px-3 rounded-lg bg-white/[.04] border border-white/[.08] text-text-0 text-[13px] outline-none focus:border-cds-orange/50" />
          <input required type="password" placeholder="Password (min 8 characters)" value={password} onChange={e => setPassword(e.target.value)}
            className="w-full h-9 px-3 rounded-lg bg-white/[.04] border border-white/[.08] text-text-0 text-[13px] outline-none focus:border-cds-orange/50" />
          {error && <p className="text-[11px] text-cds-red font-mono">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={reset}>Cancel</Button>
            <Button type="submit" size="sm" disabled={createMut.isPending}>
              {createMut.isPending ? <Loader2 size={13} className="animate-spin" /> : 'Create account'}
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <LoadingState />
      ) : agents.length === 0 ? (
        <p className="text-[12px] text-text-2 font-mono italic py-6 text-center">No Yard or Port field accounts yet.</p>
      ) : (
        <div className="divide-y divide-white/[.05]">
          {agents.map(a => (
            <div key={a.id} className="py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-medium text-text-0 truncate">{a.name}</span>
                    <Badge variant={a.role === 'yard_agent' ? 'warn' : 'ok'}>
                      {a.role === 'yard_agent' ? 'YARD' : 'PORT'}
                    </Badge>
                    <StatusBadge status={a.status} />
                  </div>
                  <p className="text-[11px] text-text-2 mt-0.5 truncate">{a.email}</p>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button onClick={() => { setResetFor(resetFor === a.id ? null : a.id); setNewPassword(''); }}
                      title="Reset password"
                      className="w-7 h-7 rounded-lg bg-white/[.04] border border-white/[.08] text-text-2 hover:text-text-0 flex items-center justify-center cursor-pointer">
                      <KeyRound size={13} />
                    </button>
                    <button onClick={() => { if (confirm(`Remove field account for ${a.name}?`)) deleteMut.mutate(a.id); }}
                      title="Remove account"
                      className="w-7 h-7 rounded-lg bg-white/[.04] border border-white/[.08] text-text-2 hover:text-cds-red flex items-center justify-center cursor-pointer">
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>
              {resetFor === a.id && (
                <div className="flex items-center gap-2 pl-1">
                  <input type="password" placeholder="New password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                    className="h-8 px-3 rounded-lg bg-white/[.04] border border-white/[.08] text-text-0 text-[12px] outline-none focus:border-cds-orange/50 flex-1" />
                  <Button size="sm" disabled={newPassword.length < 8 || resetPasswordMut.isPending}
                    onClick={() => resetPasswordMut.mutate({ id: a.id, password: newPassword })}>
                    Set
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
