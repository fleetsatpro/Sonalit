import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import {
  Siren, Camera, Mic, Radio, PauseCircle, ShieldCheck, Clock,
  MapPin, FileSearch, ChevronDown, Loader2,
} from 'lucide-react';

interface Device { id: string; name: string; officer_name?: string | null }
interface TEvent {
  id: string; ts: string; type: string; severity: string;
  title: string; detail?: string | null;
  lat?: number | null; lng?: number | null; media_url?: string | null;
}
interface Dossier {
  device: { id: string; name: string };
  window: { from: string; to: string };
  events: TEvent[];
  integrity: { algorithm: string; digest: string; event_count: number; sealed_at: string };
}

const WINDOWS = [
  { label: 'Last 6h', hours: 6 },
  { label: 'Last 24h', hours: 24 },
  { label: 'Last 72h', hours: 72 },
];

const INFO = { ring: 'border-white/10', text: 'text-neutral-400', dot: 'bg-neutral-500' };
const SEV: Record<string, { ring: string; text: string; dot: string }> = {
  critical: { ring: 'border-red-500/50', text: 'text-red-400', dot: 'bg-red-500' },
  high: { ring: 'border-orange-500/50', text: 'text-orange-400', dot: 'bg-orange-500' },
  warning: { ring: 'border-amber-500/50', text: 'text-amber-400', dot: 'bg-amber-500' },
  info: INFO,
};

function TypeIcon({ type, className }: { type: string; className?: string }) {
  const map: Record<string, typeof Siren> = {
    panic: Siren, capture: Camera, voice: Mic, command: Radio, stop: PauseCircle,
  };
  const Icon = map[type] ?? Clock;
  return <Icon size={15} className={className} />;
}

export default function Incident() {
  const [deviceId, setDeviceId] = useState<string>('');
  const [hours, setHours] = useState<number>(24);

  const { data: devices } = useQuery<Device[]>({
    queryKey: ['guardian-devices-list'],
    queryFn: async () => (await api.get<{ data: Device[] }>('/guardian/devices')).data.data ?? [],
    staleTime: 30_000,
  });

  const window_ = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - hours * 3600 * 1000);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [hours]);

  const { data: dossier, isFetching, isError } = useQuery<Dossier>({
    queryKey: ['incident-reconstruct', deviceId, hours],
    enabled: !!deviceId,
    queryFn: async () => (await api.get<{ data: Dossier }>(
      `/incidents/${deviceId}/reconstruct?from=${encodeURIComponent(window_.from)}&to=${encodeURIComponent(window_.to)}`,
    )).data.data,
  });

  const events = dossier?.events ?? [];

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <FileSearch className="text-violet-400" />
        <div>
          <h1 className="text-xl font-bold text-white">Incident Reconstruction</h1>
          <p className="text-sm text-neutral-400">Replay a device's SOS, covert captures, comms and GPS trail as one sealed timeline.</p>
        </div>
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative">
          <select
            value={deviceId}
            onChange={e => setDeviceId(e.target.value)}
            className="appearance-none rounded-lg border border-white/10 bg-black/40 py-2 pl-3 pr-9 text-sm text-white"
          >
            <option value="">Select a device…</option>
            {(devices ?? []).map(d => (
              <option key={d.id} value={d.id}>{d.officer_name ? `${d.officer_name} · ${d.name}` : d.name}</option>
            ))}
          </select>
          <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500" />
        </div>
        <div className="flex overflow-hidden rounded-lg border border-white/10">
          {WINDOWS.map(w => (
            <button
              key={w.hours}
              type="button"
              onClick={() => setHours(w.hours)}
              className={`px-3 py-2 text-xs font-semibold ${hours === w.hours ? 'bg-violet-600 text-white' : 'bg-black/40 text-neutral-400 hover:text-white'}`}
            >
              {w.label}
            </button>
          ))}
        </div>
        {isFetching && <Loader2 size={16} className="animate-spin text-neutral-400" />}
      </div>

      {/* Integrity seal */}
      {dossier && (
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] p-3">
          <ShieldCheck size={18} className="shrink-0 text-emerald-400" />
          <div className="min-w-0 text-xs">
            <div className="font-semibold text-emerald-300">Tamper-evident seal · {dossier.integrity.event_count} events</div>
            <div className="truncate font-mono text-[11px] text-neutral-400" title={dossier.integrity.digest}>
              {dossier.integrity.algorithm}: {dossier.integrity.digest.slice(0, 32)}…
            </div>
          </div>
        </div>
      )}

      {/* Body */}
      {!deviceId && (
        <div className="rounded-xl border border-white/[0.06] bg-black/30 p-10 text-center text-sm text-neutral-500">
          Pick a device to reconstruct its incident timeline.
        </div>
      )}
      {isError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-6 text-center text-sm text-red-300">
          Could not load the dossier for this device.
        </div>
      )}
      {deviceId && !isFetching && !isError && events.length === 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-black/30 p-10 text-center text-sm text-neutral-500">
          No recorded events in this window — the device was quiet.
        </div>
      )}

      {events.length > 0 && (
        <ol className="relative ml-2 space-y-4 border-l border-white/10 pl-6">
          {events.map(ev => {
            const sev = SEV[ev.severity] ?? INFO;
            return (
              <li key={ev.id} className="relative">
                <span className={`absolute -left-[31px] top-1.5 h-3 w-3 rounded-full ring-4 ring-black ${sev.dot}`} />
                <div className={`rounded-lg border ${sev.ring} bg-black/40 p-3`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <TypeIcon type={ev.type} className={sev.text} />
                      <span className="text-sm font-semibold text-white">{ev.title}</span>
                    </div>
                    <time className="shrink-0 font-mono text-[11px] text-neutral-500">
                      {new Date(ev.ts).toLocaleString()}
                    </time>
                  </div>
                  {ev.detail && <p className="mt-1 text-xs text-neutral-400">{ev.detail}</p>}
                  <div className="mt-2 flex items-center gap-3">
                    {ev.media_url && (
                      <a href={ev.media_url} target="_blank" rel="noreferrer">
                        <img src={ev.media_url} alt="capture" className="h-16 w-16 rounded object-cover" loading="lazy" />
                      </a>
                    )}
                    {ev.lat != null && ev.lng != null && (
                      <a
                        className="inline-flex items-center gap-1 text-[11px] text-violet-300 hover:underline"
                        href={`https://www.google.com/maps?q=${ev.lat},${ev.lng}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MapPin size={12} /> {ev.lat.toFixed(4)}, {ev.lng.toFixed(4)}
                      </a>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
