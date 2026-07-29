import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import {
  Radar, Route as RouteIcon, ChevronDown, Loader2, Truck, Clock, Navigation,
  MapPinned, Gauge, Signal, AlertTriangle, ShieldAlert, Maximize2, Minimize2, Flag,
} from 'lucide-react';
import CorridorPlanner from '../components/geofences/CorridorPlanner.js';
import CorridorGlobe from '../components/geofences/CorridorGlobe.js';
import AutoPlanPanel from '../components/geofences/AutoPlanPanel.js';
import CorridorTimeline, { ModeToggle } from '../components/geofences/CorridorTimeline.js';
import type { ReplayFrame, ReplayResp } from '../components/geofences/CorridorTimeline.js';

interface ConvoyRow { id: string; name: string; status: string }
interface ConvoyDetail { id: string; route_origin: string | null; route_destination: string | null }
interface Member {
  id: string; name: string; officer_name?: string | null;
  lat: number | null; lng: number | null; last_fix_at: string | null;
  status: string; severity: string;
  cross_track_km?: number | null; schedule_delta_km?: number | null;
  schedule_delta_min?: number | null; along_km?: number | null;
  expected_along_km?: number | null; route_len_km?: number | null;
  remaining_km?: number | null; eta?: string | null; eta_min?: number | null;
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
  no_go: 'border-red-500/40 bg-red-500/10 text-red-300',
  critical: 'border-red-500/40 bg-red-500/10 text-red-300',
  high: 'border-orange-500/40 bg-orange-500/10 text-orange-300',
  medium: 'border-yellow-500/40 bg-yellow-500/10 text-yellow-300',
  low: 'border-lime-500/40 bg-lime-500/10 text-lime-300',
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

function etaText(m: Member): string | null {
  if (m.eta_min == null || m.remaining_km == null) return null;
  if (m.remaining_km < 1) return 'arrived';
  const h = Math.floor(m.eta_min / 60), mins = m.eta_min % 60;
  const when = new Date(m.eta!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${m.remaining_km.toFixed(0)} km left · ETA ${when} (${h > 0 ? `${h}h ${mins}m` : `${mins}m`})`;
}

/**
 * The 4th dimension, drawn: how far along the route the truck actually is
 * (filled bar) against where the schedule says it should be by now (marker).
 */
function ProgressRail({ m, bg }: { m: Member; bg: string }) {
  const len = m.route_len_km ?? 0;
  if (!(len > 0)) return null;
  const pct = (v: number) => Math.max(0, Math.min(100, (v / len) * 100));
  return (
    <div className="mt-2.5">
      <div className="relative h-1.5 w-full overflow-visible rounded-full bg-white/[0.07]">
        <div className={`h-full rounded-full ${bg} opacity-80`} style={{ width: `${pct(m.along_km ?? 0)}%` }} />
        <span className="absolute -top-1 h-3.5 w-0.5 rounded bg-white/70"
          style={{ left: `calc(${pct(m.expected_along_km ?? 0)}% - 1px)` }}
          title="where the schedule says it should be" />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] font-mono text-neutral-600">
        <span>{(m.along_km ?? 0).toFixed(0)} km</span>
        <span className="text-neutral-500">exp {(m.expected_along_km ?? 0).toFixed(0)}</span>
        <span>{len.toFixed(0)} km</span>
      </div>
    </div>
  );
}

function Stat({ Icon, label, value, tone = 'text-neutral-200' }: {
  Icon: typeof Gauge; label: string; value: string; tone?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-2">
      <Icon size={14} className="shrink-0 text-neutral-500" />
      <div className="min-w-0">
        <p className="truncate text-[10px] uppercase tracking-wide text-neutral-500">{label}</p>
        <p className={`truncate text-[13px] font-semibold ${tone}`}>{value}</p>
      </div>
    </div>
  );
}

export default function Corridor() {
  const [convoyId, setConvoyId] = useState<string>('');
  const [planning, setPlanning] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [live, setLive] = useState(true);
  const [frame, setFrame] = useState<ReplayFrame | null>(null);
  const [replay, setReplay] = useState<ReplayResp | null>(null);
  const [expanded, setExpanded] = useState(false);
  const queryClient = useQueryClient();

  const { data: convoys } = useQuery<ConvoyRow[]>({
    queryKey: ['convoys-for-corridor'],
    queryFn: async () => (await api.get<{ data: ConvoyRow[] }>('/convoys?limit=100')).data.data ?? [],
    staleTime: 30_000,
  });

  const { data, isFetching, error } = useQuery<CorridorResp>({
    queryKey: ['convoy-corridor', convoyId],
    enabled: !!convoyId,
    // Polling while scrubbing would fight the timeline for the globe.
    refetchInterval: live ? 15_000 : false,
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

  const onFrame = useCallback((f: ReplayFrame | null, r: ReplayResp | null) => {
    setFrame(f); setReplay(r);
  }, []);

  const monitorable = (convoys ?? []).filter(c => c.status === 'active' || c.status === 'planned');

  // While scrubbing, the roster and the globe both read from the replay frame,
  // so the numbers beside a truck always match the dot on the globe.
  const shown: Member[] = useMemo(() => {
    const src: Member[] = !live && frame
      ? frame.members.map(m => ({ ...m, last_fix_at: null, severity: 'na' } as unknown as Member))
      : (data?.members ?? []);
    return [...src].sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.name.localeCompare(b.name));
  }, [live, frame, data]);

  // The focused truck's recorded track, so a detour reads as a shape.
  const trail = useMemo(() => {
    if (live || !replay || !focusId) return undefined;
    return replay.frames
      .map(f => f.members.find(m => m.id === focusId))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .map(m => ({ lat: m.lat, lng: m.lng }));
  }, [live, replay, focusId]);

  const route = (!live && replay ? replay.route : data?.route) ?? [];
  const corridorKm = (!live && replay ? replay.width_km : data?.config.corridor_km) ?? 2;
  const routeKm = data?.members?.[0]?.route_len_km ?? 0;
  const flagged = shown.filter(m => m.status === 'off_route' || m.status === 'behind').length;
  const hasCorridor = !!data && route.length >= 2;
  const showPlanner = !!convoyId && (planning || (!!error && !data));

  return (
    <div className={`flex flex-col ${expanded ? 'fixed inset-0 z-50 bg-[#080a0f]' : 'h-full'}`}>
      {/* ── Command bar ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-black/40 px-3 py-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-violet-500/25 bg-violet-500/10">
          <Radar size={16} className="text-violet-400" />
        </span>
        <div className="mr-1 min-w-0">
          <h1 className="text-sm font-bold leading-tight text-white">4D Geofence</h1>
          <p className="text-[11px] leading-tight text-neutral-500">Route corridor swept over time</p>
        </div>

        <div className="relative">
          <select
            value={convoyId}
            onChange={e => { setConvoyId(e.target.value); setPlanning(false); setFocusId(null); setLive(true); }}
            className="appearance-none rounded-lg border border-white/10 bg-black/40 py-1.5 pl-2.5 pr-8 text-[13px] font-medium text-white outline-none focus:border-violet-500/50"
          >
            <option value="">Select a convoy…</option>
            {monitorable.map(c => <option key={c.id} value={c.id}>{c.name} · {c.status}</option>)}
          </select>
          <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
        </div>

        {convoyId && (
          <button onClick={() => setPlanning(p => !p)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] font-semibold ${planning
              ? 'border-violet-500/50 bg-violet-500/10 text-violet-300'
              : 'border-white/10 bg-black/40 text-neutral-300 hover:text-white'}`}>
            <MapPinned size={13} /> {hasCorridor ? 'Update' : 'Plan'}
          </button>
        )}
        {hasCorridor && <ModeToggle live={live} onChange={l => { setLive(l); if (l) setFrame(null); }} />}

        <div className="ml-auto flex items-center gap-2">
          {flagged > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/25 bg-red-500/[0.07] px-2.5 py-1.5 text-[12px] font-semibold text-red-300">
              <AlertTriangle size={13} /> {flagged}
            </span>
          )}
          {live && data && (
            <span className="hidden items-center gap-1.5 rounded-full border border-white/10 px-2 py-1 text-[10px] text-neutral-400 sm:inline-flex">
              <span className={`h-1.5 w-1.5 rounded-full bg-emerald-500 ${isFetching ? 'animate-pulse' : ''}`} /> 15s
            </span>
          )}
          {hasCorridor && (
            <button onClick={() => setExpanded(e => !e)} aria-label={expanded ? 'Exit fullscreen' : 'Fullscreen'}
              className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 text-neutral-400 hover:text-white">
              {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}
        </div>
      </div>

      {/* ── Body: globe left, roster right ─────────────────────────────────── */}
      <div className="grid min-h-0 flex-1 grid-rows-[minmax(320px,58vh)_auto] lg:grid-cols-[1fr_minmax(320px,380px)] lg:grid-rows-1">
        <section className="relative flex min-h-0 flex-col border-b border-white/10 lg:border-b-0 lg:border-r">
          {!convoyId ? (
            <Empty Icon={Radar} text="Pick a convoy to watch its live 4D corridor." />
          ) : showPlanner ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mx-auto max-w-xl space-y-3">
                <AutoPlanPanel
                  convoyId={convoyId}
                  origin={convoyDetail?.route_origin ?? null}
                  destination={convoyDetail?.route_destination ?? null}
                  widthKm={data?.config.corridor_km ?? 2}
                  onPlanned={afterPlan}
                />
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
            </div>
          ) : hasCorridor ? (
            <>
              <div className="min-h-0 flex-1">
                <CorridorGlobe
                  fill
                  route={route}
                  corridorKm={corridorKm}
                  members={shown}
                  zones={data?.risk?.zones ?? []}
                  focusId={focusId}
                  trail={trail}
                  onSelect={setFocusId}
                />
              </div>
              <CorridorTimeline convoyId={convoyId} live={live} onFrame={onFrame} />
            </>
          ) : (
            <Empty Icon={Loader2} text="Loading corridor…" spin />
          )}
        </section>

        {/* ── Roster ───────────────────────────────────────────────────────── */}
        <aside className="min-h-0 overflow-y-auto bg-black/20">
          {data && (
            <div className="space-y-3 p-3">
              <div className="grid grid-cols-2 gap-2">
                <Stat Icon={RouteIcon} label="Route" value={`${routeKm.toFixed(0)} km`} />
                <Stat Icon={Navigation} label="Corridor" value={`±${corridorKm} km`} tone="text-violet-300" />
                <Stat Icon={Gauge} label="Pace" value={`${data.config.avg_speed_kmh} km/h`} />
                <Stat Icon={Clock} label="Schedule"
                  value={data.config.schedule_known ? 'running' : 'not started'}
                  tone={data.config.schedule_known ? 'text-emerald-300' : 'text-neutral-500'} />
              </div>

              {data.risk?.zones?.length > 0 && (
                <div className={`rounded-lg border p-2.5 ${data.risk.blocked
                  ? 'border-red-500/30 bg-red-500/[0.06]' : 'border-amber-500/25 bg-amber-500/[0.05]'}`}>
                  <p className={`flex items-center gap-1.5 text-[11px] font-semibold ${data.risk.blocked ? 'text-red-300' : 'text-amber-200'}`}>
                    <ShieldAlert size={12} />
                    {data.risk.blocked ? 'Crosses a no-go zone' : 'Risk zones on route'}
                    <span className="ml-auto font-mono font-normal text-neutral-400">{data.risk.exposed_km} km</span>
                  </p>
                  <ul className="mt-1.5 flex flex-wrap gap-1">
                    {data.risk.zones.map((z, i) => (
                      <li key={`${z.zone_id}-${i}`}
                        className={`rounded border px-1.5 py-0.5 text-[10px] ${RISK_CHIP[z.risk_level] ?? RISK_CHIP['medium']}`}>
                        {z.name ?? 'Zone'} · <span className="font-mono">{z.km_inside}km</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {CHIPS.map(c => (
                  <div key={c.key} className="rounded-md border border-white/10 bg-black/40 px-2 py-1 text-[11px]">
                    <span className={`font-bold ${c.cls}`}>
                      {!live && frame ? frame.members.filter(m => m.status === c.key).length : (data.summary[c.key] ?? 0)}
                    </span>
                    <span className="ml-1.5 text-neutral-400">{c.label}</span>
                  </div>
                ))}
              </div>

              <ul className="space-y-2">
                {shown.map(m => {
                  const st = STATUS[m.status] ?? OFF;
                  const eta = live ? etaText(m) : null;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setFocusId(id => (id === m.id ? null : m.lat != null ? m.id : null))}
                        disabled={m.lat == null}
                        aria-label={`Show ${m.name} on the globe`}
                        className={`w-full rounded-lg border ${st.ring} bg-black/40 p-2.5 text-left transition-colors ${
                          focusId === m.id ? 'ring-1 ring-violet-400/60' : ''
                        } ${m.lat != null ? 'hover:border-white/25' : 'cursor-default'}`}>
                        <div className="flex items-start gap-2">
                          <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${st.bg} ${st.glow}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                              <Truck size={12} className="shrink-0 text-neutral-400" />
                              <span className="truncate text-[13px] font-semibold text-white">
                                {m.officer_name ? `${m.officer_name} · ${m.name}` : m.name}
                              </span>
                              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${st.ring} ${st.text}`}>
                                {st.label}
                              </span>
                            </div>

                            {m.status === 'no_fix' ? (
                              <p className="mt-1 flex items-center gap-1.5 text-[11px] text-neutral-500">
                                <Signal size={11} /> last fix {fixAge(m.last_fix_at)}
                              </p>
                            ) : (
                              <>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-400">
                                  <span><span className="font-mono text-neutral-300">{(m.cross_track_km ?? 0).toFixed(2)}</span> km off</span>
                                  <span className={m.schedule_delta_min ? st.text : ''}>{schedText(m.schedule_delta_min)}</span>
                                </div>
                                {eta && (
                                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-neutral-500">
                                    <Flag size={10} /> {eta}
                                  </p>
                                )}
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

              {shown.length === 0 && (
                <p className="px-1 py-6 text-center text-[13px] text-neutral-500">
                  {live ? 'No Guardian devices assigned to this convoy yet.' : 'No positions recorded at this moment.'}
                </p>
              )}
            </div>
          )}

          {!data && convoyId && !showPlanner && (
            <p className="p-6 text-center text-[13px] text-neutral-500">Loading…</p>
          )}
          {!convoyId && (
            <p className="p-6 text-center text-[13px] text-neutral-600">The roster appears once a convoy is selected.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Empty({ Icon, text, spin = false }: { Icon: typeof Radar; text: string; spin?: boolean }) {
  return (
    <div className="grid min-h-0 flex-1 place-items-center p-8 text-center">
      <div>
        <Icon size={26} className={`mx-auto mb-3 text-neutral-700 ${spin ? 'animate-spin' : ''}`} />
        <p className="text-sm text-neutral-500">{text}</p>
      </div>
    </div>
  );
}
