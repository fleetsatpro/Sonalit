// Core Domain Types for Container Delivery System

export interface UUID {
  id: string;
}

export interface Timestamp {
  createdAt: Date;
  updatedAt: Date;
}

export interface SoftDelete {
  deletedAt: Date | null;
}

export interface OrganizationScoped {
  orgId: string;
}

// Base Entity
export interface BaseEntity extends UUID, Timestamp, SoftDelete, OrganizationScoped {}

// Location Types
export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface GeoAddress {
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  coordinates?: GeoPoint;
}

// Shipment Types
export type ShipmentStatus =
  | 'created'
  | 'assigned'
  | 'container_assigned'
  | 'vehicle_assigned'
  | 'driver_assigned'
  | 'lock_assigned'
  | 'tracking_activated'
  | 'in_transit'
  | 'at_checkpoint'
  | 'at_border'
  | 'arrived'
  | 'unlock_authorized'
  | 'delivered'
  | 'container_returned'
  | 'closed'
  | 'archived'
  | 'cancelled';

export type ShipmentPriority = 'low' | 'medium' | 'high' | 'critical';

export interface ShipmentCheckpoint {
  id: string;
  shipmentId: string;
  name: string;
  location: GeoPoint;
  address?: GeoAddress;
  expectedArrival?: Date;
  actualArrival?: Date;
  verified: boolean;
  verifiedBy?: string;
  verifiedAt?: Date;
  notes?: string;
}

export interface ShipmentTimeline {
  id: string;
  shipmentId: string;
  status: ShipmentStatus;
  timestamp: Date;
  userId?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
}

export interface Shipment extends BaseEntity {
  reference: string;
  customerId: string;
  transporterId?: string;
  containerId?: string;
  vehicleId?: string;
  driverId?: string;
  lockId?: string;
  status: ShipmentStatus;
  priority: ShipmentPriority;
  origin: GeoAddress;
  destination: GeoAddress;
  originCoords: GeoPoint;
  destinationCoords: GeoPoint;
  expectedPickup?: Date;
  actualPickup?: Date;
  expectedDelivery?: Date;
  actualDelivery?: Date;
  cargoDescription?: string;
  weight?: number;
  value?: number;
  checkpoints: ShipmentCheckpoint[];
  currentLocation?: GeoPoint;
  routeGeometry?: string; // GeoJSON
  estimatedArrival?: Date;
  delayMinutes?: number;
  notes?: string;
}

// Container Types
export type ContainerType =
  | '20ft'
  | '40ft'
  | '40ft_hc'
  | '45ft'
  | '20ft_rf'
  | '40ft_rf'
  | '20ft_ot'
  | '40ft_ot'
  | '20ft_flat'
  | '40ft_flat';

export type ContainerStatus =
  | 'available'
  | 'reserved'
  | 'in_use'
  | 'in_transit'
  | 'at_port'
  | 'at_warehouse'
  | 'at_customer'
  | 'maintenance'
  | 'damaged'
  | 'retired';

export interface Container extends BaseEntity {
  containerNumber: string;
  isoCode: string;
  type: ContainerType;
  status: ContainerStatus;
  ownerId?: string;
  tareWeight: number;
  maxPayload: number;
  length: number;
  width: number;
  height: number;
  volume: number;
  currentShipmentId?: string;
  currentVehicleId?: string;
  currentLocation?: GeoPoint;
  lastInspection?: Date;
  nextInspection?: Date;
  notes?: string;
}

// Customer Types
export type CustomerType = 'importer' | 'exporter' | 'both';

export interface CustomerContact {
  name: string;
  email: string;
  phone: string;
  role?: string;
}

export interface Customer extends BaseEntity {
  name: string;
  code: string;
  type: CustomerType;
  contacts: CustomerContact[];
  billingAddress?: GeoAddress;
  deliveryAddresses: GeoAddress[];
  taxId?: string;
  creditLimit?: number;
  paymentTerms?: number;
  notes?: string;
  tags?: string[];
}

// Transporter Types
export type TransporterStatus = 'active' | 'suspended' | 'inactive';

export interface TransporterVehicle {
  vehicleId: string;
  assignedAt: Date;
}

export interface TransporterDriver {
  driverId: string;
  assignedAt: Date;
}

export interface Transporter extends BaseEntity {
  name: string;
  code: string;
  status: TransporterStatus;
  contacts: CustomerContact[];
  vehicles: TransporterVehicle[];
  drivers: TransporterDriver[];
  licenseNumber?: string;
  insuranceExpiry?: Date;
  rating?: number;
  totalShipments?: number;
  onTimeDeliveryRate?: number;
  notes?: string;
}

// Driver Types
export type DriverStatus = 'available' | 'on_trip' | 'off_duty' | 'suspended';

export interface DriverLicense {
  number: string;
  type: string;
  expiry: Date;
  country: string;
}

export interface Driver extends BaseEntity {
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: DriverStatus;
  transporterId?: string;
  license: DriverLicense;
  dateOfBirth?: Date;
  address?: GeoAddress;
  emergencyContact?: CustomerContact;
  photoUrl?: string;
  rating?: number;
  totalTrips?: number;
  notes?: string;
}

// Vehicle Types
export type VehicleType =
  | 'truck'
  | 'trailer'
  | 'semi_trailer'
  | 'rigid'
  | 'van'
  | 'flatbed';

export type VehicleStatus =
  | 'available'
  | 'on_trip'
  | 'maintenance'
  | 'out_of_service'
  | 'offline';

export interface Vehicle extends BaseEntity {
  registration: string;
  type: VehicleType;
  make?: string;
  model?: string;
  year?: number;
  status: VehicleStatus;
  transporterId?: string;
  currentDriverId?: string;
  currentShipmentId?: string;
  currentLocation?: GeoPoint;
  lastLocationUpdate?: Date;
  fuelType?: string;
  fuelCapacity?: number;
  currentFuelLevel?: number;
  mileage?: number;
  nextService?: Date;
  insuranceExpiry?: Date;
  roadTaxExpiry?: Date;
  notes?: string;
}

// Electronic Lock Types
export type LockStatus =
  | 'available'
  | 'assigned'
  | 'in_use'
  | 'offline'
  | 'low_battery'
  | 'tampered'
  | 'faulty'
  | 'maintenance';

export type LockEventType =
  | 'lock'
  | 'unlock'
  | 'gps_update'
  | 'heartbeat'
  | 'battery_low'
  | 'battery_critical'
  | 'signal_low'
  | 'signal_lost'
  | 'signal_restored'
  | 'tamper'
  | 'open'
  | 'close'
  | 'lock_failure'
  | 'unlock_failure'
  | 'firmware_update'
  | 'config_change';

export interface LockEvent {
  id: string;
  lockId: string;
  type: LockEventType;
  timestamp: Date;
  location?: GeoPoint;
  batteryLevel?: number;
  signalStrength?: number;
  metadata?: Record<string, unknown>;
}

export interface LockDiagnostics {
  firmwareVersion: string;
  hardwareVersion: string;
  lastHealthCheck?: Date;
  lastRestart?: Date;
  uptime: number;
  signalQuality: 'excellent' | 'good' | 'fair' | 'poor';
  batteryHealth: number;
  gpsAccuracy: number;
}

export interface ElectronicLock extends BaseEntity {
  serialNumber: string;
  securisatId: string;
  status: LockStatus;
  assignedShipmentId?: string;
  assignedVehicleId?: string;
  currentLocation?: GeoPoint;
  lastLocationUpdate?: Date;
  batteryLevel: number;
  signalStrength: number;
  lastHeartbeat?: Date;
  diagnostics: LockDiagnostics;
  installationDate?: Date;
  lastMaintenance?: Date;
  notes?: string;
}

// Geofence Types
export type GeofenceType =
  | 'circular'
  | 'polygon'
  | 'corridor'
  | 'route';

export type GeofenceAlertType =
  | 'entry'
  | 'exit'
  | 'overspeed'
  | 'unauthorized_stop'
  | 'route_deviation'
  | 'idle_timeout'
  | 'wrong_destination';

export interface GeofenceAlert {
  id: string;
  geofenceId: string;
  entityType: 'vehicle' | 'container' | 'lock';
  entityId: string;
  shipmentId?: string;
  alertType: GeofenceAlertType;
  timestamp: Date;
  location?: GeoPoint;
  speed?: number;
  metadata?: Record<string, unknown>;
}

export interface Geofence extends BaseEntity {
  name: string;
  type: GeofenceType;
  category?: string;
  center?: GeoPoint;
  radius?: number; // meters, for circular
  coordinates?: GeoPoint[]; // for polygon
  corridorWidth?: number; // meters, for corridor
  routeGeometry?: string; // GeoJSON, for route/corridor
  color?: string;
  active: boolean;
  alertOnEntry: boolean;
  alertOnExit: boolean;
  alertTypes: GeofenceAlertType[];
  speedLimit?: number;
  idleTimeout?: number; // minutes
}

// Incident Types
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'resolved' | 'closed';

export interface Incident extends BaseEntity {
  title: string;
  description: string;
  type: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  shipmentId?: string;
  vehicleId?: string;
  driverId?: string;
  lockId?: string;
  location?: GeoPoint;
  reportedBy?: string;
  assignedTo?: string;
  resolvedAt?: Date;
  resolution?: string;
  attachments?: string[];
}

// Alert Types
export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';
export type AlertStatus = 'active' | 'acknowledged' | 'resolved' | 'dismissed';

export interface Alert extends BaseEntity {
  title: string;
  message: string;
  type: string;
  severity: AlertSeverity;
  status: AlertStatus;
  source: 'system' | 'lock' | 'geofence' | 'shipment' | 'vehicle' | 'driver';
  sourceId?: string;
  shipmentId?: string;
  vehicleId?: string;
  lockId?: string;
  acknowledgedBy?: string;
  acknowledgedAt?: Date;
  resolvedBy?: string;
  resolvedAt?: Date;
  metadata?: Record<string, unknown>;
}

// Document Types
export type DocumentType =
  | 'bill_of_lading'
  | 'packing_list'
  | 'invoice'
  | 'customs_declaration'
  | 'certificate_of_origin'
  | 'phytosanitary'
  | 'insurance'
  | 'delivery_note'
  | 'photo'
  | 'other';

export interface Document extends BaseEntity {
  reference: string;
  type: DocumentType;
  title: string;
  shipmentId?: string;
  containerId?: string;
  vehicleId?: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  uploadedBy?: string;
  verified: boolean;
  verifiedBy?: string;
  verifiedAt?: Date;
  expiryDate?: Date;
  notes?: string;
}

// Audit Log Types
export interface AuditLog extends UUID {
  orgId: string;
  userId?: string;
  userEmail?: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

// Analytics Types
export interface DeliveryMetrics {
  totalShipments: number;
  delivered: number;
  inTransit: number;
  delayed: number;
  cancelled: number;
  onTimeRate: number;
  avgDeliveryTime: number;
  avgDelayMinutes: number;
}

export interface LockMetrics {
  totalLocks: number;
  activeLocks: number;
  offlineLocks: number;
  lowBatteryLocks: number;
  tamperedLocks: number;
  avgBatteryLevel: number;
}

export interface FleetMetrics {
  totalVehicles: number;
  activeVehicles: number;
  totalDrivers: number;
  activeDrivers: number;
  vehicleUtilization: number;
  driverUtilization: number;
  avgTripDuration: number;
}

// API Response Types
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Notification Types
export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  data?: Record<string, unknown>;
  createdAt: Date;
}

// AI Inbox Types
export interface AIInboxItem {
  id: string;
  channel: 'email' | 'whatsapp' | 'sms';
  sender: string;
  senderPhone?: string;
  senderEmail?: string;
  subject?: string;
  content: string;
  receivedAt: Date;
  processed: boolean;
  processedAt?: Date;
  extractedData?: {
    shipmentReferences?: string[];
    containerNumbers?: string[];
    sealNumbers?: string[];
    lockIds?: string[];
    vehicleRegistrations?: string[];
    driverNames?: string[];
    customer?: string;
    transporter?: string;
    deliveryLocation?: string;
    pickupLocation?: string;
    arrivalTime?: string;
    departureTime?: string;
    notes?: string;
  };
  confidence: number;
  verified: boolean;
  verifiedBy?: string;
  verifiedAt?: Date;
  committedToSystem: boolean;
}

// Integration Types
export interface IntegrationConfig {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  credentials: Record<string, string>;
  settings: Record<string, unknown>;
  lastSyncAt?: Date;
  status: 'connected' | 'disconnected' | 'error';
}

// User & RBAC Types
export type Role =
  | 'admin'
  | 'operations_manager'
  | 'dispatcher'
  | 'driver_supervisor'
  | 'analyst'
  | 'customer_service'
  | 'viewer';

export interface Permission {
  resource: string;
  actions: ('create' | 'read' | 'update' | 'delete')[];
}

export interface UserRole {
  role: Role;
  permissions: Permission[];
}
