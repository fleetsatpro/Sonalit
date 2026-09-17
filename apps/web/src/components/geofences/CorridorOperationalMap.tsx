import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Map, { AttributionControl, Layer, Marker, ScaleControl, Source, type MapRef } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Crosshair, Minus, Plus, ShieldAlert, Target, Truck } from 'lucide-react';
import { SAT_STYLE } from '../../lib/mapStyles.js';
import type { GlobeMember, LatLng, RiskZone } from './CorridorWorldScene.js';

const CENTER = { longitude: 36.8219, latitude: -1.2921, zoom: 5.5 };
const XD_VECTOR_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

type Props = {
  route: LatLng[];
  members: GlobeMember[];
  zones?: RiskZone[];
  focusId?: string | null;
  onSelect?: (id: string | null) => void;
  mapMode: 'dark' | 'satellite' | 'hybrid';
};

function styleFor(mode: Props['mapMode']): StyleSpecification | string {
  return mode === 'satellite' || mode === 'hybrid' ? SAT_STYLE : XD_VECTOR_STYLE;
}

function bounds(route: LatLng[], members: GlobeMember[]) {
  const pts = [
    ...route,
    ...members.filter(m => m.lat != null && m.lng != null).map(m => ({ lat: m.lat!, lng: m.lng! })),
  ];
  if (pts.length < 2) return null;
  const lats = pts.map(p => p.lat);
  const lngs = pts.map(p => p.lng);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngPad = Math.max(0.01, (maxLng - minLng) * 0.08);
  const latPad = Math.max(0.01, (maxLat - minLat) * 0.08);
  return [[minLng - lngPad, minLat - latPad], [maxLng + lngPad, maxLat + latPad]] as [[number, number], [number, number]];
}

function markerClass(status: string, selected: boolean) {
  const ring = selected ? 'ring-2 ring-white/90 ring-offset-2 ring-offset-black/20' : '';
  const fill = status === 'off_route'
    ? 'bg-red-400'
    : status === 'behind'
      ? 'bg-amber-300'
      : status === 'ahead'
        ? 'bg-cyan-300'
        : status === 'no_fix'
          ? 'bg-neutral-400'
          : 'bg-emerald-300';
  return `${ring} ${fill}`;
}

function deviceContext(member: GlobeMember) {
  const m = member as GlobeMember & { convoy_name?: string | null; client_name?: string | null };
  return [m.convoy_name, m.client_name].filter(Boolean).join(' · ');
}

export default function CorridorOperationalMap({ route, members, zones = [], focusId = null, onSelect, mapMode }: Props) {
  const mapRef = useRef<MapRef>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const lastFittedKeyRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const fit = useCallback(() => {
    const map = mapRef.current;
    if (!map) return false;
    const b = bounds(route, members);
    if (b) {
      map.fitBounds(b, {
        padding: { top: 112, right: 82, bottom: 96, left: 92 },
        duration: 700,
        maxZoom: 15,
      });
      return true;
    }
    const live = members.find(m => m.lat != null && m.lng != null);
    if (live) {
      map.flyTo({ longitude: live.lng!, latitude: live.lat!, zoom: 10.5, duration: 650 });
      return true;
    }
    return false;
  }, [members, route]);

  const structuralKey = useMemo(() => {
    const start = route[0];
    const end = route.at(-1);
    const ids = members.map(m => m.id).sort().join('|');
    return [route.length, start?.lat, start?.lng, end?.lat, end?.lng, ids].join(':');
  }, [members, route]);

  const line = useMemo(() => ({
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: route.map(p => [p.lng, p.lat]),
    },
  }), [route]);

  const riskFeatures = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: zones.map((z, i) => ({
      type: 'Feature' as const,
      id: z.zone_id ?? String(i),
      properties: { risk: z.risk_level, name: z.name ?? 'Risk zone' },
      geometry: { type: 'Point' as const, coordinates: [z.lng, z.lat] },
    })),
  }), [zones]);

  const focused = focusId ? members.find(m => m.id === focusId) : null;
  const context = focused ? deviceContext(focused) : '';
  const initial = members.find(m => m.lat != null && m.lng != null);
  const initialView = initial ? { longitude: initial.lng!, latitude: initial.lat!, zoom: 9 } : CENTER;
  const pixelRatio = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2.25);
  const positionedCount = members.filter(m => m.lat != null && m.lng != null).length;

  useEffect(() => {
    if (!mapReady) return;
    if (lastFittedKeyRef.current === structuralKey) return;
    if (fit()) lastFittedKeyRef.current = structuralKey;
  }, [fit, mapReady, structuralKey]);

  useEffect(() => {
    const map = mapRef.current;
    const box = boxRef.current;
    if (!map || !box) return;
    const resize = () => requestAnimationFrame(() => {
      if (!mapRef.current) return;
      mapRef.current.resize();
    });
    const observer = new ResizeObserver(resize);
    observer.observe(box);
    resize();
    return () => observer.disconnect();
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !focused || focused.lat == null || focused.lng == null) return;
    const currentZoom = map.getZoom();
    map.flyTo({
      longitude: focused.lng,
      latitude: focused.lat,
      zoom: Math.min(15, Math.max(11.5, currentZoom)),
      duration: 650,
    });
  }, [focusId, focused, mapReady]);

  return (
    <div ref={boxRef} className="relative h-full w-full overflow-hidden bg-[#070a0f]">
      <div className="absolute inset-0 [&_.maplibregl-canvas]:brightness-[0.78] [&_.maplibregl-canvas]:contrast-[1.12] [&_.maplibregl-canvas]:saturate-[0.82] [&_.maplibregl-canvas]:will-change-transform">
        <Map
          ref={mapRef}
          initialViewState={initialView}
          mapStyle={styleFor(mapMode)}
          onLoad={() => {
            setMapReady(true);
            mapRef.current?.resize();
            requestAnimationFrame(() => fit());
          }}
          onClick={event => {
            if (!event.defaultPrevented) onSelect?.(null);
          }}
          attributionControl={false}
          minZoom={2}
          maxZoom={19}
          dragRotate={false}
          touchPitch={false}
          touchRotate={false}
          doubleClickZoom
          scrollZoom
          dragPan
          touchZoomRotate
          pixelRatio={pixelRatio}
          maxCanvasSize={[8192, 8192]}
          canvasContextAttributes={{ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: false, contextType: 'webgl2' }}
        >
          <ScaleControl position="bottom-left" unit="metric" maxWidth={120} />
          <AttributionControl position="bottom-right" compact />

          <Source id="xd-route" type="geojson" data={line}>
            <Layer id="xd-route-halo" type="line" paint={{ 'line-color': '#5b21b6', 'line-opacity': 0.20, 'line-width': 18, 'line-blur': 3 }} />
            <Layer id="xd-route-core" type="line" paint={{ 'line-color': '#c4b5fd', 'line-opacity': 0.92, 'line-width': 4.5 }} />
          </Source>

          <Source id="xd-risk" type="geojson" data={riskFeatures}>
            <Layer id="xd-risk-ring" type="circle" paint={{
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 18, 15, 26],
              'circle-color': ['match', ['get', 'risk'], 'critical', '#ef4444', 'no_go', '#dc2626', 'high', '#f97316', 'medium', '#eab308', '#84cc16'],
              'circle-opacity': 0.18,
              'circle-stroke-width': 2,
              'circle-stroke-opacity': 0.65,
              'circle-stroke-color': ['match', ['get', 'risk'], 'critical', '#ef4444', 'no_go', '#dc2626', 'high', '#f97316', 'medium', '#eab308', '#84cc16'],
            }} />
          </Source>

          {route[0] && (
            <Marker longitude={route[0].lng} latitude={route[0].lat} anchor="center">
              <div className="grid h-5 w-5 select-none place-items-center rounded-full border border-emerald-200/80 bg-emerald-400/20 text-[9px] font-bold font-mono text-emerald-100">A</div>
            </Marker>
          )}
          {route.at(-1) && (
            <Marker longitude={route.at(-1)!.lng} latitude={route.at(-1)!.lat} anchor="center">
              <div className="grid h-5 w-5 select-none place-items-center rounded-full border border-rose-200/80 bg-rose-400/20 text-[9px] font-bold font-mono text-rose-100">B</div>
            </Marker>
          )}

          {members.filter(m => m.lat != null && m.lng != null).map(member => {
            const selected = member.id === focusId;
            const contextText = deviceContext(member);
            return (
              <Marker
                key={member.id}
                longitude={member.lng!}
                latitude={member.lat!}
                anchor="bottom"
                onClick={event => {
                  event.originalEvent.stopPropagation();
                  onSelect?.(selected ? null : member.id);
                }}
              >
                <button type="button" className="group flex cursor-pointer flex-col items-center text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/80" aria-label={`Inspect ${member.name}`}>
                  <span className={`grid h-10 w-10 place-items-center rounded-xl border border-white/30 bg-[#06090f]/92 shadow-[0_8px_22px_rgba(0,0,0,.45)] transition-transform ${selected ? 'scale-125 border-white/80' : 'group-hover:scale-110'}`}>
                    <span className={`grid h-5 w-5 place-items-center rounded-md ${markerClass(member.status, selected)}`}>
                      <Truck size={12} className="text-black" />
                    </span>
                  </span>
                  <span className={`mt-1 max-w-[210px] rounded-lg border px-2.5 py-1.5 text-center backdrop-blur-xl ${selected ? 'border-white/25 bg-[#05070c]/96' : 'border-white/10 bg-[#05070c]/84 opacity-90 group-hover:opacity-100'}`}>
                    <span className="block truncate text-[11px] font-bold text-white">{member.name}</span>
                    {contextText && <span className="block truncate text-[10px] font-semibold font-mono text-violet-200/95">{contextText}</span>}
                    <span className="block text-[9px] font-bold font-mono uppercase tracking-[0.08em] text-neutral-300">{member.status.replaceAll('_', ' ')}</span>
                  </span>
                </button>
              </Marker>
            );
          })}
        </Map>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto rounded-2xl border border-white/10 bg-[#05070c]/84 px-3 py-2.5 shadow-2xl backdrop-blur-2xl">
          <div className="flex items-center gap-2 text-[11px] font-bold font-mono uppercase tracking-[0.16em] text-violet-300"><Crosshair size={12} /> XD · 2D OPERATIONAL</div>
          <div className="mt-1 text-[10px] font-semibold font-mono text-neutral-300">OPEN VECTOR · {positionedCount}/{members.length} POSITIONED · DPR {pixelRatio.toFixed(2)}×</div>
        </div>
        <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-white/10 bg-[#05070c]/90 p-1 shadow-2xl backdrop-blur-2xl">
          <button type="button" onClick={() => fit()} className="grid h-8 w-8 place-items-center rounded-xl text-neutral-300 hover:bg-white/10 hover:text-white" aria-label="Fit world"><Target size={14} /></button>
          <button type="button" onClick={() => mapRef.current?.getMap().zoomIn()} className="grid h-8 w-8 place-items-center rounded-xl text-neutral-300 hover:bg-white/10 hover:text-white" aria-label="Zoom in"><Plus size={14} /></button>
          <button type="button" onClick={() => mapRef.current?.getMap().zoomOut()} className="grid h-8 w-8 place-items-center rounded-xl text-neutral-300 hover:bg-white/10 hover:text-white" aria-label="Zoom out"><Minus size={14} /></button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-xl border border-white/10 bg-[#05070c]/90 px-3 py-2.5 text-center backdrop-blur-xl">
        <div className="flex items-center gap-3 text-[10px] font-bold font-mono uppercase tracking-[0.08em] text-neutral-200">
          <span>{members.length} entities</span>
          <span className="text-emerald-300">{positionedCount} positioned</span>
          <span className="text-amber-300">{zones.length} risk</span>
        </div>
      </div>

      {focused && (
        <div className="pointer-events-none absolute bottom-3 right-3 max-w-[320px] rounded-2xl border border-violet-400/20 bg-[#05070c]/92 p-3 shadow-2xl backdrop-blur-2xl">
          <div className="flex items-center gap-2"><Truck size={14} className="text-violet-300" /><span className="text-[12px] font-bold text-white">{focused.name}</span></div>
          {context && <p className="mt-1 text-[10px] font-bold font-mono text-violet-200">{context}</p>}
          <p className="mt-2 text-[10px] font-semibold text-neutral-200">{focused.position_state ?? 'observed'} · {focused.position_confidence != null ? `${Math.round(focused.position_confidence * 100)}% confidence` : 'confidence unavailable'}</p>
        </div>
      )}
      {zones.length > 0 && (
        <div className="pointer-events-none absolute left-3 bottom-[42px] rounded-xl border border-red-400/20 bg-[#05070c]/90 px-2.5 py-2 backdrop-blur-xl">
          <div className="flex items-center gap-1.5 text-[10px] font-bold font-mono uppercase tracking-[0.1em] text-red-300"><ShieldAlert size={12} /> risk overlays active</div>
        </div>
      )}
    </div>
  );
}
