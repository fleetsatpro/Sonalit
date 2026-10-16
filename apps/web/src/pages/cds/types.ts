export type ShipmentStatus =
  | 'created'
  | 'vehicle_assigned'
  | 'driver_assigned'
  | 'awaiting_lock'
  | 'locked'
  | 'dispatched'
  | 'checkpoint'
  | 'delayed'
  | 'at_port'
  | 'delivered'
  | 'lock_removed'
  | 'completed'
  | 'archived';

export type ContainerStatus =
  | 'available'
  | 'booked'
  | 'awaiting_pickup'
  | 'in_transit'
  | 'at_port'
  | 'delivered'
  | 'maintenance';

export type LockStatus =
  | 'available'
  | 'assigned'
  | 'installed'
  | 'removed'
  | 'maintenance'
  | 'offline';

export type DriverStatus =
  | 'available'
  | 'active'
  | 'on_break'
  | 'off_duty'
  | 'suspended';

export type VehicleStatus =
  | 'available'
  | 'in_use'
  | 'maintenance'
  | 'decommissioned';

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type SignalStrength = 'strong' | 'medium' | 'weak' | 'offline';
export type GeofenceType = 'circle' | 'polygon' | 'corridor' | 'route';

export interface Shipment {
  id: string;
  reference: string;
  status: ShipmentStatus;
  customerId: string;
  customerName: string;
  containerId: string | null;
  containerNumber: string | null;
  vehicleId: string | null;
  vehicleReg: string | null;
  driverId: string | null;
  driverName: string | null;
  lockId: string | null;
  lockSerial: string | null;
  transporterId: string;
  transporterName: string;
  commodity: string;
  weight: number;
  origin: string;
  destination: string;
  eta: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  deliveredAt: string | null;
  closedAt: string | null;
  risk: RiskLevel;
  progress: number;
  bookingRef: string | null;
  sealNumber: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface Container {
  id: string;
  number: string;
  isoType: string;
  containerType?: string;
  containerSize?: number;
  ownership: 'owned' | 'leased' | 'customer';
  status: ContainerStatus;
  condition?: 'new' | 'good' | 'fair' | 'damaged' | 'retired';
  length: number;
  width: number;
  height: number;
  maxWeight: number;
  tareWeight: number;
  currentShipmentId: string | null;
  currentVehicleId: string | null;
  currentLockId: string | null;
  lat: number | null;
  lng: number | null;
  currentLocation?: string;
  lastInspection: string | null;
  nextInspection: string | null;
  manufacturer: string;
  yearBuilt: number;
  createdAt: string;
  updatedAt: string;
}

export interface ElectronicLock {
  id: string;
  serial: string;
  provider: string;
  status: LockStatus;
  batteryLevel: number;
  solarCharging: boolean;
  signalStrength: SignalStrength;
  firmwareVersion: string;
  containerId: string | null;
  containerNumber: string | null;
  vehicleId: string | null;
  vehicleReg: string | null;
  lat: number | null;
  lng: number | null;
  location: string;
  lastHeartbeat: string;
  temperature: number | null;
  tamperDetected: boolean;
  lastEventAt: string;
  assignedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  licenseNumber: string;
  licenseExpiry: string;
  transporterId: string;
  transporterName: string;
  status: DriverStatus;
  currentVehicleId: string | null;
  currentVehicleReg: string | null;
  totalTrips: number;
  rating: number;
  photo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Vehicle {
  id: string;
  registration: string;
  type: 'truck' | 'trailer' | 'tanker' | 'flatbed';
  make: string;
  model: string;
  year: number;
  status: VehicleStatus;
  transporterId: string;
  transporterName: string;
  currentDriverId: string | null;
  currentDriverName: string | null;
  lat: number | null;
  lng: number | null;
  speed: number;
  heading: number;
  lastPositionAt: string | null;
  fuelLevel: number | null;
  odometer: number;
  nextService: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  company_name: string;
  code: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  country: string;
  total_shipments: number;
  active_shipments: number;
  sla_compliance: number;
  rating: number;
  status: 'active' | 'inactive' | 'suspended';
  created_at: string;
  updated_at: string;
}

export interface Transporter {
  id: string;
  company_name: string;
  code: string;
  contact_person: string;
  phone: string;
  email: string;
  total_trucks: number;
  active_trips: number;
  on_time_rate: number;
  avg_clamp_time: string;
  total_trips: number;
  rating: number;
  status: 'active' | 'inactive' | 'suspended';
  created_at: string;
  updated_at: string;
}

export interface GeofenceAlert {
  type:
    | 'entry'
    | 'exit'
    | 'overspeed'
    | 'unauthorized_stop'
    | 'route_deviation'
    | 'idle_timeout';
  enabled: boolean;
  threshold?: number;
}

export interface Geofence {
  id: string;
  name: string;
  type: GeofenceType;
  geometry: GeoJSON.Geometry;
  category:
    | 'warehouse'
    | 'port'
    | 'border'
    | 'customer'
    | 'restricted'
    | 'corridor';
  alerts: GeofenceAlert[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Alert {
  id: string;
  type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  entityType:
    | 'shipment'
    | 'container'
    | 'lock'
    | 'vehicle'
    | 'driver'
    | 'geofence';
  entityId: string;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface Incident {
  id: string;
  type:
    | 'tamper'
    | 'theft'
    | 'accident'
    | 'breakdown'
    | 'route_deviation'
    | 'unauthorized_stop'
    | 'lock_failure';
  severity: AlertSeverity;
  title: string;
  description: string;
  shipmentId: string | null;
  containerId: string | null;
  lockId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  lat: number | null;
  lng: number | null;
  status: 'open' | 'investigating' | 'resolved' | 'closed';
  assignedTo: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  userName: string;
  details: Record<string, unknown>;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  icon:
    | 'clamp'
    | 'depart'
    | 'checkpoint'
    | 'sync'
    | 'arrival'
    | 'unclamp'
    | 'ai'
    | 'alert'
    | 'lock'
    | 'unlock';
  text: string;
  meta: string;
  timestamp: string;
}

export interface DashboardKPI {
  label: string;
  value: string;
  delta: string;
  trend: 'up' | 'down';
  sparkline?: number[];
}

export interface ConversationMessage {
  id: string;
  mine: boolean;
  time: string;
  html: string;
  scanning?: boolean;
}

export interface ExtractedField {
  label: string;
  value: string;
  confidence: number;
  missing?: boolean;
}

export interface FieldGroup {
  label: string;
  fields: ExtractedField[];
}

export interface Conversation {
  id: string;
  name: string;
  category: 'ground' | 'port' | 'dispatch' | 'supervisor';
  color: string;
  initials: string;
  phone: string;
  online: boolean;
  status: 'review' | 'synced' | 'pending';
  unread: number;
  time: string;
  preview: string;
  messages: ConversationMessage[];
  confidence: number;
  groups: FieldGroup[];
}

export interface LockEvent {
  id: string;
  lockId: string;
  type:
    | 'lock'
    | 'unlock'
    | 'tamper'
    | 'heartbeat'
    | 'gps_update'
    | 'battery_low'
    | 'offline'
    | 'online'
    | 'firmware_update';
  data: Record<string, unknown>;
  createdAt: string;
}

export interface Report {
  id: string;
  name: string;
  type: 'daily' | 'weekly' | 'monthly' | 'custom';
  format: 'pdf' | 'excel' | 'csv';
  status: 'generating' | 'ready' | 'failed';
  downloadUrl: string | null;
  generatedBy: string;
  generatedAt: string;
  parameters: Record<string, unknown>;
}

export interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  read: boolean;
  actionUrl: string | null;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SearchFilters {
  query?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export type PipelineStage =
  | 'received'
  | 'clamping'
  | 'in_transit'
  | 'at_port'
  | 'unclamping'
  | 'completed';

export interface BookingPipelineItem {
  id: string;
  booking_number: string;
  reference: string | null;
  status: string;
  customer_id: string | null;
  customer_name: string | null;
  pickup_location: string | null;
  delivery_location: string | null;
  commodity: string | null;
  container_type: string | null;
  container_size: string | null;
  shipping_line: string | null;
  eta: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  trip_count: number;
  trips_completed: number;
  pipeline_stage: PipelineStage;
}

export type CDSAnalyticsWindow = 7 | 30 | 90 | 365;

export interface CDSAnalyticsSummary {
  trips_started: number;
  deliveries_completed: number;
  active_trips: number;
  moving_trips: number;
  delayed_trips: number;
  eta_met: number;
  eta_observed: number;
  eta_attainment_pct: number | null;
  avg_transit_hours: number | null;
  trips_missing_vehicle: number;
  trips_missing_driver: number;
  trips_missing_container: number;
  trips_missing_lock: number;
  trips_missing_eta: number;
  total_containers: number;
  available_containers: number;
  containers_in_use: number;
  container_utilization_pct: number | null;
  total_vehicles: number;
  available_vehicles: number;
  vehicles_in_use: number;
  vehicles_in_maintenance: number;
  vehicle_utilization_pct: number | null;
  total_locks: number;
  locks_needing_attention: number;
  low_battery_locks: number;
  tampered_locks: number;
  stale_lock_heartbeats: number;
  active_drivers: number;
  open_incidents: number;
  unacknowledged_alerts: number;
}

export interface CDSAnalyticsPayload {
  meta: { window_days: CDSAnalyticsWindow; period_start: string; period_end: string; generated_at: string };
  summary: CDSAnalyticsSummary;
  daily: Array<{ day: string; trips_started: number; deliveries_completed: number }>;
  trip_statuses: Array<{ status: string; count: number }>;
  risk_mix: Array<{ risk: string; count: number }>;
  lock_statuses: Array<{ status: string; count: number; low_battery: number; tampered: number }>;
  booking_pipeline: Array<{ status: string; count: number }>;
  lanes: Array<{
    origin: string; destination: string; trips_started: number; deliveries_completed: number;
    currently_delayed: number; avg_transit_hours: number | null;
  }>;
  alerts: Array<{
    id: string; type: string; severity: string; title: string; message: string;
    entity_type: string; entity_id: string; created_at: string;
  }>;
}
