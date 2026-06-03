import React, { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense, Component } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Radio, Clock, Loader2, Shield } from 'lucide-react';
import { api } from '../lib/api.js';
import { subscribe } from '../lib/centrifuge.js';
import { useAuthStore } from '../stores/auth.js';
import { normalizeList } from '../lib/normalize.js';
import type { Vehicle } from '@sonalit/contracts';

const CesiumLiveMap = lazy(() => import('../components/CesiumLiveMap.js'));

class MapErrorBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
  override render() {
    if (this.state.failed) {
      return (
        <div className="flex items-center justify-center w-full h-full bg-gray-950 text-gray-500 text-sm">
          3D map unavailable
        </div>
      );
    }
    return this.props.children;
  }
}

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

export type RawGeofence = {
  id: string;
  name: string;
  type: string;
  coordinates: unknown;
  radius: number | null;
  active: boolean;
};

export type GuardianDevice = {
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
        isSelected ? 'bg-orange-900/20 border-l-2 border-l-orange-500' : ''
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MapPin className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
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

  // Geofences overlay
  const { data: geofencesData } = useQuery<RawGeofence[]>({
    queryKey: ['geofences', 'gps-overlay'],
    queryFn: async () => {
      const res = await api.get('/geofences');
      return normalizeList<RawGeofence>(res.data).data;
    },
    enabled: !!orgId,
    staleTime: 60_000,
  });

  // Guardian devices
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

  const handleSelect = useCallback((deviceId: string) => {
    setSelectedDeviceId(deviceId);
  }, []);

  const handleDeselect = useCallback(() => {
    setSelectedDeviceId(null);
  }, []);

  const guardianDevicesWithLocation = useMemo(
    () => (guardianData ?? []).filter((d) => d.last_lat != null && d.last_lng != null),
    [guardianData],
  );

  const locationsList = Array.from(locations.values());

  return (
    <div className="flex flex-col md:flex-row h-[calc(100dvh-3.5rem)] overflow-hidden -m-4 md:-m-6">
      {/* 3D Map — CesiumJS globe */}
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
        <MapErrorBoundary>
          <Suspense
            fallback={
              <div className="flex items-center justify-center w-full h-full bg-gray-950 text-gray-500 text-sm gap-2">
                <Loader2 className="w-5 h-5 animate-spin" /> Loading 3D map…
              </div>
            }
          >
            <CesiumLiveMap
              locations={locationsList}
              vehicleMap={vehicleMap}
              selectedId={selectedDeviceId}
              onSelect={handleSelect}
              onDeselect={handleDeselect}
              geofences={geofencesData ?? []}
              guardianDevices={guardianDevicesWithLocation}
            />
          </Suspense>
        </MapErrorBoundary>
      </div>

      {/* Control panel */}
      <aside className="w-full md:w-72 h-64 md:h-auto bg-gray-900 border-t md:border-t-0 md:border-l border-gray-800 flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
          <Radio className="w-4 h-4 text-orange-400" />
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
              onClick={() => handleSelect(loc.device_id)}
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
