---
name: frontend-design/map-ux
description: Geospatial UI patterns — MapLibre 2D maps, CesiumJS 3D globes, marker design, layer management, style switching, geofence rendering, and fleet tracking map UX.
triggers:
  - map
  - maplibre
  - cesium
  - globe
  - geofence
  - corridor
  - marker
  - satellite
  - GPS
  - tracking
  - geospatial
  - deck.gl
  - GeoJSON
  - tile
  - 3D
related_skills:
  - frontend-design
  - frontend-design/dark-theme-mastery
  - frontend-design/data-dense-design
  - frontend-patterns
---

# Map UX

## Purpose

Teaches the geospatial UI patterns used across Sonalit's tracking, surveillance, and risk-intelligence features. Covers the two rendering engines (MapLibre for 2D, CesiumJS for 3D), marker design language, layer management, geofence visualisation, and the conventions that keep 7+ map components visually consistent. Inspired by Mapbox Studio, Google Earth, and military C2 map UIs.

## When to Activate

When building or modifying map views, adding markers, rendering geofences/corridors, choosing between 2D and 3D, designing map controls, or integrating real-time vehicle/device tracking on a map.

## Two Rendering Engines

| Engine | Library | Use Case | Files |
|--------|---------|----------|-------|
| 2D | MapLibre GL JS | Fleet tracking, risk zones, geofences, traffic layers | `FleetMap.tsx`, `TacticalMap.tsx`, `PortalMap.tsx`, `RiskMap.tsx` |
| 3D | CesiumJS | Live globe, trail replay, 4D corridor geofences, login globe | `CesiumLiveMap.tsx`, `CesiumTrailMap.tsx`, `CorridorGlobe.tsx`, `OperationsGlobe.tsx` |

**Decision rule**: Use MapLibre for flat operational maps (fleet tracking, risk analysis). Use Cesium when the feature needs a globe, 3D terrain, or time-dynamic corridors.

## Base Map Styles

### Dark Street (Default)

```typescript
const DARK_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
// or tile URL:
const MAP_URL = 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
```

CARTO Dark Matter — minimal, grey-on-black streets. Used everywhere by default because it doesn't compete with coloured markers and overlays.

### Satellite

```typescript
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
```

ArcGIS World Imagery — no API key required for web maps.

### Hybrid (Satellite + Labels)

```typescript
const REF_PLACES_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const REF_ROADS_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';
```

Satellite imagery with transparent reference overlays for place names and roads.

### Map Mode Cycling

File: `apps/web/src/components/CesiumLiveMap.tsx`

Three modes cycle on button click:

```typescript
type MapMode = 'map' | 'satellite' | 'hybrid';
const NEXT_MODE: Record<MapMode, MapMode> = { map: 'satellite', satellite: 'hybrid', hybrid: 'map' };
```

Each map component uses the same mode names and the same cycling order.

## Vehicle Markers — MapLibre

File: `apps/web/src/features/live-fleet/components/FleetMap.tsx`

Markers are HTML elements (not GeoJSON points) via `maplibregl.Marker`. This enables rich tooltips, animations, and complex DOM:

### Marker Anatomy

```
         ▲              ← heading arrow (CSS triangle, rotated to compass bearing)
     ┌───────┐
     │   •   │          ← status dot (colour-coded) or officer SVG glyph
     └───────┘
  ┌──────────────┐
  │ KBC 123  MOV │      ← registration + status label
  └──────────────┘
```

### Status Colour Map

```typescript
const STATUS_COLOR: Record<LiveStatus, string> = {
  move: '#16c784',    // green — vehicle is moving
  idle: '#f59e0b',    // amber — engine on, not moving
  stop: '#475569',    // slate — parked
  offline: '#3e4252', // dark grey — no signal
  sos: '#ef4444',     // red — panic/SOS active
};
```

### Marker Features

- **Pulse ring**: moving/idle vehicles get a pulsing border ring (`animation: lf-mping 2.2s`)
- **SOS ring**: SOS vehicles get a rapid red pulse (`animation: lf-sos-ring .65s`)
- **Heading arrow**: CSS triangle rotated to `v.heading` degrees, shown only when moving
- **Officer distinction**: Guardian field officers use a person SVG icon inside a rounded-square badge instead of a circle dot — distinct from vehicles at a glance
- **Online override**: Officers who are online glow green regardless of move/idle/stop, because reachability is what matters for dispatch
- **Label truncation**: Registration plates > 10 chars are truncated

### Custom HTML Marker Builder

```typescript
function makeEl(v: LiveVehicle): HTMLElement {
  const color = STATUS_COLOR[v.status];
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div style="...">...</div>`;
  return wrap;
}
```

Markers are built with raw DOM for performance — React rendering 500+ markers per frame would be too expensive.

## Vehicle Markers — CesiumJS

File: `apps/web/src/components/CesiumLiveMap.tsx`

Cesium uses entity-based markers (not DOM):

```typescript
function makePoint(color: Cesium.Color, size: number): Cesium.PointGraphics {
  return new Cesium.PointGraphics({
    pixelSize: size,
    color,
    outlineColor: WHITE,
    outlineWidth: 2,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  });
}
```

- **CLAMP_TO_GROUND**: markers stick to terrain, not float in space
- **disableDepthTestDistance: Infinity**: markers always render on top of terrain, never occluded by hills
- **White outline**: ensures visibility on both dark streets and satellite imagery

### Cesium Colour Palette

```typescript
const ORANGE = Cesium.Color.fromCssColorString('#ff9040');
const GREEN  = Cesium.Color.fromCssColorString('#4ade80');
const RED    = Cesium.Color.fromCssColorString('#ef4444');
const GEO_ORANGE = Cesium.Color.fromCssColorString('#f97316');
const GEO_BLUE   = Cesium.Color.fromCssColorString('#38bdf8');
```

Same conceptual palette as 2D markers, converted to Cesium's colour type.

## Geofence Rendering

### Circle Geofences (MapLibre)

File: `apps/web/src/features/live-fleet/components/FleetMap.tsx`

Client-side circle polygon generation (no server GeoJSON needed):

```typescript
function circlePolygon(lat: number, lng: number, radiusM: number): GeoRing {
  const pts = 48;
  for (let i = 0; i <= pts; i++) {
    const a = (i / pts) * 2 * Math.PI;
    const dLat = (radiusM * Math.sin(a) / 6371000) * (180 / Math.PI);
    const dLng = (radiusM * Math.cos(a) / 6371000) * (180 / Math.PI) / Math.cos(lat * Math.PI / 180);
    out.push([lng + dLng, lat + dLat]);
  }
}
```

48-point approximation. Longitude correction via `cos(lat)` ensures circles don't distort at high latitudes.

### Risk Zone Rendering (MapLibre)

GeoJSON FeatureCollection with data-driven styling:

```typescript
const riskColorExpr = ['case',
  ['==', ['get', 'risk_level'], 'high'],   '#ef4444',
  ['==', ['get', 'risk_level'], 'medium'], '#f97316',
  '#eab308',
];
```

MapLibre expressions colour-code risk zones without JavaScript per-feature.

### 4D Corridor Geofence (CesiumJS)

File: `apps/web/src/components/geofences/CorridorGlobe.tsx`

3D corridor extruded from a route centre-line:

```typescript
function corridorRing(route: LatLng[], km: number): number[] {
  // Offset centre-line left and right by `km`
  // Returns closed polygon ring for Cesium extrusion
}
```

- **Route normal calculation**: perpendicular offset at each waypoint
- **Latitude correction**: `cos(lat)` prevents corridor widening at high latitudes
- **Status colour map**: off_route (red), behind (amber), ahead (cyan), on_track (green), no_fix (grey)
- **Risk zone spheres**: translucent coloured regions at risk locations

### Corridor Member Markers

Members positioned along the corridor with bearing-aware rotation:

```typescript
function bearingDeg(a: LatLng, b: LatLng): number {
  // Returns compass bearing in degrees for billboard rotation
}
```

## Map Controls

### Coordinate Display

```typescript
m.on('mousemove', e => {
  coordsRef.current.textContent = `${lat.toFixed(4)}°N ${lng.toFixed(4)}°E`;
});
```

Lat/lng readout in the corner — monospace font, updates on mouse move.

### Map Mode Toggle Button

Consistent across all map components: single button that cycles through map/satellite/hybrid with matching icons (Map, Globe, Layers from Lucide).

### Traffic Layer Toggle

File: `apps/web/src/features/live-fleet/components/FleetMap.tsx`

Optional traffic overlay using `lib/trafficLayer.ts`:

```typescript
const [trafficOn, setTrafficOn] = useState(false);
// Fetch incidents by visible bbox
const { data: trafficFC } = useTrafficIncidents(bbox, trafficOn);
```

Traffic data is fetched only for the visible map bounds and only when enabled.

## Map Initialisation Pattern

All MapLibre maps follow this lifecycle:

```typescript
useEffect(() => {
  if (!containerRef.current || mapRef.current) return;

  const m = new maplibregl.Map({
    container: containerRef.current,
    style: DARK_STYLE,
    center: [35.5, 1.2],   // East Africa default centre
    zoom: 5,
    attributionControl: false,
    transformRequest: trafficTransformRequest,
  });

  m.on('style.load', () => setMapReady(true));

  mapRef.current = m;
  return () => { m.remove(); mapRef.current = null; setMapReady(false); };
}, []);
```

- **Guard**: skip if container missing or map already exists
- **style.load**: wait for tiles before adding sources/layers
- **Cleanup**: `m.remove()` + null ref on unmount
- **Default centre**: `[35.5, 1.2]` (East Africa — Sonalit's primary operations region)

## Relevant Files

- `apps/web/src/features/live-fleet/components/FleetMap.tsx` — MapLibre fleet tracking, markers, geofences, traffic
- `apps/web/src/components/dashboard/TacticalMap.tsx` — MapLibre tactical overview, risk zones, device circles
- `apps/web/src/components/CesiumLiveMap.tsx` — CesiumJS live GPS globe, entity markers, mode cycling
- `apps/web/src/components/CesiumTrailMap.tsx` — CesiumJS trail replay with time-dynamic paths
- `apps/web/src/components/geofences/CorridorGlobe.tsx` — CesiumJS 4D corridor geofence, risk zones, member tracking
- `apps/web/src/components/PortalMap.tsx` — MapLibre portal map (cargo owner view)
- `apps/web/src/features/risk-intel/components/RiskMap.tsx` — MapLibre risk intelligence heatmap
- `apps/web/src/features/auth/login/OperationsGlobe.tsx` — CesiumJS login page globe (decorative)
- `apps/web/src/lib/trafficLayer.ts` — traffic data integration for MapLibre

## Do

- Use MapLibre for flat 2D operational maps, CesiumJS for 3D/globe features
- Use CARTO Dark Matter as the default base style — it doesn't compete with overlays
- Build markers with raw DOM (`document.createElement`) for 100+ marker performance
- Use `CLAMP_TO_GROUND` and `disableDepthTestDistance: Infinity` on all Cesium markers
- Colour-code markers by status using the shared STATUS_COLOR map
- Generate circle polygons client-side (48 points with cos(lat) correction)
- Show coordinate readout in monospace for precision feel
- Guard map init with `if (!container || mapRef.current) return`
- Clean up maps on unmount (`map.remove()` + null refs)

## Don't

- Use React-rendered markers for large fleets — DOM markers via `document.createElement` only
- Forget `cos(lat)` correction when generating circles/corridors — shapes distort near poles
- Create a new map style without ensuring it works in all three modes (map/satellite/hybrid)
- Skip the `style.load` event — adding sources before tiles load causes silent failures
- Use bright base map styles — they clash with the dark UI and wash out coloured overlays
- Hardcode coordinates — use the East Africa default centre `[35.5, 1.2]` or fit to data bounds
- Import CesiumJS in a component that doesn't need 3D — it's a large dependency
