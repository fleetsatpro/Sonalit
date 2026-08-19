/**
 * Live e-lock tracking map.
 *
 * Draws every lock's current position from the Securisat telemetry feed, keeps
 * the markers in step with realtime updates (the parent invalidates
 * ['cds','locks-live'] on each cds.lock.telemetry event, so `locks` changes and
 * the markers move), and draws the selected lock's recent GPS trail.
 *
 * Marker colour is a fast read of the thing that matters most: red = tamper,
 * amber = low battery or offline, teal = healthy. That means a control-room
 * screen showing the fleet surfaces a compromised container as a red dot
 * without anyone reading a table.
 */
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';

import { STREET_STYLE, SAT_STYLE } from '../../lib/mapStyles.js';

export interface LockPoint {
  id: string;
  serial: string;
  lat: number | null;
  lng: number | null;
  battery_level: number | null;
  signal_strength: string | null;
  tamper_detected: boolean;
  status: string;
  container_number?: string | null;
  booking_number?: string | null;
}

export type LockHealth = 'tamper' | 'warn' | 'ok' | 'stale';

export function lockHealth(l: LockPoint): LockHealth {
  if (l.tamper_detected) return 'tamper';
  if (l.status === 'offline' || l.signal_strength === 'offline') return 'stale';
  if ((l.battery_level ?? 100) <= 20) return 'warn';
  return 'ok';
}

const HEALTH_COLOR: Record<LockHealth, string> = {
  tamper: '#ff5c5c', warn: '#ffb020', ok: '#33d6a8', stale: '#64748b',
};

function markerEl(l: LockPoint, selected: boolean): HTMLElement {
  const health = lockHealth(l);
  const color = HEALTH_COLOR[health];
  const el = document.createElement('div');
  el.style.cssText = `width:${selected ? 20 : 14}px;height:${selected ? 20 : 14}px;border-radius:50%;background:${color};border:2px solid rgba(0,0,0,.5);box-shadow:0 0 ${selected ? 16 : 10}px ${color};cursor:pointer;transition:all .15s`;
  if (health === 'tamper') {
    // A tampered lock pulses so it can't be missed on a wall display.
    el.style.animation = 'cdsLockPulse 1s ease-in-out infinite';
  }
  el.title = `${l.serial}${l.container_number ? ` · ${l.container_number}` : ''} — ${health}`;
  return el;
}

// One-time keyframes injection for the tamper pulse.
function ensurePulseKeyframes() {
  if (document.getElementById('cds-lock-pulse-kf')) return;
  const style = document.createElement('style');
  style.id = 'cds-lock-pulse-kf';
  style.textContent = '@keyframes cdsLockPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.5);opacity:.6}}';
  document.head.appendChild(style);
}

export function LockTrackingMap({
  locks, selectedId, trail, satellite, onSelect,
}: {
  locks: LockPoint[];
  selectedId: string | null;
  trail: { lat: number; lng: number }[];
  satellite: boolean;
  onSelect: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const styledOnce = useRef(false);
  const fitOnce = useRef(false);

  useEffect(() => {
    ensurePulseKeyframes();
    if (!containerRef.current || mapRef.current) return;
    const m = new maplibregl.Map({
      container: containerRef.current,
      style: satellite ? SAT_STYLE : STREET_STYLE,
      center: [39.66, -4.05], // Mombasa — the yard/port corridor
      zoom: 6,
      attributionControl: false,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current = m;
    const markerStore = markers.current;
    return () => { m.remove(); mapRef.current = null; markerStore.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Style swap (street ↔ satellite) without tearing down the map.
  useEffect(() => {
    if (!mapRef.current || !styledOnce.current) { styledOnce.current = true; return; }
    mapRef.current.setStyle(satellite ? SAT_STYLE : STREET_STYLE);
  }, [satellite]);

  // Markers — reconciled against the current lock set on every update.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    const withPos = locks.filter(l => l.lat != null && l.lng != null);

    for (const l of withPos) {
      seen.add(l.id);
      const existing = markers.current.get(l.id);
      const el = markerEl(l, l.id === selectedId);
      el.onclick = () => onSelect(l.id);
      if (existing) {
        existing.getElement().replaceWith(el);
        existing.setLngLat([l.lng as number, l.lat as number]);
        // maplibre keeps its own element ref; recreate the marker to rebind.
        existing.remove();
      }
      const mk = new maplibregl.Marker({ element: el }).setLngLat([l.lng as number, l.lat as number]).addTo(map);
      markers.current.set(l.id, mk);
    }
    for (const [id, mk] of markers.current) {
      if (!seen.has(id)) { mk.remove(); markers.current.delete(id); }
    }

    // Fit to the fleet once, on first data — after that the operator's pan/zoom
    // is theirs to keep.
    if (!fitOnce.current && withPos.length > 0) {
      fitOnce.current = true;
      const b = new maplibregl.LngLatBounds();
      withPos.forEach(l => b.extend([l.lng as number, l.lat as number]));
      map.fitBounds(b, { padding: 60, maxZoom: 12, duration: 0 });
    }
  }, [locks, selectedId, onSelect]);

  // Selected lock's GPS trail as a polyline.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const draw = () => {
      const src = map.getSource('lock-trail') as maplibregl.GeoJSONSource | undefined;
      const data: GeoJSON.Feature = {
        type: 'Feature', properties: {},
        geometry: { type: 'LineString', coordinates: trail.map(p => [p.lng, p.lat]) },
      };
      if (src) { src.setData(data); return; }
      if (trail.length < 2) return;
      map.addSource('lock-trail', { type: 'geojson', data });
      map.addLayer({
        id: 'lock-trail-line', type: 'line', source: 'lock-trail',
        paint: { 'line-color': '#ff7a00', 'line-width': 2.5, 'line-opacity': 0.8 },
      });
    };
    if (map.isStyleLoaded()) draw(); else { void map.once('load', draw); }
  }, [trail]);

  return <div ref={containerRef} className="w-full h-full rounded-xl overflow-hidden" />;
}
