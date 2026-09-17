import { useCallback, useEffect, useMemo, useRef } from 'react';
import Map, { Layer, Marker, NavigationControl, ScaleControl, Source, type MapRef } from 'react-map-gl/maplibre';
import type { StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Crosshair, Maximize2, Minus, Plus, Satellite, ShieldAlert, Target, Truck } from 'lucide-react';
import { SAT_STYLE, STREET_STYLE } from '../../lib/mapStyles.js';
import type { GlobeMember, LatLng, RiskZone } from './CorridorWorldScene.js';

const CENTER = { longitude: 36.8219, latitude: -1.2921, zoom: 5.5 };

type Props = {
  route: LatLng[];
  members: GlobeMember[];
  zones?: RiskZone[];
  focusId?: string | null;
  onSelect?: (id: string | null) => void;
  mapMode: 'dark' | 'satellite' | 'hybrid';
};

function styleFor(mode: Props['mapMode']): StyleSpecification {
  if (mode === 'satellite' || mode === 'hybrid') return SAT_STYLE;
  return STREET_STYLE;
}

function bounds(route: LatLng[], members: GlobeMember[]) {
  const pts = [...route, ...members.filter(m => m.lat != null && m.lng != null).map(m => ({ lat: m.lat!, lng: m.lng! }))];
  if (pts.length < 2) return null;
  const lats = pts.map(p => p.lat), lngs = pts.map(p => p.lng);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]] as [[number, number], [number, number]];
}

function markerClass(status: string, selected: boolean) {
  const ring = selected ? 'ring-2 ring-white/90 ring-offset-2 ring-offset-black/20' : '';
  const fill = status === 'off_route' ? 'bg-red-400' : status === 'behind' ? 'bg-amber-300' : status === 'ahead' ? 'bg-cyan-300' : status === 'no_fix' ? 'bg-neutral-400' : 'bg-emerald-300';
  return `${ring} ${fill}`;
}

function deviceContext(member: GlobeMember) {
  const m = member as GlobeMember & { convoy_name?: string | null; client_name?: string | null };
  return [m.convoy_name, m.client_name].filter(Boolean).join(' · ');
}

export default function CorridorOperationalMap({ route, members, zones = [], focusId = null, onSelect, mapMode }: Props) {
  const mapRef = useRef<MapRef>(null);
  const fittedRef = useRef(false);
  const fit = useCallback(() => {
    const b = bounds(route, members);
    if (!b || !mapRef.current) return;
    mapRef.current.fitBounds(b, { padding: { top: 108, right: 90, bottom: 86, left: 90 }, duration: 650, maxZoom: 15 });
    fittedRef.current = true;
  }, [route, members]);

  useEffect(() => {
    if (!fittedRef.current) fit();
  }, [fit]);

  const line = useMemo(() => ({
    type: 'Feature' as const,
    properties: {},
    geometry: { type: 'LineString' as const, coordinates: route.map(p => [p.lng, p.lat]) },
  }), [route]);

  const riskFeatures = useMemo(() => ({
    type: 'FeatureCollection' as const,
    features: zones.map((z, i) => ({ type: 'Feature' as const, id: z.zone_id ?? String(i), properties: { risk: z.risk_level, name: z.name ?? 'Risk zone' }, geometry: { type: 'Point' as const, coordinates: [z.lng, z.lat] } })),
  }), [zones]);

  const focused = focusId ? members.find(m => m.id === focusId) : null;
  const context = focused ? deviceContext(focused) : '';

  const initial = members.find(m => m.lat != null && m.lng != null);
  const initialView = initial ? { longitude: initial.lng!, latitude: initial.lat!, zoom: 9 } : CENTER;

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#070a0f]">
      <Map
        ref={mapRef}
        initialViewState={initialView}
        mapStyle={styleFor(mapMode)}
        reuseMaps
        attributionControl={false}
        dragRotate
        cooperativeGestures
        minZoom={2}
        maxZoom={19}
      >
        <NavigationControl position="bottom-right" showCompass={false} showZoom={true} />
        <ScaleControl position="bottom-left" unit="metric" maxWidth={120} />
        <Source id="xd-route" type="geojson" data={line}>
          <Layer id="xd-route-halo" type="line" paint={{ 'line-color': '#5b21b6', 'line-opacity': 0.18, 'line-width': 18, 'line-blur': 3 }} />
          <Layer id="xd-route-core" type="line" paint={{ 'line-color': '#c4b5fd', 'line-opacity': 0.92, 'line-width': 4.5 }} />
        </Source>
        <Source id="xd-risk" type="geojson" data={riskFeatures}>
          <Layer id="xd-risk-ring" type="circle" paint={{ 'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 18, 15, 26], 'circle-color': ['match', ['get', 'risk'], 'critical', '#ef4444', 'no_go', '#dc2626', 'high', '#f97316', 'medium', '#eab308', '#84cc16'], 'circle-opacity': 0.18, 'circle-stroke-width': 2, 'circle-stroke-opacity': 0.65, 'circle-stroke-color': ['match', ['get', 'risk'], 'critical', '#ef4444', 'no_go', '#dc2626', 'high', '#f97316', 'medium', '#eab308', '#84cc16'] }} />
        </Source>

        {route[0] && <Marker longitude={route[0].lng} latitude={route[0].lat} anchor="center"><div className="grid h-5 w-5 place-items-center rounded-full border border-emerald-200/80 bg-emerald-400/20 text-[8px] font-mono text-emerald-100">A</div></Marker>}
        {route.at(-1) && <Marker longitude={route.at(-1)!.lng} latitude={route.at(-1)!.lat} anchor="center"><div className="grid h-5 w-5 place-items-center rounded-full border border-rose-200/80 bg-rose-400/20 text-[8px] font-mono text-rose-100">B</div></Marker>}

        {members.filter(m => m.lat != null && m.lng != null).map(member => {
          const selected = member.id === focusId;
          const contextText = deviceContext(member);
          return (
            <Marker key={member.id} longitude={member.lng!} latitude={member.lat!} anchor="bottom" onClick={event => { event.originalEvent.stopPropagation(); onSelect?.(selected ? null : member.id); }}>
              <div className="group flex flex-col items-center">
                <div className={`grid h-9 w-9 place-items-center rounded-xl border border-white/30 bg-[#06090f]/90 shadow-[0_8px_22px_rgba(0,0,0,.45)] transition-transform ${selected ? 'scale-125 border-white/80' : 'hover:scale-110'}`}>
                  <span className={`grid h-5 w-5 place-items-center rounded-md ${markerClass(member.status, selected)}`}><Truck size={12} className="text-black" /></span>
                </div>
                <div className={`mt-1 max-w-[210px] rounded-lg border px-2 py-1 text-center backdrop-blur-xl ${selected ? 'border-white/25 bg-[#05070c]/95' : 'border-white/10 bg-[#05070c]/80 opacity-85 group-hover:opacity-100'}`}>
                  <p className="truncate text-[10px] font-semibold text-white">{member.name}</p>
                  {contextText && <p className="truncate text-[9px] font-mono text-violet-200/90">{contextText}</p>}
                  <p className="text-[8px] font-mono uppercase tracking-wider text-neutral-500">{member.status.replaceAll('_', ' ')}</p>
                </div>
              </div>
            </Marker>
          );
        })}
      </Map>

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <div className="pointer-events-auto rounded-2xl border border-white/10 bg-[#05070c]/84 px-3 py-2 shadow-2xl backdrop-blur-2xl">
          <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em] text-violet-300"><Crosshair size={12} /> XD · 2D OPERATIONAL</div>
          <div className="mt-1 text-[11px] text-neutral-500">Vector-first command surface · no Ion dependency</div>
        </div>
        <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-white/10 bg-[#05070c]/84 p-1 shadow-2xl backdrop-blur-2xl">
          <button type="button" onClick={fit} className="grid h-8 w-8 place-items-center rounded-xl text-neutral-400 hover:bg-white/10 hover:text-white" aria-label="Fit world"><Target size={14} /></button>
          <button type="button" onClick={() => mapRef.current?.getMap().zoomIn()} className="grid h-8 w-8 place-items-center rounded-xl text-neutral-400 hover:bg-white/10 hover:text-white" aria-label="Zoom in"><Plus size={14} /></button>
          <button type="button" onClick={() => mapRef.current?.getMap().zoomOut()} className="grid h-8 w-8 place-items-center rounded-xl text-neutral-400 hover:bg-white/10 hover:text-white" aria-label="Zoom out"><Minus size={14} /></button>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-xl border border-white/10 bg-[#05070c]/82 px-3 py-2 text-center backdrop-blur-xl">
        <div className="flex items-center gap-3 text-[9px] font-mono uppercase tracking-wider text-neutral-400">
          <span>{members.length} entities</span><span className="text-emerald-300">{members.filter(m => m.lat != null && m.lng != null).length} positioned</span><span className="text-amber-300">{zones.length} risk</span>
        </div>
      </div>

      {focused && <div className="pointer-events-none absolute bottom-3 right-3 max-w-[320px] rounded-2xl border border-violet-400/20 bg-[#05070c]/90 p-3 shadow-2xl backdrop-blur-2xl">
        <div className="flex items-center gap-2"><Truck size={14} className="text-violet-300" /><span className="text-[12px] font-semibold text-white">{focused.name}</span></div>
        {context && <p className="mt-1 text-[10px] font-mono text-violet-200">{context}</p>}
        <p className="mt-2 text-[10px] text-neutral-400">{focused.position_state ?? 'observed'} · {focused.position_confidence != null ? `${Math.round(focused.position_confidence * 100)}% confidence` : 'confidence unavailable'}</p>
      </div>}

      {zones.length > 0 && <div className="pointer-events-none absolute left-3 bottom-3 rounded-xl border border-red-400/20 bg-[#05070c]/86 px-2.5 py-2 backdrop-blur-xl">
        <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-wider text-red-300"><ShieldAlert size={12} /> risk overlays active</div>
      </div>}
    </div>
  );
}
