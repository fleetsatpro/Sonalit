import { useRef, useEffect } from 'react';
import maplibregl from 'maplibre-gl';
import { bindDenseMapLabels } from '../../lib/mapLabels.js';
import { createOperationalDeviceMarker, setOperationalMarkerDensity } from '../../lib/operationalMapMarkers.js';
import { geoCircle } from '../../lib/geoMath.js';
import { STREET_STYLE, SAT_STYLE } from '../../lib/mapStyles.js';
import { EA_CENTER, EA_ZOOM } from './types.js';
import type { MapVehicle, MapDevice, MapGeofence, Geofence } from './types.js';
import type { CorridorSignalOverlay } from './geofenceSegmentSignals.js';

type DrawMode = 'circle' | 'polygon' | 'linear' | 'corridor' | null;

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
  corridorSignalOverlay: CorridorSignalOverlay;
  onViewportChange: (viewport: { latitude: number; longitude: number; radiusM: number }) => void;
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
  const mapStyleRef = useRef<'street' | 'satellite'>('street');
  const renderRef = useRef<(() => void) | null>(null);
  const operationalMarkersRef = useRef<maplibregl.Marker[]>([]);
  const onViewportChangeRef = useRef(opts.onViewportChange);
  onViewportChangeRef.current = opts.onViewportChange;
  const corridorSignalOverlayRef = useRef(opts.corridorSignalOverlay);
  corridorSignalOverlayRef.current = opts.corridorSignalOverlay;

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = new maplibregl.Map({ container: mapEl.current, style: STREET_STYLE, center: EA_CENTER, zoom: EA_ZOOM });
    bindDenseMapLabels(map);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const topRightCtrl = map.getContainer().querySelector<HTMLElement>('.maplibregl-ctrl-top-right');
    if (topRightCtrl) topRightCtrl.style.marginTop = '52px';

    const publishViewport = () => {
      if (mapRef.current !== map) return;
      const center = map.getCenter();
      const bounds = map.getBounds();
      const corners: [number, number][] = [
        [bounds.getNorth(), bounds.getEast()],
        [bounds.getNorth(), bounds.getWest()],
        [bounds.getSouth(), bounds.getEast()],
        [bounds.getSouth(), bounds.getWest()],
      ];
      const toRadians = (value: number) => value * Math.PI / 180;
      const radiusFor = (lat: number, lng: number) => {
        const dLat = toRadians(lat - center.lat);
        const dLng = toRadians(lng - center.lng);
        const a = Math.sin(dLat / 2) ** 2
          + Math.cos(toRadians(center.lat)) * Math.cos(toRadians(lat)) * Math.sin(dLng / 2) ** 2;
        return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
      };
      const radiusM = Math.max(15000, Math.min(250000, Math.ceil(Math.max(...corners.map(([lat, lng]) => radiusFor(lat, lng))) * 1.2 / 25000) * 25000));
      onViewportChangeRef.current({
        latitude: Math.round(center.lat * 10) / 10,
        longitude: Math.round(center.lng * 10) / 10,
        radiusM,
      });
    };
    const redrawAfterStyleLoad = () => {
      mapReadyRef.current = true;
      publishViewport();
      requestAnimationFrame(() => {
        if (mapRef.current === map && map.isStyleLoaded()) renderRef.current?.();
      });
    };
    map.on('load', redrawAfterStyleLoad);
    map.on('style.load', redrawAfterStyleLoad);
    map.on('moveend', publishViewport);
    const refreshMarkerDensity = () => {
      const zoom = map.getZoom();
      operationalMarkersRef.current.forEach(marker => setOperationalMarkerDensity(marker.getElement() as HTMLButtonElement, zoom));
    };
    map.on('zoom', refreshMarkerDensity);
    mapRef.current = map;
    return () => {
      map.off('load', redrawAfterStyleLoad);
      map.off('style.load', redrawAfterStyleLoad);
      map.off('moveend', publishViewport);
      map.off('zoom', refreshMarkerDensity);
      operationalMarkersRef.current.forEach(marker => marker.remove());
      operationalMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
      renderRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (mapRef.current) setTimeout(() => mapRef.current?.resize(), 50);
  }, [opts.expanded]);

  useEffect(() => {
    const m = mapRef.current;
    if (!m || mapStyleRef.current === opts.mapStyle) return;
    mapStyleRef.current = opts.mapStyle;
    mapReadyRef.current = false;
    m.setStyle(opts.mapStyle === 'satellite' ? SAT_STYLE : STREET_STYLE);
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
    const render = () => {
      ['gf-zone-fill', 'gf-zone-line', 'gf-zone-label', 'gf-polygon-fill', 'gf-polygon-line', 'gf-polygon-label', 'gf-corridor-buffer-fill', 'gf-corridor-buffer-line', 'gf-corridor-buffer-distance', 'gf-corridor-glow', 'gf-corridor-line', 'gf-corridor-signal-shadow', 'gf-corridor-signal-glow', 'gf-corridor-signal-line', 'gf-corridor-signal-points-glow', 'gf-corridor-signal-points', 'gf-corridor-label', 'gf-linear-line', 'gf-linear-label', 'gf-vehicles-glow', 'gf-vehicles-dot', 'gf-vehicles-label', 'gf-devices-glow', 'gf-devices-dot', 'gf-devices-label', 'gf-draw-fill', 'gf-draw-line', 'gf-draw-vertices']
        .forEach(id => { if (m.getLayer(id)) m.removeLayer(id); });
      operationalMarkersRef.current.forEach(marker => marker.remove());
      operationalMarkersRef.current = [];
      ['gf-zone-src', 'gf-polygon-src', 'gf-corridor-buffer-src', 'gf-corridor-src', 'gf-corridor-signal-src', 'gf-corridor-signal-points-src', 'gf-linear-src', 'gf-vehicles-src', 'gf-devices-src', 'gf-draw-src'].forEach(id => { if (m.getSource(id)) m.removeSource(id); });

      const circleFeatures: GeoJSON.Feature[] = [];
      const polygonFeatures: GeoJSON.Feature[] = [];
      const corridorBufferFeatures: GeoJSON.Feature[] = [];
      const corridorFeatures: GeoJSON.Feature[] = [];
      const linearFeatures: GeoJSON.Feature[] = [];
      const visibleZoneIds = new Set(opts.visibleZones.map(z => z.id));
      opts.mapGeofences.filter(g => opts.regionFilter === 'all' || visibleZoneIds.has(g.id)).forEach(g => {
        if ((g.type === 'polygon' || g.polygon) && g.polygon && g.polygon.length >= 4) {
          polygonFeatures.push({ type: 'Feature', properties: { name: g.name }, geometry: { type: 'Polygon', coordinates: [g.polygon.map(([lat, lng]) => [lng, lat])] } });
        } else if (g.type === 'linear' && g.path && g.path.length >= 2) {
          linearFeatures.push({ type: 'Feature', properties: { name: g.name }, geometry: { type: 'LineString', coordinates: g.path.map(([lat, lng]) => [lng, lat]) } });
        } else if (g.type === 'corridor' && g.path && g.path.length >= 2) {
          corridorFeatures.push({ type: 'Feature', properties: { name: g.name }, geometry: { type: 'LineString', coordinates: g.path.map(([lat, lng]) => [lng, lat]) } });
          if (g.buffer_polygon && g.buffer_polygon.length >= 4) {
            corridorBufferFeatures.push({ type: 'Feature', properties: { name: g.name, buffer_m: g.buffer_m || 0 }, geometry: { type: 'Polygon', coordinates: [g.buffer_polygon.map(([lat, lng]) => [lng, lat])] } });
          } else if (Number.isFinite(Number(g.buffer_m)) && Number(g.buffer_m) > 0) {
            const meanLat = g.path.reduce((sum, point) => sum + point[0], 0) / g.path.length;
            const metresPerPixelAtZoomZero = 156543.03392 * Math.max(0.087, Math.cos(meanLat * Math.PI / 180));
            corridorBufferFeatures.push({
              type: 'Feature',
              properties: { name: g.name, buffer_m: Number(g.buffer_m), buffer_width_zoom_zero: 2 * Number(g.buffer_m) / metresPerPixelAtZoomZero },
              geometry: { type: 'LineString', coordinates: g.path.map(([lat, lng]) => [lng, lat]) },
            });
          }
        } else if (g.lat != null && g.lng != null) {
          circleFeatures.push({ type: 'Feature', properties: { name: g.name }, geometry: { type: 'Polygon', coordinates: [geoCircle(g.lat, g.lng, (g.radius_m || 1000) / 1000)] } });
        }
      });
      const LABEL_FONT = ['Open Sans Regular', 'Arial Unicode MS Regular'];

      m.addSource('gf-zone-src', { type: 'geojson', data: { type: 'FeatureCollection', features: circleFeatures } });
      m.addLayer({ id: 'gf-zone-fill', type: 'fill', source: 'gf-zone-src', paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.08 } });
      m.addLayer({ id: 'gf-zone-line', type: 'line', source: 'gf-zone-src', paint: { 'line-color': '#22d3ee', 'line-width': 1.5, 'line-dasharray': [4, 3] } });
      m.addLayer({ id: 'gf-zone-label', type: 'symbol', source: 'gf-zone-src', layout: {
        'text-field': ['get', 'name'], 'text-size': 10, 'text-anchor': 'center', 'text-font': LABEL_FONT,
        'text-allow-overlap': false, 'text-optional': true,
      }, paint: { 'text-color': '#22d3ee', 'text-halo-color': '#000000', 'text-halo-width': 1.5 } });
      m.addSource('gf-polygon-src', { type: 'geojson', data: { type: 'FeatureCollection', features: polygonFeatures } });
      m.addLayer({ id: 'gf-polygon-fill', type: 'fill', source: 'gf-polygon-src', paint: { 'fill-color': '#a78bfa', 'fill-opacity': 0.14 } });
      m.addLayer({ id: 'gf-polygon-line', type: 'line', source: 'gf-polygon-src', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#c4b5fd', 'line-width': 2.5 } });
      m.addLayer({ id: 'gf-polygon-label', type: 'symbol', source: 'gf-polygon-src', layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-font': LABEL_FONT, 'text-anchor': 'center', 'text-allow-overlap': false, 'text-optional': true }, paint: { 'text-color': '#ddd6fe', 'text-halo-color': '#080b12', 'text-halo-width': 2 } });
      // Corridors get a wide translucent buffer band; linear geofences are a plain route line with no buffer.
      m.addSource('gf-corridor-buffer-src', { type: 'geojson', data: { type: 'FeatureCollection', features: corridorBufferFeatures } });
      m.addLayer({ id: 'gf-corridor-buffer-fill', type: 'fill', source: 'gf-corridor-buffer-src', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#38bdf8', 'fill-opacity': 0.10 } });
      m.addLayer({ id: 'gf-corridor-buffer-line', type: 'line', source: 'gf-corridor-buffer-src', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'line-color': '#7dd3fc', 'line-width': 1.8, 'line-opacity': 0.78 } });
      // For the centreline-distance model, express the metre buffer as a
      // zoom-scaled MapLibre stroke. This keeps the visible band consistent
      // with its persisted operational threshold without inventing a polygon.
      m.addLayer({
        id: 'gf-corridor-buffer-distance',
        type: 'line',
        source: 'gf-corridor-buffer-src',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#38bdf8',
          // The 7 px minimum above is an overview-scale visibility floor, not a change to the saved metre threshold.
          'line-opacity': 0.27,
          // Cap the visual stroke at 512 screen pixels. At very close zooms a
          // kilometre-scale corridor can be wider than the viewport; avoid
          // submitting unbounded line widths to the renderer.
          'line-width': ['max', 7, ['interpolate', ['exponential', 2], ['zoom'], 0, ['get', 'buffer_width_zoom_zero'], 22, ['min', 512, ['*', ['get', 'buffer_width_zoom_zero'], 4194304]]]],
        },
      });
      m.addSource('gf-corridor-src', { type: 'geojson', data: { type: 'FeatureCollection', features: corridorFeatures } });
      m.addLayer({ id: 'gf-corridor-glow', type: 'line', source: 'gf-corridor-src', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#38bdf8', 'line-width': 14, 'line-opacity': 0.15 } });
      m.addLayer({ id: 'gf-corridor-line', type: 'line', source: 'gf-corridor-src', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#38bdf8', 'line-width': 2.5, 'line-dasharray': [3, 2] } });
      // Evidence-backed route signals are a separate visual layer over the unchanged operational centreline.
      // Shadow + broad glow + crisp core create restrained pseudo-3D depth without changing stored geometry.
      m.addSource('gf-corridor-signal-src', { type: 'geojson', data: corridorSignalOverlayRef.current.segments as GeoJSON.FeatureCollection });
      m.addLayer({
        id: 'gf-corridor-signal-shadow', type: 'line', source: 'gf-corridor-signal-src',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#020617', 'line-width': 12, 'line-opacity': 0.72, 'line-translate': [0, 3], 'line-translate-anchor': 'viewport' },
      });
      m.addLayer({
        id: 'gf-corridor-signal-glow', type: 'line', source: 'gf-corridor-signal-src',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'signal_color'], 'line-width': 18, 'line-opacity': 0.28, 'line-blur': 2.2 },
      });
      m.addLayer({
        id: 'gf-corridor-signal-line', type: 'line', source: 'gf-corridor-signal-src',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ['get', 'signal_color'], 'line-width': 5.5, 'line-opacity': 0.98 },
      });
      m.addSource('gf-corridor-signal-points-src', { type: 'geojson', data: corridorSignalOverlayRef.current.markers as GeoJSON.FeatureCollection });
      m.addLayer({
        id: 'gf-corridor-signal-points-glow', type: 'circle', source: 'gf-corridor-signal-points-src',
        paint: { 'circle-radius': 11, 'circle-color': ['get', 'signal_color'], 'circle-opacity': 0.22, 'circle-blur': 0.85 },
      });
      m.addLayer({
        id: 'gf-corridor-signal-points', type: 'circle', source: 'gf-corridor-signal-points-src',
        paint: { 'circle-radius': 5.5, 'circle-color': ['get', 'signal_color'], 'circle-opacity': 0.98, 'circle-stroke-color': '#f8fafc', 'circle-stroke-width': 1.6 },
      });
      m.addLayer({ id: 'gf-corridor-label', type: 'symbol', source: 'gf-corridor-src', layout: {
        'text-field': ['get', 'name'], 'text-size': 10, 'text-font': LABEL_FONT, 'symbol-placement': 'line-center',
        'text-allow-overlap': false, 'text-optional': true,
      }, paint: { 'text-color': '#38bdf8', 'text-halo-color': '#000000', 'text-halo-width': 1.5 } });
      m.addSource('gf-linear-src', { type: 'geojson', data: { type: 'FeatureCollection', features: linearFeatures } });
      m.addLayer({ id: 'gf-linear-line', type: 'line', source: 'gf-linear-src', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#a78bfa', 'line-width': 2.5 } });
      m.addLayer({ id: 'gf-linear-label', type: 'symbol', source: 'gf-linear-src', layout: {
        'text-field': ['get', 'name'], 'text-size': 10, 'text-font': LABEL_FONT, 'symbol-placement': 'line-center',
        'text-allow-overlap': false, 'text-optional': true,
      }, paint: { 'text-color': '#a78bfa', 'text-halo-color': '#000000', 'text-halo-width': 1.5 } });

      const placeVehicle = (vehicle: MapVehicle) => {
        const status = vehicle.status || 'unknown';
        const speed = Number.isFinite(vehicle.speed_kmh) && vehicle.speed_kmh > 0 ? Math.round(vehicle.speed_kmh) + ' km/h' : '';
        const element = createOperationalDeviceMarker({
          kind: 'vehicle',
          identity: vehicle.registration || 'Vehicle',
          state: status,
          detail: speed || status.toUpperCase().replaceAll('_', ' '),
          heading: Number.isFinite(vehicle.heading) ? vehicle.heading : null,
          zoom: m.getZoom(),
          title: [vehicle.registration, status.toUpperCase(), speed].filter(Boolean).join(' · '),
        });
        element.addEventListener('click', event => { event.stopPropagation(); opts.onVehiclePicked(vehicle.id); });
        operationalMarkersRef.current.push(new maplibregl.Marker({ element, anchor: 'left', offset: [-20, 0] }).setLngLat([vehicle.lng, vehicle.lat]).addTo(m));
      };
      const placeDevice = (device: MapDevice) => {
        const state = device.panic_active ? 'sos' : (device.status || 'unknown');
        const detail = device.model || device.assignment_type || 'GPS DEVICE';
        const element = createOperationalDeviceMarker({
          kind: 'tracker',
          identity: device.name || device.model || 'Device',
          state,
          detail,
          zoom: m.getZoom(),
          title: [device.name, device.model, state.toUpperCase(), device.last_seen || 'Last fix unavailable'].filter(Boolean).join(' · '),
        });
        element.addEventListener('click', event => {
          event.stopPropagation();
          new maplibregl.Popup({ closeButton: false, closeOnClick: true, offset: 22 })
            .setLngLat([device.lng, device.lat])
            .setText([device.name, device.model || device.assignment_type || 'GPS device', state.toUpperCase(), device.last_seen ? 'Last seen ' + device.last_seen : 'Last seen unavailable'].join(' · '))
            .addTo(m);
        });
        operationalMarkersRef.current.push(new maplibregl.Marker({ element, anchor: 'left', offset: [-20, 0] }).setLngLat([device.lng, device.lat]).addTo(m));
      };
      opts.visibleVehicles.forEach(placeVehicle);
      opts.devices.forEach(placeDevice);

      const drawFeatures: GeoJSON.Feature[] = [];
      if (opts.drawMode === 'circle' && opts.drawCenter) drawFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [geoCircle(opts.drawCenter[0], opts.drawCenter[1], parseFloat(opts.drawRadiusM || '2000') / 1000)] } });
      else if (opts.drawMode === 'polygon' && opts.drawPath.length >= 3) drawFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...opts.drawPath, opts.drawPath[0]!].map(([lat, lng]) => [lng, lat])] } });
      else if ((opts.drawMode === 'corridor' || opts.drawMode === 'linear' || opts.drawMode === 'polygon') && opts.drawPath.length >= 2) drawFeatures.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: opts.drawPath.map(([lat, lng]) => [lng, lat]) } });
      opts.drawPath.forEach(([lat, lng], index) => drawFeatures.push({ type: 'Feature', properties: { index: index + 1 }, geometry: { type: 'Point', coordinates: [lng, lat] } }));
      m.addSource('gf-draw-src', { type: 'geojson', data: { type: 'FeatureCollection', features: drawFeatures } });
      m.addLayer({ id: 'gf-draw-fill', type: 'fill', source: 'gf-draw-src', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': '#f97316', 'fill-opacity': 0.18 } });
      m.addLayer({ id: 'gf-draw-line', type: 'line', source: 'gf-draw-src', paint: { 'line-color': '#ffb36b', 'line-width': 3, 'line-opacity': 0.95 } });
      m.addLayer({ id: 'gf-draw-vertices', type: 'circle', source: 'gf-draw-src', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-radius': 5, 'circle-color': '#ff8a30', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    };
    renderRef.current = render;
    if (mapReadyRef.current && m.isStyleLoaded()) render();
    return () => { if (renderRef.current === render) renderRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.visibleVehicles, opts.devices, opts.mapGeofences, opts.visibleZones, opts.regionFilter, opts.drawMode, opts.drawCenter, opts.drawPath, opts.drawRadiusM]);

  // Evidence refreshes update just the two dedicated GeoJSON sources. Do not rebuild
  // the vehicles/devices/drawing layers every time a weather or traffic feed polls.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current || !map.isStyleLoaded()) return;
    const segments = map.getSource('gf-corridor-signal-src') as maplibregl.GeoJSONSource | undefined;
    const markers = map.getSource('gf-corridor-signal-points-src') as maplibregl.GeoJSONSource | undefined;
    segments?.setData(opts.corridorSignalOverlay.segments as GeoJSON.FeatureCollection);
    markers?.setData(opts.corridorSignalOverlay.markers as GeoJSON.FeatureCollection);
  }, [opts.corridorSignalOverlay]);

  // A low-frequency pulse supplies depth on the signal overlay without an
  // expensive per-feature animation. Respect reduced-motion accessibility.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)) return;
    let frame = 0;
    let lastUpdate = 0;
    const animate = (time: number) => {
      if (time - lastUpdate >= 84) {
        lastUpdate = time;
        const pulse = (Math.sin(time / 620) + 1) / 2;
        try {
          if (map.getLayer('gf-corridor-signal-glow')) map.setPaintProperty('gf-corridor-signal-glow', 'line-opacity', 0.20 + pulse * 0.20);
          if (map.getLayer('gf-corridor-signal-points-glow')) {
            map.setPaintProperty('gf-corridor-signal-points-glow', 'circle-radius', 8 + pulse * 5);
            map.setPaintProperty('gf-corridor-signal-points-glow', 'circle-opacity', 0.12 + pulse * 0.18);
          }
        } catch { /* style may be swapping while the animation frame runs */ }
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, []);

  return { mapEl, mapRef };
}
