import { useEffect, useMemo, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Crosshair, Layers, Map as MapIcon, Satellite, Signal, Target, TriangleAlert, ZoomIn, ZoomOut, RotateCcw, RotateCw, ArrowUp, ArrowDown, MoveLeft, MoveRight, MoveUp, MoveDown } from 'lucide-react';
import type { SpatialWorldEntity } from '../../lib/spatialClient.js';
import { spatialEntityLayer } from '../../lib/spatialClient.js';
import { createAiCesiumImageryProvider, wrapCesiumImageryProvider } from '../../lib/imageryAiCesium.js';
import '../../styles/spatial-command.css';

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
const GOOGLE_KEY = (import.meta.env['VITE_GOOGLE_MAPS_API_KEY'] as string | undefined)?.trim() ?? '';
const PHOTOREALISTIC_ION_ASSET_ID = 2275207;
const STREET_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ROADS_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
const PLACES_URL = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const MODEL_URL = (import.meta.env['VITE_SONALIT_VEHICLE_MODEL_URL'] as string | undefined)?.trim() ?? '';

const STATUS_COLOR: Record<string, string> = {
  off_route: '#ef4444',
  behind: '#f59e0b',
  ahead: '#22d3ee',
  on_track: '#10b981',
  no_fix: '#737373',
  no_route: '#a78bfa',
};
const RISK_COLOR: Record<string, string> = {
  no_go: '#dc2626',
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#84cc16',
};
const WORLD_LAYER_COLOR: Record<string, string> = {
  aircraft: '#60a5fa', weather: '#a7f3d0', maritime: '#22d3ee', traffic: '#eab308',
  hazards: '#ef4444', security: '#fb923c', infrastructure: '#cbd5e1', incidents: '#fb7185',
  alerts: '#f0abfc', cameras: '#5eead4', satellites: '#c4b5fd',
};

const ABSOLUTE_ALTITUDE_TYPES = new Set(['aircraft', 'satellite']);

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const r = 6371000;
  const p1 = Cesium.Math.toRadians(aLat);
  const p2 = Cesium.Math.toRadians(bLat);
  const dLat = p2 - p1;
  const dLng = Cesium.Math.toRadians(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function cameraViewport(viewer: Cesium.Viewer): { latitude:number; longitude:number; radiusM:number; bbox?:[number,number,number,number] } | null {
  const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (rectangle) {
    const center = Cesium.Rectangle.center(rectangle);
    const corners = [[rectangle.south, rectangle.west], [rectangle.south, rectangle.east], [rectangle.north, rectangle.west], [rectangle.north, rectangle.east]] as const;
    const centerLat = Cesium.Math.toDegrees(center.latitude);
    const centerLng = Cesium.Math.toDegrees(center.longitude);
    const radius = Math.max(...corners.map(([lat, lng]) => haversineMeters(centerLat, centerLng, Cesium.Math.toDegrees(lat), Cesium.Math.toDegrees(lng)))) * 1.2;
    let west = Cesium.Math.toDegrees(rectangle.west);
    let east = Cesium.Math.toDegrees(rectangle.east);
    const south = Cesium.Math.toDegrees(rectangle.south);
    const north = Cesium.Math.toDegrees(rectangle.north);
    if (east <= west) {
      // A dateline-crossing view cannot be represented by one OpenEye bbox.
      // Widen to the full longitudinal span rather than silently returning
      // zero cameras for the visible half-world.
      west = -180;
      east = 180;
    }
    return {
      latitude: centerLat,
      longitude: centerLng,
      radiusM: Math.min(100000, Math.max(10000, Number.isFinite(radius) ? radius : 25000)),
      bbox: [
        Math.max(-180, west),
        Math.max(-90, south),
        Math.min(180, east),
        Math.min(90, north),
      ],
    };
  }
  const cartographic = viewer.camera.positionCartographic;
  if (!cartographic) return null;
  return { latitude: Cesium.Math.toDegrees(cartographic.latitude), longitude: Cesium.Math.toDegrees(cartographic.longitude), radiusM: 50000 };
}

function externalLabel(item: SpatialWorldEntity) {
  const attrs = item.attributes ?? {};
  const value = attrs.callsign ?? attrs.name ?? attrs.title ?? attrs.categoryTitle ?? attrs.description ?? attrs.label ?? item.id;
  const freshness = item.quality?.freshnessClass ?? (item.entityType === 'satellite' ? 'MODELLED' : 'UNKNOWN');
  return String(value) + ' · ' + String(freshness);
}

function externalAltitude(item: SpatialWorldEntity) {
  const type = String(item.entityType || '').toLowerCase();
  const value = Number(item.altitudeM ?? item.attributes?.altitudeM);
  return ABSOLUTE_ALTITUDE_TYPES.has(type) && Number.isFinite(value) && value > 0 ? value : null;
}

function applyPhotorealisticQuality(tileset: Cesium.Cesium3DTileset, highFidelity: boolean) {
  // Preserve high visible fidelity while avoiding whole-world over-refinement.
  // The desired-view SSE remains strict; invisible siblings/flight destinations
  // are no longer prefetched just because the operator moved the camera.
  tileset.maximumScreenSpaceError = highFidelity ? 1.5 : 2.25;
  tileset.cacheBytes = highFidelity ? 384 * 1024 * 1024 : 192 * 1024 * 1024;
  tileset.maximumCacheOverflowBytes = highFidelity ? 192 * 1024 * 1024 : 96 * 1024 * 1024;
  tileset.dynamicScreenSpaceError = true;
  tileset.foveatedScreenSpaceError = true;
  tileset.foveatedTimeDelay = highFidelity ? 0.12 : 0.18;
  tileset.preloadFlightDestinations = false;
  tileset.preloadAncestors = true;
  tileset.preloadSiblings = false;
  tileset.skipLevelOfDetail = true;
  tileset.skipScreenSpaceErrorFactor = 16;
  tileset.skipLevels = 1;
  tileset.immediatelyLoadDesiredLevelOfDetail = false;
  tileset.cullRequestsWhileMoving = true;
  tileset.preferLeaves = false;
  tileset.enableCollision = true;
  tileset.shadows = Cesium.ShadowMode.ENABLED;
}

function createWorldViewer(container: HTMLDivElement, antialias: boolean, requestWebgl1 = false) {
  // Do not bootstrap a low-quality raster layer just to get the widget alive.
  // The first rendered surface should be the photorealistic world, with Esri
  // added only as an explicit last-resort fallback after provider failures.
  return new Cesium.Viewer(container, {
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    showRenderLoopErrors: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    animation: false,
    navigationHelpButton: false,
    navigationInstructionsInitiallyVisible: false,
    fullscreenButton: false,
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
    scene3DOnly: true,
    contextOptions: {
      requestWebgl1,
      allowTextureFilterAnisotropic: true,
      webgl: {
        // The canvas is opaque and the command chrome is HTML above it, so
        // alpha compositing is unnecessary and can reduce context reliability.
        alpha: false,
        antialias,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
        failIfMajorPerformanceCaveat: false,
      },
    },
  });
}

function externalCaption(item: SpatialWorldEntity) {
  const type = String(item.entityType || '').toLowerCase();
  if (type === 'satellite') return 'MODELLED ORBITAL POSITION · NOT LIVE TELEMETRY · NOT AN IMAGING OR TASKING CLAIM';
  if (type === 'spatial_camera' || type === 'camera') return 'CAMERA INFRASTRUCTURE · GEOMETRY ONLY · NOT PERSON TRACKING';
  if (item.telemetryLive === true) return 'LIVE EXTERNAL TELEMETRY';
  const freshness = item.quality?.freshnessClass;
  return freshness ? String(freshness) + ' EXTERNAL OBSERVATION' : 'EXTERNAL WORLD OBSERVATION';
}


function css(hex: string, alpha = 1) {
  return Cesium.Color.fromCssColorString(hex).withAlpha(alpha);
}

function fitPoints(route: LatLng[], members: GlobeMember[], trail?: LatLng[], zones: RiskZone[] = [], worldEntities: SpatialWorldEntity[] = []) {
  return [
    ...route,
    ...members.filter(m => m.lat != null && m.lng != null).map(m => ({ lat: m.lat!, lng: m.lng!, altitudeM: 0 })),
    ...(trail ?? []),
    ...zones.map(z => ({ lat: z.lat, lng: z.lng, altitudeM: 0 })),
    ...worldEntities.filter(e => Number.isFinite(e.latitude) && Number.isFinite(e.longitude)).map(e => ({
      lat: e.latitude,
      lng: e.longitude,
      altitudeM: externalAltitude(e) ?? 0,
    })),
  ].map(p => Cesium.Cartesian3.fromDegrees(p.lng, p.lat, p.altitudeM));
}

function cameraSvg(color: string, selected: boolean) {
  const stroke = selected ? '#ffffff' : color;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="25" fill="#061014" fill-opacity=".94" stroke="${stroke}" stroke-width="3"/><path d="M18 25h22l6-6h5v26h-5l-6-6H18z" fill="${color}" fill-opacity=".30" stroke="${color}" stroke-width="2"/><circle cx="28" cy="32" r="7" fill="#04080c" stroke="${stroke}" stroke-width="2.5"/><circle cx="28" cy="32" r="3" fill="${color}"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function vehicleSvg(color: string, selected: boolean) {
  const stroke = selected ? '#ffffff' : color;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64" viewBox="0 0 96 64"><defs><filter id="g"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g filter="url(#g)"><rect x="19" y="8" width="58" height="45" rx="11" fill="#0a0d14" fill-opacity=".96" stroke="${stroke}" stroke-width="4"/><path d="M30 16h31l10 15v12H25V28z" fill="${color}" fill-opacity=".28" stroke="${color}" stroke-width="2"/><circle cx="34" cy="52" r="7" fill="#05070b" stroke="${color}" stroke-width="3"/><circle cx="63" cy="52" r="7" fill="#05070b" stroke="${color}" stroke-width="3"/><path d="M31 20h24l7 10H31z" fill="#dfe7f5" fill-opacity=".18"/></g></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function addImagery(viewer: Cesium.Viewer, mode: MapMode, onError: (message: string) => void) {
  viewer.imageryLayers.removeAll();
  const add = (url: string, credit: string, maximumLevel = 19, tune?: (layer: Cesium.ImageryLayer) => void) => {
    const provider = url === SATELLITE_URL
      ? createAiCesiumImageryProvider(url, credit, maximumLevel, 14)
      : new Cesium.UrlTemplateImageryProvider({
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

function singleWorldPoint(liveMembers: GlobeMember[], zones: RiskZone[], worldEntities: SpatialWorldEntity[]) {
  const member = liveMembers.find(m => m.lat != null && m.lng != null);
  if (member) return { lat: member.lat!, lng: member.lng!, altitudeM: 0 };
  const zone = zones[0];
  if (zone) return { lat: zone.lat, lng: zone.lng, altitudeM: 0 };
  const external = worldEntities.find(e => Number.isFinite(e.latitude) && Number.isFinite(e.longitude));
  if (external) return { lat: external.latitude, lng: external.longitude, altitudeM: externalAltitude(external) ?? 0 };
  return null;
}

function globalCameraEntities(worldEntities: SpatialWorldEntity[]) {
  // Orbital/modelled entities must never determine the initial ground-world fit.
  // Their altitude can be orders of magnitude above the Earth surface and a
  // low fixed camera range can push Cesium into the globe, appearing blank.
  return worldEntities.filter(entity => {
    const type = String(entity.entityType || '').toLowerCase();
    if (type === 'satellite') return false;
    const altitude = externalAltitude(entity);
    return altitude == null || altitude <= 50_000;
  });
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
  onExternalSelect,
  selectedExternalId = null,
  worldEntities = [],
  onViewportChange,
  fill = false,
  globalView = false,
  showMapControls = true,
}: {
  route: LatLng[];
  corridorKm: number;
  members: GlobeMember[];
  zones?: RiskZone[];
  ceilingM?: number;
  focusId?: string | null;
  trail?: LatLng[];
  onSelect?: (id: string | null) => void;
  onExternalSelect?: (id: string | null) => void;
  selectedExternalId?: string | null;
  worldEntities?: SpatialWorldEntity[];
  onViewportChange?: (viewport: { latitude: number; longitude: number; radiusM: number }) => void;
  fill?: boolean;
  globalView?: boolean;
  showMapControls?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const entityMapRef = useRef<Map<string, Cesium.Entity>>(new globalThis.Map());
  const externalEntityMapRef = useRef<Map<string, Cesium.Entity>>(new globalThis.Map());
  const currentRef = useRef<Map<string, Cesium.Cartesian3>>(new globalThis.Map());
  const targetRef = useRef<Map<string, Cesium.Cartesian3>>(new globalThis.Map());
  const headingRef = useRef<Map<string, number>>(new globalThis.Map());
  const vehicleRenderPulseTimerRef = useRef<number | null>(null);
  const renderPulseMsRef = useRef(33);
  const startVehicleRenderPulseRef = useRef<(() => void) | null>(null);
  const selectRef = useRef(onSelect);
  const externalSelectRef = useRef(onExternalSelect);
  const onViewportChangeRef = useRef(onViewportChange);
  const fittedRouteSignatureRef = useRef<string | null>(null);
  // Data refreshes must never steal the operator's camera. GEV performs one
  // initial fit after the first usable world state, then only explicit
  // recenter/fit controls may move the camera.
  const initialGlobalFitDoneRef = useRef(false);
  const initialLocalFitDoneRef = useRef(false);
  const renderRecoveryRef = useRef(0);
  const photoTilesetRef = useRef<Cesium.Cesium3DTileset | null>(null);
  const modeRef = useRef<MapMode>(globalView ? 'satellite' : 'dark');
  const surfaceQualityRef = useRef<'loading' | 'photorealistic' | 'terrain' | 'fallback'>('loading');
  const [mode, setMode] = useState<MapMode>(globalView ? 'satellite' : 'dark');
  const [surfaceQuality, setSurfaceQuality] = useState<'loading' | 'photorealistic' | 'terrain' | 'fallback'>('loading');
  const [mapStatus, setMapStatus] = useState('HIGH-FIDELITY 3D SURFACE LOADING');
  const [terrainReady, setTerrainReady] = useState(false);
  const [initFailed, setInitFailed] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);

  selectRef.current = onSelect;
  externalSelectRef.current = onExternalSelect;
  onViewportChangeRef.current = onViewportChange;
  modeRef.current = mode;
  surfaceQualityRef.current = surfaceQuality;

  const height = Math.max(200, ceilingM || Math.min(1800, Math.max(700, corridorKm * 500)));
  const liveMembers = useMemo(() => members.filter(m => m.lat != null && m.lng != null), [members]);
  const routeSignature = useMemo(() => {
    const start = route[0];
    const end = route.at(-1);
    return [route.length, start?.lat, start?.lng, end?.lat, end?.lng].join(':');
  }, [route]);

  useEffect(() => {
    if (!boxRef.current) return;
    let viewer: Cesium.Viewer;
    let contextSafeMode = false;
    let webgl1CompatibilityMode = false;
    try {
      Cesium.Ion.defaultAccessToken = TOKEN;
      viewer = createWorldViewer(boxRef.current, true, false);
    } catch {
      // A subset of mobile/driver combinations reject an antialiased WebGL context.
      // Retry the exact same high-fidelity scene with a context-safe WebGL2 setup.
      contextSafeMode = true;
      try {
        while (boxRef.current.firstChild) boxRef.current.removeChild(boxRef.current.firstChild);
        viewer = createWorldViewer(boxRef.current, false, false);
      } catch {
        // Cesium supports an explicit WebGL1 compatibility path. Keep this as the
        // final renderer-tier fallback instead of replacing the 3D world with 2D.
        webgl1CompatibilityMode = true;
        try {
          while (boxRef.current.firstChild) boxRef.current.removeChild(boxRef.current.firstChild);
          viewer = createWorldViewer(boxRef.current, false, true);
        } catch {
          setInitFailed(true);
          return;
        }
      }
    }

    viewerRef.current = viewer;
    // Cesium stops its default render loop after a render exception. Keep GEV
    // self-healing for transient shader/texture/tile faults instead of leaving
    // the operator with a permanently frozen or blank globe.
    const renderErrorHandler = () => {
      setMapStatus('3D RENDER RECOVERING · PRESERVING ACTIVE SURFACE');
      if (renderRecoveryRef.current >= 3 || viewer.isDestroyed()) return;
      renderRecoveryRef.current += 1;
      // Stay in requestRenderMode during recovery. Re-enabling Cesium's
      // continuous loop here would recreate the browser-lag failure mode.
      viewer.scene.requestRender();
    };
    viewer.scene.renderError.addEventListener(renderErrorHandler);
    if (globalView) {
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(20, 0, 13000000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 },
      });
    }
    const compactSurface = window.matchMedia?.('(max-width: 900px)').matches ?? false;
    const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const cssWidth = Math.max(320, boxRef.current.clientWidth || 1280);
    const cssHeight = Math.max(240, boxRef.current.clientHeight || 720);
    const nativePixels = cssWidth * cssHeight * devicePixelRatio * devicePixelRatio;
    const deviceMemoryGiB = Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8);
    const hardwareThreads = Number(navigator.hardwareConcurrency || 4);
    const highFidelity = !compactSurface || (deviceMemoryGiB >= 6 && hardwareThreads >= 6);
    // Budget the framebuffer in actual pixels. Never supersample a dense mobile
    // canvas above its native device resolution: the old 1.35 ceiling could
    // multiply an already-large DPR framebuffer into a browser-melting surface.
    const pixelBudget = compactSurface
      ? (deviceMemoryGiB >= 8 && hardwareThreads >= 8 ? 5_500_000 : 4_200_000)
      : (deviceMemoryGiB >= 12 && hardwareThreads >= 8 ? 10_000_000 : 8_500_000);
    const resolutionScale = Math.min(1, Math.sqrt(pixelBudget / Math.max(1, nativePixels)));
    const msaaTarget = compactSurface ? 2 : 4;
    renderPulseMsRef.current = compactSurface ? 55 : 35;

    viewer.scene.globe.enableLighting = true;
    viewer.scene.globe.showGroundAtmosphere = true;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.fog.enabled = false;
    viewer.scene.highDynamicRange = !compactSurface && viewer.scene.highDynamicRangeSupported;
    viewer.scene.postProcessStages.fxaa.enabled = true;
    // Logarithmic depth improves precision across global-to-street camera ranges.
    try {
      viewer.scene.logarithmicDepthBuffer = true;
    } catch {
      // Preserve normal depth buffering on legacy contexts.
    }
    viewer.scene.globe.tileCacheSize = highFidelity ? 1100 : 500;
    viewer.scene.globe.preloadAncestors = true;
    viewer.scene.globe.preloadSiblings = false;
    // Prefer 8x MSAA, but keep 4x on the context-safe path. Combined with
    // high-DPI rendering and FXAA this preserves crisp geometry without risking
    // another context initialization failure on constrained GPUs.
    viewer.scene.msaaSamples = viewer.scene.msaaSupported
      ? (webgl1CompatibilityMode ? 2 : (contextSafeMode ? Math.min(4, msaaTarget) : msaaTarget))
      : 1;
    // Render at native device density first, then allow bounded supersampling
    // on genuinely large displays. This avoids the old DPR × resolutionScale
    // multiplication that could request enormous mobile framebuffers.
    viewer.useBrowserRecommendedResolution = false;
    viewer.resolutionScale = resolutionScale;
    viewer.scene.globe.maximumScreenSpaceError = compactSurface ? 1.0 : 0.5;
    viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#06101a');
    viewer.scene.globe.undergroundColor = Cesium.Color.fromCssColorString('#02050a');
    viewer.scene.globe.dynamicAtmosphereLighting = true;
    viewer.scene.globe.dynamicAtmosphereLightingFromSun = true;
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.brightnessShift = -0.06;
    viewer.scene.skyAtmosphere.saturationShift = 0.04;
    viewer.scene.skyAtmosphere.hueShift = -0.01;
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#02050a');
    viewer.scene.screenSpaceCameraController.inertiaSpin = 0.72;
    viewer.scene.screenSpaceCameraController.inertiaTranslate = 0.72;
    // Keep pinch/wheel input responsive without the prolonged inertial zoom
    // that can feel like the camera is continuing to move on its own.
    viewer.scene.screenSpaceCameraController.inertiaZoom = 0.12;
    viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;
    viewer.scene.screenSpaceCameraController.minimumZoomDistance = 90;
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 30000000;
    // Avoid blur-producing bloom on the photographic surface. GEV prioritizes
    // source texture fidelity and crisp building edges over decorative glow.
    // Do not let the low-detail ellipsoid flash underneath the photorealistic world.
    viewer.scene.globe.show = !(GOOGLE_KEY || TOKEN);
    setSurfaceQuality('loading');
    setMapStatus('HIGH-FIDELITY 3D SURFACE LOADING');

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(movement.position);
      const id = picked?.id?.id;
      if (typeof id === 'string' && id.startsWith('dev:')) {
        selectRef.current?.(id.slice(4));
        externalSelectRef.current?.(null);
      } else if (typeof id === 'string' && id.startsWith('ext:')) {
        selectRef.current?.(null);
        externalSelectRef.current?.(id.slice(4));
      } else {
        selectRef.current?.(null);
        externalSelectRef.current?.(null);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    const preRender = () => {
      // Interpolation work only matters while a vehicle is actually moving.
      // requestRenderMode ensures this callback is not a permanent 60 FPS loop.
      const alpha = compactSurface ? 0.24 : 0.20;
      let moving = false;
      currentRef.current.forEach((current, id) => {
        const target = targetRef.current.get(id);
        const entity = entityMapRef.current.get(id);
        if (!target || !entity) return;
        if (Cesium.Cartesian3.distance(current, target) <= 0.75) {
          if (!Cesium.Cartesian3.equals(current, target)) {
            currentRef.current.set(id, target.clone());
            entity.position = new Cesium.ConstantPositionProperty(target);
          }
          return;
        }
        const next = Cesium.Cartesian3.lerp(current, target, alpha, new Cesium.Cartesian3());
        currentRef.current.set(id, next);
        entity.position = new Cesium.ConstantPositionProperty(next);
        const heading = headingRef.current.get(id);
        if (heading != null) {
          entity.orientation = new Cesium.ConstantProperty(
            Cesium.Transforms.headingPitchRollQuaternion(next, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(heading), 0, 0)),
          );
        }
        moving = true;
      });
      return moving;
    };
    viewer.scene.preRender.addEventListener(preRender);

    const startVehicleRenderPulse = () => {
      if (vehicleRenderPulseTimerRef.current != null) return;
      const pulse = () => {
        vehicleRenderPulseTimerRef.current = null;
        if (viewer.isDestroyed()) return;
        const moving = Array.from(currentRef.current.entries()).some(([id, current]) => {
          const target = targetRef.current.get(id);
          return Boolean(target && Cesium.Cartesian3.distance(current, target) > 0.75);
        });
        if (!moving) return;
        viewer.scene.requestRender();
        vehicleRenderPulseTimerRef.current = window.setTimeout(pulse, renderPulseMsRef.current);
      };
      pulse();
    };
    startVehicleRenderPulseRef.current = startVehicleRenderPulse;
    const syncViewport = () => {
      if (viewer.isDestroyed()) return;
      const viewport = cameraViewport(viewer);
      if (viewport) onViewportChangeRef.current?.(viewport);
    };
    viewer.camera.moveEnd.addEventListener(syncViewport);

    const resize = () => {
      if (viewer.isDestroyed()) return;
      viewer.resize();
      viewer.scene.requestRender();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(boxRef.current);
    resize();

    (async () => {
      const alive = () => !viewer.isDestroyed();
      // First choice when explicitly configured: Google's live Photorealistic
      // 3D Tiles service. The existing Drive Replay integration establishes the
      // same credential contract, and 18 concurrent tile requests follows
      // Google's current Cesium guidance.
      if (GOOGLE_KEY) {
        try {
          // Use the raw Google 3D Tiles root endpoint. This keeps the GEV
          // chrome free of a geocoder while following Google's documented
          // CesiumJS renderer pattern.
          setMapStatus('GOOGLE PHOTOREALISTIC 3D · CONNECTING');
          Cesium.RequestScheduler.requestsByServer['tile.googleapis.com:443'] = 18;
          const tileset = await Cesium.Cesium3DTileset.fromUrl(
            `https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(GOOGLE_KEY)}`,
            { showCreditsOnScreen: true },
          );
          tileset.initialTilesLoaded.addEventListener(() => {
            if (!viewer.isDestroyed() && photoTilesetRef.current === tileset) {
              setMapStatus('GOOGLE PHOTOREALISTIC 3D · FULL DETAIL');
            }
          });
          if (!alive()) return;
          photoTilesetRef.current = viewer.scene.primitives.add(tileset);
          applyPhotorealisticQuality(tileset, highFidelity);
          viewer.scene.globe.show = false;
          viewer.scene.globe.showGroundAtmosphere = false;
          viewer.scene.fog.enabled = false;
          surfaceQualityRef.current = 'photorealistic';
          setSurfaceQuality('photorealistic');
          setMapStatus('GOOGLE PHOTOREALISTIC 3D · STREAMING');
          viewer.scene.requestRender();
          return;
        } catch {
          setMapStatus('GOOGLE 3D UNAVAILABLE · SWITCHING TO ION PHOTOREALISTIC');
          // Use the Ion-hosted Photorealistic asset before dropping to terrain.
        }
      }

      // Guaranteed high-fidelity route when a Cesium Ion token is available:
      // Cesium ion distributes Google's Photorealistic 3D Tiles as a reusable
      // global 3D asset. This avoids requiring an additional Google key for GEV.
      if (TOKEN) {
        try {
          setMapStatus('CESIUM ION · PHOTOREALISTIC 3D · CONNECTING');
          const tileset = await Cesium.Cesium3DTileset.fromIonAssetId(PHOTOREALISTIC_ION_ASSET_ID, {
            showCreditsOnScreen: true,
          });
          tileset.initialTilesLoaded.addEventListener(() => {
            if (!viewer.isDestroyed() && photoTilesetRef.current === tileset) {
              setMapStatus('CESIUM ION · PHOTOREALISTIC 3D · FULL DETAIL');
            }
          });
          if (!alive()) return;
          photoTilesetRef.current = viewer.scene.primitives.add(tileset);
          applyPhotorealisticQuality(tileset, highFidelity);
          viewer.scene.globe.show = false;
          viewer.scene.globe.showGroundAtmosphere = false;
          viewer.scene.fog.enabled = false;
          surfaceQualityRef.current = 'photorealistic';
          setSurfaceQuality('photorealistic');
          setMapStatus('CESIUM ION · PHOTOREALISTIC 3D');
          viewer.scene.requestRender();
          return;
        } catch {
          setMapStatus('ION PHOTOREALISTIC UNAVAILABLE · SWITCHING TO 3D TERRAIN');
          // Fall through to the Cesium World Terrain surface below.
        }
      }

      // Final high-quality fallback: Cesium World Terrain + high-resolution
      // global aerial imagery + OSM buildings. This retains true relief and
      // 3D structures when photorealistic coverage/credentials are unavailable.
      if (TOKEN) {
        viewer.scene.globe.show = true;
        let imageryLoaded = false;
        try {
          setMapStatus('CESIUM WORLD AERIAL · CONNECTING');
          const imagery = wrapCesiumImageryProvider(await Cesium.createWorldImageryAsync({
            style: modeRef.current === 'hybrid'
              ? Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS
              : Cesium.IonWorldImageryStyle.AERIAL,
          }), 14);
          if (!alive()) return;
          viewer.imageryLayers.removeAll();
          viewer.imageryLayers.addImageryProvider(imagery);
          imageryLoaded = true;
        } catch {
          setMapStatus('CESIUM WORLD AERIAL UNAVAILABLE · RETAINING BEST SURFACE');
          // Keep the existing no-imagery globe until terrain can be attached.
        }
        let terrainLoaded = false;
        try {
          setMapStatus('CESIUM WORLD TERRAIN · CONNECTING');
          const terrain = await Cesium.createWorldTerrainAsync({ requestVertexNormals: true, requestWaterMask: true });
          if (!alive()) return;
          viewer.terrainProvider = terrain;
          setTerrainReady(true);
          terrainLoaded = true;
        } catch {
          // Ellipsoid terrain remains available.
        }
        let buildingsLoaded = false;
        try {
          const buildings = await Cesium.createOsmBuildingsAsync();
          if (!alive()) return;
          viewer.scene.primitives.add(buildings);
          buildingsLoaded = true;
        } catch {
          // Buildings are an enhancement, never a dependency for the world surface.
        }
        if (!imageryLoaded) {
          addImagery(viewer, modeRef.current, message => setMapStatus(message));
        }
        surfaceQualityRef.current = 'terrain';
        setSurfaceQuality('terrain');
        setMapStatus(
          terrainLoaded
            ? (imageryLoaded
              ? (buildingsLoaded ? 'CESIUM WORLD TERRAIN · 3D BUILDINGS' : 'CESIUM WORLD TERRAIN · AERIAL')
              : (buildingsLoaded ? 'CESIUM WORLD TERRAIN · ESRI AERIAL FALLBACK + 3D BUILDINGS' : 'CESIUM WORLD TERRAIN · ESRI AERIAL FALLBACK'))
            : 'CESIUM ELLIPSOID · ESRI AERIAL FALLBACK',
        );
        viewer.scene.requestRender();
        return;
      }

      // No high-fidelity credentials: deliberately make the raster surface
      // an explicit last resort. It is never used to mask provider failures.
      addImagery(viewer, modeRef.current, message => setMapStatus(message));
      surfaceQualityRef.current = 'fallback';
      setSurfaceQuality('fallback');
      setMapStatus('ESRI RASTER FALLBACK · NO HIGH-FIDELITY CREDENTIAL');
      viewer.scene.requestRender();
    })();

    return () => {
      observer.disconnect();
      handler.destroy();
      viewer.scene.preRender.removeEventListener(preRender);
      viewer.scene.renderError.removeEventListener(renderErrorHandler);
      viewer.camera.moveEnd.removeEventListener(syncViewport);
      renderRecoveryRef.current = 0;
      if (photoTilesetRef.current) {
        try { viewer.scene.primitives.remove(photoTilesetRef.current); } catch { /* viewer teardown */ }
        photoTilesetRef.current = null;
      }
      entityMapRef.current.clear();
      externalEntityMapRef.current.clear();
      currentRef.current.clear();
      targetRef.current.clear();
      headingRef.current.clear();
      fittedRouteSignatureRef.current = null;
      initialGlobalFitDoneRef.current = false;
      initialLocalFitDoneRef.current = false;
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    modeRef.current = mode;
    if (surfaceQualityRef.current === 'loading') {
      // Provider initialization owns the surface while it is negotiating.
      // Never introduce a raster replacement just because a display mode changed.
      return;
    }
    if (surfaceQualityRef.current === 'photorealistic') {
      setMapStatus(GOOGLE_KEY ? 'GOOGLE PHOTOREALISTIC 3D · FULL DETAIL' : 'CESIUM ION · PHOTOREALISTIC 3D · FULL DETAIL');
      return;
    }
    if (surfaceQualityRef.current === 'terrain' && TOKEN) {
      void Cesium.createWorldImageryAsync({
        style: mode === 'hybrid' ? Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS : Cesium.IonWorldImageryStyle.AERIAL,
      }).then(provider => {
        if (viewer.isDestroyed() || surfaceQualityRef.current !== 'terrain') return;
        viewer.imageryLayers.removeAll();
        viewer.imageryLayers.addImageryProvider(wrapCesiumImageryProvider(provider, 14));
        viewer.scene.requestRender();
      }).catch(() => { /* preserve the current imagery surface */ });
      return;
    }
    addImagery(viewer, mode, message => setMapStatus(message));
    viewer.scene.requestRender();
  }, [mode]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.entities.values.filter(e => e.id.startsWith('corridor:')).forEach(e => viewer.entities.remove(e));
    if (route.length < 2) return;

    const positions = Cesium.Cartesian3.fromDegreesArray(route.flatMap(p => [p.lng, p.lat]));
    const topPositions = Cesium.Cartesian3.fromDegreesArrayHeights(route.flatMap(p => [p.lng, p.lat, height]));
    const widthM = Math.max(200, corridorKm * 2000);
    viewer.entities.add({
      id: 'corridor:volume',
      corridor: {
        positions,
        width: widthM,
        height: 0,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        extrudedHeight: height,
        extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
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
        positions: topPositions,
        width: 2,
        material: css('#c4b5fd', 0.28),
      },
    });
    const pin = (id: string, p: LatLng, color: string, label: string) => viewer.entities.add({
      id,
      position: Cesium.Cartesian3.fromDegrees(p.lng, p.lat),
      point: { pixelSize: 12, color: css(color), outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
      label: { text: label, font: '700 12px sans-serif', fillColor: Cesium.Color.WHITE, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -22), disableDepthTestDistance: Number.POSITIVE_INFINITY },
    });
    pin('corridor:origin', route[0]!, '#10b981', 'ORIGIN');
    pin('corridor:destination', route[route.length - 1]!, '#fb7185', 'DESTINATION');
    viewer.scene.requestRender();
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
          heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
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
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 750000),
        },
      });
    }
    viewer.scene.requestRender();
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
      const target = Cesium.Cartesian3.fromDegrees(member.lng!, member.lat!, 0);
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
        const moved = Cesium.Cartesian3.distance(currentRef.current.get(member.id) ?? position, target) > 0.75;
        targetRef.current.set(member.id, target);
        existing.point = new Cesium.PointGraphics({ pixelSize: selected ? 15 : 9, color: css(color), outlineColor: selected ? Cesium.Color.WHITE : css(color), outlineWidth: selected ? 3 : 1, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY });
        if (existing.label?.text) (existing.label.text as Cesium.ConstantProperty).setValue(label);
        if (existing.billboard?.image) (existing.billboard.image as Cesium.ConstantProperty).setValue(vehicleSvg(color, selected));
        if (Number.isFinite(heading)) {
          existing.orientation = new Cesium.ConstantProperty(
            Cesium.Transforms.headingPitchRollQuaternion(currentRef.current.get(member.id) ?? target, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(heading), 0, 0)),
          );
        }
        if (moved) startVehicleRenderPulseRef.current?.();
        continue;
      }

      const entity = viewer.entities.add({
        id: `dev:${member.id}`,
        position: new Cesium.ConstantPositionProperty(position),
        orientation: Number.isFinite(heading) ? new Cesium.ConstantProperty(Cesium.Transforms.headingPitchRollQuaternion(position, new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(heading), 0, 0))) : undefined,
        point: { pixelSize: selected ? 15 : 9, color: css(color), outlineColor: selected ? Cesium.Color.WHITE : css(color), outlineWidth: selected ? 3 : 1, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY },
        billboard: { image: vehicleSvg(color, selected), width: selected ? 42 : 34, height: selected ? 28 : 23, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY, alignedAxis: Cesium.Cartesian3.ZERO, scaleByDistance: new Cesium.NearFarScalar(250, 1.18, 300000, 0.62) },
        label: { text: label, font: '700 12px sans-serif', fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3, style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -34), heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, disableDepthTestDistance: Number.POSITIVE_INFINITY, showBackground: true, backgroundColor: css('#06090f', 0.76), backgroundPadding: new Cesium.Cartesian2(7, 4), scaleByDistance: new Cesium.NearFarScalar(300, 1.08, 180000, 0.72), translucencyByDistance: new Cesium.NearFarScalar(35000, 1, 240000, 0) },
        ellipse: { semiMajorAxis: Math.max(12, Number(member.position_uncertainty_m || 12)), semiMinorAxis: Math.max(12, Number(member.position_uncertainty_m || 12)), height: 4, material: css(color, 0.06), outline: true, outlineColor: css(color, 0.45), outlineWidth: 1 },
        ...(member.vehicle_model_url || MODEL_URL ? { model: new Cesium.ModelGraphics({ uri: new Cesium.ConstantProperty(member.vehicle_model_url || MODEL_URL), minimumPixelSize: 34, maximumScale: 220, runAnimations: selected, shadows: selected ? Cesium.ShadowMode.ENABLED : Cesium.ShadowMode.DISABLED, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND }) } : {}),
      });
      entityMapRef.current.set(member.id, entity);
    }
    viewer.scene.requestRender();
  }, [liveMembers, focusId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    viewer.entities.values.filter(e => e.id === 'trail:history').forEach(e => viewer.entities.remove(e));
    if (!trail || trail.length < 2) {
      viewer.scene.requestRender();
      return;
    }
    viewer.entities.add({
      id: 'trail:history',
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(trail.flatMap(p => [p.lng, p.lat])),
        width: 7,
        clampToGround: true,
        material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.22, color: css('#22d3ee', 0.7) }),
      },
    });
    viewer.scene.requestRender();
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
  }, [focusId]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || route.length < 2) return;
    if (fittedRouteSignatureRef.current === routeSignature) return;
    const points = fitPoints(route, liveMembers, trail, zones, worldEntities);
    if (points.length < 2) return;
    viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(points), {
      duration: 1.15,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-52), Math.max(1800, corridorKm * 900)),
    });
    fittedRouteSignatureRef.current = routeSignature;
  }, [route, routeSignature, liveMembers, trail, zones, worldEntities, corridorKm]);

  // GEV starts from a true global view. Refine only when there are at least
  // two safe ground/low-altitude anchors; never fit the camera to orbital
  // geometry and never auto-zoom to a lone local point.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !globalView || route.length >= 2) return;
    if (initialGlobalFitDoneRef.current) return;

    const cameraEntities = globalCameraEntities(worldEntities);
    const points = fitPoints([], liveMembers, trail, zones, cameraEntities);
    if (points.length < 2) return;
    initialGlobalFitDoneRef.current = true;

    const sphere = Cesium.BoundingSphere.fromPoints(points);
    const safeRange = Math.min(14_000_000, Math.max(3_500_000, sphere.radius * 3.2));
    viewer.camera.flyToBoundingSphere(sphere, {
      duration: 1.15,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-52), safeRange),
    });
  }, [globalView, route.length, liveMembers, trail, zones, worldEntities]);

  // XD Live can be opened before a corridor has geometry. Still present a
  // useful live surface by fitting once to the first available live context.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || globalView || route.length >= 2) return;
    if (initialLocalFitDoneRef.current) return;

    const points = fitPoints([], liveMembers, trail, zones, worldEntities);
    if (!points.length) return;

    if (points.length === 1) {
      const only = singleWorldPoint(liveMembers, zones, worldEntities);
      if (!only) return;
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(
          only.lng,
          only.lat,
          Math.max(2200, only.altitudeM + 2200),
        ),
        duration: 0.9,
      });
    } else {
      viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(points), {
        duration: 1.0,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-52), Math.max(1800, corridorKm * 900)),
      });
    }

    initialLocalFitDoneRef.current = true;
  }, [globalView, route.length, liveMembers, trail, zones, worldEntities, corridorKm]);

  const zoomCamera = (direction: 'in' | 'out') => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const heightM = viewer.camera.positionCartographic.height;
    const distance = Math.max(100, Math.min(8_000_000, heightM * 0.18));
    if (direction === 'in') viewer.camera.zoomIn(distance);
    else viewer.camera.zoomOut(distance);
    viewer.scene.requestRender();
  };

  const rotateCamera = (direction: 'left' | 'right' | 'up' | 'down') => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const angle = Cesium.Math.toRadians(7);
    if (direction === 'left') viewer.camera.rotateLeft(angle);
    else if (direction === 'right') viewer.camera.rotateRight(angle);
    else if (direction === 'up') viewer.camera.rotateUp(angle);
    else viewer.camera.rotateDown(angle);
    viewer.scene.requestRender();
  };

  const panCamera = (direction: 'left' | 'right' | 'up' | 'down') => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const heightM = viewer.camera.positionCartographic.height;
    const distance = Math.max(100, Math.min(1_200_000, heightM * 0.09));
    if (direction === 'left') viewer.camera.moveLeft(distance);
    else if (direction === 'right') viewer.camera.moveRight(distance);
    else if (direction === 'up') viewer.camera.moveUp(distance);
    else viewer.camera.moveDown(distance);
    viewer.scene.requestRender();
  };

  const recenter = () => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const member = focusId ? liveMembers.find(m => m.id === focusId) : null;
    if (member?.lat != null && member?.lng != null) {
      viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(member.lng, member.lat, 2200), orientation: { heading: Cesium.Math.toRadians(Number(member.heading) || 0), pitch: Cesium.Math.toRadians(-62), roll: 0 }, duration: 0.8 });
      return;
    }
    const cameraEntities = globalView ? globalCameraEntities(worldEntities) : worldEntities;
    const points = fitPoints(route, liveMembers, trail, zones, cameraEntities);
    if (points.length === 1) {
      const only = singleWorldPoint(liveMembers, zones, worldEntities);
      if (only) viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(only.lng, only.lat, Math.max(2200, only.altitudeM + 2200)), duration: 0.8 });
    } else if (points.length >= 2) {
      viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(points), { duration: 0.8, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-52), Math.max(1800, corridorKm * 900)) });
    }
  };

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const renderable = worldEntities.filter((item) => spatialEntityLayer(item) && Number.isFinite(item.latitude) && Number.isFinite(item.longitude));
    const incoming = new Set(renderable.map((item) => `ext:${item.id}`));

    viewer.entities.values.filter((entity) => entity.id.startsWith('ext:')).forEach((entity) => {
      if (!incoming.has(entity.id)) {
        viewer.entities.remove(entity);
        externalEntityMapRef.current.delete(entity.id.slice(4));
      }
    });

    for (const item of renderable) {
      const layer = spatialEntityLayer(item);
      if (!layer) continue;
      const id = `ext:${item.id}`;
      const color = WORLD_LAYER_COLOR[layer] ?? '#94a3b8';
      const selected = item.id === selectedExternalId;
      const type = String(item.entityType || '').toLowerCase();
      const altitude = externalAltitude(item);
      const position = Cesium.Cartesian3.fromDegrees(item.longitude, item.latitude, altitude ?? 0);
      const ground = Cesium.Cartesian3.fromDegrees(item.longitude, item.latitude, 0);
      const label = externalLabel(item);
      const existing = externalEntityMapRef.current.get(item.id);
      const isCamera = type === 'camera' || type === 'spatial_camera';
      const pointSize = selected ? 16 : (type === 'satellite' || type === 'aircraft' ? 10 : isCamera ? 11 : 8);
      const maxLabelDistance = type === 'satellite' ? 30000000 : isCamera ? 750000 : 3500000;
      const point = new Cesium.PointGraphics({
        pixelSize: pointSize,
        color: css(color, item.quality?.freshnessClass === 'MODELLED' ? 0.58 : 0.92),
        outlineColor: selected ? Cesium.Color.WHITE : css(color, 0.9),
        outlineWidth: selected ? 3 : 1,
        heightReference: altitude == null ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(1000, 1.25, 20000000, 0.72),
      });
      const labelGraphic = (selected || isCamera) ? new Cesium.LabelGraphics({
        text: label,
        font: selected ? '700 12px sans-serif' : '600 10px sans-serif',
        heightReference: altitude == null ? Cesium.HeightReference.CLAMP_TO_GROUND : Cesium.HeightReference.NONE,
        fillColor: css(color, 0.98),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, maxLabelDistance),
        scaleByDistance: new Cesium.NearFarScalar(1000, selected ? 1.1 : 1, maxLabelDistance, 0.7),
        translucencyByDistance: new Cesium.NearFarScalar(Math.min(35000, maxLabelDistance * 0.08), 1, maxLabelDistance, 0),
        showBackground: true,
        backgroundColor: css('#05070d', 0.82),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
      }) : undefined;
      const visuals: Cesium.Entity.ConstructorOptions = {
        id,
        position: new Cesium.ConstantPositionProperty(position),
        point,
        label: labelGraphic,
        billboard: isCamera ? {
          image: cameraSvg(color, selected),
          width: selected ? 42 : 34,
          height: selected ? 42 : 34,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          scaleByDistance: new Cesium.NearFarScalar(250, selected ? 1.15 : 1, 750000, 0.68),
        } : undefined,
        properties: new Cesium.PropertyBag({
          entityId: item.id, layer, entityType: item.entityType, source: item.source ?? 'unknown',
          freshness: item.quality?.freshnessClass ?? 'UNKNOWN', observedAt: item.observedAt ?? null,
          sourceReference: item.sourceReference ?? null, altitudeM: altitude, caption: externalCaption(item),
          telemetryLive: item.telemetryLive ?? null, imagingClaim: item.imagingClaim ?? null, taskingClaim: item.taskingClaim ?? null,
        }),
      };
      if (altitude != null && altitude > 5000 && (type === 'satellite' || type === 'aircraft')) {
        visuals.polyline = { positions: [ground, position], width: selected ? 2.5 : 1, material: css(color, selected ? 0.42 : 0.2) };
      }
      if (type === 'natural_hazard' || type === 'risk_zone') {
        const radiusKm = Number(item.attributes?.radius_km ?? item.attributes?.radiusKm);
        if (Number.isFinite(radiusKm) && radiusKm > 0) {
          visuals.ellipse = { semiMajorAxis: Math.max(100, radiusKm * 1000), semiMinorAxis: Math.max(100, radiusKm * 1000), height: 4, heightReference: Cesium.HeightReference.CLAMP_TO_GROUND, material: css(color, 0.05), outline: true, outlineColor: css(color, 0.38) };
        }
      }
      if (existing) {
        existing.position = visuals.position;
        existing.point = point;
        existing.label = labelGraphic;
        existing.billboard = visuals.billboard;
        existing.properties = visuals.properties;
        existing.polyline = visuals.polyline;
        existing.ellipse = visuals.ellipse;
      } else {
        const entity = viewer.entities.add(visuals);
        externalEntityMapRef.current.set(item.id, entity);
      }
    }
    viewer.scene.requestRender();
  }, [worldEntities, selectedExternalId]);

  if (initFailed) {
    return (
      <div className={`${fill ? 'h-full' : 'h-[520px]'} grid place-items-center bg-[#080b12] text-center`}>
        <div className="max-w-sm px-6">
          <TriangleAlert className="mx-auto mb-3 text-amber-400" size={26} />
          <p className="text-sm font-semibold text-white">3D world renderer could not create a WebGL context</p>
          <p className="mt-1 text-xs text-neutral-500">Sonalit will not substitute a degraded surface for this failure. Reinitialize the renderer after GPU/WebGL availability is restored.</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-lg border border-cyan-400/20 bg-cyan-400/[0.07] px-3 py-2 text-[10px] font-bold font-mono tracking-[0.12em] text-cyan-200 hover:bg-cyan-400/[0.12]">REINITIALIZE 3D</button>
        </div>
      </div>
    );
  }

  return (
    <div data-spatial-surface="cesium-world" className={`spatial-surface ${fill ? 'h-full' : 'h-[520px]'} relative overflow-hidden bg-[#080b12]`}>
      <div ref={boxRef} className="absolute inset-0" />
      {showMapControls && (
      <div className={`gev-map-controls pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3 ${globalView ? 'gev-map-controls--global' : ''}`}>
        <div className="spatial-control-rail pointer-events-auto flex items-center gap-1 rounded-xl border border-white/10 bg-[#070a10]/86 p-1 backdrop-blur-xl">
          <button type="button" disabled={surfaceQuality === 'photorealistic'} onClick={() => setMode('dark')} className={`grid h-11 w-11 place-items-center rounded-xl ${mode === 'dark' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-white'} disabled:cursor-not-allowed disabled:opacity-40`} aria-label="Dark map" aria-pressed={mode === 'dark'} title={surfaceQuality === 'photorealistic' ? 'Photorealistic 3D surface is active' : 'Dark base imagery'}><MapIcon size={19} strokeWidth={2.7} /></button>
          <button type="button" disabled={surfaceQuality === 'photorealistic'} onClick={() => setMode('satellite')} className={`grid h-11 w-11 place-items-center rounded-xl ${mode === 'satellite' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-white'} disabled:cursor-not-allowed disabled:opacity-40`} aria-label="Satellite map" aria-pressed={mode === 'satellite'} title={surfaceQuality === 'photorealistic' ? 'Photorealistic 3D surface is active' : 'Satellite base imagery'}><Satellite size={19} strokeWidth={2.7} /></button>
          <button type="button" disabled={surfaceQuality === 'photorealistic'} onClick={() => setMode('hybrid')} className={`grid h-11 w-11 place-items-center rounded-xl ${mode === 'hybrid' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-white'} disabled:cursor-not-allowed disabled:opacity-40`} aria-label="Hybrid map" aria-pressed={mode === 'hybrid'} title={surfaceQuality === 'photorealistic' ? 'Photorealistic 3D surface is active' : 'Hybrid base imagery'}><Layers size={19} strokeWidth={2.7} /></button>
          <span className="ml-1 max-w-[280px] truncate border-l border-white/10 pl-2 pr-2 text-[10px] font-bold font-mono text-neutral-400">{mapStatus}</span>
        </div>
        <div className="pointer-events-auto grid grid-cols-3 gap-1 rounded-2xl border border-white/15 bg-[#070a10]/94 p-1.5 shadow-2xl backdrop-blur-2xl" role="group" aria-label="3D world navigation">
          <button type="button" onClick={() => zoomCamera('in')} className="gev-nav-button" aria-label="Zoom in" title="Zoom in"><ZoomIn size={19} strokeWidth={2.7} /></button>
          <button type="button" onClick={() => zoomCamera('out')} className="gev-nav-button" aria-label="Zoom out" title="Zoom out"><ZoomOut size={19} strokeWidth={2.7} /></button>
          <button type="button" onClick={recenter} className="gev-nav-button" aria-label="Recenter world" title="Recenter view"><Crosshair size={19} strokeWidth={2.7} /></button>
          <button type="button" onClick={() => rotateCamera('left')} className="gev-nav-button" aria-label="Orbit left" title="Orbit left"><RotateCcw size={19} strokeWidth={2.7} /></button>
          <button type="button" onClick={() => rotateCamera('right')} className="gev-nav-button" aria-label="Orbit right" title="Orbit right"><RotateCw size={19} strokeWidth={2.7} /></button>
          <button type="button" onClick={() => rotateCamera('up')} className="gev-nav-button" aria-label="Tilt camera up" title="Tilt camera up"><ArrowUp size={19} strokeWidth={2.7} /></button>
          <button type="button" onClick={() => rotateCamera('down')} className="gev-nav-button" aria-label="Tilt camera down" title="Tilt camera down"><ArrowDown size={19} strokeWidth={2.7} /></button>
          <button type="button" onClick={() => panCamera('left')} className="gev-nav-button" aria-label="Pan left" title="Pan left"><MoveLeft size={19} strokeWidth={2.7} /></button>
          <button type="button" onClick={() => panCamera('up')} className="gev-nav-button" aria-label="Pan up" title="Pan up"><MoveUp size={19} strokeWidth={2.7} /></button>
          <button type="button" onClick={() => panCamera('right')} className="gev-nav-button" aria-label="Pan right" title="Pan right"><MoveRight size={19} strokeWidth={2.7} /></button>
          <button type="button" onClick={() => { const viewer = viewerRef.current; if (!viewer || viewer.isDestroyed()) return; const cameraEntities = globalView ? globalCameraEntities(worldEntities) : worldEntities; const points = fitPoints(route, liveMembers, trail, zones, cameraEntities); if (points.length === 1) { const only = singleWorldPoint(liveMembers, zones, worldEntities); if (only) viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(only.lng, only.lat, Math.max(2200, only.altitudeM + 2200)), duration: 0.8 }); } else if (points.length >= 2) viewer.camera.flyToBoundingSphere(Cesium.BoundingSphere.fromPoints(points), { duration: 0.8, offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-52), Math.max(1800, corridorKm * 900)) }); }} className="gev-nav-button" aria-label={globalView ? 'Fit world' : 'Fit corridor'} title={globalView ? 'Fit world' : 'Fit corridor'}><Target size={19} strokeWidth={2.7} /></button>
          <button type="button" onClick={() => panCamera('down')} className="gev-nav-button" aria-label="Pan down" title="Pan down"><MoveDown size={19} strokeWidth={2.7} /></button>
          <button type="button" onClick={() => setCreditsOpen(v => !v)} className="gev-nav-button" aria-label="Map information" aria-expanded={creditsOpen} title="Map information"><Signal size={19} strokeWidth={2.7} /></button>
        </div>
      </div>
      )}
      <div className="pointer-events-none absolute top-[154px] right-3 hidden sm:block">
        <span className="rounded-lg border border-white/10 bg-[#070a10]/88 px-3 py-2 text-xs font-extrabold tracking-wide text-neutral-100 shadow-xl backdrop-blur-xl">LEFT-DRAG TO ORBIT · RIGHT-DRAG / WHEEL TO ZOOM · MIDDLE-DRAG TILTS · USE ARROWS TO PAN · PINCH TO ZOOM</span>
      </div>
      <div className="spatial-cesium-chrome pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-2">
        <span className="rounded-lg border border-white/10 bg-[#070a10]/84 px-2.5 py-1.5 text-[10px] font-bold font-mono text-neutral-300 backdrop-blur-xl">{liveMembers.length} DEVICE{liveMembers.length === 1 ? '' : 'S'} VISIBLE</span>
        <span className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-bold font-mono backdrop-blur-xl ${surfaceQuality === 'photorealistic' ? 'border-cyan-400/25 bg-cyan-400/[0.09] text-cyan-200' : terrainReady ? 'border-emerald-500/20 bg-emerald-500/[0.08] text-emerald-300' : surfaceQuality === 'loading' ? 'border-amber-400/20 bg-amber-400/[0.07] text-amber-200' : 'border-red-400/20 bg-red-400/[0.07] text-red-200'}`}>{surfaceQuality === 'photorealistic' ? 'PHOTOREALISTIC 3D' : terrainReady ? 'WORLD TERRAIN + 3D BUILDINGS' : surfaceQuality === 'loading' ? '3D SURFACE LOADING' : 'ESRI RASTER FALLBACK'}</span>
        {focusId && <span className="rounded-lg border border-violet-500/25 bg-violet-500/[0.09] px-2.5 py-1.5 text-[10px] font-bold font-mono text-violet-300 backdrop-blur-xl">FOCUS · {liveMembers.find(m => m.id === focusId)?.name ?? focusId.slice(0, 8)}</span>}
      </div>
      {creditsOpen && (
        <div className="spatial-cesium-chrome absolute bottom-3 right-3 max-w-xs rounded-xl border border-white/10 bg-[#070a10]/92 p-3 text-[10px] leading-relaxed text-neutral-400 shadow-2xl backdrop-blur-xl">
          <p className="font-semibold text-neutral-200">World surface</p>
          <p className="mt-1">{surfaceQuality === 'photorealistic' ? 'Photorealistic 3D surface: Google Maps Platform Photorealistic 3D Tiles rendered by CesiumJS. Google and third-party attributions remain on screen.' : terrainReady ? 'Aerial imagery and terrain are streamed through Cesium ion, with Cesium World Terrain normals/water data and OSM 3D buildings where available.' : 'Operational map surface is using the Esri fallback. No high-fidelity provider is claimed until it successfully loads.'}</p>
        </div>
      )}
      {!globalView && liveMembers.length === 0 && (
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
