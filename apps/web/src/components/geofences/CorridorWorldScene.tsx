import { useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Globe2, Layers, Compass, Play, Pause, RotateCcw, Box } from 'lucide-react';

export interface LatLng { lat: number; lng: number }
export interface GlobeMember {
  id: string;
  name: string;
  officer_name?: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  along_km?: number | null;
  cross_track_km?: number | null;
  heading?: number | null;
  speed_kph?: number | null;
  position_state?: string | null;
  position_confidence?: number | null;
  position_uncertainty_m?: number | null;
  vehicle_type?: string | null;
  vehicle_model_url?: string | null;
}
export interface RiskZone {
  zone_id: string | null;
  name: string | null;
  risk_level: string;
  lat: number;
  lng: number;
  radius_km: number;
}

const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ROADS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
const DARK_URL = 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
const DEFAULT_VEHICLE_MODEL = 'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumMilkTruck/CesiumMilkTruck.glb';
const VEHICLE_MODEL = import.meta.env.VITE_SONALIT_VEHICLE_MODEL_URL || DEFAULT_VEHICLE_MODEL;

const STATUS_COLOR: Record<string, string> = {
  off_route: '#ef4444', behind: '#f59e0b', ahead: '#22d3ee', on_track: '#10b981', no_fix: '#737373',
};
const RISK_COLOR: Record<string, string> = {
  no_go: '#dc2626', critical: '#ef4444', high: '#f97316', medium: '#eab308', low: '#84cc16',
};
const KM_PER_DEG_LAT = 111.32;
const SIM_SPEED_MULTIPLIER = 18;

function corridorRing(route: LatLng[], km: number): number[] {
  const left: number[][] = [], right: number[][] = [];
  for (let i = 0; i < route.length; i++) {
    const prev = route[Math.max(0, i - 1)]!, next = route[Math.min(route.length - 1, i + 1)]!, here = route[i]!;
    const cos = Math.max(0.05, Math.cos((here.lat * Math.PI) / 180));
    const dx = (next.lng - prev.lng) * KM_PER_DEG_LAT * cos;
    const dy = (next.lat - prev.lat) * KM_PER_DEG_LAT;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    left.push([here.lng + (nx * km) / (KM_PER_DEG_LAT * cos), here.lat + (ny * km) / KM_PER_DEG_LAT]);
    right.push([here.lng - (nx * km) / (KM_PER_DEG_LAT * cos), here.lat - (ny * km) / KM_PER_DEG_LAT]);
  }
  return [...left, ...right.reverse()].flat();
}
function css(hex: string, alpha = 1): Cesium.Color { return Cesium.Color.fromCssColorString(hex).withAlpha(alpha); }
function nearOnly(maxM: number): Cesium.DistanceDisplayCondition { return new Cesium.DistanceDisplayCondition(0, maxM); }
function bearingDeg(a: LatLng, b: LatLng): number {
  const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180, dl = (b.lng - a.lng) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lng - a.lng) * Math.PI / 180;
  const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
function interpolateRoute(route: LatLng[], distanceKm: number): LatLng {
  if (!route.length) return { lat: 0, lng: 0 };
  if (route.length === 1) return route[0]!;
  let remaining = Math.max(0, distanceKm);
  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i]!, b = route[i + 1]!, d = haversineKm(a, b);
    if (remaining <= d || i === route.length - 2) {
      const t = d > 0 ? Math.min(1, remaining / d) : 0;
      return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
    }
    remaining -= d;
  }
  return route[route.length - 1]!;
}
function routeLengthKm(route: LatLng[]): number {
  let d = 0;
  for (let i = 0; i < route.length - 1; i++) d += haversineKm(route[i]!, route[i + 1]!);
  return d;
}

export default function CorridorWorldScene({
  route, corridorKm, members, zones, ceilingM = 0, focusId = null, trail, onSelect, fill = false,
}: {
  route: LatLng[];
  corridorKm: number;
  members: GlobeMember[];
  zones?: RiskZone[];
  ceilingM?: number;
  focusId?: string | null;
  trail?: LatLng[];
  onSelect?: (id: string | null) => void;
  fill?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const entityMapRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const currentPosRef = useRef<Map<string, Cesium.Cartesian3>>(new Map());
  const targetPosRef = useRef<Map<string, Cesium.Cartesian3>>(new Map());
  const lastFrameRef = useRef<number | null>(null);
  const [satellite, setSatellite] = useState(true);
  const [failed, setFailed] = useState(false);
  const [simulation, setSimulation] = useState(false);
  const [simKm, setSimKm] = useState(0);
  const [modelFailed, setModelFailed] = useState(false);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  const wallM = ceilingM > 0 ? ceilingM : Math.max(1500, corridorKm * 1200);
  const totalRouteKm = useMemo(() => routeLengthKm(route), [route]);

  useEffect(() => {
    if (!boxRef.current) return;
    let viewer: Cesium.Viewer;
    try {
      viewer = new Cesium.Viewer(boxRef.current, {
        baseLayerPicker: false, geocoder: false, homeButton: false, infoBox: false,
        sceneModePicker: false, navigationHelpButton: false, timeline: false,
        animation: false, fullscreenButton: false, selectionIndicator: false,
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      });
    } catch { setFailed(true); return; }
    viewerRef.current = viewer;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.globe.baseColor = css('#0b0f19');
    viewer.cesiumWidget.creditContainer.setAttribute('style', 'display:none');

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
      const picked = viewer.scene.pick(movement.position);
      const id = picked && picked.id && typeof picked.id.id === 'string' ? picked.id.id : null;
      selectRef.current?.(id?.startsWith('dev:') ? id.slice(4) : null);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    const preRender = () => {
      const now = performance.now();
      const dt = lastFrameRef.current == null ? 16 : Math.min(80, now - lastFrameRef.current);
      lastFrameRef.current = now;
      const alpha = 1 - Math.exp(-dt / 260);
      currentPosRef.current.forEach((cur, id) => {
        const target = targetPosRef.current.get(id);
        const ent = entityMapRef.current.get(id);
        if (!target || !ent) return;
        const next = Cesium.Cartesian3.lerp(cur, target, alpha, new Cesium.Cartesian3());
        currentPosRef.current.set(id, next);
        ent.position = new Cesium.ConstantPositionProperty(next);
        const c = currentPosRef.current.get(id);
        if (c) ent.orientation = undefined;
      });
      viewer.scene.requestRender();
    };
    viewer.scene.preRender.addEventListener(preRender);

    return () => {
      handler.destroy();
      viewer.scene.preRender.removeEventListener(preRender);
      entityMapRef.current.clear(); currentPosRef.current.clear(); targetPosRef.current.clear();
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const layers = viewer.imageryLayers;
    layers.removeAll();
    if (satellite) {
      layers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({ url: SAT_URL, maximumLevel: 18 }));
      layers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({ url: ROADS_URL, maximumLevel: 18 }));
    } else layers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({ url: DARK_URL, maximumLevel: 19 }));
  }, [satellite]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const previous = viewer.entities.values.filter(e => e.id.startsWith('corridor:'));
    previous.forEach(e => viewer.entities.remove(e));
    if (route.length < 2) return;
    const ring = corridorRing(route, corridorKm);
    const volume = viewer.entities.add({ id: 'corridor:volume', polygon: {
      hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring)),
      extrudedHeight: wallM, height: 0, material: css('#8b5cf6', 0.15), outline: true,
      outlineColor: css('#a78bfa', 0.55), closeTop: false, closeBottom: false,
    }});
    const centre = viewer.entities.add({ id: 'corridor:centerline', polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(route.flatMap(p => [p.lng, p.lat])), width: 4,
      clampToGround: true, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.25, color: css('#a78bfa') }),
    }});
    const addPin = (id: string, p: LatLng, color: string, label: string) => viewer.entities.add({
      id, position: Cesium.Cartesian3.fromDegrees(p.lng, p.lat, 0), point: {
        pixelSize: 12, color: css(color), outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      }, label: {
        text: label, font: '600 13px sans-serif', fillColor: Cesium.Color.WHITE,
        outlineColor: css('#000000'), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -22), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: nearOnly(3_000_000),
      },
    });
    addPin('corridor:origin', route[0]!, '#10b981', 'ORIGIN');
    addPin('corridor:destination', route[route.length - 1]!, '#f43f5e', 'DESTINATION');
    viewer.flyTo(volume, { duration: 1.6 }).catch(() => undefined);
  }, [route, corridorKm, wallM]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.entities.values.filter(e => e.id.startsWith('risk:')).forEach(e => viewer.entities.remove(e));
    (zones ?? []).forEach((z, idx) => {
      const color = RISK_COLOR[z.risk_level] ?? RISK_COLOR.medium!;
      viewer.entities.add({ id: `risk:${z.zone_id ?? idx}`, position: Cesium.Cartesian3.fromDegrees(z.lng, z.lat, wallM / 2),
        cylinder: { length: wallM, topRadius: z.radius_km * 1000, bottomRadius: z.radius_km * 1000, material: css(color, 0.14), outline: true, outlineColor: css(color, 0.5) },
        label: { text: `${z.name ?? 'Risk zone'} · ${z.risk_level.replace('_', '-')}`, font: '600 12px sans-serif', fillColor: css(color), outlineColor: css('#000000'), outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -10), disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: nearOnly(600_000) },
      });
    });
  }, [zones, wallM]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const oldIds = new Set(viewer.entities.values.filter(e => e.id.startsWith('dev:')).map(e => e.id));
    const nextIds = new Set(members.filter(m => m.lat != null && m.lng != null).map(m => `dev:${m.id}`));
    oldIds.forEach(id => { if (!nextIds.has(id)) viewer.entities.removeById(id); });

    members.filter(m => m.lat != null && m.lng != null).forEach(m => {
      const id = `dev:${m.id}`;
      const color = STATUS_COLOR[m.status] ?? STATUS_COLOR.off_route!;
      const target = Cesium.Cartesian3.fromDegrees(m.lng!, m.lat!, 4);
      targetPosRef.current.set(m.id, target);
      if (!currentPosRef.current.has(m.id)) currentPosRef.current.set(m.id, target.clone());
      const existing = entityMapRef.current.get(m.id);
      const heading = Number.isFinite(Number(m.heading)) ? Number(m.heading) : 0;
      const orientation = Cesium.Transforms.headingPitchRollQuaternion(
        target,
        new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(heading), 0, 0),
      );
      const modelUrl = m.vehicle_model_url || VEHICLE_MODEL;
      if (existing) {
        existing.position = new Cesium.ConstantPositionProperty(currentPosRef.current.get(m.id)!);
        existing.orientation = new Cesium.ConstantProperty(orientation);
        const model = existing.model;
        if (model) model.uri = new Cesium.ConstantProperty(modelUrl);
        return;
      }
      const ent = viewer.entities.add({
        id,
        position: new Cesium.ConstantPositionProperty(currentPosRef.current.get(m.id)!),
        orientation: new Cesium.ConstantProperty(orientation),
        model: new Cesium.ModelGraphics({
          uri: new Cesium.ConstantProperty(modelUrl), minimumPixelSize: 44, maximumScale: 260,
          runAnimations: true, shadows: Cesium.ShadowMode.ENABLED,
        }),
        point: { pixelSize: 5, color: css(color), outlineColor: Cesium.Color.WHITE, outlineWidth: 1, distanceDisplayCondition: nearOnly(140), disableDepthTestDistance: Number.POSITIVE_INFINITY },
        label: { text: `${m.officer_name ? `${m.officer_name} · ` : ''}${m.name}${m.position_state && m.position_state !== 'observed' ? ` · ${m.position_state.replaceAll('_', ' ')}` : ''}`,
          font: '600 12px sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: css('#000000'), outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -38),
          disableDepthTestDistance: Number.POSITIVE_INFINITY, distanceDisplayCondition: nearOnly(1_500_000) },
        polyline: { positions: new Cesium.CallbackProperty(() => {
          const p = currentPosRef.current.get(m.id) || target;
          const c = Cesium.Ellipsoid.WGS84.cartesianToCartographic(p);
          return Cesium.Cartesian3.fromDegrees(c.longitude * 180 / Math.PI, c.latitude * 180 / Math.PI, 0).toString ? [Cesium.Cartesian3.fromDegrees(c.longitude * 180 / Math.PI, c.latitude * 180 / Math.PI, 0), p] : [p];
        }, false) as unknown as Cesium.Property, width: 1.5, material: css(color, 0.55) },
        ellipse: { semiMajorAxis: Math.max(8, Number(m.position_uncertainty_m || 12)), semiMinorAxis: Math.max(8, Number(m.position_uncertainty_m || 12)), height: 3,
          material: css(color, 0.06), outline: true, outlineColor: css(color, 0.34), outlineWidth: 1 },
      });
      entityMapRef.current.set(m.id, ent);
    });

    setModelFailed(false);
    const failure = () => setModelFailed(true);
    // Cesium loads GLTF asynchronously. Hook the global error surface only while
    // the scene is active; a failed asset must never remove the real telemetry.
    viewer.scene.renderError.addEventListener(failure);
    const cleanup = () => viewer.scene.renderError.removeEventListener(failure);
    return cleanup;
  }, [members]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.entities.values.filter(e => e.id === 'history:trail').forEach(e => viewer.entities.remove(e));
    if (!trail || trail.length < 2) return;
    viewer.entities.add({ id: 'history:trail', polyline: {
      positions: Cesium.Cartesian3.fromDegreesArray(trail.flatMap(p => [p.lng, p.lat])), width: 3,
      clampToGround: true, material: new Cesium.PolylineDashMaterialProperty({ color: css('#fbbf24', 0.9) }),
    }});
  }, [trail]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !focusId) return;
    const ent = entityMapRef.current.get(focusId);
    if (!ent) return;
    viewer.flyTo(ent, { duration: 1.2, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-28), 5000) }).catch(() => undefined);
  }, [focusId]);

  useEffect(() => {
    if (!simulation || route.length < 2 || totalRouteKm <= 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(100, now - last); last = now;
      const baseKph = Math.max(15, 45);
      setSimKm(v => {
        const n = v + baseKph * SIM_SPEED_MULTIPLIER * dt / 3_600_000;
        return n >= totalRouteKm ? 0 : n;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [simulation, route, totalRouteKm]);

  const simPoint = useMemo(() => interpolateRoute(route, simKm), [route, simKm]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !simulation || route.length < 2) return;
    const p = Cesium.Cartesian3.fromDegrees(simPoint.lng, simPoint.lat, 4);
    const heading = route.length > 1 ? bearingDeg(simPoint, interpolateRoute(route, Math.min(totalRouteKm, simKm + 0.05))) : 0;
    let ent = viewer.entities.getById('sim:vehicle');
    if (!ent) ent = viewer.entities.add({ id: 'sim:vehicle', position: p, orientation: Cesium.Transforms.headingPitchRollQuaternion(p, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(heading), 0, 0)),
      model: new Cesium.ModelGraphics({ uri: new Cesium.ConstantProperty(VEHICLE_MODEL), minimumPixelSize: 44, maximumScale: 260, runAnimations: true, shadows: Cesium.ShadowMode.ENABLED }),
      label: { text: 'SIMULATION · ROUTE MOVEMENT', font: '600 12px sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: css('#000000'), outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -38), disableDepthTestDistance: Number.POSITIVE_INFINITY },
    });
    else { ent.position = new Cesium.ConstantPositionProperty(p); ent.orientation = new Cesium.ConstantProperty(Cesium.Transforms.headingPitchRollQuaternion(p, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(heading), 0, 0))); }
  }, [simulation, route, simPoint, simKm, totalRouteKm]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    if (!simulation) {
      const e = viewer.entities.getById('sim:vehicle');
      if (e) viewer.entities.remove(e);
    }
  }, [simulation]);

  if (failed) {
    return <div className={`flex items-center justify-center bg-black/40 p-6 text-center text-sm text-neutral-500 ${fill ? 'h-full w-full' : 'h-[380px] rounded-xl border border-white/10'}`}>This device can&apos;t render the 3D world (WebGL unavailable).</div>;
  }

  return (
    <div className={fill ? 'relative h-full w-full overflow-hidden' : 'relative overflow-hidden rounded-xl border border-white/10'}>
      <div ref={boxRef} className={fill ? 'h-full w-full' : 'h-[380px] w-full sm:h-[520px]'} />
      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-2 rounded-lg bg-black/75 px-2.5 py-1.5 text-[10px] backdrop-blur">
        <span className="flex items-center gap-1.5 text-violet-300"><span className="h-2.5 w-2.5 rounded-sm border border-violet-400 bg-violet-500/30" /> corridor ±{corridorKm} km</span>
        <span className="text-neutral-500">WORLD STATE · {members.length} assets</span>
        {modelFailed && <span className="text-amber-300">MODEL DEGRADED</span>}
      </div>
      <div className="absolute right-3 top-3 flex gap-1.5">
        <button type="button" title={simulation ? 'Pause movement simulation' : 'Run route simulation'} aria-label={simulation ? 'Pause movement simulation' : 'Run route simulation'} onClick={() => setSimulation(v => !v)}
          className={`grid h-8 w-8 place-items-center rounded-lg border backdrop-blur ${simulation ? 'border-violet-400/50 bg-violet-500/20 text-violet-200' : 'border-white/10 bg-black/60 text-neutral-300 hover:text-white'}`}>
          {simulation ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button type="button" title="Reset simulation" aria-label="Reset simulation" onClick={() => { setSimKm(0); setSimulation(false); }} className="grid h-8 w-8 place-items-center rounded-lg border border-white/10 bg-black/60 text-neutral-300 backdrop-blur hover:text-white"><RotateCcw size={14} /></button>
        <button type="button" title={satellite ? 'Use dark basemap' : 'Use satellite imagery'} aria-label={satellite ? 'Use dark basemap' : 'Use satellite imagery'} onClick={() => setSatellite(v => !v)} className={`grid h-8 w-8 place-items-center rounded-lg border backdrop-blur ${satellite ? 'border-violet-500/50 bg-violet-500/20 text-violet-200' : 'border-white/10 bg-black/60 text-neutral-400'}`}>{satellite ? <Globe2 size={14} /> : <Layers size={14} />}</button>
      </div>
      {simulation && <div className="absolute bottom-10 left-3 right-3 rounded-lg border border-violet-400/20 bg-black/75 p-2 backdrop-blur">
        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-violet-200"><Box size={11} /> route simulation · clearly synthetic</div>
        <div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-violet-400" style={{ width: `${totalRouteKm ? Math.min(100, simKm / totalRouteKm * 100) : 0}%` }} /></div>
      </div>}
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-lg bg-black/70 px-2.5 py-1.5 text-[10px] text-neutral-400 backdrop-blur"><Compass size={11} /> drag to orbit · scroll to zoom · right-drag to tilt</div>
      <div className="pointer-events-none absolute bottom-3 right-3 hidden items-center gap-2 rounded-lg bg-black/70 px-2.5 py-1.5 text-[10px] text-neutral-400 backdrop-blur sm:flex">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> LIVE / RECONCILED WORLD STATE
      </div>
    </div>
  );
}
