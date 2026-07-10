import { useRef, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import { geoCircle } from '../../lib/geoMath.js';
import { STREET_STYLE, SAT_STYLE } from '../../lib/mapStyles.js';
import { STATUS_COLOR, EA_CENTER, EA_ZOOM } from './types.js';
import type { MapVehicle, MapDevice, MapGeofence, Geofence } from './types.js';

type DrawMode = 'circle' | 'linear' | 'corridor' | null;

interface Options {
  drawMode: DrawMode;
  drawCenter: [number, number] | null;
  drawPath: [number, number][];
  drawRadiusM: string;
  onDrawCenter: (pt: [number, number]) => void;
  onDrawPoint: (pt: [number, number]) => void;
  onVehiclePicked: (id: string) => void;
  vehicles: MapVehicle[];
  visibleVehicles: MapVehicle[];
  devices: MapDevice[];
  mapGeofences: MapGeofence[];
  visibleZones: Geofence[];
  regionFilter: string;
  expanded: boolean;
  mapStyle: 'street' | 'satellite';
}

// Owns the imperative MapLibre instance for the Geofences page: base style
// (street/satellite raster tiles — no vector-style/glyph fetch to fail),
// draw-mode click capture, vehicle-marker picking, fullscreen resize, and
// redrawing the live zones/vehicles/devices/draw-preview layers whenever the
// underlying data or base style changes.
export function useGeofenceMap(opts: Options) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);
  const styleAppliedRef = useRef(false);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: mapEl.current, style: STREET_STYLE, center: EA_CENTER, zoom: EA_ZOOM });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
    map.on('load', () => { mapReadyRef.current = true; });
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; mapReadyRef.current = false; };
  }, []);

  useEffect(() => {
    if (mapRef.current) setTimeout(() => mapRef.current?.resize(), 50);
  }, [opts.expanded]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    if (!styleAppliedRef.current) { styleAppliedRef.current = true; return; }
    m.setStyle(opts.mapStyle === 'satellite' ? SAT_STYLE : STREET_STYLE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.mapStyle]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || !opts.drawMode) return;
    const handler = (e: maplibregl.MapMouseEvent) => {
      const pt: [number, number] = [e.lngLat.lat, e.lngLat.lng];
      if (opts.drawMode === 'circle') opts.onDrawCenter(pt); else opts.onDrawPoint(pt);
    };
    m.on('click', handler);
    return () => { m.off('click', handler); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.drawMode]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const handler = (e: maplibregl.MapMouseEvent) => {
      const feats = m.queryRenderedFeatures(e.point, { layers: ['gf-vehicles-dot'] });
      const id = feats[0]?.properties?.['id'];
      if (id) opts.onVehiclePicked(id);
    };
    m.on('click', 'gf-vehicles-dot', handler);
    return () => { m.off('click', 'gf-vehicles-dot', handler); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.vehicles.length]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const render = () => {
      ['gf-zone-fill', 'gf-zone-line', 'gf-corridor-glow', 'gf-corridor-line', 'gf-linear-line', 'gf-vehicles-glow', 'gf-vehicles-dot', 'gf-devices-glow', 'gf-devices-dot', 'gf-draw-fill', 'gf-draw-line']
        .forEach(id => { if (m.getLayer(id)) m.removeLayer(id); });
      ['gf-zone-src', 'gf-corridor-src', 'gf-linear-src', 'gf-vehicles-src', 'gf-devices-src', 'gf-draw-src'].forEach(id => { if (m.getSource(id)) m.removeSource(id); });

      const circleFeatures: GeoJSON.Feature[] = [];
      const corridorFeatures: GeoJSON.Feature[] = [];
      const linearFeatures: GeoJSON.Feature[] = [];
      const visibleZoneIds = new Set(opts.visibleZones.map(z => z.id));
      opts.mapGeofences.filter(g => opts.regionFilter === 'all' || visibleZoneIds.has(g.id)).forEach(g => {
        if (g.type === 'linear' && g.path && g.path.length >= 2) {
          linearFeatures.push({ type: 'Feature', properties: { name: g.name }, geometry: { type: 'LineString', coordinates: g.path.map(([lat, lng]) => [lng, lat]) } });
        } else if (g.type === 'corridor' && g.path && g.path.length >= 2) {
          corridorFeatures.push({ type: 'Feature', properties: { name: g.name }, geometry: { type: 'LineString', coordinates: g.path.map(([lat, lng]) => [lng, lat]) } });
        } else if (g.lat != null && g.lng != null) {
          circleFeatures.push({ type: 'Feature', properties: { name: g.name }, geometry: { type: 'Polygon', coordinates: [geoCircle(g.lat, g.lng, (g.radius_m || 1000) / 1000)] } });
        }
      });
      m.addSource('gf-zone-src', { type: 'geojson', data: { type: 'FeatureCollection', features: circleFeatures } });
      m.addLayer({ id: 'gf-zone-fill', type: 'fill', source: 'gf-zone-src', paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.08 } });
      m.addLayer({ id: 'gf-zone-line', type: 'line', source: 'gf-zone-src', paint: { 'line-color': '#22d3ee', 'line-width': 1.5, 'line-dasharray': [4, 3] } });
      // Corridors get a wide translucent buffer band; linear geofences are a plain route line with no buffer.
      m.addSource('gf-corridor-src', { type: 'geojson', data: { type: 'FeatureCollection', features: corridorFeatures } });
      m.addLayer({ id: 'gf-corridor-glow', type: 'line', source: 'gf-corridor-src', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#38bdf8', 'line-width': 14, 'line-opacity': 0.15 } });
      m.addLayer({ id: 'gf-corridor-line', type: 'line', source: 'gf-corridor-src', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#38bdf8', 'line-width': 2.5, 'line-dasharray': [3, 2] } });
      m.addSource('gf-linear-src', { type: 'geojson', data: { type: 'FeatureCollection', features: linearFeatures } });
      m.addLayer({ id: 'gf-linear-line', type: 'line', source: 'gf-linear-src', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#a78bfa', 'line-width': 2.5 } });

      const vehicleFeatures: GeoJSON.Feature[] = opts.visibleVehicles.map(v => ({ type: 'Feature', properties: { id: v.id, registration: v.registration, status: v.status }, geometry: { type: 'Point', coordinates: [v.lng, v.lat] } }));
      m.addSource('gf-vehicles-src', { type: 'geojson', data: { type: 'FeatureCollection', features: vehicleFeatures } });
      const statusColorExpr: maplibregl.ExpressionSpecification = ['match', ['get', 'status'], 'panic', STATUS_COLOR['panic']!, 'alert', STATUS_COLOR['alert']!, 'warn', STATUS_COLOR['warn']!, 'moving', STATUS_COLOR['moving']!, 'idle', STATUS_COLOR['idle']!, 'offline', STATUS_COLOR['offline']!, '#666666'];
      m.addLayer({ id: 'gf-vehicles-glow', type: 'circle', source: 'gf-vehicles-src', paint: { 'circle-radius': 13, 'circle-color': statusColorExpr, 'circle-opacity': 0.2, 'circle-blur': 1 } });
      m.addLayer({ id: 'gf-vehicles-dot', type: 'circle', source: 'gf-vehicles-src', paint: { 'circle-radius': 6, 'circle-color': statusColorExpr, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#000', 'circle-opacity': 0.95 } });

      const deviceFeatures: GeoJSON.Feature[] = opts.devices.map(d => ({ type: 'Feature', properties: { id: d.id, name: d.name, status: d.status }, geometry: { type: 'Point', coordinates: [d.lng, d.lat] } }));
      m.addSource('gf-devices-src', { type: 'geojson', data: { type: 'FeatureCollection', features: deviceFeatures } });
      m.addLayer({ id: 'gf-devices-glow', type: 'circle', source: 'gf-devices-src', paint: { 'circle-radius': ['case', ['==', ['get', 'status'], 'panic'], 20, 9], 'circle-color': statusColorExpr, 'circle-opacity': ['case', ['==', ['get', 'status'], 'panic'], 0.35, 0.15], 'circle-blur': 1 } });
      m.addLayer({ id: 'gf-devices-dot', type: 'circle', source: 'gf-devices-src', paint: { 'circle-radius': 4.5, 'circle-color': statusColorExpr, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#fff', 'circle-opacity': 0.95 } });

      const drawFeatures: GeoJSON.Feature[] = [];
      if (opts.drawMode === 'circle' && opts.drawCenter) drawFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [geoCircle(opts.drawCenter[0], opts.drawCenter[1], parseFloat(opts.drawRadiusM || '2000') / 1000)] } });
      else if ((opts.drawMode === 'corridor' || opts.drawMode === 'linear') && opts.drawPath.length >= 2) drawFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: opts.drawPath.map(([lat, lng]) => [lng, lat]) } });
      m.addSource('gf-draw-src', { type: 'geojson', data: { type: 'FeatureCollection', features: drawFeatures } });
      m.addLayer({ id: 'gf-draw-fill', type: 'fill', source: 'gf-draw-src', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#f97316', 'fill-opacity': 0.15 } });
      m.addLayer({ id: 'gf-draw-line', type: 'line', source: 'gf-draw-src', paint: { 'line-color': '#f97316', 'line-width': 2.5 } });
    };
    if (mapReadyRef.current) render(); else m.once('load', render);
    m.on('style.load', render);
    return () => { m.off('style.load', render); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.visibleVehicles, opts.devices, opts.mapGeofences, opts.visibleZones, opts.regionFilter, opts.drawMode, opts.drawCenter, opts.drawPath, opts.drawRadiusM]);

  return { mapEl, mapRef };
}
