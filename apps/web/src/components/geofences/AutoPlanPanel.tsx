import { useState } from 'react';
import { api } from '../../lib/api.js';
import {
  Wand2, Loader2, Check, AlertTriangle, ShieldAlert, Clock, Ruler, Navigation, Flag,
} from 'lucide-react';

export interface Exposure {
  zone_id: string | null; name: string | null; risk_level: string;
  zone_type: string | null; km_inside: number; nearest_km: number | null;
}
export interface Candidate {
  index: number; provider: string; distance_km: number; duration_min: number;
  risk_score: number; blocked: boolean; worst_risk: string | null;
  exposed_km: number; waypoint_count: number; exposures: Exposure[];
}
export interface AutoPlanResult {
  origin: { name: string; resolved: string; lat: number; lng: number };
  destination: { name: string; resolved: string; lat: number; lng: number };
  chosen: Candidate;
  candidates: Candidate[];
  zones_considered: number;
  all_blocked: boolean;
  routing_provider: string;
  waypoint_count: number;
  width_km: number;
}

const RISK_TEXT: Record<string, string> = {
  no_go: 'text-red-400', critical: 'text-red-400', high: 'text-orange-400',
  medium: 'text-yellow-400', low: 'text-lime-400',
};

function fmtDrive(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  return `${Math.floor(min / 60)}h ${Math.round(min % 60)}m`;
}

type ApiError = { response?: { status?: number; data?: { error?: string; missing?: unknown } }; message?: string };

/**
 * One-tap corridor planning. The convoy already records where it is going, so
 * the operator picks nothing: the system geocodes those endpoints, asks the
 * router for every road between them, scores each against live risk intel, and
 * takes the safest viable one — then shows its working.
 */
export default function AutoPlanPanel({ convoyId, origin, destination, widthKm, onPlanned }: {
  convoyId: string;
  origin: string | null;
  destination: string | null;
  widthKm: number;
  onPlanned: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AutoPlanResult | null>(null);
  const [showAll, setShowAll] = useState(false);

  const ready = !!origin && !!destination;

  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await api.post<{ data: AutoPlanResult }>(
        `/convoys/${convoyId}/corridor/auto`, { width_km: widthKm },
      );
      setResult(r.data.data);
      onPlanned();
    } catch (e) {
      const err = e as ApiError;
      setError(err?.response?.data?.error || err?.message || 'Auto-planning failed.');
    } finally { setBusy(false); }
  };

  const rejected = (result?.candidates ?? []).filter(c => c.index !== result?.chosen.index);

  return (
    <div className="overflow-hidden rounded-xl border border-violet-500/25 bg-gradient-to-b from-violet-500/[0.07] to-transparent">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3 text-sm font-semibold text-white">
        <Wand2 size={15} className="text-violet-400" /> Auto-plan from convoy details
      </div>

      <div className="p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <Endpoint Icon={Navigation} label="Origin" value={origin} />
          <Endpoint Icon={Flag} label="Destination" value={destination} />
        </div>

        {!ready && (
          <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-xs leading-relaxed text-amber-200/80">
            This convoy has no {!origin && !destination ? 'origin or destination' : !origin ? 'origin' : 'destination'} set.
            Add it on the convoy, or use manual planning below.
          </p>
        )}

        <button onClick={run} disabled={!ready || busy}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
          {busy ? 'Comparing roads…' : 'Plan the safest route'}
        </button>
        {ready && !busy && !result && (
          <p className="mt-2 text-[11px] text-neutral-500">
            Routes the real road, weighs every alternative against live risk zones, and keeps the safest.
          </p>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/[0.06] p-3">
            <p className="flex items-start gap-1.5 text-xs font-semibold text-red-300">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
            </p>
          </div>
        )}

        {result && (
          <div className="mt-4 space-y-3">
            {result.all_blocked && (
              <p className="flex items-start gap-1.5 rounded-lg border border-red-500/30 bg-red-500/[0.08] px-3 py-2 text-xs font-semibold text-red-300">
                <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                Every available road crosses a no-go zone. The corridor is saved so you can still track it — treat this route as unsafe.
              </p>
            )}

            <div className={`rounded-lg border p-3 ${result.chosen.blocked
              ? 'border-red-500/30 bg-red-500/[0.06]' : 'border-emerald-500/25 bg-emerald-500/[0.06]'}`}>
              <p className={`flex items-center gap-1.5 text-xs font-semibold ${result.chosen.blocked ? 'text-red-300' : 'text-emerald-300'}`}>
                <Check size={13} /> Corridor saved · {result.origin.resolved} → {result.destination.resolved}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Pill Icon={Ruler} value={`${result.chosen.distance_km.toFixed(0)} km`} label="distance" />
                <Pill Icon={Clock} value={fmtDrive(result.chosen.duration_min)} label="drive" />
                <Pill Icon={ShieldAlert} value={result.chosen.exposed_km > 0 ? `${result.chosen.exposed_km} km` : 'clear'} label="risk exposure" />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-neutral-400">
                Chose this from {result.candidates.length} road{result.candidates.length === 1 ? '' : 's'} against{' '}
                {result.zones_considered} active risk zone{result.zones_considered === 1 ? '' : 's'}.
              </p>
            </div>

            {result.chosen.exposures.length > 0 && (
              <ul className="space-y-1.5">
                {result.chosen.exposures.map((x, i) => (
                  <li key={`${x.zone_id}-${i}`} className="flex items-center gap-2 rounded-lg border border-white/[0.07] bg-black/30 px-3 py-2 text-xs">
                    <ShieldAlert size={12} className={RISK_TEXT[x.risk_level] ?? 'text-neutral-400'} />
                    <span className="min-w-0 flex-1 truncate text-neutral-300">{x.name ?? 'Risk zone'}</span>
                    <span className={`font-semibold ${RISK_TEXT[x.risk_level] ?? 'text-neutral-400'}`}>
                      {x.risk_level.replace('_', '-')}
                    </span>
                    <span className="font-mono text-neutral-500">{x.km_inside} km</span>
                  </li>
                ))}
              </ul>
            )}

            {rejected.length > 0 && (
              <div>
                <button onClick={() => setShowAll(s => !s)}
                  className="text-[11px] font-semibold text-neutral-400 underline-offset-2 hover:text-white hover:underline">
                  {showAll ? 'Hide' : 'Show'} the {rejected.length} road{rejected.length === 1 ? '' : 's'} it rejected
                </button>
                {showAll && (
                  <ul className="mt-2 space-y-1.5">
                    {rejected.map(c => (
                      <li key={c.index} className="rounded-lg border border-white/[0.07] bg-black/30 px-3 py-2 text-xs">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-neutral-400">
                          <span className="font-mono text-neutral-300">{c.distance_km.toFixed(0)} km</span>
                          <span>{fmtDrive(c.duration_min)}</span>
                          {c.blocked
                            ? <span className="font-semibold text-red-400">crosses a no-go zone</span>
                            : c.exposed_km > 0
                              ? <span className={RISK_TEXT[c.worst_risk ?? 'medium'] ?? 'text-neutral-400'}>
                                  {c.exposed_km} km through {c.worst_risk?.replace('_', '-')} risk
                                </span>
                              : <span className="text-neutral-500">clear, but slower</span>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Endpoint({ Icon, label, value }: { Icon: typeof Navigation; label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-white/[0.07] bg-black/30 px-3 py-2">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        <Icon size={11} /> {label}
      </p>
      <p className={`mt-0.5 truncate text-sm ${value ? 'text-white' : 'text-neutral-600'}`}>
        {value ?? 'not set on convoy'}
      </p>
    </div>
  );
}

function Pill({ Icon, value, label }: { Icon: typeof Clock; value: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-neutral-300">
      <Icon size={11} className="text-neutral-500" />
      <span className="font-mono font-semibold">{value}</span>
      <span className="text-neutral-500">{label}</span>
    </span>
  );
}
