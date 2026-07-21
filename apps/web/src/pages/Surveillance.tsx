import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Camera, ShieldAlert, X, RefreshCw, ExternalLink } from 'lucide-react';
import { api } from '../lib/api.js';

// Surveillance — the covert-capture console. Lists every photo a Guardian
// device has taken in response to a capture_photo command (org-wide), lets the
// operator request a new one, and is honest about why captures aren't landing
// (R2 storage not configured) instead of leaving an unexplained empty gallery.

interface Capture { id: string; device_id: string; url: string; created_at: string; device_name: string }
interface Device { id: string; name: string; officer_name?: string | null; status?: string }

function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function Surveillance() {
  const qc = useQueryClient();
  const [deviceId, setDeviceId] = useState<string>('');
  const [lightbox, setLightbox] = useState<Capture | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const { data: status } = useQuery<{ configured: boolean }>({
    queryKey: ['capture-status'],
    queryFn: async () => (await api.get('/guardian/capture/status')).data as { configured: boolean },
    staleTime: 60_000,
  });
  const { data: captures, isLoading, refetch, isFetching } = useQuery<Capture[]>({
    queryKey: ['captures-recent'],
    queryFn: async () => (await api.get<{ data: Capture[] }>('/guardian/captures/recent')).data.data ?? [],
    refetchInterval: 10_000,
  });
  const { data: devices } = useQuery<Device[]>({
    queryKey: ['guardian-devices-list'],
    queryFn: async () => (await api.get<{ data: Device[] }>('/guardian/devices')).data.data ?? [],
    staleTime: 30_000,
  });

  const request = useMutation({
    mutationFn: (id: string) => api.post(`/guardian/devices/${id}/commands`, { command: 'capture_photo' }),
    onSuccess: () => {
      setNote({ kind: 'ok', text: 'Capture requested — the photo lands here once the device uploads it.' });
      // Poll the gallery a few times while the device captures + uploads.
      let n = 0;
      const iv = setInterval(() => { void qc.invalidateQueries({ queryKey: ['captures-recent'] }); if (++n >= 8) clearInterval(iv); }, 3000);
    },
    onError: () => setNote({ kind: 'err', text: 'Failed to send the capture command to the device.' }),
  });

  const guardianDevices = useMemo(() => (devices ?? []).filter(d => !!d.name), [devices]);
  const configured = status?.configured !== false; // treat unknown as ok until we hear otherwise

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-500/40 bg-violet-500/10 text-violet-300">
          <Camera size={20} />
        </div>
        <div className="mr-auto">
          <h1 className="text-lg font-black text-white leading-none">Surveillance</h1>
          <div className="mt-1 text-[11px] font-mono uppercase tracking-widest text-neutral-500">Covert captures · Guardian devices</div>
        </div>
        <button
          onClick={() => void refetch()}
          className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-neutral-300 hover:text-white"
        >
          <RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Storage status banner */}
      {status && !status.configured && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-600/40 bg-amber-950/25 p-3">
          <ShieldAlert size={18} className="mt-0.5 flex-none text-amber-400" />
          <div className="text-[12.5px] leading-relaxed text-amber-100">
            <b>Photo storage isn’t configured.</b> Devices take the photo but have nowhere to upload it, so captures never
            arrive. Set the Cloudflare R2 environment variables on the backend —
            <code className="mx-1 rounded bg-black/40 px-1 py-0.5 text-[11px] text-amber-200">R2_ACCOUNT_ID</code>
            <code className="mx-1 rounded bg-black/40 px-1 py-0.5 text-[11px] text-amber-200">R2_ACCESS_KEY</code>
            <code className="mx-1 rounded bg-black/40 px-1 py-0.5 text-[11px] text-amber-200">R2_SECRET_KEY</code>
            <code className="mx-1 rounded bg-black/40 px-1 py-0.5 text-[11px] text-amber-200">R2_BUCKET</code>
            <code className="mx-1 rounded bg-black/40 px-1 py-0.5 text-[11px] text-amber-200">R2_PUBLIC_URL</code>
            — then captures will begin to land here.
          </div>
        </div>
      )}

      {/* Request a capture */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <span className="text-[11px] font-mono uppercase tracking-wider text-neutral-500">Request a capture</span>
        <select
          value={deviceId}
          onChange={e => setDeviceId(e.target.value)}
          className="min-w-[180px] flex-1 rounded-md border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white outline-none"
        >
          <option value="">Select a device…</option>
          {guardianDevices.map(d => (
            <option key={d.id} value={d.id}>{d.officer_name ? `${d.officer_name} · ${d.name}` : d.name}</option>
          ))}
        </select>
        <button
          disabled={!deviceId || request.isPending}
          onClick={() => deviceId && request.mutate(deviceId)}
          className="inline-flex items-center gap-2 rounded-md bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40 hover:bg-violet-500"
        >
          <Camera size={15} />{request.isPending ? 'Requesting…' : 'Capture'}
        </button>
      </div>
      {note && (
        <div className={`-mt-2 text-[12px] ${note.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{note.text}</div>
      )}

      {/* Gallery */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="grid place-items-center py-20 text-sm text-neutral-500">Loading captures…</div>
        ) : (captures?.length ?? 0) === 0 ? (
          <div className="grid place-items-center gap-2 py-20 text-center">
            <Camera size={30} className="text-neutral-700" />
            <div className="text-sm font-semibold text-neutral-400">No captures yet</div>
            <div className="max-w-sm text-[12.5px] text-neutral-500">
              {configured
                ? 'Request one above, or trigger a capture from a device in GPS Live. On Android 12+ the covert camera can be blocked — the officer then gets a “Tap to capture” notification to complete it.'
                : 'Configure photo storage (above) so captures have somewhere to land.'}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {captures!.map(c => (
              <button
                key={c.id}
                onClick={() => setLightbox(c)}
                className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-black/40 text-left"
              >
                <img src={c.url} alt={`Capture from ${c.device_name}`} loading="lazy" className="aspect-square w-full object-cover transition group-hover:scale-[1.03]" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2">
                  <div className="truncate text-[12px] font-bold text-white">{c.device_name}</div>
                  <div className="text-[10px] font-mono text-neutral-300">{relTime(c.created_at)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 p-4" onClick={() => setLightbox(null)}>
          <div className="relative max-h-full max-w-3xl" onClick={e => e.stopPropagation()}>
            <img src={lightbox.url} alt={`Capture from ${lightbox.device_name}`} className="max-h-[80vh] w-auto rounded-lg" />
            <div className="mt-2 flex items-center gap-3">
              <div className="mr-auto">
                <div className="text-sm font-bold text-white">{lightbox.device_name}</div>
                <div className="text-[11px] font-mono text-neutral-400">{relTime(lightbox.created_at)} · {new Date(lightbox.created_at).toLocaleString()}</div>
              </div>
              <a href={lightbox.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:text-white">
                <ExternalLink size={13} /> Full size
              </a>
              <button onClick={() => setLightbox(null)} className="grid h-8 w-8 place-items-center rounded-md border border-white/15 text-neutral-300 hover:text-white">
                <X size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
