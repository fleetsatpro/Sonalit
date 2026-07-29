import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Radar, Route as RouteIcon, ChevronDown, Loader2, Truck, Clock, Navigation, MapPinned } from 'lucide-react';
import CorridorPlanner from '../components/geofences/CorridorPlanner.js';

interface ConvoyRow { id: string; name: string; status: string }
interface Member {
  id: string; name: string; officer_name?: string | null;
  lat: number | null; lng: number | null; last_fix_at: string | null;
  status: string; severity: string;
  cross_track_km?: number | null; schedule_delta_km?: number | null;
  schedule_delta_min?: number | null; along_km?: number | null;
  expected_along_km?: number | null; route_len_km?: number | null;
}
interface CorridorResp {
  convoy: { id: string; name: string; status: string; departure_time: string | null };
  config: { avg_speed_kmh: number; corridor_km: number; schedule_tol_km: number; started_at: string | null; schedule_known: boolean };
  route: { lat: number; lng: number; name: string | null; seq: number }[];
  members: Member[];
  summary: Record<string, number>;
  evaluated_at: string;
}

const OFF = { label: 'Off route', ring: 'border-red-500/50', text: 'text-red-400', bg: 'bg-red-500' };
const STATUS: Record<string, { label: string; ring: string; text: string; bg: string }> = {
  off_route: OFF,
  behind: { label: 'Behind schedule', ring: 'border-amber-500/50', text: 'text-amber-400', bg: 'bg-amber-500' },
  ahead: { label: 'Ahead of escort', ring: 'border-cyan-500/50', text: 'text-cyan-400', bg: 'bg-cyan-500' },
  on_track: { label: 'On track', ring: 'border-emerald-500/40', text: 'text-emerald-400', bg: 'bg-emerald-500' },
  no_fix: { label: 'No GPS fix', ring: 'border-white/10', text: 'text-neutral-500', bg: 'bg-neutral-600' },
};

function schedText(min?: number | null): string {
  if (min == null || min === 0) return 'on schedule';
  const a = Math.abs(min);
  return min < 0 ? `${a} min behind` : `${a} min ahead`;
}

export default function Corridor() {
  const [convoyId, setConvoyId] = useState<string>('');
  const [planning, setPlanning] = useState(false);
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
    queryFn: async () => (await api.get<{ data: CorridorResp }>(`/convoys/${convoyId}/corridor`)).data.data,
  });

  const monitorable = (convoys ?? []).filter(c => c.status === 'active' || c.status === 'planned');
  const members = data?.members ?? [];

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <Radar className="text-violet-400" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">4D Geofence · Route Corridor</h1>
          <p className="text-sm text-neutral-400">The planned route swept over time — flags trucks that stray off-corridor, fall behind, stall, or outrun their escort.</p>
        </div>
        {isFetching && <Loader2 size={16} className="animate-spin text-neutral-500" />}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative inline-block">
          <select
            value={convoyId}
            onChange={e => { setConvoyId(e.target.value); setPlanning(false); }}
            className="appearance-none rounded-lg border border-white/10 bg-black/40 py-2 pl-3 pr-9 text-sm text-white"
          >
            <option value="">Select a convoy…</option>
            {monitorable.map(c => <option key={c.id} value={c.id}>{c.name} · {c.status}</option>)}
          </select>
          <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500" />
        </div>
        {convoyId && (
          <button onClick={() => setPlanning(p => !p)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold ${planning ? 'border-violet-500/50 bg-violet-500/10 text-violet-300' : 'border-white/10 bg-black/40 text-neutral-300 hover:text-white'}`}>
            <MapPinned size={14} /> {data ? 'Update route' : 'Plan route'}
          </button>
        )}
      </div>

      {convoyId && planning && (
        <div className="mb-6">
          <CorridorPlanner convoyId={convoyId} onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['convoy-corridor', convoyId] });
          }} />
        </div>
      )}

      {data && (
        <div className="mb-5 flex flex-wrap items-center gap-4 rounded-lg border border-white/10 bg-black/30 p-3 text-xs text-neutral-400">
          <span className="inline-flex items-center gap-1"><RouteIcon size={13} /> {data.route.length} waypoints · {(members[0]?.route_len_km ?? 0).toFixed(0)} km</span>
          <span className="inline-flex items-center gap-1"><Navigation size={13} /> corridor ±{data.config.corridor_km} km</span>
          <span className="inline-flex items-center gap-1"><Clock size={13} /> {data.config.schedule_known ? `pace ${data.config.avg_speed_kmh} km/h` : 'schedule not started'}</span>
        </div>
      )}

      {!convoyId && (
        <div className="rounded-xl border border-white/[0.06] bg-black/30 p-10 text-center text-sm text-neutral-500">
          Pick a convoy to watch its live 4D corridor.
        </div>
      )}
      {error && !planning && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-6 text-center text-sm text-amber-300">
          <p>This convoy has no corridor yet, or it couldn't be loaded.</p>
          <button onClick={() => setPlanning(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/10">
            <MapPinned size={13} /> Plan the route
          </button>
        </div>
      )}

      {members.length > 0 && (
        <ul className="space-y-3">
          {members.map(m => {
            const st = STATUS[m.status] ?? OFF;
            return (
              <li key={m.id} className={`rounded-xl border ${st.ring} bg-black/40 p-4`}>
                <div className="flex items-start gap-3">
                  <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${st.bg}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Truck size={14} className="text-neutral-400" />
                      <span className="truncate font-semibold text-white">{m.officer_name ? `${m.officer_name} · ${m.name}` : m.name}</span>
                    </div>
                    <p className={`mt-0.5 text-sm font-medium ${st.text}`}>{st.label}</p>
                    {m.status !== 'no_fix' && (
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[11px] font-mono text-neutral-500">
                        <span>{(m.cross_track_km ?? 0).toFixed(2)} km off route</span>
                        <span>{schedText(m.schedule_delta_min)}</span>
                        <span>{(m.along_km ?? 0).toFixed(0)} / {(m.route_len_km ?? 0).toFixed(0)} km along</span>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data && members.length === 0 && !error && (
        <div className="rounded-xl border border-white/[0.06] bg-black/30 p-10 text-center text-sm text-neutral-500">
          No Guardian devices assigned to this convoy yet.
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
