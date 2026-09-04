import maplibregl from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';

import { STREET_STYLE, SAT_STYLE } from '../../lib/mapStyles.js';

import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * Live Fleet Tracking map for the CDS control room.
 *
 * This panel used to be a CSS grid with an emoji in the middle of it — there was
 * no map at all, in either state. It now draws the real thing: every open trip
 * with a GPS fix, positioned on a raster basemap, coloured by phase, with the
 * selected trip's recent track behind it.
 *
 * Raster tiles (the shared STREET_STYLE / SAT_STYLE) rather than a hosted vector
 * style, for the reason documented in lib/mapStyles.ts: a vector style's own
 * style/glyph fetches can fail silently in a deployed app and leave a blank
 * canvas, which is the failure mode this panel is being fixed for.
 */

export interface LiveTrip {
  id: string;
  trip_number: string;
  status: string;
  phase: 'moving' | 'at_port' | 'staged';
  /** GPS is recorded per vehicle, so the track is fetched by this, not by trip. */
  vehicle_id: string | null;
  lat: number | string | null;
  lng: number | string | null;
  speed: number | string | null;
  heading: number | string | null;
  last_seen: string | null;
  vehicle_reg: string | null;
  driver_name: string | null;
  customer_name: string | null;
  destination: string | null;
}

export interface TrackPoint { lat: number; lng: number }

interface LiveFleetMapProps {
  trips: LiveTrip[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Recent track of the selected trip, newest first. */
  track: TrackPoint[];
}

const PHASE_COLOR: Record<LiveTrip['phase'], string> = {
  moving: '#33d6a8',
  at_port: '#37e6ff',
  staged: '#f0b429',
};

const num = (v: number | string | null): number | null => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export const positioned = (t: LiveTrip): boolean => num(t.lat) != null && num(t.lng) != null;

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .cds-fleet-pin{cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:3px}
    .cds-fleet-dot{width:13px;height:13px;border-radius:50%;border:2px solid rgba(0,0,0,.55);position:relative}
    .cds-fleet-pin[data-sel="1"] .cds-fleet-dot{width:17px;height:17px}
    .cds-fleet-pin[data-live="1"] .cds-fleet-dot::after{content:'';position:absolute;inset:-6px;border-radius:50%;
      border:1.5px solid currentColor;opacity:0;animation:cds-fleet-pulse 2.2s ease-out infinite}
    @keyframes cds-fleet-pulse{0%{transform:scale(.55);opacity:.75}100%{transform:scale(1.5);opacity:0}}
    .cds-fleet-tag{font:600 9.5px/1.1 'IBM Plex Mono',ui-monospace,monospace;letter-spacing:.04em;
      white-space:nowrap;padding:2px 5px;border-radius:5px;background:rgba(8,9,11,.82);
      border:1px solid rgba(255,255,255,.14);color:#fff}
  `;
  document.head.appendChild(s);
}

export function LiveFleetMap({ trips, selectedId, onSelect, track }: LiveFleetMapProps) {
  const holder = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<Map<string, maplibregl.Marker>>(new Map());
  const ready = useRef(false);
  // Refit only when the set of positioned trips changes, so a 20s refetch that
  // moves a lorry 200m does not yank the operator's pan and zoom back.
  const fitKey = useRef('');
  const [basemap, setBasemap] = useState<'street' | 'satellite'>('street');

  useEffect(() => {
    injectStyles();
    if (!holder.current || map.current) return;
    const m = new maplibregl.Map({
      container: holder.current,
      style: STREET_STYLE,
      center: [37.9, -1.1],
      zoom: 5,
      attributionControl: { compact: true },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('load', () => {
      ready.current = true;
      m.addSource('cds-track', { type: 'geojson', data: emptyLine() });
      m.addLayer({
        id: 'cds-track-line', type: 'line', source: 'cds-track',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#33d6a8', 'line-width': 3, 'line-opacity': 0.75 },
      });
    });
    map.current = m;
    return () => { m.remove(); map.current = null; ready.current = false; };
  }, []);

  // Switching basemap replaces the style, which drops our own source and layer
  // with it — re-add them once the new style is in.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    m.setStyle(basemap === 'satellite' ? SAT_STYLE : STREET_STYLE);
    void m.once('styledata', () => {
      if (m.getSource('cds-track')) return;
      m.addSource('cds-track', { type: 'geojson', data: emptyLine() });
      m.addLayer({
        id: 'cds-track-line', type: 'line', source: 'cds-track',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#33d6a8', 'line-width': 3, 'line-opacity': 0.75 },
      });
    });
  }, [basemap]);

  // Markers: one per positioned trip, reused across refetches so the pins do not
  // flicker every poll.
  useEffect(() => {
    const m = map.current;
    if (!m) return;

    const seen = new Set<string>();
    const pts: [number, number][] = [];

    for (const t of trips) {
      const lat = num(t.lat), lng = num(t.lng);
      if (lat == null || lng == null) continue;
      seen.add(t.id);
      pts.push([lng, lat]);

      let marker = markers.current.get(t.id);
      if (!marker) {
        const el = document.createElement('div');
        el.className = 'cds-fleet-pin';
        el.innerHTML = '<div class="cds-fleet-dot"></div><div class="cds-fleet-tag"></div>';
        el.addEventListener('click', e => { e.stopPropagation(); onSelect(t.id); });
        marker = new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(m);
        markers.current.set(t.id, marker);
      } else {
        marker.setLngLat([lng, lat]);
      }

      const el = marker.getElement();
      const color = PHASE_COLOR[t.phase];
      el.style.color = color;
      el.dataset['sel'] = t.id === selectedId ? '1' : '0';
      el.dataset['live'] = t.phase === 'moving' ? '1' : '0';
      const dot = el.querySelector<HTMLElement>('.cds-fleet-dot');
      if (dot) {
        dot.style.background = color;
        dot.style.boxShadow = t.id === selectedId ? `0 0 0 3px ${color}55` : `0 0 10px ${color}88`;
      }
      const tag = el.querySelector<HTMLElement>('.cds-fleet-tag');
      if (tag) tag.textContent = t.vehicle_reg || t.trip_number;
    }

    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) { marker.remove(); markers.current.delete(id); }
    }

    const key = [...seen].sort().join(',');
    if (pts.length && key !== fitKey.current) {
      fitKey.current = key;
      const bounds = pts.reduce(
        (b, p) => b.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
      m.fitBounds(bounds, { padding: 56, maxZoom: 13, duration: 600 });
    }
  }, [trips, selectedId, onSelect]);

  // Selected trip's recent track.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    const src = m.getSource('cds-track') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    const coords = track
      .map(p => [Number(p.lng), Number(p.lat)] as [number, number])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
      .reverse();
    src.setData(coords.length > 1
      ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } }
      : emptyLine());
  }, [track]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl">
      {/* Sized with an inline style, not `absolute inset-0`: maplibre-gl.css sets
          `.maplibregl-map { position: relative }` on this very element, and at
          equal specificity the later stylesheet wins — so the utility class
          loses, inset-0 stops applying, and the container collapses to zero
          height with the canvas rendering at its default size into nothing. The
          other maps in this app size their holder inline for the same reason. */}
      <div ref={holder} style={{ width: '100%', height: '100%' }} />
      <button
        type="button"
        onClick={() => setBasemap(b => (b === 'street' ? 'satellite' : 'street'))}
        className="absolute left-2.5 top-2.5 z-10 rounded-lg border border-white/15 bg-black/60 px-2.5 py-1.5 text-[10px] font-mono tracking-[.08em] text-white/80 backdrop-blur-md transition-colors hover:border-white/40 hover:text-white cursor-pointer"
      >
        {basemap === 'street' ? 'SAT' : 'STR'}
      </button>
    </div>
  );
}

function emptyLine(): GeoJSON.Feature<GeoJSON.LineString> {
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [] } };
}
