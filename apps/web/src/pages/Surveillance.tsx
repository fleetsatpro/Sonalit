import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Camera, ShieldAlert, X, RefreshCw, ExternalLink, MapPin, Search, LayoutGrid, Map as MapIcon, Crosshair, Siren, Sparkles, Users, Car, Loader, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuthStore } from '../stores/auth.js';

// Surveillance — the covert-capture console. Every photo a Guardian device took
// in response to a capture_photo command (org-wide), now located: each capture
// carries the device's fix at capture time (falling back to last-known), so the
// gallery doubles as a map. Filter by officer, search, narrow the time window,
// and read the reverse-geocoded address of any shot.

interface CaptureAI {
  summary: string | null;
  labels: string[];
  person_count: number;
  has_weapon: boolean;
  plates: string[];
  vehicles: string[];
  threat_level: 'low' | 'medium' | 'high';
}
interface Capture {
  id: string; device_id: string; url: string; created_at: string;
  device_name: string; officer_name?: string | null;
  trigger_reason?: string | null;
  lat?: number | null; lng?: number | null;
  ai?: CaptureAI | null;
}
interface Device { id: string; name: string; officer_name?: string | null; status?: string }

type Facet = 'people' | 'weapon' | 'vehicle';
const FACETS: Array<{ k: Facet; label: string; icon: typeof Users }> = [
  { k: 'people', label: 'People', icon: Users },
  { k: 'weapon', label: 'Weapon', icon: ShieldAlert },
  { k: 'vehicle', label: 'Vehicle', icon: Car },
];
const THREAT_COLOR: Record<string, string> = { low: 'text-emerald-400', medium: 'text-amber-400', high: 'text-red-400' };

const WINDOWS: Array<{ k: string; label: string; ms: number | null }> = [
  { k: 'all', label: 'All', ms: null },
  { k: '24h', label: '24h', ms: 24 * 3600_000 },
  { k: '6h', label: '6h', ms: 6 * 3600_000 },
  { k: '1h', label: '1h', ms: 3600_000 },
];

const SAT_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    sat: { type: 'raster', tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: '© Esri, Maxar' },
    ref: { type: 'raster', tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
  },
  layers: [
    { id: 'sat', type: 'raster', source: 'sat' },
    { id: 'ref', type: 'raster', source: 'ref', paint: { 'raster-opacity': 0.7 } },
  ],
};

function relTime(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Reverse-geocoded street address for the open lightbox (backend proxies
// Nominatim + caches). Coordinate-less captures skip the call entirely.
function useAddress(lat?: number | null, lng?: number | null) {
  return useQuery<{ short: string | null; address: string | null }>({
    queryKey: ['revgeo', lat, lng],
    enabled: lat != null && lng != null,
    staleTime: 24 * 3600_000,
    queryFn: async () => (await api.get('/dashboard/reverse-geocode', { params: { lat, lng } })).data as { short: string | null; address: string | null },
  });
}

export default function Surveillance() {
  const qc = useQueryClient();
  // Deleting a covert capture destroys surveillance evidence — admin only,
  // mirroring the backend authorize('admin') gate on DELETE /captures/:id.
  const isAdmin = useAuthStore((s) => s.user?.role) === 'admin';
  const [deviceId, setDeviceId] = useState<string>('');
  const [lightbox, setLightbox] = useState<Capture | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [view, setView] = useState<'grid' | 'map'>('grid');
  const [search, setSearch] = useState('');
  const [filterDevice, setFilterDevice] = useState('');
  const [win, setWin] = useState('all');
  const [facets, setFacets] = useState<Set<Facet>>(new Set());

  const { data: status } = useQuery<{ configured: boolean; ai_configured?: boolean }>({
    queryKey: ['capture-status'],
    queryFn: async () => (await api.get('/guardian/capture/status')).data as { configured: boolean; ai_configured?: boolean },
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
      let n = 0;
      const iv = setInterval(() => { void qc.invalidateQueries({ queryKey: ['captures-recent'] }); if (++n >= 8) clearInterval(iv); }, 3000);
    },
    onError: () => setNote({ kind: 'err', text: 'Failed to send the capture command to the device.' }),
  });

  // (Re)tag a single capture on demand.
  const analyzeOne = useMutation({
    mutationFn: (id: string) => api.post(`/guardian/captures/${id}/analyze`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['captures-recent'] }),
    onError: () => setNote({ kind: 'err', text: 'Analysis failed — check the AI vision configuration.' }),
  });
  // Backfill: tag captures that predate the feature.
  const analyzeUntagged = useMutation({
    mutationFn: () => api.post('/guardian/captures/analyze-untagged', { limit: 15 }),
    onSuccess: (r) => {
      const d = (r.data as { data?: { analyzed?: number } })?.data;
      setNote({ kind: 'ok', text: `Tagged ${d?.analyzed ?? 0} capture(s).` });
      void qc.invalidateQueries({ queryKey: ['captures-recent'] });
    },
    onError: () => setNote({ kind: 'err', text: 'Backfill failed — check the AI vision configuration.' }),
  });

  // Admin: permanently delete a capture (photo + record). Optimistically drops
  // it from the gallery; the backend also deletes the stored R2 object.
  const deleteCapture = useMutation({
    mutationFn: (id: string) => api.delete(`/guardian/captures/${id}`),
    onSuccess: (_r, id) => {
      setLightbox((lb) => (lb && lb.id === id ? null : lb));
      qc.setQueryData<Capture[]>(['captures-recent'], (prev) => (prev ?? []).filter((c) => c.id !== id));
      setNote({ kind: 'ok', text: 'Capture deleted.' });
    },
    onError: () => setNote({ kind: 'err', text: 'Failed to delete the capture.' }),
  });
  function confirmDelete(c: Capture) {
    if (window.confirm('Delete this capture permanently? This removes the photo and its record for everyone.')) {
      deleteCapture.mutate(c.id);
    }
  }

  const guardianDevices = useMemo(() => (devices ?? []).filter(d => !!d.name), [devices]);
  const configured = status?.configured !== false;
  const aiConfigured = status?.ai_configured !== false;

  const toggleFacet = (f: Facet) => setFacets(prev => {
    const next = new Set(prev);
    next.has(f) ? next.delete(f) : next.add(f);
    return next;
  });

  // Apply the filter bar: device, free-text (officer/device/AI tags), time
  // window, and the AI facet chips (people / weapon / vehicle).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cutoff = WINDOWS.find(w => w.k === win)?.ms;
    const min = cutoff != null ? Date.now() - cutoff : null;
    return (captures ?? []).filter(c => {
      if (filterDevice && c.device_id !== filterDevice) return false;
      if (min != null && new Date(c.created_at).getTime() < min) return false;
      if (facets.has('people') && !((c.ai?.person_count ?? 0) > 0)) return false;
      if (facets.has('weapon') && !c.ai?.has_weapon) return false;
      if (facets.has('vehicle') && !((c.ai?.vehicles?.length ?? 0) > 0 || (c.ai?.plates?.length ?? 0) > 0)) return false;
      if (q) {
        const ai = c.ai;
        const hay = [c.device_name, c.officer_name ?? '', ai?.summary ?? '',
          ...(ai?.labels ?? []), ...(ai?.plates ?? []), ...(ai?.vehicles ?? [])].join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [captures, search, filterDevice, win, facets]);

  const located = useMemo(() => filtered.filter(c => c.lat != null && c.lng != null), [filtered]);

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-500/40 bg-violet-500/10 text-violet-300">
          <Camera size={20} />
        </div>
        <div className="mr-auto">
          <h1 className="text-lg font-black text-white leading-none">Surveillance</h1>
          <div className="mt-1 text-[11px] font-mono uppercase tracking-widest text-neutral-500">
            Located captures · {filtered.length} shown · {located.length} on map
          </div>
        </div>
        {/* View toggle */}
        <div className="flex overflow-hidden rounded-lg border border-white/10">
          <button
            onClick={() => setView('grid')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold ${view === 'grid' ? 'bg-violet-600 text-white' : 'bg-white/[0.04] text-neutral-300 hover:text-white'}`}
          >
            <LayoutGrid size={14} /> Grid
          </button>
          <button
            onClick={() => setView('map')}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold ${view === 'map' ? 'bg-violet-600 text-white' : 'bg-white/[0.04] text-neutral-300 hover:text-white'}`}
          >
            <MapIcon size={14} /> Map
          </button>
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

      {/* Filters + request-a-capture */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search officer, device, plate, or scene…"
            className="w-full rounded-md border border-white/10 bg-neutral-900 py-2 pl-9 pr-3 text-sm text-white outline-none placeholder:text-neutral-600"
          />
        </div>
        <select
          value={filterDevice}
          onChange={e => setFilterDevice(e.target.value)}
          className="rounded-md border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-white outline-none"
        >
          <option value="">All devices</option>
          {guardianDevices.map(d => (
            <option key={d.id} value={d.id}>{d.officer_name ? `${d.officer_name} · ${d.name}` : d.name}</option>
          ))}
        </select>
        <div className="flex overflow-hidden rounded-md border border-white/10">
          {WINDOWS.map(w => (
            <button
              key={w.k}
              onClick={() => setWin(w.k)}
              className={`px-3 py-2 text-xs font-mono ${win === w.k ? 'bg-violet-600 text-white' : 'bg-neutral-900 text-neutral-400 hover:text-white'}`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {/* AI facet chips + backfill */}
      <div className="-mt-1 flex flex-wrap items-center gap-2">
        <Sparkles size={13} className="text-violet-400" />
        {FACETS.map(f => {
          const on = facets.has(f.k);
          const Icon = f.icon;
          return (
            <button
              key={f.k}
              onClick={() => toggleFacet(f.k)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold ${on ? 'border-violet-500 bg-violet-600/20 text-violet-200' : 'border-white/10 bg-white/[0.03] text-neutral-400 hover:text-white'}`}
            >
              <Icon size={12} /> {f.label}
            </button>
          );
        })}
        {aiConfigured && (captures ?? []).some(c => !c.ai) && (
          <button
            onClick={() => analyzeUntagged.mutate()}
            disabled={analyzeUntagged.isPending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-violet-500/40 bg-violet-600/10 px-3 py-1 text-[11px] font-semibold text-violet-200 hover:bg-violet-600/20 disabled:opacity-40"
          >
            {analyzeUntagged.isPending ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {analyzeUntagged.isPending ? 'Tagging…' : 'Tag untagged'}
          </button>
        )}
      </div>

      {/* AI status banner */}
      {status && status.configured && !aiConfigured && (
        <div className="flex items-start gap-3 rounded-lg border border-violet-600/30 bg-violet-950/20 p-3">
          <Sparkles size={18} className="mt-0.5 flex-none text-violet-400" />
          <div className="text-[12.5px] leading-relaxed text-violet-100">
            <b>AI auto-tagging isn’t configured.</b> Set <code className="mx-1 rounded bg-black/40 px-1 py-0.5 text-[11px] text-violet-200">ANTHROPIC_API_KEY</code>
            on the backend and captures will be scanned for people, weapons, vehicles, and licence plates automatically.
          </div>
        </div>
      )}
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

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading ? (
          <div className="grid h-full place-items-center text-sm text-neutral-500">Loading captures…</div>
        ) : filtered.length === 0 ? (
          <div className="grid h-full place-items-center gap-2 py-20 text-center">
            <Camera size={30} className="text-neutral-700" />
            <div className="text-sm font-semibold text-neutral-400">{(captures?.length ?? 0) === 0 ? 'No captures yet' : 'Nothing matches these filters'}</div>
            <div className="max-w-sm text-[12.5px] text-neutral-500">
              {(captures?.length ?? 0) === 0
                ? (configured
                  ? 'Request one above, or trigger a capture from a device in GPS Live. On Android 12+ the covert camera can be blocked — the officer then gets a “Tap to capture” notification to complete it.'
                  : 'Configure photo storage (above) so captures have somewhere to land.')
                : 'Widen the time window or clear the search to see more.'}
            </div>
          </div>
        ) : view === 'map' ? (
          <CaptureMap captures={located} onPick={setLightbox} selectedId={lightbox?.id ?? null} />
        ) : (
          <div className="h-full overflow-y-auto">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {filtered.map(c => (
                <div
                  key={c.id}
                  className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-black/40"
                >
                  <button type="button" onClick={() => setLightbox(c)} className="block w-full text-left">
                  <img src={c.url} alt={`Capture from ${c.device_name}`} loading="lazy" className="aspect-square w-full object-cover transition group-hover:scale-[1.03]" />
                  {c.trigger_reason === 'panic' && (
                    <div className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-red-600/90 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white shadow-lg" title="Auto-captured on panic">
                      <Siren size={10} /> SOS
                    </div>
                  )}
                  {c.lat != null && c.lng != null && (
                    <div className={`absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-violet-600/90 text-white shadow-lg ${isAdmin ? 'transition group-hover:opacity-0' : ''}`} title="Located">
                      <MapPin size={13} />
                    </div>
                  )}
                  {/* AI facet badges (weapon → red, person count, plate) */}
                  {c.ai && (
                    <div className="absolute left-2 top-2 flex flex-col items-start gap-1" style={c.trigger_reason === 'panic' ? { top: 34 } : undefined}>
                      {c.ai.has_weapon && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-600/90 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white shadow" title="Weapon detected">
                          <ShieldAlert size={10} /> Weapon
                        </span>
                      )}
                      {c.ai.person_count > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[9px] font-bold text-white shadow" title={`${c.ai.person_count} people`}>
                          <Users size={10} /> {c.ai.person_count}
                        </span>
                      )}
                      {c.ai.plates.length > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-cyan-600/85 px-2 py-0.5 text-[9px] font-black tracking-wider text-white shadow" title="Plate read">
                          <Car size={10} /> {c.ai.plates[0]}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2">
                    <div className="truncate text-[12px] font-bold text-white">{c.device_name}</div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[10px] font-mono text-neutral-300">{relTime(c.created_at)}</div>
                      {c.ai
                        ? <span className={`text-[9px] font-black uppercase ${THREAT_COLOR[c.ai.threat_level] ?? 'text-neutral-400'}`}>{c.ai.threat_level}</span>
                        : <Sparkles size={10} className="text-neutral-600" />}
                    </div>
                  </div>
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      title="Delete capture"
                      aria-label="Delete capture"
                      onClick={(e) => { e.stopPropagation(); confirmDelete(c); }}
                      disabled={deleteCapture.isPending}
                      className="absolute right-2 top-2 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-red-600/90 text-white opacity-0 shadow-lg transition group-hover:opacity-100 hover:bg-red-500 disabled:opacity-40"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {lightbox && (
        <Lightbox
          capture={(captures ?? []).find(c => c.id === lightbox.id) ?? lightbox}
          aiConfigured={aiConfigured}
          analyzing={analyzeOne.isPending}
          onAnalyze={() => analyzeOne.mutate(lightbox.id)}
          onClose={() => setLightbox(null)}
          canDelete={isAdmin}
          onDelete={() => confirmDelete(lightbox)}
        />
      )}
    </div>
  );
}

// ── Map ──────────────────────────────────────────────────────────────────────
function CaptureMap({ captures, onPick, selectedId }: { captures: Capture[]; onPick: (c: Capture) => void; selectedId: string | null }) {
  const el = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!el.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: el.current, style: SAT_STYLE, center: [37, 3], zoom: 4, attributionControl: false });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => setReady(true));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; setReady(false); };
  }, []);

  // Rebuild markers whenever the located set changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    const bounds = new maplibregl.LngLatBounds();
    for (const c of captures) {
      const lat = c.lat!, lng = c.lng!;
      const wrap = document.createElement('button');
      wrap.className = c.trigger_reason === 'panic' ? 'sv-pin is-sos' : 'sv-pin';
      wrap.title = `${c.device_name} · ${relTime(c.created_at)}${c.trigger_reason === 'panic' ? ' · SOS' : ''}`;
      wrap.innerHTML = `<img src="${c.url}" alt="" loading="lazy"/>`;
      wrap.addEventListener('click', (e) => { e.stopPropagation(); onPick(c); });
      const marker = new maplibregl.Marker({ element: wrap, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(map);
      markersRef.current.push(marker);
      bounds.extend([lng, lat]);
    }
    if (captures.length === 1) {
      map.easeTo({ center: [captures[0]!.lng!, captures[0]!.lat!], zoom: 15, duration: 700 });
    } else if (captures.length > 1) {
      map.fitBounds(bounds, { padding: 70, maxZoom: 15, duration: 700 });
    }
  }, [captures, ready, onPick]);

  // Reflect the selected capture on its marker.
  useEffect(() => {
    markersRef.current.forEach((m, i) => {
      const c = captures[i];
      m.getElement().classList.toggle('is-sel', !!c && c.id === selectedId);
    });
  }, [selectedId, captures]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-white/[0.08]">
      <div ref={el} className="absolute inset-0" />
      <style>{`
        .sv-pin{width:46px;height:46px;padding:0;border:2px solid rgba(183,157,255,.9);border-radius:10px;
          overflow:hidden;cursor:pointer;background:#0b0b12;box-shadow:0 6px 18px -6px #000;line-height:0;transition:transform .12s,border-color .12s}
        .sv-pin:hover{transform:scale(1.12);border-color:#fff;z-index:2}
        .sv-pin.is-sos{border-color:#ff3b5c;box-shadow:0 0 0 2px rgba(255,59,92,.35),0 6px 18px -6px #000}
        .sv-pin.is-sel{border-color:#fff;box-shadow:0 0 0 3px rgba(183,157,255,.5),0 6px 18px -6px #000;transform:scale(1.15);z-index:3}
        .sv-pin img{width:100%;height:100%;object-fit:cover}
        .maplibregl-ctrl-attrib,.maplibregl-ctrl-logo{display:none!important}
      `}</style>
    </div>
  );
}

// ── Lightbox ─────────────────────────────────────────────────────────────────
function Lightbox({ capture, aiConfigured, analyzing, onAnalyze, onClose, canDelete, onDelete }: {
  capture: Capture; aiConfigured: boolean; analyzing: boolean; onAnalyze: () => void; onClose: () => void;
  canDelete: boolean; onDelete: () => void;
}) {
  const { data: geo, isLoading } = useAddress(capture.lat, capture.lng);
  const hasLoc = capture.lat != null && capture.lng != null;
  const ai = capture.ai;
  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/85 p-4" onClick={onClose}>
      <div className="relative max-h-full max-w-3xl" onClick={e => e.stopPropagation()}>
        <img src={capture.url} alt={`Capture from ${capture.device_name}`} className="max-h-[70vh] w-auto rounded-lg" />
        {/* AI analysis panel */}
        <div className="mt-2 rounded-lg border border-violet-500/20 bg-violet-950/20 p-3">
          {ai ? (
            <>
              <div className="flex items-center gap-2">
                <Sparkles size={13} className="text-violet-400" />
                <span className="text-[10px] font-mono uppercase tracking-widest text-violet-300">AI analysis</span>
                <span className={`ml-auto text-[10px] font-black uppercase ${THREAT_COLOR[ai.threat_level] ?? 'text-neutral-400'}`}>{ai.threat_level} threat</span>
              </div>
              {ai.summary && <div className="mt-1.5 text-[13px] leading-snug text-neutral-100">{ai.summary}</div>}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {ai.has_weapon && <span className="inline-flex items-center gap-1 rounded-full bg-red-600/90 px-2 py-0.5 text-[10px] font-bold text-white"><ShieldAlert size={11} /> Weapon</span>}
                {ai.person_count > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-neutral-200"><Users size={11} /> {ai.person_count} {ai.person_count === 1 ? 'person' : 'people'}</span>}
                {ai.plates.map(p => <span key={p} className="inline-flex items-center gap-1 rounded-full bg-cyan-600/25 px-2 py-0.5 text-[10px] font-black tracking-wider text-cyan-200"><Car size={11} /> {p}</span>)}
                {ai.vehicles.map((v, i) => <span key={i} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-neutral-300">{v}</span>)}
                {ai.labels.map(l => <span key={l} className="rounded-full bg-white/[0.04] px-2 py-0.5 text-[10px] text-neutral-400">{l}</span>)}
              </div>
              {aiConfigured && (
                <button onClick={onAnalyze} disabled={analyzing} className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-semibold text-violet-300 hover:text-violet-200 disabled:opacity-40">
                  {analyzing ? <Loader size={11} className="animate-spin" /> : <RefreshCw size={11} />} Re-analyze
                </button>
              )}
            </>
          ) : (
            <div className="flex items-center gap-3">
              <Sparkles size={15} className="text-neutral-600" />
              <div className="mr-auto text-[12px] text-neutral-400">{aiConfigured ? 'Not yet analysed.' : 'AI vision not configured.'}</div>
              {aiConfigured && (
                <button onClick={onAnalyze} disabled={analyzing} className="inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-violet-500 disabled:opacity-40">
                  {analyzing ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />} {analyzing ? 'Analysing…' : 'Analyse'}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="mt-2 flex items-start gap-3">
          <div className="mr-auto min-w-0">
            <div className="flex items-center gap-2">
              <div className="text-sm font-bold text-white">{capture.device_name}</div>
              {capture.trigger_reason === 'panic' && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-600/90 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">
                  <Siren size={10} /> SOS burst
                </span>
              )}
            </div>
            <div className="text-[11px] font-mono text-neutral-400">{relTime(capture.created_at)} · {new Date(capture.created_at).toLocaleString()}</div>
            {hasLoc ? (
              <div className="mt-1 flex items-center gap-1.5 text-[12px] text-violet-300">
                <MapPin size={13} className="flex-none" />
                <span className="truncate">
                  {isLoading ? 'Locating…' : (geo?.short || `${capture.lat!.toFixed(5)}, ${capture.lng!.toFixed(5)}`)}
                </span>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-1.5 text-[12px] text-neutral-500">
                <Crosshair size={13} className="flex-none" /> No location on this capture
              </div>
            )}
          </div>
          {hasLoc && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${capture.lat},${capture.lng}`}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:text-white"
            >
              <MapPin size={13} /> Map
            </a>
          )}
          <a href={capture.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-md border border-white/15 px-3 py-1.5 text-xs font-semibold text-neutral-200 hover:text-white">
            <ExternalLink size={13} /> Full size
          </a>
          {canDelete && (
            <button onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-md border border-red-500/40 bg-red-600/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-600/20 hover:text-red-200">
              <Trash2 size={13} /> Delete
            </button>
          )}
          <button onClick={onClose} className="grid h-8 w-8 flex-none place-items-center rounded-md border border-white/15 text-neutral-300 hover:text-white">
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
