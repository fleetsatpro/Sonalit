import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { MapPin, X, Loader2, Route as RouteIcon, Flag, Navigation, ArrowLeftRight, AlertTriangle, Check } from 'lucide-react';

interface Place { name: string; lat: number; lng: number }
interface PlanResult { routing_provider: string | null; distance_km: number | null; duration_min: number | null; waypoint_count: number; planned: boolean }
interface PlanError { title: string; hint?: string; detail: string }

const WIDTH_MIN = 0.5;
const WIDTH_MAX = 10;

type ApiError = { response?: { status?: number; data?: { error?: string } }; message?: string };

// Prefer the API's own message, then axios' — a silent "no matches" hid real
// failures (a 404 on the endpoint, an expired session) behind a token hint.
function errText(e: unknown, fallback: string): string {
  const err = e as ApiError;
  return err?.response?.data?.error || err?.message || fallback;
}

/**
 * Turn a raw failure into something an operator can act on. A bare
 * "POST /api/v1/convoys/<uuid>/corridor not found" tells them nothing about
 * what to do next; the status code says exactly whose problem it is.
 */
function planError(e: unknown): PlanError {
  const err = e as ApiError;
  const status = err?.response?.status;
  const detail = errText(e, 'Unknown error');

  if (status === 404 && /corridor/.test(detail) && /not found/i.test(detail)) {
    return {
      title: 'The API build in front of you has no corridor endpoint',
      hint: 'This is a server-side gap, not something you can fix from here — the backend needs redeploying with the corridor route.',
      detail,
    };
  }
  if (status === 404) return { title: 'Convoy not found', hint: 'It may have been deleted, or belongs to another organisation.', detail };
  if (status === 400) return { title: 'The route could not be accepted', hint: 'Re-pick the origin and destination and try again.', detail };
  if (status === 401 || status === 403) return { title: 'Not authorised to plan this corridor', hint: 'Your session may have expired — sign in again.', detail };
  if (status === 429) return { title: 'Too many requests', hint: 'Give it a moment before planning again.', detail };
  if (status && status >= 500) return { title: 'The server failed while planning', hint: 'The routing provider may be down. Try again shortly.', detail };
  if (!status) return { title: 'Could not reach the server', hint: 'Check the connection and try again.', detail };
  return { title: 'Could not plan the corridor', detail };
}

// A place-name search box, geocoded server-side (backend Mapbox token) so the
// browser needs no key. Picks a single {name,lat,lng}.
function PlaceSearch({ label, Icon, selected, onSelect }: {
  label: string; Icon: typeof MapPin; selected: Place | null; onSelect: (p: Place | null) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) { setLoading(false); return; }
    const query = q.trim();
    if (query.length < 3) { setResults([]); setLookupError(''); setOpen(false); setLoading(false); return; }
    setLoading(true);
    // Keystrokes can outrun responses; only the newest lookup may write state.
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api.get<{ data: { results: Place[] } }>('/guardian/geo/geocode', { params: { q: query } });
        if (!live) return;
        setResults(r.data.data.results ?? []); setLookupError(''); setOpen(true);
      } catch (e) {
        if (!live) return;
        setResults([]);
        setLookupError(errText(e, 'Place lookup failed.'));
        setOpen(true);
      } finally { if (live) setLoading(false); }
    }, 350);
    return () => { live = false; clearTimeout(t); };
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
            lookupError
              ? <p className="mt-1 px-1 text-xs text-red-400">{lookupError}</p>
              : <p className="mt-1 px-1 text-xs text-neutral-600">No matches — check the backend Mapbox token, or type a fuller name.</p>
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
  const [error, setError] = useState<PlanError | null>(null);
  const [result, setResult] = useState<PlanResult | null>(null);

  const canPlan = !!origin && !!destination && !saving;
  const swap = () => { setOrigin(destination); setDestination(origin); };
  const widthPct = ((widthKm - WIDTH_MIN) / (WIDTH_MAX - WIDTH_MIN)) * 100;

  const plan = async () => {
    if (!origin || !destination) return;
    setSaving(true); setError(null); setResult(null);
    try {
      const r = await api.post<{ data: PlanResult }>(`/convoys/${convoyId}/corridor`, {
        origin: { lat: origin.lat, lng: origin.lng },
        destination: { lat: destination.lat, lng: destination.lng },
        width_km: widthKm,
      });
      setResult(r.data.data);
      onSaved();
    } catch (e) {
      setError(planError(e));
    } finally { setSaving(false); }
  };

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-violet-500/[0.05] to-transparent">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3 text-sm font-semibold text-white">
        <RouteIcon size={15} className="text-violet-400" /> Plan the route corridor
        <span className="ml-auto hidden text-[11px] font-normal text-neutral-500 sm:inline">
          the road between is routed for you
        </span>
      </div>

      <div className="p-4">
        {/* Origin → destination, drawn as the leg it is. */}
        <div className="relative grid gap-3 sm:grid-cols-2">
          <PlaceSearch label="Origin" Icon={Navigation} selected={origin} onSelect={setOrigin} />
          <PlaceSearch label="Destination" Icon={Flag} selected={destination} onSelect={setDestination} />
          {origin && destination && (
            <button onClick={swap} title="Swap origin and destination"
              className="absolute left-1/2 top-[30px] hidden h-6 w-6 -translate-x-1/2 place-items-center rounded-full border border-white/15 bg-neutral-900 text-neutral-400 hover:text-white sm:grid">
              <ArrowLeftRight size={11} />
            </button>
          )}
        </div>

        <div className="mt-4 rounded-lg border border-white/[0.07] bg-black/30 p-3">
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
            <span>Corridor width</span>
            <span className="font-mono text-sm normal-case tracking-normal text-violet-300">±{widthKm} km</span>
          </div>
          {/* The track is painted by hand: accent-color only tints the filled
              half, leaving the UA's bright white bar across a dark panel, and
              color-scheme:dark does not override it in Chrome. */}
          <input type="range" min={WIDTH_MIN} max={WIDTH_MAX} step={0.5} value={widthKm}
            onChange={e => setWidthKm(Number(e.target.value))}
            style={{ background: `linear-gradient(to right, #8b5cf6 ${widthPct}%, rgba(255,255,255,0.10) ${widthPct}%)` }}
            className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full
              [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-violet-300
              [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-300 [&::-webkit-slider-thumb]:shadow-[0_0_0_3px_rgba(139,92,246,0.25)]" />
          <div className="mt-1 flex justify-between text-[10px] font-mono text-neutral-600">
            <span>{WIDTH_MIN} km tight</span><span>5</span><span>{WIDTH_MAX} km loose</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-neutral-500">
            How far a truck may drift from the road before it reads as off-corridor.
          </p>
        </div>

        <button onClick={plan} disabled={!canPlan}
          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto">
          {saving ? <Loader2 size={15} className="animate-spin" /> : <RouteIcon size={15} />}
          {saving ? 'Routing the road…' : 'Plan corridor'}
        </button>
        {!canPlan && !saving && (
          <p className="mt-2 text-[11px] text-neutral-600">Pick both an origin and a destination to plan.</p>
        )}

        {error && (
          <div className="mt-3 rounded-lg border border-red-500/25 bg-red-500/[0.06] p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-red-300">
              <AlertTriangle size={13} /> {error.title}
            </p>
            {error.hint && <p className="mt-1 text-[11px] leading-relaxed text-red-200/70">{error.hint}</p>}
            <p className="mt-2 break-all rounded bg-black/40 px-2 py-1 font-mono text-[10px] text-red-300/60">{error.detail}</p>
          </div>
        )}
        {result && (
          <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-300">
              <Check size={13} /> Corridor saved
              <span className="font-normal text-emerald-200/60">
                · {result.planned ? `routed on real roads (${result.routing_provider ?? 'osrm'})` : 'straight seed — no router reachable'}
              </span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {result.distance_km != null && <Pill label="distance" value={`${result.distance_km.toFixed(1)} km`} />}
              {result.duration_min != null && <Pill label="drive" value={fmtDuration(result.duration_min)} />}
              <Pill label="waypoints" value={String(result.waypoint_count)} />
              <Pill label="width" value={`±${widthKm} km`} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-md border border-emerald-500/20 bg-black/30 px-2 py-1 text-[11px] text-emerald-200">
      <span className="font-mono font-semibold">{value}</span>
      <span className="ml-1.5 text-emerald-200/50">{label}</span>
    </span>
  );
}

function fmtDuration(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  return `${h}h ${Math.round(min % 60)}m`;
}
