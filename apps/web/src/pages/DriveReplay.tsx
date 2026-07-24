import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { api } from '../lib/api.js';
import { Film, ChevronDown, Play, Pause, Loader2, User, Bike, Car, Truck, Sparkles,
  SkipBack, SkipForward, Rewind, FastForward, Video, Map as MapIcon, Move } from 'lucide-react';
import { dominantMode, iconAt, type TravelMode, type PhysicalMode } from '../lib/travelMode.js';
import { clampSpikes, speedsKmh, cumulativeMeters, trailStats, speedColor, speedBucket,
  detectStops, headingsDeg, fmtDuration, SPEED_LEGEND, type TP } from '../lib/driveTrail.js';

interface Device { id: string; name: string; officer_name?: string | null }
interface TrackPoint { lat: number; lng: number; speed: number | null; heading: number | null; ts: string }
interface TrackResp {
  device: { id: string; name: string }; from: string; to: string; points: TrackPoint[];
  snapped?: boolean; provider?: string | null; confidence?: number;
}

const SPEEDS = [1, 8, 30, 60];
type CamMode = 'chase' | 'top' | 'free';

const MODE_OPTIONS: { id: TravelMode; label: string; Icon: typeof User }[] = [
  { id: 'auto', label: 'Auto', Icon: Sparkles },
  { id: 'foot', label: 'Foot', Icon: User },
  { id: 'bicycle', label: 'Bike', Icon: Bike },
  { id: 'car', label: 'Car', Icon: Car },
  { id: 'truck', label: 'Truck', Icon: Truck },
];
const CAMS: { id: CamMode; label: string; Icon: typeof Video }[] = [
  { id: 'chase', label: 'Chase', Icon: Video },
  { id: 'top', label: 'Top', Icon: MapIcon },
  { id: 'free', label: 'Free', Icon: Move },
];

interface Hud { time: string; kmh: number; distKm: number; totalKm: number; pct: number; remainMs: number; avgKmh: number; maxKmh: number }

// Owns the Cesium viewer: a spike-free, speed-graded, cinematic drive replay.
function CesiumDrive({ points, snapped, provider, confidence }:
  { points: TrackPoint[]; snapped?: boolean | undefined; provider?: string | null | undefined; confidence?: number | undefined }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(8);
  const [camMode, setCamMode] = useState<CamMode>('chase');
  const camRef = useRef<CamMode>('chase');
  const [mode, setMode] = useState<TravelMode>('auto');
  const modeRef = useRef<TravelMode>('auto');
  const [autoMode, setAutoMode] = useState<PhysicalMode>('car');
  const [hud, setHud] = useState<Hud>({ time: '', kmh: 0, distKm: 0, totalKm: 0, pct: 0, remainMs: 0, avgKmh: 0, maxKmh: 0 });

  // Init viewer once.
  useEffect(() => {
    if (!containerRef.current) return;
    const token = (import.meta.env['VITE_CESIUM_ION_TOKEN'] as string | undefined) ?? '';
    Cesium.Ion.defaultAccessToken = token;

    const esri = new Cesium.UrlTemplateImageryProvider({
      url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      credit: new Cesium.Credit('Esri, Maxar, Earthstar Geographics', false),
      maximumLevel: 19,
    });
    const viewer = new Cesium.Viewer(containerRef.current, {
      baseLayer: new Cesium.ImageryLayer(esri),
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      animation: false, timeline: true, baseLayerPicker: false, fullscreenButton: false,
      geocoder: false, homeButton: false, infoBox: false, sceneModePicker: false,
      selectionIndicator: false, navigationHelpButton: false,
      navigationInstructionsInitiallyVisible: false, creditContainer: document.createElement('div'),
    });
    viewer.scene.globe.enableLighting = true;
    if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewerRef.current = viewer;

    const googleKey = (import.meta.env['VITE_GOOGLE_MAPS_API_KEY'] as string | undefined) ?? '';
    (async () => {
      if (googleKey) {
        try {
          (Cesium as unknown as { GoogleMaps: { defaultApiKey: string } }).GoogleMaps.defaultApiKey = googleKey;
          viewer.scene.primitives.add(await Cesium.createGooglePhotorealistic3DTileset());
          viewer.scene.globe.show = false;
          return;
        } catch { /* fall through */ }
      }
      if (token) {
        try {
          const bing = await Cesium.createWorldImageryAsync();
          viewer.imageryLayers.removeAll();
          viewer.imageryLayers.addImageryProvider(bing);
        } catch { /* keep Esri */ }
        try { viewer.terrainProvider = await Cesium.createWorldTerrainAsync(); } catch { /* keep ellipsoid */ }
        try { viewer.scene.primitives.add(await Cesium.createOsmBuildingsAsync()); } catch { /* no buildings */ }
      }
    })();

    return () => { if (!viewer.isDestroyed()) viewer.destroy(); viewerRef.current = null; };
  }, []);

  // (Re)build the animated drive whenever the trail changes.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.entities.removeAll();
    if (points.length < 2) return;

    // Final spike guard, then everything derives from the clean trail P.
    const P: TP[] = clampSpikes(points as TP[]);
    if (P.length < 2) return;
    const spd = speedsKmh(P);
    const cum = cumulativeMeters(P);
    const heads = headingsDeg(P);
    const stats = trailStats(P);
    const dominant = dominantMode(P);
    setAutoMode(dominant);

    // Motion: LINEAR interpolation — never overshoots, so no phantom spikes
    // between samples (the old Lagrange curve was drawing them).
    const sampled = new Cesium.SampledPositionProperty();
    let lastMs = -Infinity;
    const sampleTimes: Cesium.JulianDate[] = [];
    for (const p of P) {
      const t = new Date(p.ts).getTime();
      if (t <= lastMs) continue; // strictly increasing — dupes explode interpolation
      lastMs = t;
      const jd = Cesium.JulianDate.fromIso8601(p.ts);
      sampleTimes.push(jd);
      sampled.addSample(jd, Cesium.Cartesian3.fromDegrees(p.lng, p.lat, 0));
    }
    sampled.setInterpolationOptions({ interpolationDegree: 1, interpolationAlgorithm: Cesium.LinearApproximation });

    const start = sampleTimes[0]!;
    const stop = sampleTimes[sampleTimes.length - 1]!;
    const nearestIdx = (now: Cesium.JulianDate) => {
      let best = Infinity, idx = 0;
      for (let i = 0; i < sampleTimes.length; i++) {
        const d = Math.abs(Cesium.JulianDate.secondsDifference(sampleTimes[i]!, now));
        if (d < best) { best = d; idx = i; }
      }
      return idx;
    };

    // Speed-graded route ribbon: one coloured segment per contiguous speed band.
    const cart = P.map(p => Cesium.Cartesian3.fromDegrees(p.lng, p.lat));
    let s = 0;
    for (let i = 1; i <= P.length; i++) {
      const changed = i === P.length || speedBucket(spd[i]!) !== speedBucket(spd[s]!);
      if (changed) {
        const positions = cart.slice(s, Math.min(P.length, i + 1));
        if (positions.length >= 2) {
          viewer.entities.add({ polyline: {
            positions, width: 5, clampToGround: true,
            material: Cesium.Color.fromCssColorString(speedColor(spd[s]!)).withAlpha(0.92),
          } });
        }
        s = i;
      }
    }

    // Stop markers — where the vehicle sat still, with dwell time.
    for (const st of detectStops(P, { minStopMs: 120000 })) {
      viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(st.lng, st.lat),
        point: {
          pixelSize: 11, color: Cesium.Color.fromCssColorString('#ef4444'),
          outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: `⏸ ${fmtDuration(st.durationMs)}`, font: '600 12px sans-serif',
          fillColor: Cesium.Color.WHITE, showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#7f1d1d').withAlpha(0.85),
          pixelOffset: new Cesium.Cartesian2(0, -20), disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(500, 1, 9000, 0.4),
        },
      });
    }

    // Time-varying marker: person/bike/car/truck by mode + speed.
    const markerImage = new Cesium.CallbackProperty(
      (time) => iconAt(modeRef.current, dominant, spd[nearestIdx(time as Cesium.JulianDate)] ?? 0), false);
    const vehicle = viewer.entities.add({
      availability: new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({ start, stop })]),
      position: sampled,
      billboard: {
        image: markerImage, scale: 0.62,
        alignedAxis: new Cesium.VelocityVectorProperty(sampled, true),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(120, 1.0, 6000, 0.4),
      },
      path: {
        resolution: 1, width: 6, leadTime: 0, trailTime: 70,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.3, color: Cesium.Color.fromCssColorString('#22d3ee'),
        }),
      },
    });

    // Camera: chase (behind, follows heading), top-down, or free.
    const applyCamera = (now: Cesium.JulianDate) => {
      const m = camRef.current;
      if (m === 'free') return;
      const pos = sampled.getValue(now);
      if (!pos) return;
      if (m === 'top') {
        viewer.camera.lookAt(pos, new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-89), 900));
      } else {
        const hd = heads[nearestIdx(now)] ?? 0;
        viewer.camera.lookAt(pos, new Cesium.HeadingPitchRange(Cesium.Math.toRadians(hd + 180), Cesium.Math.toRadians(-28), 170));
      }
    };

    viewer.clock.startTime = start.clone();
    viewer.clock.stopTime = stop.clone();
    viewer.clock.currentTime = start.clone();
    viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
    viewer.clock.multiplier = speed;
    viewer.clock.shouldAnimate = true;
    if (viewer.timeline) viewer.timeline.zoomTo(start, stop);
    setPlaying(true);
    void vehicle;
    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    applyCamera(start);

    const total = Cesium.JulianDate.secondsDifference(stop, start) || 1;
    const onTick = () => {
      const now = viewer.clock.currentTime;
      const elapsed = Cesium.JulianDate.secondsDifference(now, start);
      const idx = nearestIdx(now);
      applyCamera(now);
      setHud({
        time: Cesium.JulianDate.toDate(now).toLocaleTimeString(),
        kmh: spd[idx] ?? 0,
        distKm: (cum[idx] ?? 0) / 1000,
        totalKm: stats.distanceKm,
        pct: Math.max(0, Math.min(100, (elapsed / total) * 100)),
        remainMs: Math.max(0, (total - elapsed) * 1000),
        avgKmh: stats.avgMovingKmh,
        maxKmh: stats.maxKmh,
      });
    };
    viewer.clock.onTick.addEventListener(onTick);
    return () => { viewer.clock.onTick.removeEventListener(onTick); };
  }, [points]); // eslint-disable-line react-hooks/exhaustive-deps

  const setMultiplier = (m: number) => {
    setSpeed(m);
    if (viewerRef.current) viewerRef.current.clock.multiplier = m;
  };
  const togglePlay = () => {
    const v = viewerRef.current; if (!v) return;
    v.clock.shouldAnimate = !v.clock.shouldAnimate;
    setPlaying(v.clock.shouldAnimate);
  };
  const skip = (seconds: number) => {
    const v = viewerRef.current; if (!v) return;
    const c = v.clock;
    let next = Cesium.JulianDate.addSeconds(c.currentTime, seconds, new Cesium.JulianDate());
    if (Cesium.JulianDate.lessThan(next, c.startTime)) next = c.startTime.clone();
    if (Cesium.JulianDate.greaterThan(next, c.stopTime)) next = c.stopTime.clone();
    c.currentTime = next;
    v.scene.requestRender();
  };
  const jumpToStart = () => {
    const v = viewerRef.current; if (!v) return;
    v.clock.currentTime = v.clock.startTime.clone();
    v.clock.shouldAnimate = true; setPlaying(true);
    v.scene.requestRender();
  };
  const jumpToEnd = () => {
    const v = viewerRef.current; if (!v) return;
    v.clock.currentTime = v.clock.stopTime.clone();
    v.clock.shouldAnimate = false; setPlaying(false);
    v.scene.requestRender();
  };
  const pickCam = (m: CamMode) => {
    setCamMode(m); camRef.current = m;
    const v = viewerRef.current; if (!v) return;
    if (m === 'free') v.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    v.scene.requestRender();
  };
  const pickMode = (m: TravelMode) => {
    setMode(m); modeRef.current = m;
    viewerRef.current?.scene.requestRender();
  };

  // Keyboard transport: Space play/pause, ←/→ scrub 5s (Shift = 30s), Home/End.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const big = e.shiftKey ? 30 : 5;
      switch (e.key) {
        case ' ': e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft': e.preventDefault(); skip(-big); break;
        case 'ArrowRight': e.preventDefault(); skip(big); break;
        case 'Home': e.preventDefault(); jumpToStart(); break;
        case 'End': e.preventDefault(); jumpToEnd(); break;
        default: break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {/* Instrument HUD */}
      <div className="pointer-events-none absolute left-4 top-4 w-52 rounded-xl border border-white/10 bg-black/70 p-3 text-white backdrop-blur">
        <div className="font-mono text-[11px] text-neutral-400">{hud.time || '—'}</div>
        <div className="mt-0.5 flex items-baseline gap-1">
          <span className="font-mono text-3xl font-bold tabular-nums" style={{ color: speedColor(hud.kmh) }}>{hud.kmh.toFixed(0)}</span>
          <span className="text-xs text-neutral-400">km/h</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-white/15">
          <div className="h-full bg-cyan-400" style={{ width: `${hud.pct}%` }} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
          <span className="text-neutral-400">dist</span><span className="text-right tabular-nums">{hud.distKm.toFixed(1)}/{hud.totalKm.toFixed(1)} km</span>
          <span className="text-neutral-400">left</span><span className="text-right tabular-nums">{fmtDuration(hud.remainMs)}</span>
          <span className="text-neutral-400">avg</span><span className="text-right tabular-nums">{hud.avgKmh.toFixed(0)} km/h</span>
          <span className="text-neutral-400">max</span><span className="text-right tabular-nums">{hud.maxKmh.toFixed(0)} km/h</span>
        </div>
        <div className="mt-2 flex items-center gap-1.5 border-t border-white/10 pt-2 font-mono text-[11px]">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${snapped ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          {snapped
            ? <span className="text-emerald-300">roads · {provider ?? 'osrm'}{confidence ? ` ${confidence.toFixed(2)}` : ''}</span>
            : <span className="text-amber-300">raw GPS</span>}
        </div>
      </div>

      {/* Speed legend */}
      <div className="pointer-events-none absolute right-4 top-4 rounded-lg border border-white/10 bg-black/70 px-3 py-2 backdrop-blur">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Speed</div>
        <div className="flex flex-col gap-1">
          {SPEED_LEGEND.map(l => (
            <div key={l.label} className="flex items-center gap-1.5 text-[11px] text-neutral-300">
              <span className="h-2 w-4 rounded-sm" style={{ background: l.hex }} /> {l.label}
            </div>
          ))}
        </div>
      </div>

      {/* Control bar */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-8 mx-auto flex w-fit max-w-[95vw] flex-wrap items-center justify-center gap-2 rounded-3xl border border-white/10 bg-black/70 px-3 py-2 backdrop-blur">
        <button onClick={jumpToStart} className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20" title="Restart (Home)"><SkipBack size={16} /></button>
        <button onClick={() => skip(-10)} className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20" title="Rewind 10s (←)"><Rewind size={16} /></button>
        <button onClick={togglePlay} className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20" title={playing ? 'Pause (Space)' : 'Play (Space)'}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button onClick={() => skip(10)} className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20" title="Fast-forward 10s (→)"><FastForward size={16} /></button>
        <button onClick={jumpToEnd} className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20" title="Jump to end (End)"><SkipForward size={16} /></button>
        <div className="flex overflow-hidden rounded-full border border-white/10">
          {SPEEDS.map(sp => (
            <button key={sp} onClick={() => setMultiplier(sp)}
              className={`px-2.5 py-1 text-xs font-bold ${speed === sp ? 'bg-amber-500 text-black' : 'text-neutral-300 hover:text-white'}`}>{sp}×</button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-full border border-white/10">
          {CAMS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => pickCam(id)} title={`${label} camera`}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold ${camMode === id ? 'bg-cyan-500 text-black' : 'text-neutral-300 hover:text-white'}`}>
              <Icon size={13} /> <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
        <div className="mx-1 h-6 w-px bg-white/10" />
        <div className="flex overflow-hidden rounded-full border border-white/10">
          {MODE_OPTIONS.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => pickMode(id)}
              title={id === 'auto' ? `Auto — detected: ${autoMode}` : label}
              className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold ${mode === id ? 'bg-emerald-500 text-black' : 'text-neutral-300 hover:text-white'}`}>
              <Icon size={13} /> <span className="hidden sm:inline">{id === 'auto' ? `Auto·${autoMode}` : label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function DriveReplay() {
  const [deviceId, setDeviceId] = useState('');
  const [hours, setHours] = useState(24);

  const { data: devices } = useQuery<Device[]>({
    queryKey: ['guardian-devices-list'],
    queryFn: async () => (await api.get<{ data: Device[] }>('/guardian/devices')).data.data ?? [],
    staleTime: 30_000,
  });

  const { data: track, isFetching, isError } = useQuery<TrackResp>({
    queryKey: ['device-track', deviceId, hours],
    enabled: !!deviceId,
    queryFn: async () => {
      const to = new Date();
      const from = new Date(to.getTime() - hours * 3600 * 1000);
      return (await api.get<{ data: TrackResp }>(
        `/guardian/devices/${deviceId}/track?from=${from.toISOString()}&to=${to.toISOString()}`,
      )).data.data;
    },
  });

  const points = track?.points ?? [];

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Film className="text-amber-400" />
          <h1 className="text-lg font-bold text-white">3D Drive Replay</h1>
        </div>
        <div className="relative">
          <select value={deviceId} onChange={e => setDeviceId(e.target.value)}
            className="appearance-none rounded-lg border border-white/10 bg-black/40 py-2 pl-3 pr-9 text-sm text-white">
            <option value="">Select a device…</option>
            {(devices ?? []).map(d => <option key={d.id} value={d.id}>{d.officer_name ? `${d.officer_name} · ${d.name}` : d.name}</option>)}
          </select>
          <ChevronDown size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-neutral-500" />
        </div>
        <div className="flex overflow-hidden rounded-lg border border-white/10">
          {[6, 24, 72].map(h => (
            <button key={h} onClick={() => setHours(h)}
              className={`px-3 py-2 text-xs font-semibold ${hours === h ? 'bg-amber-500 text-black' : 'bg-black/40 text-neutral-400 hover:text-white'}`}>
              {h}h
            </button>
          ))}
        </div>
        {isFetching && <Loader2 size={16} className="animate-spin text-neutral-500" />}
        <span className="text-xs text-neutral-500">{points.length} GPS points</span>
      </div>

      <div className="relative flex-1 overflow-hidden rounded-xl border border-white/10 bg-black">
        {!deviceId && (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            Pick a device to replay its drive in 3D.
          </div>
        )}
        {deviceId && isError && (
          <div className="flex h-full items-center justify-center text-sm text-red-300">Couldn't load this device's track.</div>
        )}
        {deviceId && !isError && !isFetching && points.length < 2 && (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500">
            Not enough GPS points in this window to replay a drive.
          </div>
        )}
        {deviceId && points.length >= 2 && (
          <CesiumDrive points={points} snapped={track?.snapped} provider={track?.provider} confidence={track?.confidence} />
        )}
      </div>
    </div>
  );
}
