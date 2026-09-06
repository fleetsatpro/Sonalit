/**
 * One booking, as a self-contained block on the manifest.
 *
 * The old manifest was a single flat table: every container of every booking
 * stacked into one list, identified only by a repeated reference column. On a
 * sheet with four bookings that reads as chaos, and the thing a controller
 * actually works with — "this booking, these boxes, how far along" — had to be
 * reassembled by eye every time.
 *
 * So the booking gets a header that answers that question outright: the
 * reference broken into its parts, the route, the vessel, how many containers
 * and where they are in the lifecycle, and whether the integrity scan found
 * anything wrong inside it. The dense operational sheet is unchanged and sits
 * underneath, one booking at a time.
 */
import { AlertTriangle, ChevronDown, ChevronRight, Check } from 'lucide-react';

import {
  CONTAINER_COLS, DIRECTION_META, MONO, SEVERITY, STAGE_COLOR, YARD_COLOR,
  monthName, parseBookingRef, str, worstSeverity,
  type Anomaly, type Row, type Severity,
} from './manifestShared.js';

export interface BookingGroupData {
  booking_id: string;
  booking_number: string;
  vessel: string;
  customer_name: string;
  file_reference: string;
  carrier_reference: string;
  controller: string;
  commodity: string;
  pickup_location: string;
  delivery_location: string;
  direction: string;
  country_code: string;
  eta: string;
  rows: Row[];
}

/**
 * The reference, rendered as the structured thing it is.
 *
 * TZ_26_08_OB_00123910 is five facts, not one string. Dimming the separators
 * and lifting the running number lets someone scanning a column find the
 * booking they want without reading twenty characters each time. A legacy
 * `BK-…` reference has no structure to show, so it renders plainly and is
 * marked as legacy rather than silently looking broken.
 */
function BookingRefBadge({ value }: { value: string }) {
  const ref = parseBookingRef(value);
  if (!ref) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="font-mono text-[15px] font-bold tracking-tight text-text-1">{value || '—'}</span>
        <span className="text-[9px] font-mono uppercase tracking-widest text-text-2 px-1.5 py-0.5 rounded border border-white/10">
          legacy ref
        </span>
      </span>
    );
  }
  const dir = DIRECTION_META[ref.direction] ?? DIRECTION_META['OB'];
  const sep = <span className="text-white/20 mx-[1px]">_</span>;
  return (
    <span className="inline-flex items-baseline font-mono text-[15px] font-bold tracking-tight">
      <span style={{ color: dir?.color }}>{ref.country}</span>{sep}
      <span className="text-text-2">{ref.yy}</span>{sep}
      <span className="text-text-2">{ref.mm}</span>{sep}
      <span style={{ color: dir?.color }}>{ref.direction}</span>{sep}
      <span className="text-text-0">{ref.sequence}</span>
    </span>
  );
}

/** Where this booking's containers are, as one glanceable bar. */
function StageRail({ rows }: { rows: Row[] }) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = str(r['status']) || 'pending';
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const total = rows.length || 1;
  const order = ['pending', 'assigned', 'in_transit', 'at_port', 'delivered', 'completed'];
  const present = order.filter(k => counts.has(k));

  return (
    <div className="flex items-center gap-2 min-w-[180px]">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden flex" style={{ background: 'rgba(255,255,255,.06)' }}>
        {present.map(k => {
          const color = STAGE_COLOR[k] ?? '#64748b';
          const pct = ((counts.get(k) ?? 0) / total) * 100;
          return (
            <div key={k} title={`${counts.get(k)} ${k.replace(/_/g, ' ')}`}
              style={{ width: `${pct}%`, background: color, boxShadow: `0 0 8px -1px ${color}` }} />
          );
        })}
      </div>
      <span className="text-[10px] font-mono text-text-2 whitespace-nowrap">
        {/* Parenthesised: ?? binds looser than +, so `a ?? 0 + b` parses as
            `a ?? (0 + b)` and a booking with any delivered container reported
            only that count, silently dropping the completed ones. */}
        {(counts.get('delivered') ?? 0) + (counts.get('completed') ?? 0)}/{rows.length}
      </span>
    </div>
  );
}

function AnomalyBadge({ items }: { items: Anomaly[] }) {
  if (items.length === 0) {
    return (
      <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded"
        style={{ color: '#33d6a8', background: 'rgba(51,214,168,.1)', border: '1px solid rgba(51,214,168,.28)' }}>
        clean
      </span>
    );
  }
  const worst = worstSeverity(items) as Severity;
  const c = SEVERITY[worst].color;
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded"
      style={{ color: c, background: `${c}1a`, border: `1px solid ${c}47` }}
      title={items.map(a => `${SEVERITY[a.severity].label}: ${a.title}`).join('\n')}>
      <AlertTriangle size={11} /> {items.length} {items.length === 1 ? 'issue' : 'issues'}
    </span>
  );
}

function StagePill({ value }: { value: string }) {
  const v = value || 'pending';
  const color = STAGE_COLOR[v] ?? '#64748b';
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide whitespace-nowrap"
      style={{ color, background: `${color}1f`, border: `1px solid ${color}3d` }}>
      {v.replace(/_/g, ' ')}
    </span>
  );
}

function YardPill({ value }: { value: string }) {
  const v = value || 'yard';
  const color = YARD_COLOR[v] ?? '#94a3b8';
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase tracking-wide"
      style={{ color, background: `${color}1f`, border: `1px solid ${color}3d` }}>
      {v}
    </span>
  );
}

export function BookingGroup({
  group, anomaliesByContainer, groupAnomalies, open, onToggle, onToggleInvoiced, busy,
}: {
  group: BookingGroupData;
  anomaliesByContainer: Map<string, Anomaly[]>;
  groupAnomalies: Anomaly[];
  open: boolean;
  onToggle: () => void;
  onToggleInvoiced: (r: Row) => void;
  busy: boolean;
}) {
  const ref = parseBookingRef(group.booking_number);
  const dir = DIRECTION_META[ref?.direction ?? group.direction] ?? DIRECTION_META['OB'];
  const accent = dir?.color ?? '#ff7a00';
  const worst = worstSeverity(groupAnomalies);
  const railColor = worst ? SEVERITY[worst].color : accent;

  const route = [group.pickup_location, group.delivery_location].filter(Boolean).join(' → ');

  return (
    <section className="rounded-xl overflow-hidden mb-3"
      style={{ border: '1px solid rgba(255,255,255,.09)', background: 'rgba(255,255,255,.015)' }}>
      {/* Header. The 3px rail on the left carries direction normally and
          escalates to the worst severity found inside — so a booking with a
          problem is identifiable from the edge of the screen, collapsed. */}
      <button
        onClick={onToggle}
        className="w-full text-left flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors hover:bg-white/[.03]"
        style={{
          borderLeft: `3px solid ${railColor}`,
          background: `linear-gradient(90deg, ${railColor}0f, transparent 40%)`,
        }}
      >
        <span className="text-text-2 flex-shrink-0">
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>

        <span className="flex flex-col gap-0.5 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <BookingRefBadge value={group.booking_number} />
            <span className="text-[9.5px] font-mono uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{ color: accent, background: `${accent}17`, border: `1px solid ${accent}3d` }}>
              {dir?.label}
            </span>
            {ref && (
              <span className="text-[10px] font-mono text-text-2">
                {monthName(ref.mm)} 20{ref.yy}
              </span>
            )}
          </span>
          {group.carrier_reference && (
            <span className="text-[9px] font-mono text-text-2 opacity-50">
              carrier {group.carrier_reference}
            </span>
          )}
          <span className="text-[11px] text-text-2 truncate">
            {[group.customer_name, group.vessel, route].filter(Boolean).join(' · ') || 'No vessel or route recorded'}
          </span>
        </span>

        <span className="ml-auto flex items-center gap-3 flex-shrink-0">
          <StageRail rows={group.rows} />
          <span className="text-[11px] font-mono text-text-1 whitespace-nowrap">
            {group.rows.length} {group.rows.length === 1 ? 'ctn' : 'ctns'}
          </span>
          {group.eta && (
            <span className="text-[10px] font-mono text-text-2 whitespace-nowrap px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)' }}>
              ETA {new Date(group.eta).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
            </span>
          )}
          <AnomalyBadge items={groupAnomalies} />
        </span>
      </button>

      {open && (
        <div className="overflow-x-auto" style={{ borderTop: '1px solid rgba(255,255,255,.07)' }}>
          <table className="border-collapse w-full"
            style={{ minWidth: CONTAINER_COLS.reduce((a, c) => a + c.w, 0) + 26 }}>
            <thead>
              <tr>
                <th style={{ width: 26, background: '#10141a', borderBottom: '1px solid rgba(255,255,255,.1)' }} />
                {CONTAINER_COLS.map(c => (
                  <th key={c.key}
                    className="text-left px-2 py-1.5 text-[9.5px] font-bold uppercase tracking-wide text-text-2 whitespace-nowrap"
                    style={{ width: c.w, minWidth: c.w, background: '#10141a', borderBottom: '1px solid rgba(255,255,255,.1)' }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {group.rows.map((r, i) => {
                const issues = anomaliesByContainer.get(String(r['id'])) ?? [];
                const sev = worstSeverity(issues);
                const sevColor = sev ? SEVERITY[sev].color : null;
                return (
                  <tr key={String(r['id'] ?? i)} className="transition-colors hover:bg-white/[.045]"
                    style={{
                      borderBottom: '1px solid rgba(255,255,255,.05)',
                      background: sevColor ? `${sevColor}0d` : undefined,
                    }}>
                    {/* A marker column rather than tinting the whole row hard:
                        the sheet still has to be readable, and 19 columns of
                        wash makes the actual values harder to scan. */}
                    <td className="px-0" style={{ width: 26 }}>
                      {sevColor && (
                        <span className="flex items-center justify-center" title={issues.map(a => a.title).join('\n')}>
                          <AlertTriangle size={12} color={sevColor} />
                        </span>
                      )}
                    </td>
                    {CONTAINER_COLS.map(c => {
                      if (c.key === 'yard_status') {
                        return <td key={c.key} className="px-2 py-1.5"><YardPill value={str(r['yard_status'])} /></td>;
                      }
                      if (c.key === 'status') {
                        return <td key={c.key} className="px-2 py-1.5"><StagePill value={str(r['status'])} /></td>;
                      }
                      if (c.key === 'invoiced') {
                        const on = Boolean(r['invoiced']);
                        return (
                          <td key={c.key} className="px-2 py-1.5">
                            <button onClick={(e) => { e.stopPropagation(); onToggleInvoiced(r); }} disabled={busy}
                              title={on ? 'Invoiced — click to clear' : 'Not invoiced — click to mark'}
                              className="w-4 h-4 rounded flex items-center justify-center transition-colors cursor-pointer"
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
                      const flagged = issues.some(a =>
                        (a.code.includes('container') && c.key === 'container_number') ||
                        (a.code.includes('seal') && (c.key === 'seal_number' || c.key === 'seal_number_2')) ||
                        (a.code.includes('lock') && c.key === 'lock_number') ||
                        (a.code.includes('truck') && c.key === 'horse_reg'));
                      return (
                        <td key={c.key}
                          className={`px-2 py-1.5 text-[11.5px] whitespace-nowrap ${MONO.has(c.key) ? 'font-mono' : ''} ${value ? 'text-text-0' : 'text-text-2'}`}
                          style={flagged && sevColor
                            ? { color: sevColor, textDecoration: 'underline', textDecorationStyle: 'wavy', textUnderlineOffset: 3 }
                            : undefined}
                          title={value || undefined}>
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
      )}
    </section>
  );
}
