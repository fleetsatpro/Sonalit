import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import {
  Radar, Route as RouteIcon, ChevronDown, Loader2, Truck, Clock, Navigation,
  MapPinned, Gauge, Flag, Signal, AlertTriangle, ShieldAlert,
} from 'lucide-react';
import CorridorPlanner from '../components/geofences/CorridorPlanner.js';
import CorridorGlobe from '../components/geofences/CorridorGlobe.js';
import AutoPlanPanel from '../components/geofences/AutoPlanPanel.js';

interface ConvoyRow { id: string; name: string; status: string }
interface ConvoyDetail { id: string; route_origin: string | null; route_destination: string | null }
interface Member {
  id: string; name: string; officer_name?: string | null;
  lat: number | null; lng: number | null; last_fix_at: string | null;
  status: string; severity: string;
  cross_track_km?: number | null; schedule_delta_km?: number | null;
  schedule_delta_min?: number | null; along_km?: number | null;
  expected_along_km?: number | null; route_len_km?: number | null;
}
interface RiskZone {
  zone_id: string | null; name: string | null; risk_level: string;
  zone_type: string | null; km_inside: number; nearest_km: number | null;
  lat: number; lng: number; radius_km: number;
}
interface CorridorResp {
  convoy: {
    id: string; name: string; status: string; departure_time: string | null;
    route_origin: string | null; route_destination: string | null;
  };
  config: { avg_speed_kmh: number; corridor_km: number; schedule_tol_km: number; started_at: string | null; schedule_known: boolean };
  route: { lat: number; lng: number; name: string | null; seq: number }[];
  members: Member[];
  summary: Record<string, number>;
  risk: { zones: RiskZone[]; exposed_km: number; worst: string | null; blocked: boolean };
  evaluated_at: string;
}

const OFF = { label: 'Off route', ring: 'border-red-500/50', text: 'text-red-400', bg: 'bg-red-500', glow: 'shadow-[0_0_12px_-2px_rgba(239,68,68,0.6)]' };
const STATUS: Record<string, { label: string; ring: string; text: string; bg: string; glow: string }> = {
  off_route: OFF,
  behind: { label: 'Behind schedule', ring: 'border-amber-500/50', text: 'text-amber-400', bg: 'bg-amber-500', glow: 'shadow-[0_0_12px_-2px_rgba(245,158,11,0.6)]' },
  ahead: { label: 'Ahead of escort', ring: 'border-cyan-500/50', text: 'text-cyan-400', bg: 'bg-cyan-500', glow: 'shadow-[0_0_12px_-2px_rgba(34,211,238,0.6)]' },
  on_track: { label: 'On track', ring: 'border-emerald-500/40', text: 'text-emerald-400', bg: 'bg-emerald-500', glow: '' },
  no_fix: { label: 'No GPS fix', ring: 'border-white/10', text: 'text-neutral-500', bg: 'bg-neutral-600', glow: '' },
};

// Worst-first: an off-route truck must never be below an on-track one.
const RANK: Record<string, number> = { off_route: 0, behind: 1, ahead: 2, no_fix: 3, on_track: 4 };

const RISK_CHIP: Record<string, string> = {
  no_go:    'border-red-500/40 bg-red-500/10 text-red-300',
  critical: 'border-red-500/40 bg-red-500/10 text-red-300',
  high:     'border-orange-500/40 bg-orange-500/10 text-orange-300',
  medium:   'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
  low:      'border-lime-500/40 bg-lime-500/10 text-lime-300',
};

const CHIPS = [
  { key: 'off_route', label: 'Off route', cls: 'text-red-400' },
  { key: 'behind', label: 'Behind', cls: 'text-amber-400' },
  { key: 'ahead', label: 'Ahead', cls: 'text-cyan-400' },
  { key: 'on_track', label: 'On track', cls: 'text-emerald-400' },
  { key: 'no_fix', label: 'No fix', cls: 'text-neutral-500' },
];

function schedText(min?: number | null): string {
  if (min == null || min === 0) return 'on schedule';
  const a = Math.abs(min);
  const t = a >= 60 ? `${Math.floor(a / 60)}h ${a % 60}m` : `${a} min`;
  return min < 0 ? `${t} behind` : `${t} ahead`;
}

function fixAge(iso: string | null): string {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(m)) return 'never';
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

/**
 * The 4th dimension, drawn: how far along the route the truck actually is
 * (filled bar) against where the schedule says it should be by now (marker).
 * The gap between them is the whole point of the page.
 */
function ProgressRail({ m, bg }: { m: Member; bg: string }) {
  const len = m.route_len_km ?? 0;
  if (!(len > 0)) return null;
  const pct = (v: number) => Math.max(0, Math.min(100, (v / len) * 100));
  const actual = pct(m.along_km ?? 0);
  const expected = pct(m.expected_along_km ?? 0);

  return (
    <div className="mt-3">
      <div className="relative h-1.5 w-full overflow-visible rounded-full bg-white/[0.07]">
        <div className={`h-full rounded-full ${bg} opacity-80`} style={{ width: `${actual}%` }} />
        <span
          className="absolute -top-1 h-3.5 w-0.5 rounded bg-white/70"
          style={{ left: `calc(${expected}% - 1px)` }}
          title="where the schedule says it should be"
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] font-mono text-neutral-600">
        <span>{(m.along_km ?? 0).toFixed(0)} km</span>
        <span className="text-neutral-500">expected {(m.expected_along_km ?? 0).toFixed(0)} km</span>
        <span>{len.toFixed(0)} km</span>
      </div>
    </div>
  );
}

function Stat({ Icon, label, value, tone = 'text-neutral-200' }: {
  Icon: typeof Gauge; label: string; value: string; tone?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
      <Icon size={15} className="shrink-0 text-neutral-500" />
      <div className="min-w-0">
        <p className="truncate text-[10px] uppercase tracking-wide text-neutral-500">{label}</p>
        <p className={`truncate text-sm font-semibold ${tone}`}>{value}</p>
      </div>
    </div>
  );
}

export default function Corridor() {
  const [convoyId, setConvoyId] = useState<string>('');
  const [planning, setPlanning] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: convoys } = useQuery<ConvoyRow[]>({
    queryKey: ['convoys-for-corridor'],
    queryFn: async () => (await api.get<{ data: ConvoyRow[] }>('/convoys?limit=100')).data.data ?? [],
    staleTime: 30_000,
  });

  const { data, isFetching, error } = useQuery<CorridorResp>({
    queryKey: ['convoy-corridor', convoyId],
    enabled: !!convoyId,
    refetchInterval: 15_000,
    retry: false,
    queryFn: async () => (await api.get<{ data: CorridorResp }>(`/convoys/${convoyId}/corridor`)).data.data,
  });

  // The convoy's own endpoints, fetched separately: the corridor call 422s
  // before a corridor exists, which is exactly when auto-planning is needed.
  const { data: convoyDetail } = useQuery<ConvoyDetail>({
    queryKey: ['convoy-endpoints', convoyId],
    enabled: !!convoyId,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => (await api.get<{ data: ConvoyDetail }>(`/convoys/${convoyId}`)).data.data,
  });

  const afterPlan = () => {
    queryClient.invalidateQueries({ queryKey: ['convoy-corridor', convoyId] });
    setPlanning(false);
  };

  const monitorable = (convoys ?? []).filter(c => c.status === 'active' || c.status === 'planned');
  const members = [...(data?.members ?? [])].sort(
    (a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.name.localeCompare(b.name),
  );
  const routeKm = data?.members?.[0]?.route_len_km ?? 0;
  const flagged = members.filter(m => m.status === 'off_route' || m.status === 'behind').length;

  return (
    <div className="mx-auto max-w-5xl p-4 sm:p-6">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="mb-5 flex items-start gap-3">
        <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-violet-500/25 bg-violet-500/10">
          <Radar size={19} className="text-violet-400" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">4D Geofence · Route Corridor</h1>
          <p className="mt-0.5 text-[13px] leading-snug text-neutral-400">
            The planned route swept over time — flags trucks that stray off-corridor, fall behind, stall, or outrun their escort.
          </p>
        </div>
        {data && (
          <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-white/10 bg-black/40 px-2.5 py-1 text-[11px] text-neutral-400 sm:inline-flex">
            <span className={`h-1.5 w-1.5 rounded-full bg-emerald-500 ${isFetching ? 'animate-pulse' : ''}`} />
            live · 15s
          </span>
        )}
        {isFetching && !data && <Loader2 size={16} className="mt-2 animate-spin text-neutral-500" />}
      </div>

      {/* ── Convoy picker ──────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <div className="relative inline-block">
          <select
            value={convoyId}
            onChange={e => { setConvoyId(e.target.value); setPlanning(false); }}
            className="appearance-none rounded-lg border border-white/10 bg-black/40 py-2 pl-3 pr-9 text-sm font-medium text-white outline-none focus:border-violet-500/50"
          >
            <option value="">Select a convoy…</option>
            {monitorable.map(c => <option key={c.id} value={c.id}>{c.name} · {c.status}</option>)}
          </select>
          <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500" />
        </div>
        {convoyId && (
          <button onClick={() => setPlanning(p => !p)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors ${planning
              ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'
              : 'border-white/10 bg-black/40 text-neutral-300 hover:border-white/20 hover:text-white'}`}>
            <MapPinned size={14} /> {data ? 'Update route' : 'Plan route'}
          </button>
        )}
        {flagged > 0 && (
          <span className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-3 py-2 text-sm font-semibold text-red-300 sm:ml-auto sm:w-auto">
            <AlertTriangle size={14} /> {flagged} needing attention
          </span>
        )}
      </div>

      {convoyId && planning && (
        <div className="mb-5 space-y-3">
          <AutoPlanPanel
            convoyId={convoyId}
            origin={convoyDetail?.route_origin ?? null}
            destination={convoyDetail?.route_destination ?? null}
            widthKm={data?.config.corridor_km ?? 2}
            onPlanned={afterPlan}
          />

          {/* Manual entry stays available, but folded away — auto-planning is
              the path for a convoy that already knows where it is going. */}
          <details className="group rounded-xl border border-white/10 bg-black/30">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold text-neutral-400 hover:text-white">
              <span className="inline-flex items-center gap-2">
                <MapPinned size={14} /> Or set the endpoints by hand
                <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
              </span>
            </summary>
            <div className="border-t border-white/[0.07] p-1">
              <CorridorPlanner convoyId={convoyId} onSaved={afterPlan} />
            </div>
          </details>
        </div>
      )}

      {/* ── Live corridor ──────────────────────────────────────────────────── */}
      {data && (
        <>
          {/* Two-up on a phone: four across truncated every label to "ROU… 9…". */}
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat Icon={RouteIcon} label="Route" value={`${routeKm.toFixed(0)} km · ${data.route.length} pts`} />
            <Stat Icon={Navigation} label="Corridor" value={`±${data.config.corridor_km} km`} tone="text-violet-300" />
            <Stat Icon={Gauge} label="Planned pace" value={`${data.config.avg_speed_kmh} km/h`} />
            <Stat
              Icon={Clock}
              label="Schedule"
              value={data.config.schedule_known ? 'running' : 'not started'}
              tone={data.config.schedule_known ? 'text-emerald-300' : 'text-neutral-500'}
            />
          </div>

          {data.risk && data.risk.zones.length > 0 && (
            <div className={`mb-4 rounded-xl border p-3 ${data.risk.blocked
              ? 'border-red-500/30 bg-red-500/[0.06]' : 'border-amber-500/25 bg-amber-500/[0.05]'}`}>
              <p className={`flex items-center gap-1.5 text-xs font-semibold ${data.risk.blocked ? 'text-red-300' : 'text-amber-200'}`}>
                <ShieldAlert size={13} />
                {data.risk.blocked ? 'This corridor crosses a no-go zone' : 'Risk zones on this corridor'}
                <span className="ml-auto font-mono font-normal text-neutral-400">{data.risk.exposed_km} km exposed</span>
              </p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {data.risk.zones.map((z, i) => (
                  <li key={`${z.zone_id}-${i}`}
                    className={`rounded-md border px-2 py-1 text-[11px] ${RISK_CHIP[z.risk_level] ?? RISK_CHIP['medium']}`}>
                    {z.name ?? 'Risk zone'} · <span className="font-mono">{z.km_inside} km</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mb-4">
            <CorridorGlobe
              route={data.route}
              corridorKm={data.config.corridor_km}
              members={members}
              zones={data.risk?.zones ?? []}
              focusId={focusId}
            />
          </div>

          <div className="mb-4 flex flex-wrap gap-2">
            {CHIPS.map(c => (
              <div key={c.key} className="rounded-lg border border-white/10 bg-black/40 px-3 py-1.5 text-sm">
                <span className={`font-bold ${c.cls}`}>{data.summary[c.key] ?? 0}</span>
                <span className="ml-2 text-[13px] text-neutral-400">{c.label}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── States ─────────────────────────────────────────────────────────── */}
      {!convoyId && (
        <div className="rounded-xl border border-white/[0.06] bg-black/30 p-10 text-center">
          <Radar size={26} className="mx-auto mb-3 text-neutral-700" />
          <p className="text-sm text-neutral-500">Pick a convoy to watch its live 4D corridor.</p>
        </div>
      )}

      {error && !planning && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-8 text-center">
          <Flag size={24} className="mx-auto mb-3 text-amber-400/70" />
          <p className="text-sm font-medium text-amber-200">No corridor for this convoy yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-amber-200/60">
            Plan one from an origin and destination and the road between them is routed automatically.
          </p>
          <button onClick={() => setPlanning(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500">
            <MapPinned size={14} /> Plan the route
          </button>
        </div>
      )}

      {/* ── Members ────────────────────────────────────────────────────────── */}
      {members.length > 0 && (
        <ul className="space-y-2.5">
          {members.map(m => {
            const st = STATUS[m.status] ?? OFF;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => setFocusId(m.lat != null ? m.id : null)}
                  disabled={m.lat == null}
                  aria-label={`Show ${m.name} on the globe`}
                  className={`w-full rounded-xl border ${st.ring} bg-black/40 p-4 text-left transition-colors ${
                    focusId === m.id ? 'ring-1 ring-violet-400/50' : ''
                  } ${m.lat != null ? 'hover:border-white/25' : 'cursor-default'}`}>
                <div className="flex items-start gap-3">
                  <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${st.bg} ${st.glow}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Truck size={14} className="shrink-0 text-neutral-400" />
                      <span className="truncate font-semibold text-white">
                        {m.officer_name ? `${m.officer_name} · ${m.name}` : m.name}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${st.ring} ${st.text}`}>
                        {st.label}
                      </span>
                    </div>

                    {m.status === 'no_fix' ? (
                      <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-neutral-500">
                        <Signal size={12} /> last fix {fixAge(m.last_fix_at)}
                      </p>
                    ) : (
                      <>
                        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-neutral-400">
                          <span><span className="font-mono text-neutral-300">{(m.cross_track_km ?? 0).toFixed(2)}</span> km off route</span>
                          <span className={m.schedule_delta_min && Math.abs(m.schedule_delta_min) > 0 ? st.text : ''}>{schedText(m.schedule_delta_min)}</span>
                          <span className="text-neutral-500">fix {fixAge(m.last_fix_at)}</span>
                        </div>
                        <ProgressRail m={m} bg={st.bg} />
                      </>
                    )}
                  </div>
                </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {data && members.length === 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-black/30 p-10 text-center">
          <Truck size={24} className="mx-auto mb-3 text-neutral-700" />
          <p className="text-sm text-neutral-500">The corridor is live, but no Guardian devices are assigned to this convoy yet.</p>
        </div>
      )}

      {data && (
        <p className="mt-6 text-center text-[11px] text-neutral-600">
          Evaluated {new Date(data.evaluated_at).toLocaleTimeString()} · auto-refresh 15s
        </p>
      )}
    </div>
  );
}
