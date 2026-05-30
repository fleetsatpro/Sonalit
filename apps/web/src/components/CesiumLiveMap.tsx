/**
 * CesiumLiveMap — 3D globe for the live GPS tracking page.
 *
 * Props:
 *   locations      — current snapshot of all device positions
 *   vehicleMap     — vehicle_id → registration lookup
 *   selectedId     — currently selected device_id (highlighted)
 *   onSelect       — called with device_id when user clicks a device
 *   onDeselect     — called when the user clicks empty space
 */
import React, { useEffect, useRef, useState } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Layers } from 'lucide-react';

export interface DeviceLocation {
  device_id: string;
  vehicle_id: string | null;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  timestamp: string;
}

interface Props {
  locations: DeviceLocation[];
  vehicleMap: Map<string, string>;
  selectedId: string | null;
  onSelect: (deviceId: string) => void;
  onDeselect: () => void;
}

const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const SAT_URL = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';

const ORANGE = Cesium.Color.fromCssColorString('#ff9040');
const GREEN  = Cesium.Color.fromCssColorString('#4ade80');
const WHITE  = Cesium.Color.WHITE;

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

export default function CesiumLiveMap({
  locations,
  vehicleMap,
  selectedId,
  onSelect,
  onDeselect,
}: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef    = useRef<Cesium.Viewer | null>(null);
  const entitiesRef  = useRef<Map<string, Cesium.Entity>>(new Map());
  const handlerRef   = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const [isSatellite, setIsSatellite] = useState(false);

  // ── Init viewer ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    Cesium.Ion.defaultAccessToken =
      (import.meta.env['VITE_CESIUM_ION_TOKEN'] as string | undefined) ?? '';

    const osmProvider = new Cesium.UrlTemplateImageryProvider({
      url: OSM_URL,
      credit: new Cesium.Credit('© OpenStreetMap contributors', false),
      maximumLevel: 19,
    });

    const viewer = new Cesium.Viewer(containerRef.current, {
      baseLayer: new Cesium.ImageryLayer(osmProvider),
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

    // Click handler — identify entity or deselect
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(click.position);
      if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
        const id = picked.id.id as string;
        onSelect(id);
      } else {
        onDeselect();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    handlerRef.current = handler;

    return () => {
      handler.destroy();
      entitiesRef.current.clear();
      if (!viewer.isDestroyed()) viewer.destroy();
      viewerRef.current = null;
    };
    // onSelect/onDeselect are stable callbacks — intentionally not in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Satellite toggle ────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const url = isSatellite ? SAT_URL : OSM_URL;
    const credit = isSatellite
      ? new Cesium.Credit('© Esri, DigitalGlobe', false)
      : new Cesium.Credit('© OpenStreetMap contributors', false);

    viewer.imageryLayers.removeAll();
    viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({ url, credit, maximumLevel: 19 }),
    );
  }, [isSatellite]);

  // ── Sync entities with locations ────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    const incoming = new Set(locations.map(l => l.device_id));

    // Remove stale entities
    for (const [id, entity] of entitiesRef.current) {
      if (!incoming.has(id)) {
        viewer.entities.remove(entity);
        entitiesRef.current.delete(id);
      }
    }

    let needsFly = entitiesRef.current.size === 0 && locations.length > 0;

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

    // Fly to fit all devices on first render
    if (needsFly && entitiesRef.current.size > 0) {
      void viewer.flyTo(viewer.entities, {
        duration: 1.5,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), 0),
      });
    }
  }, [locations, selectedId]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <button
        onClick={() => setIsSatellite(v => !v)}
        className="absolute bottom-4 left-4 z-10 flex items-center gap-1.5 bg-gray-900/90 hover:bg-gray-800 text-white text-xs font-medium px-3 py-2 rounded-lg border border-gray-700 shadow-lg transition-colors"
      >
        <Layers className="w-3.5 h-3.5" />
        {isSatellite ? 'Dark' : 'Satellite'}
      </button>
    </div>
  );
}
