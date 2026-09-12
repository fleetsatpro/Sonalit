import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { AlertRow, GeofenceEvent } from './types.js';
import { ALERT_TYPE_LABEL, EVENT_LABEL } from './types.js';

interface TrendRow { key: string; label: string; now: number; prev: number }

function bucket(items: { created_at: string }[], keyOf: (i: any) => string, labelOf: (k: string) => string): TrendRow[] {
  const nowMs = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const rows = new Map<string, TrendRow>();
  for (const item of items) {
    const key = keyOf(item);
    if (!rows.has(key)) rows.set(key, { key, label: labelOf(key), now: 0, prev: 0 });
    const age = nowMs - new Date(item.created_at).getTime();
    const row = rows.get(key)!;
    if (age <= day) row.now += 1;
    else if (age <= day * 2) row.prev += 1;
  }
  return [...rows.values()].filter(r => r.now > 0 || r.prev > 0).sort((a, b) => b.now - a.now);
}

// Real 24h-vs-prior-24h deltas computed from actual alerts + geofence events —
// no fabricated probabilities, just what already happened.
export default function TrendsPanel({ alerts, events }: { alerts: AlertRow[]; events: GeofenceEvent[] }) {
  const alertTrends = useMemo(() => bucket(alerts, a => (a as AlertRow).type, k => ALERT_TYPE_LABEL[k] ?? k), [alerts]);
  const eventTrends = useMemo(() => bucket(events, e => (e as GeofenceEvent).event_type, k => EVENT_LABEL[k] ?? k), [events]);
  const rows = [...alertTrends, ...eventTrends];
  const max = Math.max(1, ...rows.map(r => Math.max(r.now, r.prev)));

  if (rows.length === 0) {
    return <div className="text-xs text-gray-400 font-medium bg-gray-800 rounded-lg p-3">No alert or event activity in the last 48 hours.</div>;
  }

  return (
    <div className="space-y-2">
      {rows.map(r => {
        const trend = r.now > r.prev ? 'up' : r.now < r.prev ? 'down' : 'flat';
        const color = trend === 'up' ? 'text-red-400' : trend === 'down' ? 'text-green-400' : 'text-gray-400';
        return (
          <div key={r.key} className="bg-gray-800 rounded-lg px-3 py-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-white">{r.label}</span>
              <span className={`flex items-center gap-1 text-xs font-bold ${color}`}>
                {trend === 'up' ? <TrendingUp size={12} /> : trend === 'down' ? <TrendingDown size={12} /> : <Minus size={12} />}
                {r.now} today vs {r.prev} prior 24h
              </span>
            </div>
            <div className="h-1.5 bg-gray-900 rounded-full overflow-hidden">
              <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${(r.now / max) * 100}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
