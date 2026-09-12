/**
 * Container Manifest — Command Center
 *
 * Built for high-volume operations: hundreds to thousands of containers per day.
 *
 * The manifest is the control room's working view. It answers the questions a
 * controller asks all day: what is in the yard, what left, what arrived, and
 * what has a problem. At scale, those questions need structure, not just a list.
 *
 * Three tiers:
 *  1. Pipeline header — live KPIs and a lifecycle bar so the overall state is
 *     visible without scrolling.
 *  2. Filter bar — yard status, direction, container status, search, and sort.
 *     Each narrows the same dataset; they compose.
 *  3. The sheet — grouped (one block per booking) or flat (one continuous table).
 *     Sortable columns, sticky headers, severity markers.
 *
 * The integrity scan sits between tiers 1 and 2: it is system-level, not a
 * filter, so it lives above the filter controls but below the pipeline KPIs.
 */
import {
  AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown,
  ChevronsDownUp, ChevronsUpDown, Check,
  LayoutList, Rows3, Search, ShieldCheck,
  Package, Truck,
  Anchor, CircleCheck, Filter, X,
} from 'lucide-react';
import { useMemo, useState, useCallback } from 'react';

import { BookingGroup, type BookingGroupData } from './BookingGroup.js';
import { LoadingState } from './CDSDashboard.js';
import { useBookingManifest, useManifestAnomalies, useUpdateBookingContainer } from './hooks.js';
import {
  CONTAINER_STAGES, DIRECTION_META, FLAT_COLS, MONO,
  SEVERITY, SEVERITY_ORDER, STAGE_COLOR, YARD_COLOR, YARD_STATES,
  str, worstSeverity, sortRows, computePipelineStats,
  type Anomaly, type Row, type Severity, type SortState,
} from './manifestShared.js';

const PAGE_SIZE = 1000;

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

// ─── Pipeline Header ────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { key: 'pending',    label: 'Yard',       icon: Package,     color: '#94a3b8' },
  { key: 'in_transit', label: 'In Transit', icon: Truck,       color: '#ff7a00' },
  { key: 'at_port',    label: 'At Port',    icon: Anchor,      color: '#ffb020' },
  { key: 'delivered',  label: 'Delivered',  icon: CircleCheck,  color: '#33d6a8' },
] as const;

function PipelineHeader({ stats, anomalyCount }: {
  stats: ReturnType<typeof computePipelineStats>;
  anomalyCount: number;
}) {
  const segments = PIPELINE_STAGES.map(s => {
    const count = s.key === 'pending'
      ? (stats.byStage['pending'] ?? 0) + (stats.byStage['assigned'] ?? 0)
      : s.key === 'delivered'
        ? (stats.byStage['delivered'] ?? 0) + (stats.byStage['completed'] ?? 0)
        : (stats.byStage[s.key] ?? 0);
    return { ...s, count };
  });
  const total = stats.total || 1;

  return (
    <div className="rounded-xl mb-3 overflow-hidden"
      style={{ border: '1px solid rgba(255,255,255,.09)', background: 'rgba(255,255,255,.02)' }}>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-px" style={{ background: 'rgba(255,255,255,.06)' }}>
        {segments.map(s => {
          const Icon = s.icon;
          return (
            <div key={s.key} className="px-4 py-3 flex items-center gap-3" style={{ background: '#0d1117' }}>
              <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: `${s.color}1a`, border: `1px solid ${s.color}33` }}>
                <Icon size={15} color={s.color} />
              </div>
              <div>
                <div className="text-[20px] font-bold leading-none" style={{ color: s.color }}>{s.count}</div>
                <div className="text-[9.5px] font-mono uppercase tracking-widest text-text-2 mt-0.5">{s.label}</div>
              </div>
            </div>
          );
        })}

        <div className="px-4 py-3 flex items-center gap-3" style={{ background: '#0d1117' }}>
          <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(255,122,0,.12)', border: '1px solid rgba(255,122,0,.3)' }}>
            <span className="text-[13px] font-bold" style={{ color: '#ff7a00' }}>
              {stats.byDirection['OB'] ?? 0}
            </span>
          </div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-[11px] font-bold" style={{ color: '#ff7a00' }}>OB</span>
              <span className="text-[9px] text-text-2">/</span>
              <span className="text-[11px] font-bold" style={{ color: '#37e6ff' }}>IB</span>
            </div>
            <div className="text-[9.5px] font-mono uppercase tracking-widest text-text-2 mt-0.5">
              <span style={{ color: '#37e6ff' }}>{stats.byDirection['IB'] ?? 0}</span> inbound
            </div>
          </div>
        </div>

        <div className="px-4 py-3 flex items-center gap-3" style={{ background: '#0d1117' }}>
          <div className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: anomalyCount ? 'rgba(255,92,92,.12)' : 'rgba(51,214,168,.1)',
              border: `1px solid ${anomalyCount ? 'rgba(255,92,92,.3)' : 'rgba(51,214,168,.25)'}`,
            }}>
            {anomalyCount ? <AlertTriangle size={15} color="#ff5c5c" /> : <ShieldCheck size={15} color="#33d6a8" />}
          </div>
          <div>
            <div className="text-[20px] font-bold leading-none"
              style={{ color: anomalyCount ? '#ff5c5c' : '#33d6a8' }}>
              {anomalyCount}
            </div>
            <div className="text-[9.5px] font-mono uppercase tracking-widest text-text-2 mt-0.5">
              {anomalyCount ? 'findings' : 'clean'}
            </div>
          </div>
        </div>
      </div>

      {/* Lifecycle bar */}
      <div className="flex h-1.5" style={{ background: 'rgba(255,255,255,.04)' }}>
        {segments.filter(s => s.count > 0).map(s => (
          <div key={s.key}
            title={`${s.count} ${s.label.toLowerCase()}`}
            style={{
              width: `${(s.count / total) * 100}%`,
              background: s.color,
              boxShadow: `0 0 12px -2px ${s.color}`,
            }} />
        ))}
      </div>
    </div>
  );
}

// ─── Scan Strip ─────────────────────────────────────────────────────────────

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

// ─── Sort Header ────────────────────────────────────────────────────────────

function SortIcon({ col, sort }: { col: string; sort: SortState | null }) {
  if (!sort || sort.key !== col) return <ArrowUpDown size={10} className="text-text-2 opacity-40" />;
  return sort.dir === 'asc'
    ? <ArrowUp size={10} style={{ color: '#ff7a00' }} />
    : <ArrowDown size={10} style={{ color: '#ff7a00' }} />;
}

// ─── Filter Chip ────────────────────────────────────────────────────────────

function Chip({ on, color, children, onClick }: {
  on: boolean; color?: string | undefined; children: React.ReactNode; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap"
      style={on
        ? { color: color ?? '#fff', background: color ? `${color}24` : 'rgba(255,255,255,.14)', border: `1px solid ${color ? `${color}59` : 'rgba(255,255,255,.22)'}` }
        : { color: '#94a3b8', background: 'transparent', border: '1px solid rgba(255,255,255,.1)' }}>
      {children}
    </button>
  );
}

// ─── Active Filters Bar ─────────────────────────────────────────────────────

function ActiveFilters({ filters, onClear }: {
  filters: { label: string; key: string; color?: string | undefined }[];
  onClear: (key: string) => void;
}) {
  if (filters.length === 0) return null;
  return (
    <div className="flex items-center gap-1.5 mb-2 flex-wrap">
      <Filter size={11} className="text-text-2" />
      <span className="text-[10px] text-text-2 font-mono uppercase tracking-widest mr-1">Active:</span>
      {filters.map(f => (
        <button key={f.key} onClick={() => onClear(f.key)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold cursor-pointer transition-colors"
          style={{ color: f.color ?? '#fff', background: f.color ? `${f.color}1a` : 'rgba(255,255,255,.1)', border: `1px solid ${f.color ? `${f.color}3d` : 'rgba(255,255,255,.15)'}` }}>
          {f.label} <X size={9} />
        </button>
      ))}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function BookingManifest({ bookingId }: { bookingId?: string }) {
  const [search, setSearch] = useState('');
  const [yard, setYard] = useState<string>('');
  const [direction, setDirection] = useState<string>('');
  const [stageFilter, setStageFilter] = useState<string>('');
  const [mode, setMode] = useState<'grouped' | 'flat'>('grouped');
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');
  const [showFindings, setShowFindings] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState | null>(null);
  const [showStageFilter, setShowStageFilter] = useState(false);

  const params = useMemo(() => ({
    ...(bookingId ? { booking_id: bookingId } : {}),
    ...(yard ? { yard_status: yard } : {}),
    ...(direction ? { direction } : {}),
    ...(stageFilter ? { status: stageFilter } : {}),
    ...(search ? { search } : {}),
    limit: PAGE_SIZE,
  }), [bookingId, yard, direction, stageFilter, search]);

  const { data, isLoading } = useBookingManifest(params as never);
  const scan = useManifestAnomalies();
  const update = useUpdateBookingContainer();

  const rows = useMemo(() => (data?.data ?? []) as Row[], [data]);
  const anomalies = useMemo(() => (scan.data?.data ?? []) as unknown as Anomaly[], [scan.data]);
  const stats = useMemo(() => computePipelineStats(rows), [rows]);

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

  const visibleRows = useMemo(() => {
    let r = rows;
    if (severityFilter !== 'all') {
      r = r.filter(row => (byContainer.get(String(row['id'])) ?? []).some(a => a.severity === severityFilter));
    }
    return sortRows(r, sort);
  }, [rows, byContainer, severityFilter, sort]);

  const groups = useMemo(() => groupRows(visibleRows), [visibleRows]);

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

  const toggleSort = useCallback((key: string) => {
    setSort(prev => {
      if (!prev || prev.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }, []);

  const toggleInvoiced = useCallback((r: Row) => {
    update.mutate({
      bookingId: String(r['booking_id']),
      containerId: String(r['id']),
      patch: { invoiced: !r['invoiced'] },
    });
  }, [update]);

  const activeFilters = useMemo(() => {
    const f: { label: string; key: string; color?: string | undefined }[] = [];
    if (yard) f.push({ label: `Location: ${yard.toUpperCase()}`, key: 'yard', color: YARD_COLOR[yard] });
    if (direction) f.push({ label: direction === 'OB' ? 'Outbound' : 'Inbound', key: 'direction', color: DIRECTION_META[direction]?.color });
    if (stageFilter) f.push({ label: `Stage: ${stageFilter.replace(/_/g, ' ')}`, key: 'stage', color: STAGE_COLOR[stageFilter] });
    if (severityFilter !== 'all') f.push({ label: `${SEVERITY[severityFilter].label} issues`, key: 'severity', color: SEVERITY[severityFilter].color });
    return f;
  }, [yard, direction, stageFilter, severityFilter]);

  const clearFilter = useCallback((key: string) => {
    if (key === 'yard') setYard('');
    if (key === 'direction') setDirection('');
    if (key === 'stage') setStageFilter('');
    if (key === 'severity') setSeverityFilter('all');
  }, []);

  if (isLoading) return <LoadingState />;

  const total = data?.total ?? rows.length;
  const allCollapsed = collapsed.size >= sortedGroups.length && sortedGroups.length > 0;
  const toggleAll = () => {
    setCollapsed(allCollapsed ? new Set() : new Set(sortedGroups.map(g => g.booking_id)));
  };

  return (
    <div>
      {/* Tier 1: Pipeline Command Center */}
      <PipelineHeader stats={stats} anomalyCount={scan.data?.total ?? anomalies.length} />

      {/* Integrity Scan */}
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

      {/* Tier 2: Filter bar */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-2" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Container, seal, booking, vessel…"
            className="pl-7 pr-3 py-1.5 rounded-lg bg-white/[.04] border border-white/10 text-[12px] text-text-0 placeholder:text-text-2 outline-none focus:border-white/25"
            style={{ width: 260 }}
          />
        </div>

        <span className="text-[9px] text-text-2 font-mono uppercase tracking-widest mr-0.5">Loc:</span>
        <Chip on={yard === ''} onClick={() => setYard('')}>All</Chip>
        {YARD_STATES.map(st => (
          <Chip key={st} on={yard === st} color={YARD_COLOR[st]}
            onClick={() => setYard(yard === st ? '' : st)}>
            {st.toUpperCase()}
          </Chip>
        ))}

        <span className="w-px h-5 bg-white/10 mx-1" />

        <span className="text-[9px] text-text-2 font-mono uppercase tracking-widest mr-0.5">Dir:</span>
        <Chip on={direction === ''} onClick={() => setDirection('')}>All</Chip>
        <Chip on={direction === 'OB'} color="#ff7a00" onClick={() => setDirection(direction === 'OB' ? '' : 'OB')}>OB</Chip>
        <Chip on={direction === 'IB'} color="#37e6ff" onClick={() => setDirection(direction === 'IB' ? '' : 'IB')}>IB</Chip>

        <span className="w-px h-5 bg-white/10 mx-1" />

        <div className="relative">
          <Chip on={!!stageFilter} color={stageFilter ? STAGE_COLOR[stageFilter] : undefined}
            onClick={() => setShowStageFilter(v => !v)}>
            {stageFilter ? stageFilter.replace(/_/g, ' ').toUpperCase() : 'STAGE ▾'}
          </Chip>
          {showStageFilter && (
            <div className="absolute top-full left-0 mt-1 z-30 rounded-lg py-1 min-w-[140px]"
              style={{ background: '#1a1f2b', border: '1px solid rgba(255,255,255,.15)', boxShadow: '0 8px 32px rgba(0,0,0,.5)' }}>
              <button onClick={() => { setStageFilter(''); setShowStageFilter(false); }}
                className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-white/[.06] cursor-pointer text-text-2">
                All stages
              </button>
              {CONTAINER_STAGES.map(s => (
                <button key={s.id} onClick={() => { setStageFilter(stageFilter === s.id ? '' : s.id); setShowStageFilter(false); }}
                  className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-white/[.06] cursor-pointer flex items-center gap-2"
                  style={{ color: s.color }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </div>

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
          <span className="text-[11px] text-text-2 font-mono whitespace-nowrap">
            {visibleRows.length}{total > visibleRows.length ? ` of ${total}` : ''} containers · {sortedGroups.length} {sortedGroups.length === 1 ? 'booking' : 'bookings'}
          </span>
        </span>
      </div>

      <ActiveFilters filters={activeFilters} onClear={clearFilter} />

      {/* Tier 3: The sheet */}
      {mode === 'grouped' ? (
        <div style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto' }}>
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
        <FlatSheet
          rows={visibleRows}
          byContainer={byContainer}
          onToggleInvoiced={toggleInvoiced}
          busy={update.isPending}
          sort={sort}
          onSort={toggleSort}
        />
      )}

      {visibleRows.length === 0 && (
        <div className="py-14 text-center text-[12px] text-text-2">
          {activeFilters.length > 0
            ? 'No containers match the active filters.'
            : severityFilter === 'all'
              ? 'No containers match. Containers appear here once a booking has them.'
              : `No ${SEVERITY[severityFilter].label.toLowerCase()} findings on the containers currently shown.`}
        </div>
      )}
    </div>
  );
}

// ─── Flat Sheet ─────────────────────────────────────────────────────────────

function FlatSheet({ rows, byContainer, onToggleInvoiced, busy, sort, onSort }: {
  rows: Row[];
  byContainer: Map<string, Anomaly[]>;
  onToggleInvoiced: (r: Row) => void;
  busy: boolean;
  sort: SortState | null;
  onSort: (key: string) => void;
}) {
  return (
    <div className="rounded-xl border border-white/10 overflow-x-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
      <table className="border-collapse" style={{ minWidth: FLAT_COLS.reduce((a, c) => a + c.w, 0) }}>
        <thead className="sticky top-0 z-10">
          <tr>
            {FLAT_COLS.map(c => (
              <th key={c.key}
                onClick={() => onSort(c.key)}
                className="text-left px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-text-2 whitespace-nowrap cursor-pointer select-none hover:text-text-0 transition-colors"
                style={{ width: c.w, minWidth: c.w, background: '#12161d', borderBottom: '1px solid rgba(255,255,255,.14)' }}>
                <span className="inline-flex items-center gap-1">
                  {c.label}
                  <SortIcon col={c.key} sort={sort} />
                </span>
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
