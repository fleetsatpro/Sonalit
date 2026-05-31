import React, { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TrailPoint { lat: number; lng: number; t: string }
export interface LatLng { lat: number; lng: number }

export interface PortalMapProps {
  currentLocation: LatLng | null;
  heading: number | null;
  trail: TrailPoint[];
  routeLine: LatLng[] | null;
  origin: string;
  destination: string;
  status: string;
  animatePosition?: boolean;
  /** Explicit origin lat/lng — used when routeLine is absent */
  originCoords?: LatLng | null;
  /** Explicit destination lat/lng — used when routeLine is absent */
  destinationCoords?: LatLng | null;
  /** Convoy departed but no GPS received yet */
  noSignal?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const EMPTY_LINE: GeoJSON.Feature<GeoJSON.LineString> = {
  type: 'Feature', properties: {},
  geometry: { type: 'LineString', coordinates: [] },
};

function toLine(pts: LatLng[]): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: pts.map(p => [p.lng, p.lat]) } };
}

function trailLine(pts: TrailPoint[]): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: 'Feature', properties: {},
    geometry: { type: 'LineString', coordinates: pts.map(p => [p.lng, p.lat]) } };
}

/** Index in route of vertex closest to loc. */
function nearestIdx(route: LatLng[], loc: LatLng): number {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < route.length; i++) {
    const pt = route[i];
    if (!pt) continue;
    const d = (pt.lat - loc.lat) ** 2 + (pt.lng - loc.lng) ** 2;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function splitRoute(route: LatLng[], loc: LatLng | null) {
  if (!loc || route.length < 2) return { traversed: [] as LatLng[], untraversed: route };
  const idx = nearestIdx(route, loc);
  return { traversed: route.slice(0, idx + 1), untraversed: route.slice(idx) };
}

function boundsOf(pts: LatLng[]): maplibregl.LngLatBoundsLike {
  const lngs = pts.map(p => p.lng), lats = pts.map(p => p.lat);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return; stylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .pvm-vehicle{width:32px;height:32px;position:relative;display:flex;align-items:center;justify-content:center}
    .pvm-vehicle::before{content:'';position:absolute;width:44px;height:44px;border-radius:50%;
      border:2px solid #f97316;opacity:0;animation:pvm-pulse 2s ease-out infinite}
    @keyframes pvm-pulse{0%{transform:scale(.6);opacity:.8}100%{transform:scale(1.5);opacity:0}}
  `;
  document.head.appendChild(s);
}

function mkVehicleEl(): HTMLDivElement {
  injectStyles();
  const el = document.createElement('div');
  el.className = 'pvm-vehicle';
  el.innerHTML = `<svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="16" cy="16" r="14" fill="#0c1a2e" stroke="#f97316" stroke-width="2"/>
    <polygon points="16,6 24,24 16,20 8,24" fill="#f97316"/>
  </svg>`;
  return el;
}

function mkCircleEl(color: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `width:14px;height:14px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 0 6px ${color}88`;
  return el;
}

function mkDiamondEl(color: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `width:14px;height:14px;background:${color};border:2px solid #fff;transform:rotate(45deg);box-shadow:0 0 6px ${color}88`;
  return el;
}

function geoSrc(map: maplibregl.Map, id: string) {
  return map.getSource(id) as maplibregl.GeoJSONSource;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function PortalMap({
  currentLocation, heading, trail, routeLine,
  origin, destination, status, animatePosition = true,
  originCoords, destinationCoords, noSignal = false,
}: PortalMapProps): React.ReactElement {
  const containerRef     = useRef<HTMLDivElement>(null);
  const mapRef           = useRef<maplibregl.Map | null>(null);
  const initialFitRef    = useRef(false);
  const vehicleMarkerRef = useRef<maplibregl.Marker | null>(null);
  const originMarkerRef  = useRef<maplibregl.Marker | null>(null);
  const destMarkerRef    = useRef<maplibregl.Marker | null>(null);

  // ── Init (once) ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [34, -1],
      zoom: 5,
      attributionControl: false,
    });
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    mapRef.current = map;

    map.on('load', () => {
      map.addSource('trail', { type: 'geojson', data: EMPTY_LINE });
      map.addLayer({ id: 'trail-line', type: 'line', source: 'trail',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#94a3b8', 'line-width': 2, 'line-opacity': 0.6 } });

      map.addSource('route', { type: 'geojson', data: EMPTY_LINE });
      map.addSource('route-traversed', { type: 'geojson', data: EMPTY_LINE });

      map.addLayer({ id: 'route-untraversed', type: 'line', source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#f97316', 'line-width': 3, 'line-opacity': 0.4, 'line-dasharray': [4, 3] } });

      map.addLayer({ id: 'route-traversed', type: 'line', source: 'route-traversed',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#f97316', 'line-width': 3, 'line-opacity': 0.9 } });
    });

    return () => {
      vehicleMarkerRef.current?.remove();
      originMarkerRef.current?.remove();
      destMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
      initialFitRef.current = false;
    };
  }, []);

  // ── Route + endpoint markers ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    originMarkerRef.current?.remove();
    destMarkerRef.current?.remove();

    if (!routeLine || routeLine.length < 2) {
      geoSrc(map, 'route').setData(EMPTY_LINE);
      geoSrc(map, 'route-traversed').setData(EMPTY_LINE);
      // Fallback: place standalone markers using explicit coords when no route line
      const oCoord = originCoords;
      const dCoord = destinationCoords;
      if (oCoord) {
        const pop = new maplibregl.Popup({ offset: 10, closeButton: false }).setText(`Origin: ${origin}`);
        originMarkerRef.current = new maplibregl.Marker({ element: mkCircleEl('#22c55e') })
          .setLngLat([oCoord.lng, oCoord.lat]).setPopup(pop).addTo(map);
      }
      if (dCoord) {
        const pop = new maplibregl.Popup({ offset: 10, closeButton: false }).setText(`Destination: ${destination}`);
        destMarkerRef.current = new maplibregl.Marker({ element: mkDiamondEl('#f97316') })
          .setLngLat([dCoord.lng, dCoord.lat]).setPopup(pop).addTo(map);
      }
      if (!initialFitRef.current && oCoord && dCoord) {
        map.fitBounds(boundsOf([oCoord, dCoord]), { padding: 60, duration: 800 });
        initialFitRef.current = true;
      }
      return;
    }

    geoSrc(map, 'route').setData(toLine(routeLine));

    const first = routeLine[0], last = routeLine[routeLine.length - 1];
    if (first) {
      const pop = new maplibregl.Popup({ offset: 10, closeButton: false }).setText(`Origin: ${origin}`);
      originMarkerRef.current = new maplibregl.Marker({ element: mkCircleEl('#22c55e') })
        .setLngLat([first.lng, first.lat]).setPopup(pop).addTo(map);
    }
    if (last) {
      const pop = new maplibregl.Popup({ offset: 10, closeButton: false }).setText(`Destination: ${destination}`);
      destMarkerRef.current = new maplibregl.Marker({ element: mkDiamondEl('#f97316') })
        .setLngLat([last.lng, last.lat]).setPopup(pop).addTo(map);
    }

    if (!initialFitRef.current) {
      const pts: LatLng[] = currentLocation ? [...routeLine, currentLocation] : routeLine;
      map.fitBounds(boundsOf(pts), { padding: 40, duration: 800 });
      initialFitRef.current = true;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLine, origin, destination, originCoords, destinationCoords]);

  // ── Vehicle marker + traversed split ────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    if (routeLine && routeLine.length >= 2) {
      const { traversed, untraversed } = splitRoute(routeLine, currentLocation);
      geoSrc(map, 'route-traversed').setData(traversed.length >= 2 ? toLine(traversed) : EMPTY_LINE);
      geoSrc(map, 'route').setData(untraversed.length >= 2 ? toLine(untraversed) : EMPTY_LINE);
    }

    if (!currentLocation) {
      vehicleMarkerRef.current?.remove();
      vehicleMarkerRef.current = null;
      return;
    }

    const lngLat: maplibregl.LngLatLike = [currentLocation.lng, currentLocation.lat];

    if (!vehicleMarkerRef.current) {
      const el = mkVehicleEl();
      el.style.transform = `rotate(${heading ?? 0}deg)`;
      vehicleMarkerRef.current = new maplibregl.Marker({ element: el, rotationAlignment: 'viewport' })
        .setLngLat(lngLat).addTo(map);
      if (!initialFitRef.current) {
        map.flyTo({ center: lngLat, zoom: 10, duration: 800 });
        initialFitRef.current = true;
      }
    } else {
      vehicleMarkerRef.current.setLngLat(lngLat);
      const el = vehicleMarkerRef.current.getElement();
      el.style.transition = animatePosition ? 'transform 0.4s ease' : 'none';
      el.style.transform = `rotate(${heading ?? 0}deg)`;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLocation, heading, animatePosition]);

  // ── Trail ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    geoSrc(map, 'trail').setData(trail.length >= 2 ? trailLine(trail) : EMPTY_LINE);
  }, [trail]);

  const showOverlay = status === 'not_started' || currentLocation === null;
  const overlayColor = noSignal ? '#f59e0b' : '#f97316';
  const overlayBorder = noSignal ? 'rgba(245,158,11,0.45)' : 'rgba(249,115,22,0.35)';
  const overlayText  = noSignal ? 'No signal since departure' : 'Awaiting first position';

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: '#060e1a' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {showOverlay && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
          background: 'rgba(6,14,26,0.88)', border: `1px solid ${overlayBorder}`,
          borderRadius: 9999, padding: '8px 18px', display: 'flex', alignItems: 'center',
          gap: 8, pointerEvents: 'none', backdropFilter: 'blur(6px)',
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', background: overlayColor,
            display: 'inline-block', animation: 'pvm-pulse 1.4s ease-in-out infinite', flexShrink: 0,
          }} />
          <span style={{ color: noSignal ? '#fde68a' : '#cbd5e1', fontSize: 13, whiteSpace: 'nowrap', fontWeight: 500 }}>
            {overlayText}
          </span>
        </div>
      )}
    </div>
  );
}
