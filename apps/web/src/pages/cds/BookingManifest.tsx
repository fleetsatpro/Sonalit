/**
 * The container manifest.
 *
 * Two views over the same data. Grouped is the default: one block per booking,
 * because that is the unit ops actually works in — "this booking, these boxes,
 * how far along". The flat sheet is kept because reconciliation and export are
 * genuinely easier as one continuous table, and taking that away would be
 * taking away the tool people already know.
 *
 * Running across both is the integrity scan
 * (backend/src/utils/manifestAnomalies.js), which looks for the things that
 * cannot be true of real containers: the same box on two rows, one seal on two
 * boxes, an e-lock claimed twice, a container number whose ISO 6346 check digit
 * does not add up. Those used to be invisible until something failed at a port.
 */
import { AlertTriangle, ChevronsDownUp, ChevronsUpDown, Check, Rows3, Search, ShieldCheck, LayoutList } from 'lucide-react';
import { useMemo, useState } from 'react';

import { BookingGroup, type BookingGroupData } from './BookingGroup.js';
import { LoadingState } from './CDSDashboard.js';
import { useBookingManifest, useManifestAnomalies, useUpdateBookingContainer } from './hooks.js';
import {
  FLAT_COLS, MONO, SEVERITY, SEVERITY_ORDER, YARD_COLOR, YARD_STATES,
  str, worstSeverity,
  type Anomaly, type Row, type Severity,
} from './manifestShared.js';

function groupRows(rows: Row[]): BookingGroupData[] {
  const map = new Map<string, BookingGroupData>();
  for (const r of rows) {
    const id = str(r['booking_id']);
    if (!map.has(id)) {
      map.set(id, {
        booking_id: id,
        booking_number: str(r['booking_number']),
        vessel: str(r['vessel']),
        customer_name: str(r['customer_name']),
        file_reference: str(r['file_reference']),
        carrier_reference: str(r['carrier_reference']),
        controller: str(r['controller']),
        commodity: str(r['commodity']),
        pickup_location: str(r['pickup_location']),
        delivery_location: str(r['delivery_location']),
        direction: str(r['direction']) || 'OB',
        country_code: str(r['country_code']),
        eta: str(r['eta']),
        rows: [],
      });
    }
    map.get(id)?.rows.push(r);
  }
  return [...map.values()];
}

function ScanStrip({
  anomalies, total, scanned, truncated, active, onPick, loading,
}: {
  anomalies: Anomaly[];
  total: number;
  scanned: number;
  truncated: boolean;
  active: Severity | 'all';
  onPick: (s: Severity | 'all') => void;
  loading: boolean;
}) {
  const counts = SEVERITY_ORDER.map(s => [s, anomalies.filter(a => a.severity === s).length] as const);
  const clean = total === 0 && !loading;

  return (
    <div className="rounded-xl px-3 py-2.5 mb-3 flex items-center gap-3 flex-wrap"
      style={{
        border: `1px solid ${clean ? 'rgba(51,214,168,.25)' : 'rgba(255,92,92,.22)'}`,
        background: clean
          ? 'linear-gradient(90deg, rgba(51,214,168,.07), transparent 55%)'
          : 'linear-gradient(90deg, rgba(255,92,92,.07), transparent 55%)',
      }}>
      <span className="flex items-center gap-2">
        {clean
          ? <ShieldCheck size={15} color="#33d6a8" />
          : <AlertTriangle size={15} color="#ff5c5c" />}
        <span className="text-[11px] font-mono uppercase tracking-widest"
          style={{ color: clean ? '#33d6a8' : '#ff5c5c' }}>
          integrity scan
        </span>
      </span>

      <span className="text-[11px] text-text-2 font-mono">
        {loading ? 'scanning…' : `${scanned} containers checked · ${total} ${total === 1 ? 'finding' : 'findings'}`}
        {truncated && ' · partial scan'}
      </span>

      {total > 0 && (
        <span className="flex items-center gap-1.5 ml-auto flex-wrap">
          <button onClick={() => onPick('all')}
            className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-colors"
            style={active === 'all'
              ? { color: '#fff', background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.22)' }
              : { color: '#94a3b8', background: 'transparent', border: '1px solid rgba(255,255,255,.1)' }}>
            show all
          </button>
          {counts.filter(([, n]) => n > 0).map(([s, n]) => {
            const c = SEVERITY[s].color;
            const on = active === s;
            return (
              <button key={s} onClick={() => onPick(on ? 'all' : s)}
                className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide cursor-pointer transition-colors"
                style={on
                  ? { color: c, background: `${c}26`, border: `1px solid ${c}66` }
                  : { color: c, background: 'transparent', border: `1px solid ${c}33` }}>
                {n} {SEVERITY[s].label}
              </button>
            );
          })}
        </span>
      )}
    </div>
  );
}

/** The findings themselves, grouped by rule so a systemic problem reads as one thing. */
function AnomalyList({ anomalies }: { anomalies: Anomaly[] }) {
  const byCode = new Map<string, Anomaly[]>();
  for (const a of anomalies) {
    if (!byCode.has(a.code)) byCode.set(a.code, []);
    byCode.get(a.code)?.push(a);
  }
  const rankOf = (items: Anomaly[]) => {
    const first = items[0];
    return first ? SEVERITY[first.severity].rank : 99;
  };
  const groups = [...byCode.entries()].sort((a, b) => rankOf(a[1]) - rankOf(b[1]));

  return (
    <div className="space-y-2 mb-3">
      {groups.map(([code, items]) => {
        const first = items[0] as Anomaly;
        const c = SEVERITY[first.severity].color;
        return (
          <div key={code} className="rounded-lg px-3 py-2.5"
            style={{ border: `1px solid ${c}33`, background: `${c}0d` }}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded"
                style={{ color: c, background: `${c}1f`, border: `1px solid ${c}47` }}>
                {SEVERITY[first.severity].label}
              </span>
              <span className="text-[12.5px] font-bold text-text-0">{first.title}</span>
              <span className="text-[11px] font-mono text-text-2">
                {items.length} {items.length === 1 ? 'row' : 'rows'}
              </span>
            </div>
            <ul className="mt-1.5 space-y-1">
              {items.slice(0, 6).map(a => (
                <li key={a.id} className="text-[11.5px] text-text-2 leading-snug">
                  <span className="font-mono text-text-1">
                    {a.container_number || a.booking_number || '—'}
                  </span>
                  {' — '}{a.detail}
                </li>
              ))}
              {items.length > 6 && (
                <li className="text-[11px] text-text-2 font-mono">+ {items.length - 6} more</li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

export function BookingManifest({ bookingId }: { bookingId?: string }) {
  const [search, setSearch] = useState('');
  const [yard, setYard] = useState<string>('');
  const [mode, setMode] = useState<'grouped' | 'flat'>('grouped');
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [showFindings, setShowFindings] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { data, isLoading } = useBookingManifest({
    ...(bookingId ? { booking_id: bookingId } : {}),
    ...(yard ? { yard_status: yard } : {}),
    ...(search ? { search } : {}),
    limit: 500,
  } as never);
  const scan = useManifestAnomalies();
  const update = useUpdateBookingContainer();

  const rows = useMemo(() => (data?.data ?? []) as Row[], [data]);
  const anomalies = useMemo(() => (scan.data?.data ?? []) as unknown as Anomaly[], [scan.data]);

  const byContainer = useMemo(() => {
    const m = new Map<string, Anomaly[]>();
    for (const a of anomalies) {
      if (!a.container_id) continue;
      if (!m.has(a.container_id)) m.set(a.container_id, []);
      m.get(a.container_id)?.push(a);
    }
    return m;
  }, [anomalies]);

  const byBooking = useMemo(() => {
    const m = new Map<string, Anomaly[]>();
    for (const a of anomalies) {
      if (!a.booking_id) continue;
      if (!m.has(a.booking_id)) m.set(a.booking_id, []);
      m.get(a.booking_id)?.push(a);
    }
    return m;
  }, [anomalies]);

  // Filtering by severity narrows to the rows that actually carry a finding of
  // that severity — the point of the control is to get to the problem, not to
  // recolour the whole sheet.
  const visibleRows = useMemo(() => {
    if (severityFilter === 'all') return rows;
    return rows.filter(r => (byContainer.get(String(r['id'])) ?? []).some(a => a.severity === severityFilter));
  }, [rows, byContainer, severityFilter]);

  const groups = useMemo(() => groupRows(visibleRows), [visibleRows]);

  // Sorted by worst finding first, then by reference descending — a booking in
  // trouble should not be somewhere down the page behind four healthy ones.
  const sortedGroups = useMemo(() => {
    return [...groups].sort((a, b) => {
      const sa = worstSeverity(byBooking.get(a.booking_id) ?? []);
      const sb = worstSeverity(byBooking.get(b.booking_id) ?? []);
      const ra = sa ? SEVERITY[sa].rank : 99;
      const rb = sb ? SEVERITY[sb].rank : 99;
      if (ra !== rb) return ra - rb;
      return b.booking_number.localeCompare(a.booking_number);
    });
  }, [groups, byBooking]);

  if (isLoading) return <LoadingState />;

  const total = data?.total ?? rows.length;

  const toggleInvoiced = (r: Row) => {
    update.mutate({
      bookingId: String(r['booking_id']),
      containerId: String(r['id']),
      patch: { invoiced: !r['invoiced'] },
    });
  };

  const allCollapsed = collapsed.size >= sortedGroups.length && sortedGroups.length > 0;
  const toggleAll = () => {
    setCollapsed(allCollapsed ? new Set() : new Set(sortedGroups.map(g => g.booking_id)));
  };

  const chip = (on: boolean, color?: string) => on
    ? { color: color ?? '#fff', background: color ? `${color}24` : 'rgba(255,255,255,.14)', border: `1px solid ${color ? `${color}59` : 'rgba(255,255,255,.22)'}` }
    : { color: '#94a3b8', background: 'transparent', border: '1px solid rgba(255,255,255,.1)' };

  return (
    <div>
      <ScanStrip
        anomalies={anomalies}
        total={scan.data?.total ?? anomalies.length}
        scanned={scan.data?.scanned_containers ?? 0}
        truncated={Boolean(scan.data?.truncated)}
        active={severityFilter}
        onPick={(s) => { setSeverityFilter(s); if (s !== 'all') setShowFindings(true); }}
        loading={scan.isLoading}
      />

      {anomalies.length > 0 && (
        <button onClick={() => setShowFindings(v => !v)}
          className="text-[11px] font-mono uppercase tracking-widest text-text-2 hover:text-text-0 mb-2 cursor-pointer">
          {showFindings ? '− hide findings' : '+ show findings'}
        </button>
      )}
      {showFindings && anomalies.length > 0 && (
        <AnomalyList anomalies={severityFilter === 'all' ? anomalies : anomalies.filter(a => a.severity === severityFilter)} />
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Container, seal, booking, vessel…"
            className="pl-7 pr-3 py-1.5 rounded-lg bg-white/[.04] border border-white/10 text-[12px] text-text-0 placeholder:text-text-2 outline-none focus:border-white/25"
            style={{ width: 250 }}
          />
        </div>

        <button onClick={() => setYard('')}
          className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer"
          style={chip(yard === '')}>All</button>
        {YARD_STATES.map(st => (
          <button key={st} onClick={() => setYard(yard === st ? '' : st)}
            className="px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase transition-colors cursor-pointer"
            style={chip(yard === st, YARD_COLOR[st])}>{st}</button>
        ))}

        <span className="ml-auto flex items-center gap-2">
          {mode === 'grouped' && sortedGroups.length > 0 && (
            <button onClick={toggleAll} title={allCollapsed ? 'Expand all' : 'Collapse all'}
              className="px-2 py-1 rounded-lg text-[11px] text-text-2 hover:text-text-0 border border-white/10 flex items-center gap-1.5 cursor-pointer">
              {allCollapsed ? <ChevronsUpDown size={12} /> : <ChevronsDownUp size={12} />}
              {allCollapsed ? 'Expand' : 'Collapse'}
            </button>
          )}
          <span className="inline-flex rounded-lg overflow-hidden border border-white/10">
            {([['grouped', LayoutList], ['flat', Rows3]] as const).map(([m, Icon]) => (
              <button key={m} onClick={() => setMode(m)}
                title={m === 'grouped' ? 'One block per booking' : 'One continuous sheet'}
                className="px-2.5 py-1 text-[11px] font-semibold capitalize flex items-center gap-1.5 cursor-pointer transition-colors"
                style={mode === m
                  ? { color: '#ff7a00', background: 'rgba(255,122,0,.14)' }
                  : { color: '#94a3b8', background: 'transparent' }}>
                <Icon size={12} /> {m}
              </button>
            ))}
          </span>
          <span className="text-[11px] text-text-2 font-mono">
            {visibleRows.length} of {total} containers · {sortedGroups.length} {sortedGroups.length === 1 ? 'booking' : 'bookings'}
          </span>
        </span>
      </div>

      {mode === 'grouped' ? (
        <div style={{ maxHeight: '68vh', overflowY: 'auto' }}>
          {sortedGroups.map(g => (
            <BookingGroup
              key={g.booking_id}
              group={g}
              anomaliesByContainer={byContainer}
              groupAnomalies={byBooking.get(g.booking_id) ?? []}
              open={!collapsed.has(g.booking_id)}
              onToggle={() => setCollapsed(prev => {
                const next = new Set(prev);
                if (next.has(g.booking_id)) next.delete(g.booking_id); else next.add(g.booking_id);
                return next;
              })}
              onToggleInvoiced={toggleInvoiced}
              busy={update.isPending}
            />
          ))}
        </div>
      ) : (
        <FlatSheet rows={visibleRows} byContainer={byContainer} onToggleInvoiced={toggleInvoiced} busy={update.isPending} />
      )}

      {visibleRows.length === 0 && (
        <div className="py-14 text-center text-[12px] text-text-2">
          {severityFilter === 'all'
            ? 'No containers match. Containers appear here once a booking has them.'
            : `No ${SEVERITY[severityFilter].label.toLowerCase()} findings on the containers currently shown.`}
        </div>
      )}
    </div>
  );
}

/** The original continuous sheet, kept for reconciliation and export. */
function FlatSheet({ rows, byContainer, onToggleInvoiced, busy }: {
  rows: Row[];
  byContainer: Map<string, Anomaly[]>;
  onToggleInvoiced: (r: Row) => void;
  busy: boolean;
}) {
  return (
    <div className="rounded-xl border border-white/10 overflow-x-auto" style={{ maxHeight: '68vh' }}>
      <table className="border-collapse" style={{ minWidth: FLAT_COLS.reduce((a, c) => a + c.w, 0) }}>
        <thead className="sticky top-0 z-10">
          <tr>
            {FLAT_COLS.map(c => (
              <th key={c.key}
                className="text-left px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-text-2 whitespace-nowrap"
                style={{ width: c.w, minWidth: c.w, background: '#12161d', borderBottom: '1px solid rgba(255,255,255,.14)' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const issues = byContainer.get(String(r['id'])) ?? [];
            const sev = worstSeverity(issues);
            const sevColor = sev ? SEVERITY[sev].color : null;
            return (
              <tr key={String(r['id'] ?? i)} className="hover:bg-white/[.04] transition-colors"
                style={{
                  borderBottom: '1px solid rgba(255,255,255,.06)',
                  background: sevColor ? `${sevColor}0d` : undefined,
                }}>
                {FLAT_COLS.map(c => {
                  if (c.key === 'invoiced') {
                    const on = Boolean(r['invoiced']);
                    return (
                      <td key={c.key} className="px-2 py-1.5">
                        <button onClick={() => onToggleInvoiced(r)} disabled={busy}
                          className="w-4 h-4 rounded flex items-center justify-center cursor-pointer"
                          style={{
                            background: on ? 'rgba(51,214,168,.18)' : 'transparent',
                            border: `1px solid ${on ? 'rgba(51,214,168,.6)' : 'rgba(255,255,255,.18)'}`,
                          }}>
                          {on && <Check size={11} strokeWidth={3} color="#33d6a8" />}
                        </button>
                      </td>
                    );
                  }
                  const value = c.render ? c.render(r) : str(r[c.key]);
                  const isRef = c.key === 'container_number' && Boolean(sevColor);
                  return (
                    <td key={c.key}
                      className={`px-2 py-1.5 text-[11.5px] whitespace-nowrap ${MONO.has(c.key) ? 'font-mono' : ''} ${value ? 'text-text-0' : 'text-text-2'}`}
                      style={isRef && sevColor ? { color: sevColor } : undefined}
                      title={issues.length ? issues.map(a => a.title).join('\n') : (value || undefined)}>
                      {value || '·'}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
