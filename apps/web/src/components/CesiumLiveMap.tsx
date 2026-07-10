/**
 * CesiumLiveMap — 3D globe for the live GPS tracking page.
 */
import React, { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Map, Globe, Layers } from 'lucide-react';

export interface DeviceLocation {
  device_id: string;
  vehicle_id: string | null;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  timestamp: string;
}

export interface RawGeofence {
  id: string;
  name: string;
  type: string;
  coordinates: unknown;
  radius: number | null;
  active: boolean;
}

export interface GuardianDevice {
  id: string;
  name: string;
  status: string;
  panic_active: boolean;
  last_lat: number | null;
  last_lng: number | null;
  last_speed: number | null;
  last_seen: string | null;
}

interface Props {
  locations: DeviceLocation[];
  vehicleMap: Map<string, string>;
  selectedId: string | null;
  onSelect: (deviceId: string) => void;
  onDeselect: () => void;
  geofences?: RawGeofence[];
  guardianDevices?: GuardianDevice[];
}

type MapMode = 'map' | 'satellite' | 'hybrid';

const MAP_URL        = 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
const SAT_URL        = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const REF_PLACES_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const REF_ROADS_URL  = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';

const NEXT_MODE:  Record<MapMode, MapMode>  = { map: 'satellite', satellite: 'hybrid', hybrid: 'map' };
const MODE_LABEL: Record<MapMode, string>   = { map: 'Map', satellite: 'Satellite', hybrid: 'Hybrid' };

const ORANGE        = Cesium.Color.fromCssColorString('#ff9040');
const GREEN         = Cesium.Color.fromCssColorString('#4ade80');
const RED           = Cesium.Color.fromCssColorString('#ef4444');
const WHITE         = Cesium.Color.WHITE;
const GEO_ORANGE    = Cesium.Color.fromCssColorString('#f97316');
const GEO_BLUE      = Cesium.Color.fromCssColorString('#38bdf8');

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

function ModeIcon({ mode }: { mode: MapMode }): React.ReactElement {
  if (mode === 'satellite') return <Globe className="w-3.5 h-3.5" />;
  if (mode === 'hybrid')    return <Layers className="w-3.5 h-3.5" />;
  return <Map className="w-3.5 h-3.5" />;
}

export default function CesiumLiveMap({
  locations,
  vehicleMap,
  selectedId,
  onSelect,
  onDeselect,
  geofences,
  guardianDevices,
}: Props): React.ReactElement {
  const containerRef      = useRef<HTMLDivElement>(null);
  const viewerRef         = useRef<Cesium.Viewer | null>(null);
  const entitiesRef       = useRef<globalThis.Map<string, Cesium.Entity>>(new globalThis.Map());
  const geofenceIdsRef    = useRef<string[]>([]);
  const guardianRef       = useRef<globalThis.Map<string, Cesium.Entity>>(new globalThis.Map());
  const handlerRef        = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const [mapMode, setMapMode]     = useState<MapMode>('map');
  const [initFailed, setInitFailed] = useState(false);

  // ── Init viewer ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    let viewer: Cesium.Viewer | undefined;
    let handler: Cesium.ScreenSpaceEventHandler | undefined;

    try {
      Cesium.Ion.defaultAccessToken =
        (import.meta.env['VITE_CESIUM_ION_TOKEN'] as string | undefined) ?? '';

      const cartoProvider = new Cesium.UrlTemplateImageryProvider({
        url: MAP_URL,
        credit: new Cesium.Credit('© Carto, © OpenStreetMap contributors', false),
        maximumLevel: 19,
      });

      viewer = new Cesium.Viewer(containerRef.current, {
        baseLayer: new Cesium.ImageryLayer(cartoProvider),
        terrainProvider: new Cesium.EllipsoidTerrainProvider(),
        animation: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        navigationHelpButton: false,
        navigationInstructionsInitiallyVisible: false,
        creditContainer: document.createElement('div'),
      });

      viewer.clock.shouldAnimate = true;
      viewerRef.current = viewer;

      handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        const picked = viewer!.scene.pick(click.position);
        if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
          const eid = picked.id.id as string;
          if (!eid.startsWith('geo_') && !eid.startsWith('guardian_')) {
            onSelect(eid);
          }
        } else {
          onDeselect();
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
      handlerRef.current = handler;
    } catch {
      setInitFailed(true);
      return;
    }

    return () => {
      handler?.destroy();
      entitiesRef.current.clear();
      if (viewer && !viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Layer switching ────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.imageryLayers.removeAll();

    if (mapMode === 'map') {
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: MAP_URL,
          credit: new Cesium.Credit('© Carto, © OpenStreetMap contributors', false),
          maximumLevel: 19,
        }),
      );
    } else {
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: SAT_URL,
          credit: new Cesium.Credit('© Esri, Maxar, Earthstar Geographics', false),
          maximumLevel: 23,
        }),
      );
      if (mapMode === 'hybrid') {
        viewer.imageryLayers.addImageryProvider(
          new Cesium.UrlTemplateImageryProvider({
            url: REF_ROADS_URL,
            credit: new Cesium.Credit('© Esri', false),
            maximumLevel: 19,
          }),
        );
      }
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: REF_PLACES_URL,
          credit: new Cesium.Credit('© Esri', false),
          maximumLevel: 19,
        }),
      );
    }
  }, [mapMode]);

  // ── Vehicle device entities ────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const incoming = new Set(locations.map(l => l.device_id));

    for (const [id, entity] of entitiesRef.current) {
      if (!incoming.has(id)) {
        viewer.entities.remove(entity);
        entitiesRef.current.delete(id);
      }
    }

    const needsFly = entitiesRef.current.size === 0 && locations.length > 0;

    for (const loc of locations) {
      const pos = Cesium.Cartesian3.fromDegrees(loc.lng, loc.lat, 0);
      const isSelected = loc.device_id === selectedId;
      const existing = entitiesRef.current.get(loc.device_id);

      const label = loc.vehicle_id
        ? (vehicleMap.get(loc.vehicle_id) ?? loc.device_id.slice(0, 8))
        : loc.device_id.slice(0, 8);

      if (existing) {
        (existing.position as Cesium.ConstantPositionProperty).setValue(pos);
        existing.point = makePoint(isSelected ? GREEN : ORANGE, isSelected ? 16 : 11);
        if (existing.label) {
          (existing.label.text as Cesium.ConstantProperty).setValue(label);
        }
      } else {
        const entity = viewer.entities.add({
          id: loc.device_id,
          position: pos,
          point: makePoint(isSelected ? GREEN : ORANGE, isSelected ? 16 : 11),
          label: new Cesium.LabelGraphics({
            text: label,
            font: '11px sans-serif',
            fillColor: WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -20),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            showBackground: true,
            backgroundColor: Cesium.Color.fromCssColorString('#1a1a2e').withAlpha(0.8),
            backgroundPadding: new Cesium.Cartesian2(5, 3),
          }),
        });
        entitiesRef.current.set(loc.device_id, entity);
      }
    }

    if (needsFly && entitiesRef.current.size > 0) {
      void viewer.flyTo(viewer.entities, {
        duration: 1.5,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), 0),
      });
    }
  }, [locations, selectedId, vehicleMap]);

  // ── Geofence overlay ───────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    for (const id of geofenceIdsRef.current) {
      const e = viewer.entities.getById(id);
      if (e) viewer.entities.remove(e);
    }
    geofenceIdsRef.current = [];

    if (!geofences || geofences.length === 0) return;

    for (const geo of geofences) {
      if (!geo.active) continue;
      const entityId = `geo_${geo.id}`;

      if (geo.type === 'circle' && geo.radius != null) {
        const coords = geo.coordinates as { lat?: number; lng?: number };
        if (typeof coords?.lat !== 'number' || typeof coords?.lng !== 'number') continue;
        viewer.entities.add({
          id: entityId,
          position: Cesium.Cartesian3.fromDegrees(coords.lng, coords.lat),
          ellipse: new Cesium.EllipseGraphics({
            semiMajorAxis: geo.radius,
            semiMinorAxis: geo.radius,
            material: new Cesium.ColorMaterialProperty(GEO_ORANGE.withAlpha(0.18)),
            outline: true,
            outlineColor: GEO_ORANGE.withAlpha(0.85),
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          }),
          label: new Cesium.LabelGraphics({
            text: geo.name,
            font: '10px sans-serif',
            fillColor: GEO_ORANGE,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }),
        });
        geofenceIdsRef.current.push(entityId);
      } else if (geo.type === 'corridor' || geo.type === 'linear') {
        const coords = geo.coordinates as { path?: [number, number][]; buffer_m?: number };
        if (!Array.isArray(coords?.path) || coords.path.length < 2) continue;
        const positions = coords.path.map(([lat, lng]) =>
          Cesium.Cartesian3.fromDegrees(lng ?? 0, lat ?? 0, 0),
        );
        const mid = positions[Math.floor(positions.length / 2)]!;
        const bufferM = typeof coords.buffer_m === 'number' ? coords.buffer_m : 300;
        viewer.entities.add({
          id: entityId,
          position: mid,
          corridor: new Cesium.CorridorGraphics({
            positions,
            width: bufferM * 2,
            material: new Cesium.ColorMaterialProperty(GEO_BLUE.withAlpha(0.18)),
            outline: true,
            outlineColor: GEO_BLUE.withAlpha(0.85),
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          }),
          label: new Cesium.LabelGraphics({
            text: geo.name,
            font: '10px sans-serif',
            fillColor: GEO_BLUE,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }),
        });
        geofenceIdsRef.current.push(entityId);
      } else if (geo.type === 'polygon') {
        const pts = geo.coordinates as [number, number][];
        if (!Array.isArray(pts) || pts.length < 3) continue;
        const positions = pts.map(([lat, lng]) => Cesium.Cartesian3.fromDegrees(lng ?? 0, lat ?? 0, 0));
        viewer.entities.add({
          id: entityId,
          polygon: new Cesium.PolygonGraphics({
            hierarchy: new Cesium.PolygonHierarchy(positions),
            material: new Cesium.ColorMaterialProperty(GEO_ORANGE.withAlpha(0.18)),
            outline: true,
            outlineColor: GEO_ORANGE.withAlpha(0.85),
            heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          }),
        });
        geofenceIdsRef.current.push(entityId);
      }
    }
  }, [geofences]);

  // ── Guardian device entities ───────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    for (const [, entity] of guardianRef.current) {
      viewer.entities.remove(entity);
    }
    guardianRef.current.clear();

    const devices = guardianDevices ?? [];
    for (const device of devices) {
      if (device.last_lat == null || device.last_lng == null) continue;
      const pos = Cesium.Cartesian3.fromDegrees(device.last_lng, device.last_lat, 0);
      const color = device.panic_active ? RED : GREEN;
      const labelText = device.panic_active ? `⚠ ${device.name}` : device.name;
      const entity = viewer.entities.add({
        id: `guardian_${device.id}`,
        position: pos,
        point: makePoint(color, 13),
        label: new Cesium.LabelGraphics({
          text: labelText,
          font: '11px sans-serif',
          fillColor: color,
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -20),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#1a1a2e').withAlpha(0.8),
          backgroundPadding: new Cesium.Cartesian2(5, 3),
        }),
      });
      guardianRef.current.set(device.id, entity);
    }
  }, [guardianDevices]);

  if (initFailed) {
    return (
      <div className="flex items-center justify-center w-full h-full bg-gray-950 text-gray-500 text-sm">
        3D map unavailable
      </div>
    );
  }

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <button
        onClick={() => setMapMode(m => NEXT_MODE[m])}
        className="absolute bottom-4 left-4 z-10 flex items-center gap-1.5 bg-gray-900/90 hover:bg-gray-800 text-white text-xs font-medium px-3 py-2 rounded-lg border border-gray-700 shadow-lg transition-colors"
        title={`Switch to ${MODE_LABEL[NEXT_MODE[mapMode]]}`}
      >
        <ModeIcon mode={mapMode} />
        {MODE_LABEL[mapMode]}
      </button>
    </div>
  );
}
