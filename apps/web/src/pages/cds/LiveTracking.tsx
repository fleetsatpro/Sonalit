/**
 * CDS Live Operations — the e-lock tracking board.
 *
 * This is the screen that replaces opening the Securisat portal: every solar
 * e-lock on the fleet, its live position on the map, its battery / signal /
 * tamper state, and the container it's securing — all fed straight from the
 * Securisat telemetry pipeline (backend/src/utils/telemetry). It updates in
 * real time off cds.lock.telemetry events via useCDSRealtime, mounted once by
 * the CDS shell.
 */
import { AlertTriangle, BatteryLow, MapPin, Radio, Satellite, ShieldCheck, Signal } from 'lucide-react';
import { useMemo, useState } from 'react';

import { LoadingState } from './CDSDashboard.js';
import { useLocksLive, useLockTrail } from './hooks.js';
import { LockTrackingMap, lockHealth, type LockPoint } from './LockTrackingMap.js';

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null || v === '' ? '' : String(v));

function toPoint(r: Row): LockPoint {
  return {
    id: s(r['id']),
    serial: s(r['serial']),
    lat: r['lat'] == null ? null : Number(r['lat']),
    lng: r['lng'] == null ? null : Number(r['lng']),
    battery_level: r['battery_level'] == null ? null : Number(r['battery_level']),
    signal_strength: r['signal_strength'] == null ? null : s(r['signal_strength']),
    tamper_detected: Boolean(r['tamper_detected']),
    status: s(r['status']),
    container_number: s(r['container_number']) || null,
    booking_number: s(r['booking_number']) || null,
  };
}

function ago(iso: unknown): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(String(iso)).getTime();
  if (Number.isNaN(ms)) return 'never';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

const HEALTH_META = {
  tamper: { color: '#ff5c5c', label: 'TAMPER' },
  warn: { color: '#ffb020', label: 'LOW / WARN' },
  stale: { color: '#64748b', label: 'OFFLINE' },
  ok: { color: '#33d6a8', label: 'HEALTHY' },
} as const;

function BatteryPill({ level }: { level: number | null }) {
  if (level == null) return <span className="text-text-2 text-[11px] font-mono">—</span>;
  const color = level <= 20 ? '#ff5c5c' : level <= 40 ? '#ffb020' : '#33d6a8';
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-mono" style={{ color }}>
      {level <= 20 && <BatteryLow size={12} />}{level}%
    </span>
  );
}

function SignalPill({ strength }: { strength: string | null }) {
  const color = strength === 'strong' ? '#33d6a8' : strength === 'medium' ? '#ffb020'
    : strength === 'weak' ? '#ff7a00' : '#64748b';
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase" style={{ color }}>
      <Signal size={11} /> {strength || 'offline'}
    </span>
  );
}

export function LiveTrackingView() {
  const { data, isLoading } = useLocksLive();
  const [selected, setSelected] = useState<string | null>(null);
  const [satellite, setSatellite] = useState(false);
  const { data: trailData } = useLockTrail(selected);

  const rows = useMemo(() => (data?.data ?? []) as Row[], [data]);
  const points = useMemo(() => rows.map(toPoint), [rows]);
  const trail = useMemo(
    () => (trailData?.data ?? []).map(p => ({ lat: Number(p.lat), lng: Number(p.lng) })),
    [trailData],
  );

  const counts = useMemo(() => {
    const c = { tamper: 0, warn: 0, stale: 0, ok: 0 };
    for (const p of points) c[lockHealth(p)]++;
    return c;
  }, [points]);

  const tracked = points.filter(p => p.lat != null && p.lng != null).length;

  if (isLoading) return <LoadingState />;

  return (
    <div className="p-4 h-full flex flex-col">
      {/* Fleet health strip */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-[11px] font-mono uppercase tracking-widest text-text-2 flex items-center gap-1.5">
          <Radio size={13} className="text-cds-teal" /> Live e-lock tracking
        </span>
        <span className="text-[11px] font-mono text-text-2">{tracked} of {points.length} locks reporting position</span>
        <span className="ml-auto flex items-center gap-1.5">
          {(['tamper', 'warn', 'stale', 'ok'] as const).map(h => (
            counts[h] > 0 && (
              <span key={h} className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide"
                style={{ color: HEALTH_META[h].color, background: `${HEALTH_META[h].color}1a`, border: `1px solid ${HEALTH_META[h].color}40` }}>
                {h === 'tamper' && <AlertTriangle size={11} />}
                {h === 'ok' && <ShieldCheck size={11} />}
                {counts[h]} {HEALTH_META[h].label}
              </span>
            )
          ))}
          <button onClick={() => setSatellite(v => !v)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-white/10 cursor-pointer transition-colors"
            style={satellite ? { color: '#37e6ff', background: 'rgba(55,230,255,.12)' } : { color: '#94a3b8' }}>
            <Satellite size={12} /> {satellite ? 'Satellite' : 'Street'}
          </button>
        </span>
      </div>

      <div className="flex-1 grid gap-3 min-h-0" style={{ gridTemplateColumns: 'minmax(0,1fr) 340px' }}>
        {/* Map */}
        <div className="rounded-xl border border-white/[.08] overflow-hidden min-h-[420px] relative">
          <LockTrackingMap
            locks={points}
            selectedId={selected}
            trail={selected ? trail : []}
            satellite={satellite}
            onSelect={setSelected}
          />
          {tracked === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center text-text-2 text-[12px] font-mono bg-ink-0/70 px-4 py-3 rounded-xl">
                No locks are reporting a position yet.<br />
                Positions appear here as the Securisat feed delivers them.
              </div>
            </div>
          )}
        </div>

        {/* Live list */}
        <div className="rounded-xl border border-white/[.08] bg-white/[.02] overflow-y-auto">
          {points.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-text-2 font-mono">No e-locks provisioned yet.</div>
          ) : (
            <div className="divide-y divide-white/[.05]">
              {points.map(p => {
                const health = lockHealth(p);
                const meta = HEALTH_META[health];
                const r = rows.find(x => s(x['id']) === p.id) ?? {};
                const on = selected === p.id;
                return (
                  <button key={p.id} onClick={() => setSelected(on ? null : p.id)}
                    className="w-full text-left px-3 py-2.5 flex flex-col gap-1 cursor-pointer transition-colors hover:bg-white/[.03]"
                    style={on ? { background: 'rgba(255,255,255,.05)', borderLeft: `2px solid ${meta.color}` }
                      : { borderLeft: '2px solid transparent' }}>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full flex-none" style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}` }} />
                      <span className="text-[12.5px] font-mono font-bold text-text-0">{p.serial}</span>
                      {p.tamper_detected && (
                        <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                          style={{ color: '#ff5c5c', background: 'rgba(255,92,92,.15)' }}>
                          {s(r['tamper_status']).replace(/_/g, ' ') || 'tamper'}
                        </span>
                      )}
                      <span className="ml-auto"><BatteryPill level={p.battery_level} /></span>
                    </div>
                    <div className="flex items-center gap-2 pl-4 flex-wrap">
                      <SignalPill strength={p.signal_strength} />
                      {r['solar_charging'] ? <span className="text-[10px] font-mono text-cds-amber">☀ charging</span> : null}
                      <span className="text-[10px] font-mono text-text-2 flex items-center gap-1">
                        <MapPin size={10} /> {ago(r['last_telemetry_at'])}
                      </span>
                    </div>
                    {(p.container_number || p.booking_number) && (
                      <div className="pl-4 text-[10.5px] font-mono text-text-2 truncate">
                        {p.container_number || '—'}{p.booking_number ? ` · ${p.booking_number}` : ''}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
