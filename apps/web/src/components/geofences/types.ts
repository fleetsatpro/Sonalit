// /dashboard/map — normalized geometry for rendering (real GPS + Guardian telemetry)
export interface MapVehicle { id: string; registration: string; status: string; lat: number; lng: number; heading: number; speed_kmh: number }
export interface MapDevice { id: string; name: string; model?: string; assignment_type?: string; lat: number; lng: number; speed_kmh: number; status: string; panic_active: boolean; last_seen: string | null }
export interface MapGeofence { id: string; name: string; type: string; lat: number | null; lng: number | null; radius_m: number; path?: [number, number][] | null; buffer_m?: number | null }
export interface MapData { vehicles: MapVehicle[]; devices: MapDevice[]; geofences: MapGeofence[] }

// /geofences — full CRUD record
export interface Geofence { id: string; name: string; type: string; active: boolean; region: string | null; lat: number | null; lng: number | null; radius: number | null; created_at: string }
// /geofences/events
export interface GeofenceEvent { id: string; event_type: string; geofence_id: string; geofence_name: string | null; convoy_id: string | null; vehicle_id: string | null; created_at: string }
// /geofences/:id/actions
export interface GeofenceAction { id: string; action_type: string; recipient: string | null; message_template: string | null; enabled: boolean }
// /vehicles — CRUD metadata (region, driver, type)
export interface VehicleMeta { id: string; registration: string; type: string; region: string; status: string; driver_name: string | null }
// /dashboard/vehicles — live telemetry
export interface VehicleTelemetry { id: string; registration: string; status: string; speed_kmh: number; fuel_pct: number | null; engine_temp_c: number | null; gps_signal_pct: number | null; last_ping_at: string | null }
// /alerts
export interface AlertRow { id: string; type: string; severity: string; message: string; vehicle_id: string | null; vehicle_reg: string | null; region: string | null; convoy_name: string | null; acknowledged_at: string | null; resolved_at: string | null; created_at: string }

export const STATUS_COLOR: Record<string, string> = {
  panic: '#ef4444', alert: '#ef4444', warn: '#f59e0b',
  moving: '#22c55e', idle: '#94a3b8', offline: '#475569',
};

export const REGIONS = ['Kenya', 'DRC', 'Tanzania', 'Mali'];
// Real (approximate) country bounding boxes [[west,south],[east,north]] for map fly-to.
export const REGION_BOUNDS: Record<string, [[number, number], [number, number]]> = {
  Kenya: [[33.9, -4.7], [41.9, 5.5]],
  DRC: [[12.2, -13.5], [31.3, 5.4]],
  Tanzania: [[29.3, -11.8], [40.5, -1.0]],
  Mali: [[-12.2, 10.2], [4.2, 25.0]],
};
export const EA_CENTER: [number, number] = [35.5, 1.2];
export const EA_ZOOM = 5.2;

export const EVENT_LABEL: Record<string, string> = {
  enter: 'Entered zone', exit: 'Exited zone', dwell_exceeded: 'Dwell time exceeded',
  route_deviation: 'Route deviation', checkpoint_signin: 'Checkpoint sign-in',
};
export const EVENT_COLOR: Record<string, string> = {
  enter: 'text-green-400', exit: 'text-blue-400', dwell_exceeded: 'text-yellow-400',
  route_deviation: 'text-red-400', checkpoint_signin: 'text-cyan-400',
};

export const ALERT_TYPE_LABEL: Record<string, string> = {
  speed: 'Speeding', geofence: 'Geofence', mechanical: 'Mechanical', security: 'Security', communication: 'Communication',
};

export const ACTION_TYPE_META: Record<string, { label: string }> = {
  sms: { label: 'SMS' }, whatsapp: { label: 'WhatsApp' }, email: { label: 'Email' }, map_alert: { label: 'Map Alert' },
};

export const SEVERITY_COLOR: Record<string, string> = {
  critical: 'text-red-400', high: 'text-orange-400', medium: 'text-yellow-400', low: 'text-blue-400',
};
export const SEVERITY_WEIGHT: Record<string, number> = { critical: 100, high: 75, medium: 50, low: 25 };

export const VEHICLE_STATUS_ACTIONS: { status: 'active' | 'idle' | 'maintenance' | 'offline'; label: string }[] = [
  { status: 'active', label: 'Set Active' },
  { status: 'idle', label: 'Set Idle' },
  { status: 'maintenance', label: 'Send to Maintenance' },
  { status: 'offline', label: 'Mark Offline' },
];
