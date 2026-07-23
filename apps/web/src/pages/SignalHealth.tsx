import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { RadioTower, SatelliteDish, WifiOff, ShieldCheck, Truck, Loader2 } from 'lucide-react';

interface SigDevice {
  id: string; name: string; officer_name?: string | null;
  on_active_convoy: boolean;
  last_seen: string | null; last_fix_at: string | null;
  state: string; severity: string; reasons: string[];
  seen_age_ms: number | null; fix_age_ms: number | null;
}
interface SignalResp { devices: SigDevice[]; summary: Record<string, number>; scanned_at: string }

const OK = { label: 'OK', ring: 'border-white/10', text: 'text-neutral-400', Icon: ShieldCheck };
const STATE: Record<string, { label: string; ring: string; text: string; Icon: typeof ShieldCheck }> = {
  comms_blackout: { label: 'Comms blackout', ring: 'border-red-500/50', text: 'text-red-400', Icon: WifiOff },
  gps_frozen: { label: 'GPS jammed', ring: 'border-orange-500/50', text: 'text-orange-400', Icon: SatelliteDish },
  no_data: { label: 'No data', ring: 'border-white/10', text: 'text-neutral-500', Icon: RadioTower },
  ok: OK,
};

function age(ms: number | null): string {
  if (ms == null) return '—';
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

export default function SignalHealth() {
  const { data, isFetching } = useQuery<SignalResp>({
    queryKey: ['signal-health'],
    queryFn: async () => (await api.get<{ data: SignalResp }>('/guardian/signal/health')).data.data,
    refetchInterval: 15_000,
  });

  const devices = data?.devices ?? [];
  const flagged = devices.filter(d => d.state !== 'ok');
  const summary = data?.summary ?? {};
  const chips = [
    { key: 'comms_blackout', label: 'Comms blackout', cls: 'text-red-400' },
    { key: 'gps_frozen', label: 'GPS jammed', cls: 'text-orange-400' },
    { key: 'ok', label: 'Healthy', cls: 'text-emerald-400' },
  ];

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <RadioTower className="text-cyan-400" />
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">Signal Integrity</h1>
          <p className="text-sm text-neutral-400">Watches for the pre-hijack signatures — devices gone dark, or heartbeating with the GPS jammed.</p>
        </div>
        {isFetching && <Loader2 size={16} className="animate-spin text-neutral-500" />}
      </div>

      {/* Summary chips */}
      <div className="mb-6 flex flex-wrap gap-2">
        {chips.map(c => (
          <div key={c.key} className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm">
            <span className={`font-bold ${c.cls}`}>{summary[c.key] ?? 0}</span>
            <span className="ml-2 text-neutral-400">{c.label}</span>
          </div>
        ))}
      </div>

      {flagged.length === 0 ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-10 text-center">
          <ShieldCheck className="mx-auto mb-2 text-emerald-400" />
          <p className="text-sm text-emerald-300">All devices reporting cleanly — no blackout or jamming signatures.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {flagged.map(d => {
            const st = STATE[d.state] ?? OK;
            const Icon = st.Icon;
            const critical = d.severity === 'critical';
            return (
              <li key={d.id} className={`rounded-xl border ${st.ring} bg-black/40 p-4`}>
                <div className="flex items-start gap-3">
                  <Icon size={20} className={`mt-0.5 shrink-0 ${st.text}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-white">{d.officer_name ? `${d.officer_name} · ${d.name}` : d.name}</span>
                      {d.on_active_convoy && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                          <Truck size={10} /> On convoy
                        </span>
                      )}
                      {critical && (
                        <span className="rounded-full bg-red-600/90 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">Critical</span>
                      )}
                    </div>
                    <p className={`mt-1 text-sm ${st.text}`}>{st.label} — {d.reasons[0] ?? ''}</p>
                    <div className="mt-2 flex gap-4 text-[11px] font-mono text-neutral-500">
                      <span>last contact {age(d.seen_age_ms)}</span>
                      <span>last GPS fix {age(d.fix_age_ms)}</span>
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data && (
        <p className="mt-6 text-center text-[11px] text-neutral-600">
          Scanned {new Date(data.scanned_at).toLocaleTimeString()} · auto-refresh 15s
        </p>
      )}
    </div>
  );
}
