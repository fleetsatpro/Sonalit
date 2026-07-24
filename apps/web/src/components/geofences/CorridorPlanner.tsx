import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { MapPin, X, Loader2, Route as RouteIcon, Flag, Navigation } from 'lucide-react';

interface Place { name: string; lat: number; lng: number }
interface PlanResult { routing_provider: string | null; distance_km: number | null; duration_min: number | null; waypoint_count: number; planned: boolean }

// A place-name search box, geocoded server-side (backend Mapbox token) so the
// browser needs no key. Picks a single {name,lat,lng}.
function PlaceSearch({ label, Icon, selected, onSelect }: {
  label: string; Icon: typeof MapPin; selected: Place | null; onSelect: (p: Place | null) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) return;
    const query = q.trim();
    if (query.length < 3) { setResults([]); setOpen(false); return; }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ data: { results: Place[] } }>(`/guardian/geo/geocode?q=${encodeURIComponent(query)}`);
        setResults(r.data.data.results ?? []); setOpen(true);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [q, selected]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <label className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        <Icon size={12} /> {label}
      </label>
      {selected ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-sm text-white">
          <span className="min-w-0 flex-1 truncate">{selected.name}</span>
          <button onClick={() => { onSelect(null); setQ(''); }} className="text-neutral-400 hover:text-white" title="Clear">
            <X size={14} />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <input
              value={q} onChange={e => setQ(e.target.value)} onFocus={() => results.length && setOpen(true)}
              placeholder="Search a place…"
              className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 pr-8 text-sm text-white placeholder:text-neutral-600"
            />
            {loading && <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin text-neutral-500" />}
          </div>
          {open && results.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-white/10 bg-neutral-950 shadow-xl">
              {results.map((r, i) => (
                <li key={`${r.lat},${r.lng},${i}`}>
                  <button onClick={() => { onSelect(r); setOpen(false); }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm text-neutral-200 hover:bg-white/5">
                    <MapPin size={13} className="mt-0.5 shrink-0 text-neutral-500" />
                    <span className="min-w-0 flex-1">{r.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {open && !loading && q.trim().length >= 3 && results.length === 0 && (
            <p className="mt-1 px-1 text-xs text-neutral-600">No matches — check the backend Mapbox token, or type a fuller name.</p>
          )}
        </>
      )}
    </div>
  );
}

// Plan (or replace) a convoy's 4D corridor from an origin + destination. The
// backend routes the real road between them and stores it as the centre-line.
export default function CorridorPlanner({ convoyId, onSaved }: { convoyId: string; onSaved: () => void }) {
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [widthKm, setWidthKm] = useState(2);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PlanResult | null>(null);

  const canPlan = !!origin && !!destination && !saving;

  const plan = async () => {
    if (!origin || !destination) return;
    setSaving(true); setError(''); setResult(null);
    try {
      const r = await api.post<{ data: PlanResult }>(`/convoys/${convoyId}/corridor`, {
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: destination.lat, lng: destination.lng },
        width_km: widthKm,
      });
      setResult(r.data.data);
      onSaved();
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Could not plan the corridor. Try again.');
    } finally { setSaving(false); }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
        <RouteIcon size={15} className="text-violet-400" /> Plan the route corridor
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <PlaceSearch label="Origin" Icon={Navigation} selected={origin} onSelect={setOrigin} />
        <PlaceSearch label="Destination" Icon={Flag} selected={destination} onSelect={setDestination} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-xs text-neutral-400">
          Corridor width
          <input type="range" min={0.5} max={10} step={0.5} value={widthKm}
            onChange={e => setWidthKm(Number(e.target.value))} className="accent-violet-500" />
          <span className="w-12 font-mono text-neutral-300">±{widthKm} km</span>
        </label>
        <button onClick={plan} disabled={!canPlan}
          className="ml-auto inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <RouteIcon size={15} />}
          {saving ? 'Planning…' : 'Plan corridor'}
        </button>
      </div>

      {error && <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2 text-xs text-red-300">{error}</p>}
      {result && (
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-xs text-emerald-200">
          <span>✓ corridor saved</span>
          <span>{result.planned ? `routed · ${result.routing_provider ?? 'osrm'}` : 'straight seed (no router)'}</span>
          {result.distance_km != null && <span>{result.distance_km.toFixed(1)} km</span>}
          {result.duration_min != null && <span>~{result.duration_min} min drive</span>}
          <span>{result.waypoint_count} waypoints</span>
        </div>
      )}
    </div>
  );
}
