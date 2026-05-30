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

interface Props {
  locations: DeviceLocation[];
  vehicleMap: Map<string, string>;
  selectedId: string | null;
  onSelect: (deviceId: string) => void;
  onDeselect: () => void;
}

type MapMode = 'map' | 'satellite' | 'hybrid';

// Carto Dark Matter — global coverage (no missing tiles), already in CSP
const MAP_URL         = 'https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
const SAT_URL         = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
// Always applied over satellite — borders, country names, city labels
const REF_PLACES_URL  = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
// Extra detail layer added only in hybrid mode
const REF_ROADS_URL   = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}';

const NEXT_MODE: Record<MapMode, MapMode> = { map: 'satellite', satellite: 'hybrid', hybrid: 'map' };
const MODE_LABEL: Record<MapMode, string> = { map: 'Map', satellite: 'Satellite', hybrid: 'Hybrid' };

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
}: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef    = useRef<Cesium.Viewer | null>(null);
  const entitiesRef  = useRef<globalThis.Map<string, Cesium.Entity>>(new globalThis.Map());
  const handlerRef   = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const [mapMode, setMapMode] = useState<MapMode>('map');

  // ── Init viewer ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    Cesium.Ion.defaultAccessToken =
      (import.meta.env['VITE_CESIUM_ION_TOKEN'] as string | undefined) ?? '';

    const cartoProvider = new Cesium.UrlTemplateImageryProvider({
      url: MAP_URL,
      credit: new Cesium.Credit('© Carto, © OpenStreetMap contributors', false),
      maximumLevel: 19,
    });

    const viewer = new Cesium.Viewer(containerRef.current, {
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

    // Click handler — identify entity or deselect
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const picked = viewer.scene.pick(click.position);
      if (Cesium.defined(picked) && picked.id instanceof Cesium.Entity) {
        onSelect(picked.id.id as string);
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

  // ── Layer switching ────────────────────────────────────────────────────────
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || viewer.isDestroyed()) return;

    viewer.imageryLayers.removeAll();

    if (mapMode === 'map') {
      // Carto Dark Matter — global coverage, no missing-tile gaps
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: MAP_URL,
          credit: new Cesium.Credit('© Carto, © OpenStreetMap contributors', false),
          maximumLevel: 19,
        }),
      );
    } else {
      // Satellite base at max resolution
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: SAT_URL,
          credit: new Cesium.Credit('© Esri, Maxar, Earthstar Geographics', false),
          maximumLevel: 23,
        }),
      );
      // Hybrid: add road network under the labels
      if (mapMode === 'hybrid') {
        viewer.imageryLayers.addImageryProvider(
          new Cesium.UrlTemplateImageryProvider({
            url: REF_ROADS_URL,
            credit: new Cesium.Credit('© Esri', false),
            maximumLevel: 19,
          }),
        );
      }
      // Always: borders, country/city labels on top of satellite
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: REF_PLACES_URL,
          credit: new Cesium.Credit('© Esri', false),
          maximumLevel: 19,
        }),
      );
    }
  }, [mapMode]);

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

    // Fly to fit all devices on first render
    if (needsFly && entitiesRef.current.size > 0) {
      void viewer.flyTo(viewer.entities, {
        duration: 1.5,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-50), 0),
      });
    }
  }, [locations, selectedId, vehicleMap]);

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
