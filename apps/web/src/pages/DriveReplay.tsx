import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { api } from '../lib/api.js';
import { Film, ChevronDown, Play, Pause, RotateCcw, Video, Loader2 } from 'lucide-react';

interface Device { id: string; name: string; officer_name?: string | null }
interface TrackPoint { lat: number; lng: number; speed: number | null; heading: number | null; ts: string }
interface TrackResp { device: { id: string; name: string }; from: string; to: string; points: TrackPoint[] }

const SPEEDS = [1, 8, 30, 60];

// Owns the Cesium viewer and drives a vehicle along the trail with a chase cam.
function CesiumDrive({ points }: { points: TrackPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const vehicleRef = useRef<Cesium.Entity | null>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(8);
  const [follow, setFollow] = useState(true);
  const [hud, setHud] = useState<{ t: string; kmh: number | null; pct: number }>({ t: '', kmh: null, pct: 0 });

  // Init viewer once.
  useEffect(() => {
    if (!containerRef.current) return;
    const token = (import.meta.env['VITE_CESIUM_ION_TOKEN'] as string | undefined) ?? '';
    Cesium.Ion.defaultAccessToken = token;

    const osm = new Cesium.UrlTemplateImageryProvider({
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      credit: new Cesium.Credit('© OpenStreetMap contributors', false),
      maximumLevel: 19,
    });
    const viewer = new Cesium.Viewer(containerRef.current, {
      baseLayer: new Cesium.ImageryLayer(osm),
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      animation: false, timeline: true, baseLayerPicker: false, fullscreenButton: false,
      geocoder: false, homeButton: false, infoBox: false, sceneModePicker: false,
      selectionIndicator: false, navigationHelpButton: false,
      navigationInstructionsInitiallyVisible: false, creditContainer: document.createElement('div'),
    });
    viewer.scene.globe.enableLighting = true;
    viewerRef.current = viewer;

    // Upgrade to photoreal relief + city blocks when an Ion token is configured.
    if (token) {
      (async () => {
        try { viewer.terrainProvider = await Cesium.createWorldTerrainAsync(); } catch { /* keep ellipsoid */ }
        try { viewer.scene.primitives.add(await Cesium.createOsmBuildingsAsync()); } catch { /* no buildings */ }
      })();
    }

    return () => { if (!viewer.isDestroyed()) viewer.destroy(); viewerRef.current = null; };
  }, []);

  // (Re)build the animated vehicle whenever the trail changes.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.entities.removeAll();
    vehicleRef.current = null;
    if (points.length < 2) return;

    const sampled = new Cesium.SampledPositionProperty();
    for (const p of points) {
      sampled.addSample(Cesium.JulianDate.fromIso8601(p.ts), Cesium.Cartesian3.fromDegrees(p.lng, p.lat, 0));
    }
    sampled.setInterpolationOptions({
      interpolationDegree: 2,
      interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
    });

    const start = Cesium.JulianDate.fromIso8601(points[0]!.ts);
    const stop = Cesium.JulianDate.fromIso8601(points[points.length - 1]!.ts);

    // Full route ribbon.
    viewer.entities.add({
      polyline: {
        positions: points.map(p => Cesium.Cartesian3.fromDegrees(p.lng, p.lat, 0)),
        width: 3, clampToGround: true,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.18, color: Cesium.Color.fromCssColorString('#38bdf8'),
        }),
      },
    });

    // The vehicle: a box oriented along its velocity, with a fading trail.
    const vehicle = viewer.entities.add({
      availability: new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({ start, stop })]),
      position: sampled,
      orientation: new Cesium.VelocityOrientationProperty(sampled),
      box: {
        dimensions: new Cesium.Cartesian3(24, 10, 8),
        material: Cesium.Color.fromCssColorString('#f59e0b'),
        outline: true, outlineColor: Cesium.Color.WHITE,
      },
      path: {
        resolution: 1, width: 6, leadTime: 0, trailTime: 120,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.3, color: Cesium.Color.fromCssColorString('#f59e0b'),
        }),
      },
    });
    vehicleRef.current = vehicle;

    viewer.clock.startTime = start.clone();
    viewer.clock.stopTime = stop.clone();
    viewer.clock.currentTime = start.clone();
    viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
    viewer.clock.multiplier = speed;
    viewer.clock.shouldAnimate = true;
    if (viewer.timeline) viewer.timeline.zoomTo(start, stop);
    setPlaying(true);
    viewer.trackedEntity = follow ? vehicle : undefined;

    // HUD ticker: current time, interpolated speed (from nearest sample), progress.
    const total = Cesium.JulianDate.secondsDifference(stop, start) || 1;
    const onTick = () => {
      const now = viewer.clock.currentTime;
      const elapsed = Cesium.JulianDate.secondsDifference(now, start);
      // nearest sample for a speed readout
      let nearest = points[0]!;
      let best = Infinity;
      for (const p of points) {
        const d = Math.abs(Cesium.JulianDate.secondsDifference(Cesium.JulianDate.fromIso8601(p.ts), now));
        if (d < best) { best = d; nearest = p; }
      }
      setHud({
        t: Cesium.JulianDate.toDate(now).toLocaleString(),
        kmh: nearest.speed,
        pct: Math.max(0, Math.min(100, (elapsed / total) * 100)),
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
  const restart = () => {
    const v = viewerRef.current; if (!v) return;
    v.clock.currentTime = v.clock.startTime.clone();
    v.clock.shouldAnimate = true; setPlaying(true);
  };
  const toggleFollow = () => {
    const v = viewerRef.current; if (!v) return;
    const next = !follow; setFollow(next);
    v.trackedEntity = next ? (vehicleRef.current ?? undefined) : undefined;
  };

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {/* Control bar */}
      <div className="pointer-events-auto absolute inset-x-0 bottom-8 mx-auto flex w-fit items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3 py-2 backdrop-blur">
        <button onClick={togglePlay} className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20" title={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button onClick={restart} className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20" title="Restart">
          <RotateCcw size={16} />
        </button>
        <div className="flex overflow-hidden rounded-full border border-white/10">
          {SPEEDS.map(s => (
            <button key={s} onClick={() => setMultiplier(s)}
              className={`px-2.5 py-1 text-xs font-bold ${speed === s ? 'bg-amber-500 text-black' : 'text-neutral-300 hover:text-white'}`}>
              {s}×
            </button>
          ))}
        </div>
        <button onClick={toggleFollow}
          className={`flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold ${follow ? 'bg-cyan-500 text-black' : 'bg-white/10 text-neutral-300 hover:text-white'}`}>
          <Video size={13} /> {follow ? 'Chase cam' : 'Free look'}
        </button>
      </div>
      {/* HUD */}
      <div className="pointer-events-none absolute left-4 top-4 rounded-lg border border-white/10 bg-black/70 px-3 py-2 font-mono text-xs text-white backdrop-blur">
        <div>{hud.t || '—'}</div>
        <div className="text-amber-300">{hud.kmh != null ? `${hud.kmh.toFixed(0)} km/h` : '—'}</div>
        <div className="mt-1 h-1 w-40 overflow-hidden rounded bg-white/15">
          <div className="h-full bg-amber-400" style={{ width: `${hud.pct}%` }} />
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
        {deviceId && points.length >= 2 && <CesiumDrive points={points} />}
      </div>
    </div>
  );
}
