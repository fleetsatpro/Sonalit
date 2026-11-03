import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api.js';
import { Play, Pause, Radio, History, Loader2, Rewind, AlertTriangle } from 'lucide-react';

export interface FrameMember {
  id: string; name: string; officer_name?: string | null;
  lat: number; lng: number; status: string;
  cross_track_km?: number | null; along_km?: number | null;
  schedule_delta_min?: number | null; route_len_km?: number | null;
  fix_age_ms?: number;
}
export interface ReplayFrame { t: string; members: FrameMember[] }
export interface ReplayResp {
  route: { lat: number; lng: number }[];
  width_km: number;
  since: string; until: string;
  frames: ReplayFrame[];
  device_count: number;
  fix_count: number;
}

const WINDOWS = [
  { hours: 3, label: '3h' },
  { hours: 12, label: '12h' },
  { hours: 24, label: '24h' },
  { hours: 72, label: '3d' },
];
const SPEEDS = [1, 2, 4, 8];

// One frame every 160ms at 1x: fast enough to read as motion, slow enough that
// a 60-frame window takes ~10s to play rather than flashing past.
const TICK_MS = 160;

function clock(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
function dayStamp(iso: string): string {
  return new Date(iso).toLocaleDateString([], { day: '2-digit', month: 'short' });
}

/**
 * The 4th dimension, made operable.
 *
 * The live view answers "where is the convoy now". This answers "where was it
 * at 06:40, and was it already off-corridor then" — which is the question that
 * matters after an incident. Every frame was evaluated server-side against the
 * elapsed schedule *at that moment*, so a truck reads as on-time at dawn and an
 * hour down by noon, rather than being judged throughout by its final state.
 */
export default function CorridorTimeline({ convoyId, live, onFrame }: {
  convoyId: string;
  /** True when the page is showing live positions; false while scrubbing. */
  live: boolean;
  /** Emits the frame to render, or null to hand the globe back to live data. */
  onFrame: (frame: ReplayFrame | null, replay: ReplayResp | null) => void;
}) {
  const [hours, setHours] = useState(12);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data, isFetching, error } = useQuery<ReplayResp>({
    queryKey: ['corridor-replay', convoyId, hours],
    enabled: !!convoyId && !live,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => (await api.get<{ data: ReplayResp }>(
      `/convoys/${convoyId}/corridor/replay`, { params: { hours, frames: 90 } },
    )).data.data,
  });

  const frames = data?.frames ?? [];
  const maxIdx = Math.max(0, frames.length - 1);

  // Land on the newest frame whenever a fresh window arrives, so entering
  // replay shows "now" rather than a blank window from hours ago.
  useEffect(() => {
    if (frames.length) setIdx(frames.length - 1);
  }, [data]);

  const emit = useCallback((i: number) => {
    if (!data || !frames.length) return;
    onFrame(frames[Math.max(0, Math.min(maxIdx, i))] ?? null, data);
  }, [data, frames, maxIdx, onFrame]);

  useEffect(() => {
    if (live) { onFrame(null, null); return; }
    emit(idx);
  }, [idx, live, emit, onFrame]);

  // Playback. Stops at the end rather than looping — replay is for reading a
  // specific stretch of time, and a silent wrap-around loses your place.
  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (!playing || live || !frames.length) return;
    timer.current = setInterval(() => {
      setIdx(prev => {
        if (prev >= maxIdx) { setPlaying(false); return maxIdx; }
        return prev + 1;
      });
    }, TICK_MS / speed);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [playing, speed, live, frames.length, maxIdx]);

  if (live) return null;

  const frame = frames[idx];
  const offCount = frame ? frame.members.filter(m => m.status === 'off_route').length : 0;

  return (
    <div className="border-t border-white/10 bg-black/60 px-3 py-2.5 backdrop-blur">
      {error ? (
        <p className="flex items-center gap-1.5 text-xs text-amber-300">
          <AlertTriangle size={13} /> No replay available — the corridor needs to be planned first.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPlaying(p => !p)}
              disabled={!frames.length}
              aria-label={playing ? 'Pause replay' : 'Play replay'}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40"
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button
              onClick={() => { setIdx(0); setPlaying(false); }}
              disabled={!frames.length}
              aria-label="Back to the start of the window"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 text-neutral-400 hover:text-white disabled:opacity-40"
            >
              <Rewind size={14} />
            </button>

            <input
              type="range" min={0} max={maxIdx} value={idx}
              onChange={e => { setIdx(Number(e.target.value)); setPlaying(false); }}
              disabled={!frames.length}
              aria-label="Scrub through the replay window"
              style={{ background: `linear-gradient(to right, #8b5cf6 ${(idx / (maxIdx || 1)) * 100}%, rgba(255,255,255,0.10) ${(idx / (maxIdx || 1)) * 100}%)` }}
              className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full disabled:opacity-40
                [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-violet-300
                [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-300"
            />

            <span className="shrink-0 font-mono text-sm font-semibold tabular-nums text-white">
              {frame ? clock(frame.t) : '--:--'}
            </span>
            {isFetching && <Loader2 size={13} className="shrink-0 animate-spin text-neutral-500" />}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
            <div className="flex items-center gap-1">
              {WINDOWS.map(w => (
                <button key={w.hours} onClick={() => { setHours(w.hours); setPlaying(false); }}
                  className={`rounded px-1.5 py-0.5 font-semibold ${hours === w.hours
                    ? 'bg-violet-500/20 text-violet-300' : 'text-neutral-500 hover:text-white'}`}>
                  {w.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 border-l border-white/10 pl-3">
              {SPEEDS.map(s => (
                <button key={s} onClick={() => setSpeed(s)}
                  className={`rounded px-1.5 py-0.5 font-mono ${speed === s
                    ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-white'}`}>
                  {s}×
                </button>
              ))}
            </div>
            {frame && (
              <span className="text-neutral-500">
                {dayStamp(frame.t)} · {frame.members.length} tracked
                {offCount > 0 && <span className="ml-1.5 font-semibold text-red-400">{offCount} off-corridor</span>}
              </span>
            )}
            {data && data.fix_count === 0 && (
              <span className="text-amber-400/80">no GPS recorded in this window</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** The live/replay switch, kept next to the globe rather than inside the bar. */
export function ModeToggle({ live, onChange }: { live: boolean; onChange: (live: boolean) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-white/10">
      <button onClick={() => onChange(true)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold ${live
          ? 'bg-emerald-500/15 text-emerald-300' : 'text-neutral-400 hover:text-white'}`}>
        <Radio size={12} /> Live
      </button>
      <button onClick={() => onChange(false)}
        className={`inline-flex items-center gap-1.5 border-l border-white/10 px-2.5 py-1.5 text-[11px] font-semibold ${!live
          ? 'bg-violet-500/15 text-violet-300' : 'text-neutral-400 hover:text-white'}`}>
        <History size={12} /> Replay
      </button>
    </div>
  );
}
