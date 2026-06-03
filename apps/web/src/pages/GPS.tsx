import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useQuery } from '@tanstack/react-query';
import MapGL, { Layer, Marker, NavigationControl, Popup, Source } from 'react-map-gl/maplibre';
import { MapPin, Radio, Clock, Loader2, Shield } from 'lucide-react';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';
import { normalizeList } from '../lib/normalize.js';
import type { Vehicle } from '@sonalit/contracts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DeviceLocation = {
  device_id: string;
  vehicle_id: string | null;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  timestamp: string;
};

type GpsEvent = {
  device_id: string;
  vehicle_id?: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
  timestamp: string;
};

type PopupInfo = DeviceLocation & { registration: string | null };

type RawGeofence = {
  id: string;
  name: string;
  type: string;
  coordinates: unknown;
  radius: number | null;
  active: boolean;
};

type GuardianDevice = {
  id: string;
  name: string;
  status: string;
  panic_active: boolean;
  last_lat: number | null;
  last_lng: number | null;
  last_speed: number | null;
  last_seen: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

function formatSpeed(speed: number | null): string {
  if (speed === null) return '—';
  return `${(speed * 3.6).toFixed(1)} km/h`;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** Convert degrees to radians */
const toRad = (d: number) => (d * Math.PI) / 180;

/** Approximate a circle as a 64-point GeoJSON Polygon */
function circlePolygon(lat: number, lng: number, radiusM: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const N = 64;
  const coords: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const angle = (i / N) * 2 * Math.PI;
    const dLat = (radiusM / 111_320) * Math.cos(angle);
    const dLng = (radiusM / (111_320 * Math.cos(toRad(lat)))) * Math.sin(angle);
    coords.push([lng + dLng, lat + dLat]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [coords] } };
}

/** Convert a corridor path [[lat,lng],...] to a GeoJSON LineString */
function corridorLine(path: number[][]): GeoJSON.Feature<GeoJSON.LineString> {
  const coordinates: [number, number][] = path.map((p) => [p[1] as number, p[0] as number]);
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } };
}

/** Build two GeoJSON FeatureCollections: one for circle/polygon fills, one for corridor lines */
function buildGeofenceLayers(geofences: RawGeofence[]): {
  fills: GeoJSON.FeatureCollection;
  lines: GeoJSON.FeatureCollection;
} {
  const fillFeatures: GeoJSON.Feature[] = [];
  const lineFeatures: GeoJSON.Feature[] = [];

  for (const g of geofences) {
    if (!g.active) continue;
    let coords: Record<string, unknown> = {};
    try {
      coords = (typeof g.coordinates === 'string'
        ? JSON.parse(g.coordinates)
        : g.coordinates) as Record<string, unknown>;
    } catch {
      // skip unparseable
    }

    if (g.type === 'corridor') {
      const path = coords['path'];
      if (Array.isArray(path) && path.length >= 2) {
        lineFeatures.push(corridorLine(path as number[][]));
      }
    } else if (g.type === 'circle') {
      const lat = (coords['lat'] ?? (coords['center'] as Record<string, unknown>)?.['lat']) as number | undefined;
      const lng = (coords['lng'] ?? (coords['center'] as Record<string, unknown>)?.['lng']) as number | undefined;
      const radius = g.radius ?? (coords['radius'] as number | undefined) ?? 1000;
      if (lat != null && lng != null) {
        fillFeatures.push(circlePolygon(lat, lng, radius));
      }
    } else if (Array.isArray(coords) && (coords as unknown[]).length >= 3) {
      // Polygon: coordinates is [[lng,lat],...]
      const ring = coords as [number, number][];
      const closed: [number, number][] = [...ring, ring[0] as [number, number]];
      fillFeatures.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates: [closed] },
      });
    }
  }

  return {
    fills: { type: 'FeatureCollection', features: fillFeatures },
    lines: { type: 'FeatureCollection', features: lineFeatures },
  };
}

// ---------------------------------------------------------------------------
// Device panel row
// ---------------------------------------------------------------------------

function DevicePanelRow({
  loc,
  registration,
  isSelected,
  onClick,
}: {
  loc: DeviceLocation;
  registration: string | null;
  isSelected: boolean;
  onClick: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-800 hover:bg-gray-800/60 transition-colors ${
        isSelected ? 'bg-indigo-900/30 border-l-2 border-l-indigo-500' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-indigo-400 flex-shrink-0" />
          <span className="text-white text-sm font-medium">
            {registration ?? loc.device_id.slice(0, 8)}
          </span>
        </div>
        <div className="flex items-center gap-1 text-gray-400 text-xs">
          <Clock className="w-3 h-3" />
          {formatTime(loc.timestamp)}
        </div>
      </div>
      <p className="text-gray-400 text-xs mt-0.5 pl-5">
        {loc.lat.toFixed(5)}, {loc.lng.toFixed(5)} &middot; {formatSpeed(loc.speed)}
      </p>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function GPS(): React.ReactElement {
  const user = useAuthStore((s) => s.user);
  const orgId = user?.org_id ?? '';

  const [locations, setLocations] = useState<Map<string, DeviceLocation>>(new Map());
  const [popup, setPopup] = useState<PopupInfo | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const locationsRef = useRef(locations);
  locationsRef.current = locations;

  // Vehicles (for registration label lookup)
  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles', 'gps-map'],
    queryFn: async () => {
      const res = await api.get('/vehicles', { params: { limit: 200 } });
      return normalizeList<Vehicle>(res.data);
    },
    enabled: !!orgId,
  });

  // Geofences
  const { data: geofencesData } = useQuery<RawGeofence[]>({
    queryKey: ['geofences', 'gps-overlay'],
    queryFn: async () => {
      const res = await api.get('/geofences');
      return normalizeList<RawGeofence>(res.data).data;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });

  // Guardian devices (for map pins)
  const { data: guardianData } = useQuery<GuardianDevice[]>({
    queryKey: ['guardian', 'devices', 'gps-map'],
    queryFn: async () => {
      const res = await api.get('/guardian/devices', { params: { limit: 200 } });
      return normalizeList<GuardianDevice>(res.data).data;
    },
    enabled: !!orgId,
    refetchInterval: 30_000,
  });

  const vehicleMap = useMemo(
    () => new Map<string, string>(vehiclesData?.data.map((v) => [v.id, v.registration]) ?? []),
    [vehiclesData],
  );

  // Initial GPS track
  const { isLoading, isError } = useQuery<DeviceLocation[]>({
    queryKey: ['gps', 'track', 'initial'],
    queryFn: async () => {
      const res = await api.get<DeviceLocation[]>('/gps/track');
      const next = new Map<string, DeviceLocation>();
      for (const loc of res.data) next.set(loc.device_id, loc);
      setLocations(next);
      return res.data;
    },
    enabled: !!orgId,
    staleTime: 0,
  });

  // Live GPS updates via Centrifuge
  useEffect(() => {
    if (!orgId) return;
    return subscribe<GpsEvent>(`org#${orgId}`, (event) => {
      if (!event.device_id) return;
      setLocations((prev) => {
        const next = new Map(prev);
        const existing = prev.get(event.device_id);
        next.set(event.device_id, {
          device_id: event.device_id,
          vehicle_id: event.vehicle_id ?? existing?.vehicle_id ?? null,
          lat: event.lat,
          lng: event.lng,
          speed: event.speed,
          heading: event.heading,
          timestamp: event.timestamp,
        });
        return next;
      });
    });
  }, [orgId]);

  const handleMarkerClick = useCallback(
    (loc: DeviceLocation): void => {
      const registration = loc.vehicle_id ? (vehicleMap.get(loc.vehicle_id) ?? null) : null;
      setPopup({ ...loc, registration });
      setSelectedDeviceId(loc.device_id);
    },
    [vehicleMap],
  );

  // Build geofence GeoJSON layers
  const geofenceLayers = useMemo(
    () => buildGeofenceLayers(geofencesData ?? []),
    [geofencesData],
  );

  const guardianDevicesWithLocation = useMemo(
    () => (guardianData ?? []).filter((d) => d.last_lat != null && d.last_lng != null),
    [guardianData],
  );

  const locationsList = Array.from(locations.values());
  const firstLoc = locationsList[0];
  const initialViewState = firstLoc
    ? { longitude: firstLoc.lng, latitude: firstLoc.lat, zoom: 10 }
    : { longitude: 36.817, latitude: -1.286, zoom: 5 };

  return (
    <div className="flex flex-col md:flex-row h-[calc(100dvh-3.5rem)] overflow-hidden -m-4 md:-m-6">
      {/* Map */}
      <div className="flex-1 relative">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-gray-950/80">
            <div className="flex items-center gap-2 text-gray-300">
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading GPS data…
            </div>
          </div>
        )}
        {isError && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-red-900/90 text-red-200 text-sm px-4 py-2 rounded-lg">
            Failed to load GPS tracks
          </div>
        )}

        <MapGL
          initialViewState={initialViewState}
          mapStyle={MAP_STYLE}
          style={{ width: '100%', height: '100%' }}
        >
          <NavigationControl position="top-right" />

          {/* Geofence fills (circles + polygons) */}
          <Source id="geofence-fills" type="geojson" data={geofenceLayers.fills}>
            <Layer
              id="geofence-fills-fill"
              type="fill"
              paint={{ 'fill-color': '#06b6d4', 'fill-opacity': 0.12 }}
            />
            <Layer
              id="geofence-fills-outline"
              type="line"
              paint={{ 'line-color': '#06b6d4', 'line-width': 1.5, 'line-dasharray': [4, 3] }}
            />
          </Source>

          {/* Corridor lines */}
          <Source id="geofence-corridors" type="geojson" data={geofenceLayers.lines}>
            <Layer
              id="geofence-corridors-casing"
              type="line"
              paint={{ 'line-color': '#06b6d4', 'line-width': 8, 'line-opacity': 0.15 }}
            />
            <Layer
              id="geofence-corridors-line"
              type="line"
              paint={{ 'line-color': '#06b6d4', 'line-width': 2, 'line-dasharray': [6, 3] }}
            />
          </Source>

          {/* Vehicle GPS markers */}
          {locationsList.map((loc) => (
            <Marker
              key={loc.device_id}
              longitude={loc.lng}
              latitude={loc.lat}
              anchor="center"
              onClick={() => handleMarkerClick(loc)}
            >
              <div
                className="w-4 h-4 rounded-full bg-indigo-500 border-2 border-white shadow-lg cursor-pointer hover:scale-125 transition-transform"
                title={vehicleMap.get(loc.vehicle_id ?? '') ?? loc.device_id}
              />
            </Marker>
          ))}

          {/* Guardian device markers */}
          {guardianDevicesWithLocation.map((d) => (
            <Marker
              key={`guardian-${d.id}`}
              longitude={d.last_lng!}
              latitude={d.last_lat!}
              anchor="center"
            >
              <div
                className={`w-5 h-5 rounded-full border-2 border-white shadow-lg flex items-center justify-center cursor-pointer hover:scale-125 transition-transform ${
                  d.panic_active ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'
                }`}
                title={`Guardian: ${d.name}`}
              >
                <Shield className="w-2.5 h-2.5 text-white" />
              </div>
            </Marker>
          ))}

          {popup && (
            <Popup
              longitude={popup.lng}
              latitude={popup.lat}
              anchor="bottom"
              onClose={() => setPopup(null)}
              closeOnClick={false}
            >
              <div className="text-gray-900 text-sm min-w-40 p-1">
                <p className="font-bold">{popup.registration ?? popup.device_id.slice(0, 12)}</p>
                <p className="text-xs text-gray-600 mt-0.5 font-mono">{popup.device_id}</p>
                <div className="mt-2 space-y-0.5 text-xs">
                  <p>Lat: {popup.lat.toFixed(6)}</p>
                  <p>Lon: {popup.lng.toFixed(6)}</p>
                  <p>Speed: {formatSpeed(popup.speed)}</p>
                  <p>Updated: {formatTime(popup.timestamp)}</p>
                </div>
              </div>
            </Popup>
          )}
        </MapGL>
      </div>

      {/* Control panel */}
      <aside className="w-full md:w-72 h-64 md:h-auto bg-gray-900 border-t md:border-t-0 md:border-l border-gray-800 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
          <Radio className="w-4 h-4 text-indigo-400" />
          <h2 className="text-white font-semibold text-sm">Live Devices</h2>
          <span className="ml-auto text-xs text-gray-400 bg-gray-800 px-2 py-0.5 rounded-full">
            {locationsList.length}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {locationsList.length === 0 && !isLoading && (
            <p className="text-gray-500 text-sm text-center py-8">No active devices</p>
          )}
          {locationsList.map((loc) => (
            <DevicePanelRow
              key={loc.device_id}
              loc={loc}
              registration={loc.vehicle_id ? (vehicleMap.get(loc.vehicle_id) ?? null) : null}
              isSelected={selectedDeviceId === loc.device_id}
              onClick={() => handleMarkerClick(loc)}
            />
          ))}
          {guardianDevicesWithLocation.length > 0 && (
            <>
              <div className="px-4 py-2 border-b border-gray-800 bg-gray-900/60">
                <span className="text-xs text-emerald-400 font-semibold uppercase tracking-wide flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Guardian Devices ({guardianDevicesWithLocation.length})
                </span>
              </div>
              {guardianDevicesWithLocation.map((d) => (
                <div key={d.id} className="px-4 py-3 border-b border-gray-800">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Shield className={`w-3.5 h-3.5 flex-shrink-0 ${d.panic_active ? 'text-red-400' : 'text-emerald-400'}`} />
                      <span className="text-white text-sm font-medium truncate max-w-[140px]">{d.name}</span>
                    </div>
                    {d.panic_active && (
                      <span className="text-xs text-red-400 font-bold animate-pulse">PANIC</span>
                    )}
                  </div>
                  <p className="text-gray-400 text-xs mt-0.5 pl-5">
                    {d.last_lat!.toFixed(5)}, {d.last_lng!.toFixed(5)}
                    {d.last_seen ? ` · ${formatTime(d.last_seen)}` : ''}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
