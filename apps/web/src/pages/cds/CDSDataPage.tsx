import { DataTable, DrawerField, StatusBadge } from './components.js';
import { useCDSTransporters } from './hooks.js';
import { useCDSStore } from './store.js';
import { LoadingState } from './CDSDashboard.js';
import { CDSContainerRegister } from './CDSContainerRegister.js';
export { BookingsView } from './CDSBookings.js';

type Row = Record<string, unknown>;
const s = (v: unknown) => String(v ?? '—');

export function ContainersView() {
  return <CDSContainerRegister />;
}

export function TransportersView() {
  const { data, isLoading, isError, refetch } = useCDSTransporters();
  const { openDrawer } = useCDSStore();
  if (isLoading) return <LoadingState />;
  if (isError) {
    return (
      <div className="mx-auto max-w-[1600px] p-5">
        <div className="rounded-xl border border-red-300/20 bg-red-300/[.04] p-5">
          <h2 className="text-sm font-semibold text-text-0">Transport partner data unavailable</h2>
          <p className="mt-1 text-xs text-text-2">Carrier performance is hidden until the persisted trip records can be loaded.</p>
          <button type="button" onClick={() => void refetch()} className="mt-3 rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-text-0">Retry</button>
        </div>
      </div>
    );
  }
  const rows = (data?.data ?? []) as Row[];
  const sum = (key: string) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
  const activePartners = rows.filter(row => String(row['status']) === 'active').length;
  const fmt = (value: unknown) => Number(value ?? 0).toLocaleString();
  const onTime = (row: Row) => Number(row['deliveries_with_eta'] ?? 0) > 0
    ? Number(row['on_time_rate']).toFixed(1) + '%'
    : 'No ETA baseline';

  const metrics = [
    { label: 'Registered partners', value: fmt(rows.length), note: activePartners + ' active' },
    { label: 'Partner handling records', value: fmt(sum('containers_handled')), note: 'Distinct container identities per carrier' },
    { label: 'Trips recorded', value: fmt(sum('total_trips')), note: 'Across listed partners' },
    { label: 'Active trips', value: fmt(sum('active_trips')), note: 'Not yet closed' },
  ];

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-5">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-white/[.07] pb-4">
        <div>
          <div className="text-[9px] font-semibold uppercase tracking-[.18em] text-[#8eb9ed]">Carrier network / Performance</div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-text-0 sm:text-2xl">Transport partners</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-text-2">See how much equipment each partner has handled, its active workload, completed deliveries, fleet coverage and observed ETA performance.</p>
        </div>
        <div className="text-[10px] text-text-2">Ranked by containers handled, then trip volume</div>
      </header>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metrics.map((metric, index) => (
          <div key={metric.label} className="relative overflow-hidden rounded-xl border border-white/[.08] bg-[#111b2a] p-4">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[#78aee7]/70 via-[#4cc8c1]/35 to-transparent" />
            <div className="text-[9px] font-semibold uppercase tracking-[.14em] text-white/45">{metric.label}</div>
            <div className="mt-2 font-mono text-2xl font-semibold tracking-tight text-white tabular-nums">{metric.value}</div>
            <div className="mt-1 text-[10px] text-white/40">{metric.note}</div>
          </div>
        ))}
      </div>

      <section className="overflow-hidden rounded-xl border border-white/[.08] bg-[#0d1726]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[.07] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-text-0">Carrier performance register</h2>
            <p className="mt-0.5 text-[10px] text-text-2">Select a partner for its operating profile and performance detail.</p>
          </div>
          <span className="font-mono text-[10px] text-text-2">{rows.length.toLocaleString()} partners</span>
        </div>
        <DataTable
          columns={[
            { id: 'company', header: 'Transport partner', accessor: (r: Row) => (
              <div className="min-w-[170px]">
                <div className="font-semibold text-text-0">{s(r['company_name'])}</div>
                <div className="mt-0.5 font-mono text-[10px] text-text-2">{s(r['code'])}</div>
              </div>
            ) },
            { id: 'containers', header: 'Containers handled', accessor: (r: Row) => (
              <div>
                <div className="font-mono text-sm font-semibold text-[#a9cff5] tabular-nums">{fmt(r['containers_handled'])}</div>
                <div className="text-[9px] text-text-2">{fmt(r['containers_handled_30d'])} in last 30d</div>
              </div>
            ) },
            { id: 'trips', header: 'Trips', accessor: (r: Row) => <span className="font-mono text-xs tabular-nums">{fmt(r['total_trips'])}</span> },
            { id: 'workload', header: 'Active', accessor: (r: Row) => <span className="font-mono text-xs tabular-nums">{fmt(r['active_trips'])}</span> },
            { id: 'completed', header: 'Delivered', accessor: (r: Row) => <span className="font-mono text-xs tabular-nums">{fmt(r['completed_trips'])}</span> },
            { id: 'fleet', header: 'Fleet / drivers', accessor: (r: Row) => <span className="text-[11px] text-text-1">{fmt(r['registered_trucks'])} / {fmt(r['registered_drivers'])}</span> },
            { id: 'ontime', header: 'On-time delivery', accessor: (r: Row) => (
              <span className={'text-xs font-semibold tabular-nums ' + (Number(r['deliveries_with_eta'] ?? 0) === 0 ? 'text-text-2' : Number(r['on_time_rate']) >= 90 ? 'text-cds-teal' : Number(r['on_time_rate']) >= 75 ? 'text-amber-300' : 'text-red-300')}>
                {onTime(r)}
              </span>
            ) },
            { id: 'status', header: 'Status', accessor: (r: Row) => <StatusBadge status={s(r['status'])} /> },
          ]}
          data={rows}
          keyExtractor={(r: Row) => s(r['id'])}
          searchable
          searchPlaceholder="Search transport partners…"
          onRowClick={(r: Row) => openDrawer('Partner profile — ' + s(r['company_name']), (
            <div className="space-y-5">
              <section>
                <div className="text-base font-semibold text-text-0">{s(r['company_name'])}</div>
                <div className="mt-1 text-[10px] font-mono text-text-2">{s(r['code'])}</div>
                <div className="mt-3"><StatusBadge status={s(r['status'])} /></div>
              </section>
              <section>
                <div className="mb-2 text-[9px] font-bold uppercase tracking-[.15em] text-[#8eb9ed]">Equipment handled</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['Containers handled', fmt(r['containers_handled'])],
                    ['Last 30 days', fmt(r['containers_handled_30d'])],
                    ['Total trips', fmt(r['total_trips'])],
                    ['Active trips', fmt(r['active_trips'])],
                    ['Completed deliveries', fmt(r['completed_trips'])],
                    ['Delayed now', fmt(r['delayed_trips'])],
                    ['Registered vehicles', fmt(r['registered_trucks'])],
                    ['Registered drivers', fmt(r['registered_drivers'])],
                  ].map(([label, value]) => <div key={label} className="rounded-lg border border-white/[.07] bg-white/[.025] p-3"><div className="text-[9px] uppercase tracking-wider text-text-2">{label}</div><div className="mt-1 text-lg font-semibold font-mono text-text-0 tabular-nums">{value}</div></div>)}
                </div>
              </section>
              <section className="space-y-1.5">
                <div className="mb-2 text-[9px] font-bold uppercase tracking-[.15em] text-[#8eb9ed]">Partner contact</div>
                <DrawerField label="Contact person" value={s(r['contact_person'])} />
                <DrawerField label="Phone" value={s(r['phone'])} />
                <DrawerField label="Email" value={s(r['email'])} />
              </section>
              <section className="rounded-lg border border-white/[.07] bg-white/[.025] p-3">
                <div className="text-[10px] font-semibold text-text-0">ETA performance</div>
                <div className="mt-1 font-mono text-2xl font-semibold text-text-0 tabular-nums">{onTime(r)}</div>
                <p className="mt-1 text-[10px] leading-relaxed text-text-2">Calculated only from completed trips with both an ETA and an actual delivery timestamp. {fmt(r['deliveries_with_eta'])} completed trips form this baseline; deliveries without an ETA are excluded rather than counted as late or on time.</p>
              </section>
            </div>
          ))}
        />
      </section>
      <p className="text-[10px] leading-relaxed text-text-2">Container totals count distinct equipment identities per transport partner. A container handled by more than one partner across separate movements contributes to each partner’s history. Driver records remain attached to trips and partner assignments; they are no longer maintained as a standalone roster screen.</p>
    </div>
  );
}
