import { useMemo } from 'react';
import { Gauge, ShieldAlert } from 'lucide-react';
import { distanceToPolylineKm } from '../../lib/geoMath.js';
import type { MapGeofence, MapVehicle, GeofenceEvent } from './types.js';

// Every number here is derived from real vehicle positions/speeds and real
// geofence_events for this corridor — no random per-render traffic segments.
export default function CorridorStats({
  corridor, vehicles, events, onEscalate, escalating,
}: {
  corridor: MapGeofence;
  vehicles: MapVehicle[];
  events: GeofenceEvent[];
  onEscalate: (vehicleIds: string[]) => void;
  escalating: boolean;
}) {
  const bufferKm = (corridor.buffer_m ?? 2000) / 1000;

  const nearbyVehicles = useMemo(() => {
    if (!corridor.path || corridor.path.length < 2) return [];
    return vehicles.filter(v => distanceToPolylineKm(v.lat, v.lng, corridor.path!) <= bufferKm);
  }, [vehicles, corridor.path, bufferKm]);

  const avgSpeed = nearbyVehicles.length
    ? nearbyVehicles.reduce((s, v) => s + v.speed_kmh, 0) / nearbyVehicles.length
    : null;

  const trafficLevel = avgSpeed == null ? null
    : avgSpeed >= 70 ? 'Free flowing' : avgSpeed >= 45 ? 'Light' : avgSpeed >= 25 ? 'Moderate' : avgSpeed > 0 ? 'Heavy' : 'Stopped';

  const recentEvents = useMemo(() => {
    const dayMs = 24 * 60 * 60 * 1000;
    return events.filter(e => e.geofence_id === corridor.id && Date.now() - new Date(e.created_at).getTime() <= dayMs);
  }, [events, corridor.id]);

  const health = Math.max(0, 100 - recentEvents.length * 12);
  const healthColor = health >= 70 ? 'text-green-400' : health >= 40 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="bg-gray-900/60 rounded-lg p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Nearby Vehicles" value={String(nearbyVehicles.length)} />
        <Stat label="Avg Speed" value={avgSpeed != null ? `${Math.round(avgSpeed)} km/h` : '—'} />
        <Stat label="Traffic (real, from GPS)" value={trafficLevel ?? '—'} />
        <Stat label="Health (24h events)" value={`${health}%`} valueClassName={healthColor} />
      </div>
      <button
        onClick={() => onEscalate(nearbyVehicles.map(v => v.id))}
        disabled={nearbyVehicles.length === 0 || escalating}
        className="w-full flex items-center justify-center gap-2 text-xs font-bold bg-red-900/40 border border-red-700 text-red-300 disabled:opacity-40 py-2 rounded"
      >
        <ShieldAlert size={13} /> {escalating ? 'Escalating…' : nearbyVehicles.length === 0 ? 'No vehicles on corridor to escalate' : `Escalate (${nearbyVehicles.length} vehicle${nearbyVehicles.length === 1 ? '' : 's'})`}
      </button>
    </div>
  );
}

function Stat({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div>
      <div className="text-gray-500 font-semibold flex items-center gap-1"><Gauge size={10} /> {label}</div>
      <div className={`font-bold ${valueClassName ?? 'text-white'}`}>{value}</div>
    </div>
  );
}
