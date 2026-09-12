import { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Globe2, Layers, Compass } from 'lucide-react';

export interface LatLng { lat: number; lng: number }
export interface GlobeMember {
  id: string; name: string; officer_name?: string | null;
  lat: number | null; lng: number | null; status: string;
  along_km?: number | null; cross_track_km?: number | null;
}
export interface RiskZone {
  zone_id: string | null; name: string | null; risk_level: string;
  lat: number; lng: number; radius_km: number;
}

// Imagery that needs no key — the same sources the live GPS globe uses.
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ROADS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
const DARK_URL = 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';

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

const KM_PER_DEG_LAT = 111.32;

/**
 * The corridor as a closed ring on the ground: the centre-line offset by
 * `km` to either side. Cesium extrudes this ring into the actual 3D volume,
 * so this is the footprint of the geofence rather than a drawn outline.
 */
function corridorRing(route: LatLng[], km: number): number[] {
  const left: number[][] = [];
  const right: number[][] = [];

  for (let i = 0; i < route.length; i++) {
    const prev = route[Math.max(0, i - 1)]!;
    const next = route[Math.min(route.length - 1, i + 1)]!;
    const here = route[i]!;
    const cos = Math.max(0.05, Math.cos((here.lat * Math.PI) / 180));

    const dx = (next.lng - prev.lng) * KM_PER_DEG_LAT * cos;
    const dy = (next.lat - prev.lat) * KM_PER_DEG_LAT;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;

    const dLng = (nx * km) / (KM_PER_DEG_LAT * cos);
    const dLat = (ny * km) / KM_PER_DEG_LAT;
    left.push([here.lng + dLng, here.lat + dLat]);
    right.push([here.lng - dLng, here.lat - dLat]);
  }

  return [...left, ...right.reverse()].flat();
}

function css(hex: string, alpha = 1): Cesium.Color {
  return Cesium.Color.fromCssColorString(hex).withAlpha(alpha);
}

/** Initial bearing from a to b, degrees clockwise from north. */
function bearingDeg(a: LatLng, b: LatLng): number {
  const φ1 = (a.lat * Math.PI) / 180, φ2 = (b.lat * Math.PI) / 180;
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

// Labels only earn their clutter up close. Zone names in particular pile on
// top of the trucks when the whole route is in frame.
function nearOnly(maxM: number): Cesium.DistanceDisplayCondition {
  return new Cesium.DistanceDisplayCondition(0, maxM);
}

/**
 * A 4D geofence rendered as what it actually is: a walled volume swept along
 * the planned road, with the trucks inside or outside it, over satellite imagery.
 * A flat line on a flat map cannot show "outside the fence" — a wall can.
 */
export default function CorridorGlobe({
  route, corridorKm, members, zones, ceilingM = 0, focusId = null, trail, onSelect, fill = false,
}: {
  route: LatLng[]; corridorKm: number; members: GlobeMember[];
  zones?: RiskZone[] | undefined; ceilingM?: number | undefined;
  /** Fly down to this device — the only altitude where corridor walls read. */
  focusId?: string | null | undefined;
  /** Where the focused truck has actually been, drawn against the corridor. */
  trail?: LatLng[] | undefined;
  /** Clicking a truck on the globe selects it, same as clicking its card. */
  onSelect?: ((id: string | null) => void) | undefined;
  /** Fill the parent instead of a fixed height — for the full-page layout. */
  fill?: boolean | undefined;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const corridorRef = useRef<Cesium.Entity[]>([]);
  const memberRef = useRef<Cesium.Entity[]>([]);
  const zoneRef = useRef<Cesium.Entity[]>([]);
  const memberById = useRef<Map<string, Cesium.Entity>>(new Map());
  const trailRef = useRef<Cesium.Entity | null>(null);
  const selectHandler = useRef<((id: string | null) => void) | undefined>(onSelect);
  selectHandler.current = onSelect;
  const framedRef = useRef('');
  const [satellite, setSatellite] = useState(true);
  const [failed, setFailed] = useState(false);

  // Wall height. Scaled off the corridor width so a wide corridor doesn't read
  // as a thin ribbon and a narrow one isn't a skyscraper, with a floor so a
  // 0.5 km corridor is still visible from a route-wide camera.
  const wallM = ceilingM > 0 ? ceilingM : Math.max(1500, corridorKm * 1200);

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
    } catch {
      setFailed(true);
      return;
    }
    viewerRef.current = viewer;
    viewer.scene.globe.depthTestAgainstTerrain = true;
    viewer.scene.globe.baseColor = css('#0b0f19');
    viewer.cesiumWidget.creditContainer.setAttribute('style', 'display:none');

    // Clicking a truck selects it. Entity ids are set to the device id below,
    // so a pick maps straight back to a roster row.
    const clicks = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    clicks.setInputAction((movement: { position: Cesium.Cartesian2 }) => {
      const picked = viewer.scene.pick(movement.position);
      const id = picked && picked.id && typeof picked.id.id === 'string' ? picked.id.id : null;
      // Only device entities carry a dev: prefix; corridor and zone picks
      // should clear the selection rather than select something meaningless.
      selectHandler.current?.(id && id.startsWith('dev:') ? id.slice(4) : null);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      clicks.destroy();
      corridorRef.current = []; memberRef.current = []; zoneRef.current = [];
      framedRef.current = '';
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
  }, []);

  // Imagery — swapped rather than rebuilt, so toggling never drops the entities.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    const layers = viewer.imageryLayers;
    layers.removeAll();
    if (satellite) {
      layers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({ url: SAT_URL, maximumLevel: 18 }));
      layers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({ url: ROADS_URL, maximumLevel: 18 }));
    } else {
      layers.addImageryProvider(new Cesium.UrlTemplateImageryProvider({ url: DARK_URL, maximumLevel: 19 }));
    }
  }, [satellite]);

  // No world-terrain toggle here on purpose: Cesium World Terrain is fetched
  // from api.cesium.com, which this app's CSP does not allow (and which would
  // also mean leaning on Cesium's shared demo Ion token). A button that
  // silently does nothing is worse than no button. Adding it back means an
  // owned Ion token plus a connect-src entry.

  // ── The geofence volume ────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    corridorRef.current.forEach(e => viewer.entities.remove(e));
    corridorRef.current = [];
    if (route.length < 2) return;

    const ring = corridorRing(route, corridorKm);
    const volume = viewer.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArray(ring)),
        extrudedHeight: wallM,
        height: 0,
        material: css('#8b5cf6', 0.16),
        outline: true,
        outlineColor: css('#a78bfa', 0.55),
        // Walls have to be visible from inside the corridor too, which is
        // exactly where the follow camera sits.
        closeTop: false,
        closeBottom: false,
      },
    });

    const centre = viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(route.flatMap(p => [p.lng, p.lat])),
        width: 4,
        clampToGround: true,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.25, color: css('#a78bfa'),
        }),
      },
    });

    const first = route[0]!, last = route[route.length - 1]!;
    const pin = (p: LatLng, color: string, label: string) => viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(p.lng, p.lat, 0),
      point: { pixelSize: 12, color: css(color), outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND },
      label: {
        text: label, font: '600 13px sans-serif', fillColor: Cesium.Color.WHITE,
        outlineColor: css('#000000'), outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -22),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: nearOnly(3_000_000),
      },
    });

    corridorRef.current = [volume, centre, pin(first, '#10b981', 'ORIGIN'), pin(last, '#f43f5e', 'DESTINATION')];

    const key = `${route.length}:${first.lat},${first.lng}:${last.lat},${last.lng}:${corridorKm}`;
    if (framedRef.current !== key) {
      framedRef.current = key;
      // Frame along the route's own bearing rather than due north: an
      // 800 km leg viewed side-on is a hairline, viewed down its length it
      // reads as a corridor running into the distance.
      const heading = Cesium.Math.toRadians(bearingDeg(first, last));
      viewer.flyTo(volume, {
        duration: 1.8,
        offset: new Cesium.HeadingPitchRange(heading, Cesium.Math.toRadians(-38), 0),
      }).catch(() => { /* superseded by another flight */ });
    }
  }, [route, corridorKm, wallM]);

  // ── Risk zones ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    zoneRef.current.forEach(e => viewer.entities.remove(e));
    zoneRef.current = (zones ?? []).map(z => {
      const color = RISK_COLOR[z.risk_level] ?? RISK_COLOR['medium']!;
      return viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(z.lng, z.lat, wallM / 2),
        cylinder: {
          length: wallM,
          topRadius: z.radius_km * 1000,
          bottomRadius: z.radius_km * 1000,
          material: css(color, 0.14),
          outline: true,
          outlineColor: css(color, 0.5),
        },
        label: {
          text: `${z.name ?? 'Risk zone'} · ${z.risk_level.replace('_', '-')}`,
          font: '600 12px sans-serif', fillColor: css(color),
          outlineColor: css('#000000'), outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          distanceDisplayCondition: nearOnly(600_000),
        },
      });
    });
  }, [zones, wallM]);

  // ── Trucks ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    memberRef.current.forEach(e => viewer.entities.remove(e));

    // Floated to the wall top with a line back to the road, so a truck is
    // readable from an oblique camera instead of being buried in terrain.
    const FLOAT = Math.max(600, wallM * 0.55);
    memberById.current.clear();
    memberRef.current = (members ?? [])
      .filter((m): m is GlobeMember & { lat: number; lng: number } => m.lat != null && m.lng != null)
      .map(m => {
        const color = STATUS_COLOR[m.status] ?? STATUS_COLOR['off_route']!;
        const ent = viewer.entities.add({
          id: `dev:${m.id}`,
          position: Cesium.Cartesian3.fromDegrees(m.lng, m.lat, FLOAT),
          point: { pixelSize: 13, color: css(color), outlineColor: Cesium.Color.WHITE, outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY },
          polyline: {
            positions: Cesium.Cartesian3.fromDegreesArrayHeights([m.lng, m.lat, 0, m.lng, m.lat, FLOAT]),
            width: 1.5, material: css(color, 0.6),
          },
          label: {
            text: m.officer_name ? `${m.officer_name} · ${m.name}` : m.name,
            font: '600 12px sans-serif', fillColor: Cesium.Color.WHITE,
            outlineColor: css('#000000'), outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -20),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: nearOnly(1_500_000),
          },
        });
        memberById.current.set(m.id, ent);
        return ent;
      });
  }, [members, wallM]);

  // Where the focused truck has actually been — the recorded track laid against
  // the planned corridor, so a detour is visible as a shape, not a number.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;
    if (trailRef.current) { viewer.entities.remove(trailRef.current); trailRef.current = null; }
    if (!trail || trail.length < 2) return;
    trailRef.current = viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(trail.flatMap(p => [p.lng, p.lat])),
        width: 3, clampToGround: true,
        material: new Cesium.PolylineDashMaterialProperty({ color: css('#fbbf24', 0.9) }),
      },
    });
  }, [trail]);

  // Focus: drop the camera beside a truck, low and tilted, which is the only
  // altitude where the corridor walls are legible as walls.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed() || !focusId) return;
    const ent = memberById.current.get(focusId);
    if (!ent) return;
    // Pull back far enough to hold the corridor edge in frame as well as the
    // truck: framing an off-route truck alone hides the very thing that makes
    // it off-route.
    const offKm = Math.abs(members.find(m => m.id === focusId)?.cross_track_km ?? 0);
    const range = Math.max(9000, (offKm + corridorKm) * 1000 * 2.6);
    viewer.flyTo(ent, {
      duration: 1.5,
      offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-32), range),
    }).catch(() => { /* superseded */ });
  }, [focusId, members, wallM, corridorKm]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-black/40 p-6 text-center text-sm text-neutral-500 ${
        fill ? 'h-full w-full' : 'h-[380px] rounded-xl border border-white/10'}`}>
        This device can&apos;t render the 3D globe (WebGL unavailable).
      </div>
    );
  }

  return (
    <div className={fill
      ? 'relative h-full w-full overflow-hidden'
      : 'relative overflow-hidden rounded-xl border border-white/10'}>
      <div ref={boxRef} className={fill ? 'h-full w-full' : 'h-[380px] w-full sm:h-[520px]'} />

      <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-black/70 px-2.5 py-1.5 text-[10px] font-medium backdrop-blur">
        <span className="flex items-center gap-1.5 text-violet-300">
          <span className="h-2.5 w-2.5 rounded-sm border border-violet-400 bg-violet-500/30" /> corridor ±{corridorKm} km
        </span>
        {(['on_track', 'behind', 'ahead', 'off_route'] as const).map(k => (
          <span key={k} className="hidden items-center gap-1.5 text-neutral-300 sm:flex">
            <span className="h-2 w-2 rounded-full" style={{ background: STATUS_COLOR[k] }} />
            {k.replace('_', ' ')}
          </span>
        ))}
      </div>

      <div className="absolute right-3 top-3 flex flex-col gap-1.5">
        <GlobeBtn active={satellite} onClick={() => setSatellite(s => !s)}
          title={satellite ? 'Satellite imagery' : 'Dark basemap'} Icon={satellite ? Globe2 : Layers} />
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-1.5 rounded-lg bg-black/70 px-2.5 py-1.5 text-[10px] text-neutral-400 backdrop-blur">
        <Compass size={11} /> drag to orbit · scroll to zoom · right-drag to tilt
      </div>
    </div>
  );
}

function GlobeBtn({ active, onClick, title, Icon }: {
  active: boolean; onClick: () => void; title: string; Icon: typeof Globe2;
}) {
  return (
    <button onClick={onClick} title={title} aria-label={title} aria-pressed={active}
      className={`grid h-8 w-8 place-items-center rounded-lg border backdrop-blur transition-colors ${
        active ? 'border-violet-500/50 bg-violet-500/20 text-violet-200'
               : 'border-white/10 bg-black/60 text-neutral-400 hover:text-white'}`}>
      <Icon size={14} />
    </button>
  );
}
