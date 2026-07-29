import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface LatLng { lat: number; lng: number }
export interface MapMember {
  id: string; name: string; officer_name?: string | null;
  lat: number | null; lng: number | null; status: string;
}

// A 4D geofence page with no geography on it is just a table. This draws the
// thing the numbers describe: the corridor band, the centre-line, and where
// every truck actually sits inside (or outside) it.
const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

// If the basemap CDN is unreachable (offline, CSP, outage) maplibre never fires
// `load`, so the corridor layers were never added and the operator got a blank
// rectangle. Falling back to this bare style keeps the geometry — the part that
// actually matters — on screen without any external request.
const FALLBACK_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {},
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#0b0f19' } }],
};

const DOT: Record<string, string> = {
  off_route: '#ef4444',
  behind: '#f59e0b',
  ahead: '#22d3ee',
  on_track: '#10b981',
  no_fix: '#525252',
};

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const KM_PER_DEG_LAT = 111.32;

/**
 * Offset the centre-line by `km` on both sides and close the two offsets into a
 * single ring — a cheap flat-earth buffer. Over convoy distances the error is
 * far below the width of the band being drawn, and it avoids pulling in a
 * geometry library for what is a visual aid.
 */
function corridorBand(route: LatLng[], km: number): GeoJSON.Feature<GeoJSON.Polygon> | null {
  if (route.length < 2 || !(km > 0)) return null;
  const left: [number, number][] = [];
  const right: [number, number][] = [];

  for (let i = 0; i < route.length; i++) {
    const prev = route[Math.max(0, i - 1)]!;
    const next = route[Math.min(route.length - 1, i + 1)]!;
    const here = route[i]!;
    const cos = Math.max(0.05, Math.cos((here.lat * Math.PI) / 180));

    // Segment direction in km-space, so the normal is a true perpendicular
    // rather than one skewed by the longitude convergence.
    const dx = (next.lng - prev.lng) * KM_PER_DEG_LAT * cos;
    const dy = (next.lat - prev.lat) * KM_PER_DEG_LAT;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;

    const dLng = (nx * km) / (KM_PER_DEG_LAT * cos);
    const dLat = (ny * km) / KM_PER_DEG_LAT;
    left.push([here.lng + dLng, here.lat + dLat]);
    right.push([here.lng - dLng, here.lat - dLat]);
  }

  const ring = [...left, ...right.reverse()];
  ring.push(ring[0]!);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

function lineOf(route: LatLng[]): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: route.map(p => [p.lng, p.lat]) },
  };
}

function memberPoints(members: MapMember[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: members
      .filter((m): m is MapMember & { lat: number; lng: number } => m.lat != null && m.lng != null)
      .map(m => ({
        type: 'Feature' as const,
        properties: {
          color: DOT[m.status] ?? DOT['off_route'],
          label: m.officer_name ? `${m.officer_name} · ${m.name}` : m.name,
        },
        geometry: { type: 'Point' as const, coordinates: [m.lng, m.lat] },
      })),
  };
}

function boundsOf(pts: LatLng[]): maplibregl.LngLatBoundsLike {
  const lngs = pts.map(p => p.lng), lats = pts.map(p => p.lat);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

function src(map: maplibregl.Map, id: string) {
  return map.getSource(id) as maplibregl.GeoJSONSource | undefined;
}

/**
 * Sources + layers for the corridor. Re-runnable: setStyle() wipes them, so the
 * basemap fallback has to be able to put them straight back.
 */
function installLayers(map: maplibregl.Map) {
  if (map.getSource('band')) return;

  map.addSource('band', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'band-fill', type: 'fill', source: 'band',
    paint: { 'fill-color': '#8b5cf6', 'fill-opacity': 0.13 },
  });
  map.addLayer({
    id: 'band-edge', type: 'line', source: 'band',
    paint: { 'line-color': '#8b5cf6', 'line-width': 1, 'line-opacity': 0.45, 'line-dasharray': [3, 3] },
  });

  map.addSource('centre', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'centre-line', type: 'line', source: 'centre',
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: { 'line-color': '#a78bfa', 'line-width': 3, 'line-opacity': 0.9 },
  });

  map.addSource('members', { type: 'geojson', data: EMPTY });
  map.addLayer({
    id: 'member-halo', type: 'circle', source: 'members',
    paint: { 'circle-radius': 12, 'circle-color': ['get', 'color'], 'circle-opacity': 0.22 },
  });
  map.addLayer({
    id: 'member-dot', type: 'circle', source: 'members',
    paint: {
      'circle-radius': 6, 'circle-color': ['get', 'color'],
      'circle-stroke-width': 2, 'circle-stroke-color': '#0a0a0a',
    },
  });

  // Labels need a glyph endpoint; the offline fallback style has none, so the
  // dots stay and only the text is dropped.
  if (map.getStyle().glyphs) {
    map.addLayer({
      id: 'member-label', type: 'symbol', source: 'members',
      layout: {
        'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.4],
        'text-anchor': 'top', 'text-allow-overlap': false,
      },
      paint: { 'text-color': '#e5e5e5', 'text-halo-color': '#0a0a0a', 'text-halo-width': 1.5 },
    });
  }
}

export default function CorridorMap({ route, corridorKm, members }: {
  route: LatLng[]; corridorKm: number; members: MapMember[];
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  const endMarkers = useRef<maplibregl.Marker[]>([]);
  // Refit only when the corridor itself changes, so a 15s member refresh never
  // yanks the camera away from wherever the operator panned to.
  const fittedRef = useRef('');
  // Latest props, so a re-style can redraw without waiting for a prop change.
  const drawRef = useRef<() => void>(() => {});
  const [basemapDown, setBasemapDown] = useState(false);

  useEffect(() => {
    if (!boxRef.current) return;
    const map = new maplibregl.Map({
      container: boxRef.current,
      style: MAP_STYLE,
      center: [36, -1],
      zoom: 5,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    mapRef.current = map;

    const activate = () => {
      installLayers(map);
      readyRef.current = true;
      drawRef.current();
      map.resize();
    };

    map.on('load', activate);

    // A failed style request never reaches 'load'. Swap in the offline style
    // once, then bring the corridor layers back on top of it.
    let fellBack = false;
    const fallback = () => {
      if (fellBack || readyRef.current) return;
      fellBack = true;
      setBasemapDown(true);
      map.once('styledata', activate);
      map.setStyle(FALLBACK_STYLE);
    };
    map.on('error', fallback);
    // Some failures (DNS black-hole, silent proxy drop) never surface as an
    // 'error' event, so a blank map must not be allowed to persist.
    const guard = setTimeout(fallback, 3500);

    return () => {
      clearTimeout(guard);
      endMarkers.current.forEach(m => m.remove());
      endMarkers.current = [];
      readyRef.current = false;
      fittedRef.current = '';
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // One draw pass for everything, kept on a ref so the basemap fallback can
  // replay it after setStyle() clears the layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const draw = () => {
      if (!readyRef.current || !mapRef.current) return;

      src(map, 'band')?.setData(corridorBand(route, corridorKm) ?? EMPTY);
      src(map, 'centre')?.setData(route.length >= 2 ? lineOf(route) : EMPTY);
      src(map, 'members')?.setData(memberPoints(members));

      const first = route[0], last = route[route.length - 1];
      if (route.length < 2 || !first || !last) return;

      // Endpoint pins and the camera only move when the corridor itself does —
      // the 15s member refresh must not tear down markers or re-fit the view.
      const key = `${route.length}:${first.lat},${first.lng}:${last.lat},${last.lng}`;
      if (fittedRef.current === key && endMarkers.current.length) return;
      fittedRef.current = key;

      endMarkers.current.forEach(m => m.remove());
      endMarkers.current = [
        new maplibregl.Marker({ element: pin('#10b981') }).setLngLat([first.lng, first.lat])
          .setPopup(new maplibregl.Popup({ offset: 12, closeButton: false }).setText('Origin')).addTo(map),
        new maplibregl.Marker({ element: pin('#f43f5e') }).setLngLat([last.lng, last.lat])
          .setPopup(new maplibregl.Popup({ offset: 12, closeButton: false }).setText('Destination')).addTo(map),
      ];
      map.fitBounds(boundsOf(route), { padding: 48, duration: 600, maxZoom: 12 });
    };

    drawRef.current = draw;
    draw();
  }, [route, corridorKm, members]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/10">
      <div ref={boxRef} className="h-[340px] w-full sm:h-[420px]" />
      {/* right-14 keeps the legend clear of the zoom control when it wraps. */}
      <div className="pointer-events-none absolute left-3 right-14 top-3 flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-black/70 px-2.5 py-1.5 text-[10px] font-medium backdrop-blur sm:right-auto">
        <span className="flex items-center gap-1.5 text-violet-300">
          <span className="h-0.5 w-4 rounded bg-violet-400" /> corridor ±{corridorKm} km
        </span>
        {[['on_track', 'on track'], ['behind', 'behind'], ['ahead', 'ahead'], ['off_route', 'off route']].map(([k, l]) => (
          <span key={k} className="flex items-center gap-1.5 text-neutral-300">
            <span className="h-2 w-2 rounded-full" style={{ background: DOT[k as string] }} /> {l}
          </span>
        ))}
      </div>
      {basemapDown && (
        <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-amber-500/25 bg-black/80 px-2.5 py-1.5 text-[10px] text-amber-300 backdrop-blur">
          Basemap unavailable — showing corridor geometry only
        </div>
      )}
    </div>
  );
}

function pin(color: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `width:13px;height:13px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 0 8px ${color}aa`;
  return el;
}
