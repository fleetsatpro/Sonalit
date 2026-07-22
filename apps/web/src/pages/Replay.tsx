import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery } from '@tanstack/react-query';
import { Play, Pause, SkipBack, Camera, Volume2, Siren, TriangleAlert } from 'lucide-react';
import { api } from '../lib/api.js';
import '../styles/replay.css';

// 4D Ops Replay — a DVR for the whole operation. Scrub a time window and watch
// every vehicle + Guardian device move along its real track while panic / voice
// / capture / alert events fire at their true timestamps.

interface TrackPt { t: number; lat: number; lng: number; spd: number }
interface Entity { id: string; name: string; track: TrackPt[] }
type EventKind = 'panic' | 'voice' | 'capture' | 'alert';
interface RepEvent {
  kind: EventKind; id: string; at: number; deviceId?: string; vehicleId?: string;
  lat: number | null; lng: number | null; label: string; sub: string;
  durationMs?: number | null; url?: string; severity?: string;
}
interface ReplayData { window: { from: number; to: number }; vehicles: Entity[]; devices: Entity[]; events: RepEvent[] }

const WINDOWS: Array<{ k: string; h: number }> = [
  { k: '1h', h: 1 }, { k: '6h', h: 6 }, { k: '24h', h: 24 },
];
const KIND_COLOR: Record<EventKind, string> = { panic: '#ff3b5c', voice: '#ffb23e', capture: '#b79dff', alert: '#37e6ff' };

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

// Interpolate a track's position at time T. Returns null outside its span.
function posAt(track: TrackPt[], T: number): { lat: number; lng: number; spd: number } | null {
  if (track.length === 0) return null;
  if (T <= track[0]!.t) return track[0]!.t === T ? { lat: track[0]!.lat, lng: track[0]!.lng, spd: track[0]!.spd } : null;
  const last = track[track.length - 1]!;
  if (T >= last.t) return null; // gone dark after its last fix
  let lo = 0, hi = track.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (track[mid]!.t <= T) lo = mid; else hi = mid; }
  const a = track[lo]!, b = track[hi]!;
  const f = (T - a.t) / Math.max(1, b.t - a.t);
  return { lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, spd: a.spd + (b.spd - a.spd) * f };
}
// A track's known position at time T even outside its span (nearest endpoint) —
// used to pin an event that carries no coordinates to where its device was.
function nearestPos(track: TrackPt[], T: number): { lat: number; lng: number } | null {
  if (track.length === 0) return null;
  const inside = posAt(track, T);
  if (inside) return inside;
  const first = track[0]!, last = track[track.length - 1]!;
  return T <= first.t ? { lat: first.lat, lng: first.lng } : { lat: last.lat, lng: last.lng };
}

function fmtClock(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const SPEEDS = [1, 8, 60, 300];

export default function Replay() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const [winH, setWinH] = useState(6);
  const to = useMemo(() => Date.now(), [winH]); // fixed per load
  const from = to - winH * 3600_000;

  const { data, isFetching } = useQuery<ReplayData>({
    queryKey: ['replay', winH, to],
    queryFn: async () => (await api.get<ReplayData>(`/dashboard/replay?from=${new Date(from).toISOString()}&to=${new Date(to).toISOString()}`)).data,
    staleTime: 60_000,
  });

  // playback clock
  const headRef = useRef(from);
  const playingRef = useRef(false);
  const speedRef = useRef(1);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [head, setHead] = useState(from);
  const knobRef = useRef<HTMLDivElement>(null);
  const [selEvent, setSelEvent] = useState<string | null>(null);

  // voice playback
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const playVoice = async (deviceId: string, voiceId: string) => {
    try {
      const res = await api.get(`/guardian/devices/${deviceId}/voice-messages/${voiceId}/audio`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      if (!playerRef.current) playerRef.current = new Audio();
      const p = playerRef.current; p.src = url; p.volume = 1;
      p.onended = () => { setPlayingVoice(null); URL.revokeObjectURL(url); };
      await p.play(); setPlayingVoice(voiceId);
    } catch { setPlayingVoice(null); }
  };
  useEffect(() => () => playerRef.current?.pause(), []);

  // event positions are static: computed once from tracks at each event's own time
  const positionedEvents = useMemo<Array<RepEvent & { px: number | null; py: number | null; pos: { lat: number; lng: number } | null }>>(() => {
    if (!data) return [];
    const dev = new Map(data.devices.map(d => [d.id, d.track]));
    const veh = new Map(data.vehicles.map(v => [v.id, v.track]));
    return data.events.map(e => {
      let pos: { lat: number; lng: number } | null = (e.lat != null && e.lng != null) ? { lat: e.lat, lng: e.lng } : null;
      if (!pos && e.deviceId && dev.has(e.deviceId)) pos = nearestPos(dev.get(e.deviceId)!, e.at);
      if (!pos && e.vehicleId && veh.has(e.vehicleId)) pos = nearestPos(veh.get(e.vehicleId)!, e.at);
      return { ...e, pos, px: null, py: null };
    });
  }, [data]);

  // ── build map once ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: mapEl.current, style: SAT_STYLE, center: [37, 3], zoom: 5, attributionControl: false });
    mapRef.current = map;
    map.on('error', () => {});
    map.on('load', () => {
      const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
      ['tracks', 'events', 'actors', 'pings'].forEach(s => map.addSource(s, { type: 'geojson', data: empty }));
      map.addLayer({ id: 'tracks-line', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 1.6, 'line-opacity': 0.35 } });
      map.addLayer({ id: 'pings', type: 'circle', source: 'pings', paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'color'], 'circle-opacity': 0.22, 'circle-blur': 0.7 } });
      map.addLayer({ id: 'events-dot', type: 'circle', source: 'events', paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-width': 1.5, 'circle-stroke-color': '#05070e', 'circle-opacity': 0.9 } });
      map.addLayer({ id: 'actors-glow', type: 'circle', source: 'actors', paint: { 'circle-radius': 14, 'circle-color': ['get', 'color'], 'circle-opacity': 0.16, 'circle-blur': 1 } });
      map.addLayer({ id: 'actors-dot', type: 'circle', source: 'actors', paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-width': 2, 'circle-stroke-color': '#fff', 'circle-opacity': 0.98 } });
      map.addLayer({ id: 'actors-label', type: 'symbol', source: 'actors', layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.3], 'text-anchor': 'top' }, paint: { 'text-color': '#eaf1ff', 'text-halo-color': '#05070e', 'text-halo-width': 1.4 } });
      readyRef.current = true;
    });
    return () => { map.remove(); mapRef.current = null; readyRef.current = false; };
  }, []);

  // ── load data into the map + fit bounds ─────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    const apply = () => {
      const entities = [...data.vehicles.map(v => ({ ...v, kind: 'v' as const })), ...data.devices.map(d => ({ ...d, kind: 'd' as const }))];
      const trackFC: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: entities.filter(e => e.track.length >= 2).map(e => ({
          type: 'Feature', properties: { color: e.kind === 'v' ? '#37e6ff' : '#2bf0a6' },
          geometry: { type: 'LineString', coordinates: e.track.map(p => [p.lng, p.lat]) },
        })),
      };
      (map.getSource('tracks') as maplibregl.GeoJSONSource | undefined)?.setData(trackFC);
      (map.getSource('events') as maplibregl.GeoJSONSource | undefined)?.setData({
        type: 'FeatureCollection',
        features: positionedEvents.filter(e => e.pos).map(e => ({
          type: 'Feature', properties: { color: KIND_COLOR[e.kind] }, geometry: { type: 'Point', coordinates: [e.pos!.lng, e.pos!.lat] },
        })),
      });
      // fit bounds
      const b = new maplibregl.LngLatBounds();
      let any = false;
      for (const e of entities) for (const p of e.track) { b.extend([p.lng, p.lat]); any = true; }
      for (const e of positionedEvents) if (e.pos) { b.extend([e.pos.lng, e.pos.lat]); any = true; }
      if (any) map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 600 });
      // reset clock
      headRef.current = from; setHead(from); playingRef.current = false; setPlaying(false);
    };
    if (readyRef.current) apply(); else map.once('idle', apply);
  }, [data, positionedEvents, from]);

  // ── playback loop ───────────────────────────────────────────────────────────
  useEffect(() => {
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = now - last; last = now;
      if (playingRef.current) {
        headRef.current += dt * speedRef.current;
        if (headRef.current >= to) { headRef.current = to; playingRef.current = false; setPlaying(false); }
      }
      renderFrame(headRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const sync = setInterval(() => setHead(headRef.current), 140);
    return () => { cancelAnimationFrame(raf); clearInterval(sync); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, positionedEvents, to]);

  const renderFrame = (T: number) => {
    const map = mapRef.current;
    if (!map || !readyRef.current || !data) return;
    const actors: GeoJSON.Feature[] = [];
    for (const v of data.vehicles) { const p = posAt(v.track, T); if (p) actors.push({ type: 'Feature', properties: { color: '#37e6ff', name: v.name }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }); }
    for (const d of data.devices) { const p = posAt(d.track, T); if (p) actors.push({ type: 'Feature', properties: { color: '#2bf0a6', name: d.name }, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } }); }
    (map.getSource('actors') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: actors });
    // pings: events within 25s of the playhead pulse
    const pings: GeoJSON.Feature[] = [];
    for (const e of positionedEvents) {
      if (!e.pos) continue;
      const dts = Math.abs(e.at - T);
      if (dts < 25_000) pings.push({ type: 'Feature', properties: { color: KIND_COLOR[e.kind], r: 10 + (1 - dts / 25_000) * 26 }, geometry: { type: 'Point', coordinates: [e.pos.lng, e.pos.lat] } });
    }
    (map.getSource('pings') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: pings });
    // move the scrubber knob directly (no react churn)
    if (knobRef.current) knobRef.current.style.left = `${((T - from) / (to - from)) * 100}%`;
  };

  const seek = (T: number) => { headRef.current = Math.max(from, Math.min(to, T)); setHead(headRef.current); renderFrame(headRef.current); };
  const togglePlay = () => {
    if (headRef.current >= to) headRef.current = from;
    playingRef.current = !playingRef.current; setPlaying(playingRef.current);
  };
  const cycleSpeed = () => { const i = (SPEEDS.indexOf(speed) + 1) % SPEEDS.length; setSpeed(SPEEDS[i]!); speedRef.current = SPEEDS[i]!; };

  const trackPct = (t: number) => `${((t - from) / (to - from)) * 100}%`;
  const onScrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    seek(from + ((e.clientX - rect.left) / rect.width) * (to - from));
  };

  const kindIcon = (k: EventKind) =>
    k === 'panic' ? <Siren size={13} /> : k === 'voice' ? <Volume2 size={13} /> : k === 'capture' ? <Camera size={13} /> : <TriangleAlert size={13} />;

  return (
    <div className="rp">
      <div className="rp-main">
        <div ref={mapEl} className="rp-map" />
        <div className="rp-clock">{fmtClock(head)}</div>
        {isFetching && <div className="rp-loading">Loading window…</div>}

        {/* transport */}
        <div className="rp-transport">
          <button className="rp-btn" onClick={() => seek(from)} title="To start"><SkipBack size={16} /></button>
          <button className="rp-btn play" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={18} /> : <Play size={18} />}</button>
          <button className="rp-btn speed" onClick={cycleSpeed} title="Playback speed">{speed}×</button>
          <div className="rp-scrub" onClick={onScrub}>
            <div className="rp-scrub-fill" style={{ width: trackPct(head) }} />
            {data?.events.map(e => (
              <span key={e.id} className="rp-tick" style={{ left: trackPct(e.at), '--tc': KIND_COLOR[e.kind] } as CSSProperties} title={`${e.label} · ${fmtClock(e.at)}`} />
            ))}
            <div ref={knobRef} className="rp-knob" style={{ left: trackPct(head) }} />
          </div>
          <div className="rp-range"><span>{fmtClock(from)}</span><span>{fmtClock(to)}</span></div>
        </div>
      </div>

      {/* side panel */}
      <aside className="rp-side">
        <div className="rp-head">
          <div><h1>Ops Replay</h1><div className="rp-sub">4D mission playback</div></div>
          <div className="rp-wins">
            {WINDOWS.map(w => <button key={w.k} className={winH === w.h ? 'on' : ''} onClick={() => setWinH(w.h)}>{w.k}</button>)}
          </div>
        </div>
        <div className="rp-legend">
          <span><i style={{ background: '#37e6ff' }} />Vehicles</span>
          <span><i style={{ background: '#2bf0a6' }} />Officers</span>
        </div>
        <div className="rp-count">{data ? `${data.vehicles.length + data.devices.length} tracks · ${data.events.length} events` : '—'}</div>
        <div className="rp-events">
          {data && data.events.length === 0 && <div className="rp-empty">No events in this window.</div>}
          {data?.events.map(e => {
            const active = Math.abs(e.at - head) < 30_000;
            return (
              <div key={e.id} className={`rp-ev ${e.kind} ${active ? 'active' : ''} ${selEvent === e.id ? 'sel' : ''}`}
                onClick={() => { setSelEvent(e.id); seek(e.at); }}>
                <span className="rp-ev-ic" style={{ color: KIND_COLOR[e.kind] }}>{kindIcon(e.kind)}</span>
                <div className="rp-ev-main">
                  <div className="rp-ev-label">{e.label}</div>
                  <div className="rp-ev-sub">{e.sub} · {fmtClock(e.at)}</div>
                  {e.kind === 'voice' && e.deviceId && (
                    <button className="rp-ev-play" onClick={ev => { ev.stopPropagation(); void playVoice(e.deviceId!, e.id); }}>
                      <Play size={11} />{playingVoice === e.id ? 'Playing…' : 'Play'}{e.durationMs != null ? ` · ${Math.round(e.durationMs / 1000)}s` : ''}
                    </button>
                  )}
                  {e.kind === 'capture' && e.url && (
                    <a className="rp-ev-thumb" href={e.url} target="_blank" rel="noreferrer" onClick={ev => ev.stopPropagation()}>
                      <img src={e.url} alt="capture" loading="lazy" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}
