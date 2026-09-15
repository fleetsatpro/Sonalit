import { useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Crosshair, Layers, Map, Satellite, Signal, Target, TriangleAlert } from 'lucide-react';

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

type MapMode = 'dark' | 'satellite' | 'hybrid';

const TOKEN = (import.meta.env['VITE_CESIUM_ION_TOKEN'] as string | undefined)?.trim() ?? '';
const STREET_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ROADS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
const PLACES_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const MODEL_URL = (import.meta.env['VITE_SONALIT_VEHICLE_MODEL_URL'] as string | undefined)?.trim() ?? '';

const STATUS_COLOR: Record<string, string> = {
  off_route: '#ef4444',
  behind: '#f59e0b',
  ahead: '#22d3ee',
  on_track: '#10b981',
  no_fix: '#737373',
};
const RISK_COLOR: Record<string, string> = {
  no_go: '#dc2626',
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#84cc16',
};

function css(hex: string, alpha = 1) {
  return Cesium.Color.fromCssColorString(hex).withAlpha(alpha);
}

function fitPoints(route: LatLng[], members: GlobeMember[], trail?: LatLng[]) {
  return [
    ...route,
    ...members.filter(m => m.lat != null && m.lng != null).map(m => ({ lat: m.lat!, lng: m.lng! })),
    ...(trail ?? []),
  ].map(p => Cesium.Cartesian3.fromDegrees(p.lng, p.lat, 0));
}

function vehicleSvg(color: string, selected: boolean) {
  const stroke = selected ? '#ffffff' : color;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64" viewBox="0 0 96 64"><defs><filter id="g"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g filter="url(#g)"><rect x="19" y="8" width="58" height="45" rx="11" fill="#0a0d14" fill-opacity=".96" stroke="${stroke}" stroke-width="4"/><path d="M30 16h31l10 15v12H25V28z" fill="${color}" fill-opacity=".28" stroke="${color}" stroke-width="2"/><circle cx="34" cy="52" r="7" fill="#05070b" stroke="${color}" stroke-width="3"/><circle cx="63" cy="52" r="7" fill="#05070b" stroke="${color}" stroke-width="3"/><path d="M31 20h24l7 10H31z" fill="#dfe7f5" fill-opacity=".18"/></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function addImagery(viewer: Cesium.Viewer, mode: MapMode, onError: (message: string) => void) {
  viewer.imageryLayers.removeAll();
  const add = (url: string, credit: string, maximumLevel = 19, tune?: (layer: Cesium.ImageryLayer) => void) => {
    const provider = new Cesium.UrlTemplateImageryProvider({
      url,
      credit: new Cesium.Credit(credit, false),
      maximumLevel,
      enablePickFeatures: false,
    });
    provider.errorEvent.addEventListener(() => onError('Map tiles are unavailable; the fallback world surface is still active.'));
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    tune?.(layer);
    return layer;
  };

  if (mode === 'dark') {
    add(STREET_URL, 'Esri, HERE, Garmin, © OpenStreetMap contributors', 19, layer => {
      layer.brightness = 0.34;
      layer.contrast = 1.12;
      layer.saturation = 0.35;
      layer.gamma = 0.9;
    });
  } else {
    add(SATELLITE_URL, 'Esri, Maxar, Earthstar Geographics', 19);
    if (mode === 'hybrid') {
      add(ROADS_URL, 'Esri', 19);
      add(PLACES_URL, 'Esri', 19);
    }
  }
}

function statusLabel(member: GlobeMember) {
  const state = member.position_state?.replaceAll('_', ' ');
  return `${member.officer_name ? `${member.officer_name} · ` : ''}${member.name}${state && state !== 'observed' ? ` · ${state}` : ''}`;
}

export default function CorridorWorldScene({
  route,
  corridorKm,
  members,
  zones,
  ceilingM = 0,
  focusId = null,
  trail,
  onSelect,
  fill = false,
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
  const currentRef = useRef<Map<string, Cesium.Cartesian3>>(new Map());
  const targetRef = useRef<Map<string, Cesium.Cartesian3>>(new Map());
  const headingRef = useRef<Map<string, number>>(new Map());
  const selectRef = useRef(onSelect);
  const [mode, setMode] = useState<MapMode>('dark');
  const [mapStatus, setMapStatus] = useState('LIVE WORLD SURFACE');
  const [terrainReady, setTerrainReady] = useState(false);
  const [initFailed, setInitFailed] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [routeFitted, setRouteFitted] = useState(false);

  selectRef.current = onSelect;

  const height = Math.max(200, ceilingM || Math.min(1800, Math.max(700, corridorKm * 500)));
  const liveMembers = useMemo(() => members.filter(m => m.lat != null && m.lng != null), [members]);

  useEffect(() => {
    if (!boxRef.current) return;
    let viewer: Cesium.Viewer;
    try {
      Cesium.Ion.defaultAccessToken = TOKEN;
      const initialProvider = new Cesium.UrlTemplateImageryProvider({
        url: STREET_URL,
        credit: new Cesium.Credit('Esri, HERE, Garmin, © OpenStreetMap contributors', false),
        maximumLevel: 19,
        enablePickFeatures: false,
      });
      viewer = new Cesium.Viewer(boxRef.current, {
        baseLayer: new Cesium.ImageryLayer(initialProvider),
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        animation: false,
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        navigationHelpButton: false,
        navigationInstructionsInitiallyVisible: false,
        fullscreenButton: false,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
      });
    } catch {
      setInitFailed(true);
      return;
    }

    viewerRef.current = viewer;
    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.fog.enabled = true;
    viewer.scene.fog.density = 0.00002;
    viewer.scene.highDynamicRange = true;
    viewer.scene.postProcessStages.fxaa.enabled = true;
    viewer.scene.msaaSamples = 4;
    viewer.resolutionScale = Math.min(window.devicePixelRatio || 1, 2);
    setMapStatus(TOKEN ? 'CESIUM + ESRI · LIVE' : 'ESRI FALLBACK · ION TOKEN NOT EXPOSED');

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(movement.position);
      const id = picked?.id?.id;
      if (typeof id === 'string' && id.startsWith('dev:')) {
        selectRef.current?.(id.slice(4));
      } else {
        selectRef.current?.(null);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    const preRender = () => {
      const alpha = 0.12;
      currentRef.current.forEach((current, id) => {
        const target = targetRef.current.get(id);
        const entity = entityMapRef.current.get(id);
        if (!target || !entity) return;
        const next = Cesium.Cartesian3.lerp(current, target, alpha, new Cesium.Cartesian3());
        currentRef.current.set(id, next);
        entity.position = new Cesium.ConstantPositionProperty(next);
        const heading = headingRef.current.get(id);
        if (heading != null) {
          entity.orientation = new Cesium.ConstantProperty(
            Cesium.Transforms.headingPitchRollQuaternion(next, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(heading), 0, 0)),
          );
        }
      });
      viewer.scene.requestRender();
    };
    viewer.scene.preRender.addEventListener(preRender);

    (async () => {
      if (!TOKEN || viewer.isDestroyed()) return;
      try {
        const terrain = await Cesium.createWorldTerrainAsync();
        if (viewer.isDestroyed()) return;
        viewer.terrainProvider = terrain;
        setTerrainReady(true);
      } catch {
        setMapStatus('ESRI SURFACE · TERRAIN DEGRADED');
      }
    })();

    (async () => {
      if (!TOKEN || viewer.isDestroyed()) return;
      try {
        const buildings = await Cesium.createOsmBuildingsAsync();
        if (!viewer.isDestroyed()) viewer.scene.primitives.add(buildings);
      } catch {
        // Buildings are an enhancement, never a dependency for the operational map.
      }
    })();

    return () => {
      handler.destroy();
      viewer.scene.preRender.removeEventListener(preRender);
      entityMapRef.current.clear();
      currentRef.current.clear();
      targetRef.current.clear();
      headingRef.current.clear();
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    addImagery(viewer, mode, message => setMapStatus(message));
    setRouteFitted(false);
    viewer.scene.requestRender();
  }, [mode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.entities.values.filter(e => e.id.startsWith('corridor:')).forEach(e => viewer.entities.remove(e));
    if (route.length < 2) return;

    const positions = Cesium.Cartesian3.fromDegreesArray(route.flatMap(p => [p.lng, p.lat]));
    const widthM = Math.max(200, corridorKm * 2000);
    viewer.entities.add({
      id: 'corridor:volume',
      corridor: {
        positions,
        width: widthM,
        height: 0,
        extrudedHeight: height,
        material: css('#8b5cf6', 0.12),
        outline: true,
        outlineColor: css('#b59cff', 0.52),
        cornerType: Cesium.CornerType.ROUNDED,
      },
    });
    viewer.entities.add({
      id: 'corridor:center',
      polyline: {
        positions,
        width: 5,
        clampToGround: true,
        material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.28, color: css('#c4b5fd', 0.94) }),
      },
    });
    viewer.entities.add({
      id: 'corridor:top',
      polyline: {
        positions: Cesium.Cartesian3.fromDegrees(route.map(p => p.lng), route.map(p => p.lat), height),
        width: 2,
        material: css('#c4b5fd', 0.28),
      },
    });
    const pin = (id: string, p: LatLng, color: string, label: string) => viewer.entities.add({
      id,
      position: Cesium.Cartesian3.fromDegrees(p.lng, p.lat),
      point: { pixelSize: 12, color: css(color), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: label, font: '700 12px sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -22), disableDepthTestDistance: Number.POSITIVE_INFINITY },
    });
    pin('corridor:origin', route[0]!, '#10b981', 'ORIGIN');
    pin('corridor:destination', route[route.length - 1]!, '#fb7185', 'DESTINATION');
  }, [route, corridorKm, height]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.entities.values.filter(e => e.id.startsWith('risk:')).forEach(e => viewer.entities.remove(e));
    for (const [index, zone] of (zones ?? []).entries()) {
      const color = RISK_COLOR[zone.risk_level] ?? RISK_COLOR.medium!;
      viewer.entities.add({
        id: `risk:${zone.zone_id ?? index}`,
        position: Cesium.Cartesian3.fromDegrees(zone.lng, zone.lat, height / 2),
        cylinder: {
          length: height,
          topRadius: Math.max(50, zone.radius_km * 1000),
          bottomRadius: Math.max(50, zone.radius_km * 1000),
          material: css(color, 0.13),
          outline: true,
          outlineColor: css(color, 0.58),
        },
        label: {
          text: `${zone.name ?? 'Risk zone'} · ${zone.risk_level.replaceAll('_', '-')}`,
          font: '700 11px sans-serif',
          fillColor: css(color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -12),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 750000),
        },
      });
    }
  }, [zones, height]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const activeIds = new Set(liveMembers.map(m => `dev:${m.id}`));
    viewer.entities.values.filter(e => e.id.startsWith('dev:')).forEach(e => {
      if (!activeIds.has(e.id)) {
        viewer.entities.remove(e);
        const id = e.id.slice(4);
        entityMapRef.current.delete(id);
        currentRef.current.delete(id);
        targetRef.current.delete(id);
        headingRef.current.delete(id);
      }
    });

    for (const member of liveMembers) {
      const target = Cesium.Cartesian3.fromDegrees(member.lng!, member.lat!, 6);
      targetRef.current.set(member.id, target);
      if (!currentRef.current.has(member.id)) currentRef.current.set(member.id, target.clone());
      const heading = Number(member.heading);
      if (Number.isFinite(heading)) headingRef.current.set(member.id, heading);
      const position = currentRef.current.get(member.id)!;
      const selected = member.id === focusId;
      const color = STATUS_COLOR[member.status] ?? STATUS_COLOR.off_route;
      const existing = entityMapRef.current.get(member.id);
      const label = statusLabel(member);
      if (existing) {
        existing.position = new Cesium.ConstantPositionProperty(position);
        existing.point = new Cesium.PointGraphics({ pixelSize: selected ? 15 : 9, color: css(color), outlineColor: selected ? Cesium.Color.WHITE : css(color), outlineWidth: selected ? 3 : 1, disableDepthTestDistance: Number.POSITIVE_INFINITY });
        if (existing.label?.text) (existing.label.text as Cesium.ConstantProperty).setValue(label);
        if (existing.billboard?.image) (existing.billboard.image as Cesium.ConstantProperty).setValue(vehicleSvg(color, selected));
        continue;
      }

      const entity = viewer.entities.add({
        id: `dev:${member.id}`,
        position: new Cesium.ConstantPositionProperty(position),
        orientation: Number.isFinite(heading) ? new Cesium.ConstantProperty(Cesium.Transforms.headingPitchRollQuaternion(position, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(heading), 0, 0))) : undefined,
        point: { pixelSize: selected ? 15 : 9, color: css(color), outlineColor: selected ? Cesium.Color.WHITE : css(color), outlineWidth: selected ? 3 : 1, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        billboard: { image: vehicleSvg(color, selected), width: selected ? 42 : 34, height: selected ? 28 : 23, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, disableDepthTestDistance: Number.POSITIVE_INFINITY, alignedAxis: Cesium.Cartesian3.ZERO },
        label: { text: label, font: '700 12px sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -34), disableDepthTestDistance: Number.POSITIVE_INFINITY, showBackground: true, backgroundColor: css('#06090f', 0.76), backgroundPadding: new Cesium.Cartesian2(7, 4) },
        ellipse: { semiMajorAxis: Math.max(12, Number(member.position_uncertainty_m || 12)), semiMinorAxis: Math.max(12, Number(member.position_uncertainty_m || 12)), height: 4, material: css(color, 0.06), outline: true, outlineColor: css(color, 0.45), outlineWidth: 1 },
        ...(member.vehicle_model_url || MODEL_URL ? { model: new Cesium.ModelGraphics({ uri: new Cesium.ConstantProperty(member.vehicle_model_url || MODEL_URL), minimumPixelSize: 34, maximumScale: 220, runAnimations: true, shadows: Cesium.ShadowMode.ENABLED }) } : {}),
      });
      entityMapRef.current.set(member.id, entity);
    }
    viewer.scene.requestRender();
  }, [liveMembers, focusId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.entities.values.filter(e => e.id === 'trail:history').forEach(e => viewer.entities.remove(e));
    if (!trail || trail.length < 2) return;
    viewer.entities.add({
      id: 'trail:history',
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(trail.flatMap(p => [p.lng, p.lat])),
        width: 7,
        clampToGround: true,
        material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.22, color: css('#22d3ee', 0.7) }),
      },
    });
  }, [trail]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !focusId) return;
    const member = liveMembers.find(m => m.id === focusId);
    if (!member || member.lat == null || member.lng == null) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(member.lng, member.lat, 2400),
      orientation: {
        heading: Cesium.Math.toRadians(Number.isFinite(Number(member.heading)) ? Number(member.heading) : 0),
        pitch: Cesium.Math.toRadians(-62),
        roll: 0,
      },
      duration: 0.9,
    });
    setRouteFitted(true);
  }, [focusId, liveMembers]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || routeFitted) return;
    const points = fitPoints(route, liveMembers, trail);
    if (points.length < 2) return;
    viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(points), { duration: 1.15, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-52), Math.max(1800, corridorKm * 900)) }).catch(() => undefined);
    setRouteFitted(true);
  }, [route, liveMembers, trail, corridorKm, routeFitted]);

  const recenter = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const member = focusId ? liveMembers.find(m => m.id === focusId) : null;
    if (member?.lat != null && member?.lng != null) {
      viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(member.lng, member.lat, 2200), orientation: { heading: Cesium.Math.toRadians(Number(member.heading) || 0), pitch: Cesium.Math.toRadians(-62), roll: 0 }, duration: 0.8 });
      return;
    }
    const points = fitPoints(route, liveMembers, trail);
    if (points.length >= 2) viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(points), { duration: 0.8, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-52), Math.max(1800, corridorKm * 900)) });
  };

  if (initFailed) {
    return (
      <div className={`${fill ? 'h-full' : 'h-[520px]'} grid place-items-center bg-[#080b12] text-center`}>
        <div className="max-w-sm px-6">
          <TriangleAlert className="mx-auto mb-3 text-amber-400" size={26} />
          <p className="text-sm font-semibold text-white">4D world renderer failed to initialize</p>
          <p className="mt-1 text-xs text-neutral-500">The operational corridor data is intact. Reopen the map after the browser finishes loading its WebGL context.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${fill ? 'h-full' : 'h-[520px]'} relative overflow-hidden bg-[#080b12]`}>
      <div ref={boxRef} className="absolute inset-0" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-white/10 bg-[#070a10]/86 p-1 backdrop-blur-xl">
          <button type="button" onClick={() => setMode('dark')} className={`grid h-8 w-8 place-items-center rounded-lg ${mode === 'dark' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-white'}`} aria-label="Dark map"><Map size={15} /></button>
          <button type="button" onClick={() => setMode('satellite')} className={`grid h-8 w-8 place-items-center rounded-lg ${mode === 'satellite' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-white'}`} aria-label="Satellite map"><Satellite size={15} /></button>
          <button type="button" onClick={() => setMode('hybrid')} className={`grid h-8 w-8 place-items-center rounded-lg ${mode === 'hybrid' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-white'}`} aria-label="Hybrid map"><Layers size={15} /></button>
          <span className="ml-1 border-l border-white/10 pl-2 pr-2 text-[10px] font-mono text-neutral-500">{mapStatus}</span>
        </div>
        <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-white/10 bg-[#070a10]/86 p-1 backdrop-blur-xl">
          <button type="button" onClick={recenter} className="grid h-8 w-8 place-items-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white" aria-label="Recenter world"><Crosshair size={15} /></button>
          <button type="button" onClick={() => { const viewer = viewerRef.current; if (!viewer || viewer.isDestroyed()) return; const points = fitPoints(route, liveMembers, trail); if (points.length >= 2) viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(points), { duration: 0.8, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-52), Math.max(1800, corridorKm * 900)) }); }} className="grid h-8 w-8 place-items-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white" aria-label="Fit corridor"><Target size={15} /></button>
          <button type="button" onClick={() => setCreditsOpen(v => !v)} className="grid h-8 w-8 place-items-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white" aria-label="Map information"><Signal size={15} /></button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-2">
        <span className="rounded-lg border border-white/10 bg-[#070a10]/84 px-2.5 py-1.5 text-[10px] font-mono text-neutral-400 backdrop-blur-xl">{liveMembers.length} DEVICE{liveMembers.length === 1 ? '' : 'S'} VISIBLE</span>
        {terrainReady && <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.08] px-2.5 py-1.5 text-[10px] font-mono text-emerald-300 backdrop-blur-xl">WORLD TERRAIN</span>}
        {focusId && <span className="rounded-lg border border-violet-500/25 bg-violet-500/[0.09] px-2.5 py-1.5 text-[10px] font-mono text-violet-300 backdrop-blur-xl">FOCUS · {liveMembers.find(m => m.id === focusId)?.name ?? focusId.slice(0, 8)}</span>}
      </div>

      {creditsOpen && (
        <div className="absolute bottom-3 right-3 max-w-xs rounded-xl border border-white/10 bg-[#070a10]/92 p-3 text-[10px] leading-relaxed text-neutral-400 shadow-2xl backdrop-blur-xl">
          <p className="font-semibold text-neutral-200">World surface</p>
          <p className="mt-1">Operational map tiles: Esri / OpenStreetMap contributors. Cesium terrain and buildings are enabled when the configured Ion token permits them.</p>
        </div>
      )}

      {liveMembers.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="rounded-xl border border-white/10 bg-[#070a10]/88 px-4 py-3 text-center backdrop-blur-xl">
            <p className="text-xs font-semibold text-neutral-200">NO LIVE DEVICE FIX</p>
            <p className="mt-1 text-[10px] text-neutral-500">The corridor stays visible, but no position is invented.</p>
          </div>
        </div>
      )}
    </div>
  );
}
