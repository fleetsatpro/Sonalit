import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import MapGL, { Marker, NavigationControl, Popup } from 'react-map-gl/maplibre';
import { MapPin, Radio, Clock, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';
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

type VehicleListResponse = {
  data: Vehicle[];
  meta: { total: number; has_more: boolean; next_cursor: string | null };
};

type PopupInfo = DeviceLocation & { registration: string | null };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function formatSpeed(speed: number | null): string {
  if (speed === null) return '—';
  return `${(speed * 3.6).toFixed(1)} km/h`;
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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
  // Keep stable ref for subscription callback
  const locationsRef = useRef(locations);
  locationsRef.current = locations;

  const { data: vehiclesData } = useQuery<VehicleListResponse>({
    queryKey: ['vehicles', 'gps-map'],
    queryFn: async () => {
      const res = await api.get<VehicleListResponse>('/vehicles', { params: { limit: 200 } });
      return res.data;
    },
    enabled: !!orgId,
  });

  const vehicleMap = new Map<string, string>(
    vehiclesData?.data.map((v) => [v.id, v.registration]) ?? [],
  );

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
    // vehicleMap is rebuilt each render; deps are the underlying sources
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [vehiclesData],
  );

  const locationsList = Array.from(locations.values());
  const firstLoc = locationsList[0];
  const initialViewState = firstLoc
    ? { longitude: firstLoc.lng, latitude: firstLoc.lat, zoom: 10 }
    : { longitude: 3.389, latitude: 6.449, zoom: 5 };

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
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
                title={loc.device_id}
              />
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
      <aside className="w-72 bg-gray-900 border-l border-gray-800 flex flex-col overflow-hidden">
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
        </div>
      </aside>
    </div>
  );
}
