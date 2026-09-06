import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { useDashboardStore } from '../../stores/dashboardStore.js';
import type { CrewDispatch } from '../../stores/dashboardStore.js';
import { Siren, MapPin, Radio, Clock, Target, Shield } from 'lucide-react';

interface ResponseTeam {
  id: string;
  name: string;
  type: string;
  callsign: string | null;
  location: string | null;
  eta_minutes: number;
  status: string;
}

const PRIORITY_STYLES: Record<string, { bg: string; border: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-950/40', border: 'border-red-600/60', text: 'text-red-400', label: 'CRITICAL' },
  high: { bg: 'bg-amber-950/30', border: 'border-amber-600/50', text: 'text-amber-400', label: 'HIGH' },
  medium: { bg: 'bg-blue-950/20', border: 'border-blue-600/40', text: 'text-blue-400', label: 'MEDIUM' },
};

const STATUS_STYLES: Record<string, { color: string; label: string; pulse: boolean }> = {
  dispatched: { color: 'text-red-400', label: 'DISPATCHED', pulse: true },
  acknowledged: { color: 'text-amber-400', label: 'ACKNOWLEDGED', pulse: true },
  en_route: { color: 'text-orange-400', label: 'EN ROUTE', pulse: true },
  on_scene: { color: 'text-green-400', label: 'ON SCENE', pulse: false },
  resolved: { color: 'text-gray-500', label: 'RESOLVED', pulse: false },
  cancelled: { color: 'text-gray-600', label: 'CANCELLED', pulse: false },
};

function DispatchCard({ dispatch }: { dispatch: CrewDispatch }) {
  const style = (PRIORITY_STYLES[dispatch.priority] ?? PRIORITY_STYLES['high'])!;
  const statusStyle = (STATUS_STYLES[dispatch.status] ?? STATUS_STYLES['dispatched'])!;

  return (
    <div className={`rounded-lg p-3 border ${style.bg} ${style.border}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Siren size={13} className={style.text} />
            <span className={`text-xs font-bold tracking-wider ${style.text}`}>{style.label}</span>
            <span className={`text-xs font-bold ${statusStyle.color} ${statusStyle.pulse ? 'animate-pulse' : ''}`}>
              {statusStyle.label}
            </span>
          </div>
          <p className="text-sm font-semibold text-white flex items-center gap-1.5">
            <Shield size={12} className="text-blue-400" />
            {dispatch.team_name}
            {dispatch.team_callsign && (
              <span className="text-xs text-gray-500 font-mono">({dispatch.team_callsign})</span>
            )}
          </p>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{dispatch.reason}</p>
          {dispatch.target_label && (
            <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
              <Target size={10} /> {dispatch.target_label}
            </div>
          )}
          <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
            <MapPin size={10} />
            {dispatch.target_lat.toFixed(5)}, {dispatch.target_lng.toFixed(5)}
          </div>
          <div className="flex items-center gap-1 text-xs text-gray-600 mt-0.5">
            <Clock size={10} />
            {new Date(dispatch.dispatched_at).toLocaleTimeString()}
          </div>
        </div>
      </div>
    </div>
  );
}

function DispatchForm({ teams, onDispatch }: {
  teams: ResponseTeam[];
  onDispatch: (data: {
    team_id: string; priority: string; reason: string;
    target_lat: number; target_lng: number; target_label: string;
  }) => void;
}) {
  const [teamId, setTeamId] = useState('');
  const [priority, setPriority] = useState('high');
  const [reason, setReason] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [label, setLabel] = useState('');

  const panicState = useDashboardStore(s => s.panicState);
  const prefillFromPanic = panicState?.status === 'active' && panicState.lat && panicState.lng;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tLat = parseFloat(lat) || (prefillFromPanic ? panicState.lat! : 0);
    const tLng = parseFloat(lng) || (prefillFromPanic ? panicState.lng! : 0);
    if (!teamId || !reason || !tLat || !tLng) return;
    onDispatch({ team_id: teamId, priority, reason, target_lat: tLat, target_lng: tLng, target_label: label });
    setReason('');
    setLabel('');
  };

  const available = teams.filter(t => t.status === 'standby');

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <select value={teamId} onChange={e => setTeamId(e.target.value)}
          className="col-span-2 rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white">
          <option value="">Select response team…</option>
          {available.map(t => (
            <option key={t.id} value={t.id}>
              {t.name}{t.callsign ? ` (${t.callsign})` : ''} — ETA {t.eta_minutes}min
            </option>
          ))}
        </select>
        <select value={priority} onChange={e => setPriority(e.target.value)}
          className="rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white">
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
        </select>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Target label (optional)"
          className="rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white placeholder-gray-600" />
      </div>
      <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
        placeholder="Reason for intercept dispatch…"
        className="w-full rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white resize-none placeholder-gray-600" />
      <div className="grid grid-cols-2 gap-2">
        <input value={lat} onChange={e => setLat(e.target.value)} type="number" step="any"
          placeholder={prefillFromPanic ? `Lat: ${panicState.lat!.toFixed(5)} (panic)` : 'Target latitude'}
          className="rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white placeholder-gray-600" />
        <input value={lng} onChange={e => setLng(e.target.value)} type="number" step="any"
          placeholder={prefillFromPanic ? `Lng: ${panicState.lng!.toFixed(5)} (panic)` : 'Target longitude'}
          className="rounded border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white placeholder-gray-600" />
      </div>
      <button type="submit" disabled={!teamId || !reason}
        className="w-full py-2 text-xs font-bold rounded bg-red-700/80 text-white hover:bg-red-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2">
        <Siren size={14} /> DISPATCH RESPONSE CREW
      </button>
    </form>
  );
}

export default function ResponseCrewPanel() {
  const qc = useQueryClient();
  const dispatches = useDashboardStore(s => s.crewDispatches);
  const activeDispatches = dispatches.filter(d =>
    d.status !== 'resolved' && d.status !== 'cancelled'
  );

  const { data: teamsData } = useQuery({
    queryKey: ['response-teams'],
    queryFn: async () => {
      const r = await api.get<{ data: ResponseTeam[] }>('/response-crew/teams');
      return r.data.data ?? [];
    },
    staleTime: 60_000,
  });
  const teams = teamsData ?? [];

  const { data: existingDispatches } = useQuery({
    queryKey: ['response-crew-dispatches'],
    queryFn: async () => {
      const r = await api.get<{ data: Array<CrewDispatch & { team_name: string; team_callsign: string }> }>(
        '/response-crew/dispatches?active_only=true'
      );
      return r.data.data ?? [];
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { upsertCrewDispatch } = useDashboardStore.getState();
  if (existingDispatches?.length) {
    for (const d of existingDispatches) {
      upsertCrewDispatch(d);
    }
  }

  const dispatchMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/response-crew/dispatch', body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['response-crew-dispatches'] }); },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Siren size={16} className="text-red-400" />
        <h3 className="text-sm font-bold text-white">Response Crew</h3>
        {activeDispatches.length > 0 && (
          <span className="bg-red-700/80 text-red-100 text-[10px] font-bold px-1.5 py-0.5 rounded-full animate-pulse">
            {activeDispatches.length} ACTIVE
          </span>
        )}
      </div>

      {/* Team status strip */}
      {teams.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {teams.map(t => (
            <div key={t.id} className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono border ${
              t.status === 'standby'
                ? 'border-green-700/40 bg-green-950/20 text-green-400'
                : t.status === 'deployed'
                ? 'border-amber-700/40 bg-amber-950/20 text-amber-400'
                : 'border-gray-700/30 bg-gray-900/20 text-gray-600'
            }`}>
              <Radio size={8} className={t.status === 'standby' ? 'text-green-500' : 'text-amber-500'} />
              {t.callsign ?? t.name}
              <span className="uppercase">{t.status}</span>
            </div>
          ))}
        </div>
      )}

      {/* Active dispatches */}
      {activeDispatches.map(d => <DispatchCard key={d.id} dispatch={d} />)}

      {/* Dispatch form */}
      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <p className="text-[10px] text-gray-500 font-mono uppercase tracking-wider mb-2">New dispatch</p>
        <DispatchForm teams={teams} onDispatch={(data) => dispatchMutation.mutate(data)} />
        {dispatchMutation.isError && (
          <p className="text-xs text-red-400 mt-1">Dispatch failed. Try again.</p>
        )}
      </div>
    </div>
  );
}
