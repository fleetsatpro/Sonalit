// Application Constants

export const APP_NAME = 'Container Delivery System';
export const APP_VERSION = '1.0.0';
export const APP_PREFIX = 'CDS';

// Database
export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';

// Pagination
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// Rate Limiting
export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const RATE_LIMIT_MAX_REQUESTS = 500;

// JWT
export const JWT_ACCESS_TOKEN_EXPIRY = '15m';
export const JWT_REFRESH_TOKEN_EXPIRY = '7d';
export const JWT_ALGORITHM = 'HS256';

// Lock Sync Intervals
export const LOCK_SYNC_INTERVAL_MS = 60 * 1000; // 1 minute
export const LOCK_HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
export const LOCK_BATTERY_WARNING_THRESHOLD = 20;
export const LOCK_BATTERY_CRITICAL_THRESHOLD = 10;

// Geofence
export const GEOFENCE_ENTRY_EXIT_BUFFER_METERS = 50;
export const GEOFENCE_CORRIDOR_BUFFER_METERS = 100;
export const GEOFENCE_CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds

// Tracking
export const GPS_UPDATE_INTERVAL_MS = 10 * 1000; // 10 seconds
export const GPS_HISTORY_RETENTION_DAYS = 90;
export const TRACKING_PLAYBACK_SPEED_OPTIONS = [0.5, 1, 2, 4, 8, 16];

// File Upload
export const MAX_FILE_SIZE_MB = 10;
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const ALLOWED_DOCUMENT_TYPES = ['application/pdf'];
export const UPLOAD_PATH = '/uploads';

// Audit
export const AUDIT_RETENTION_DAYS = 365;

// Notification Channels
export const NOTIFICATION_CHANNELS = {
  IN_APP: 'in_app',
  EMAIL: 'email',
  SMS: 'sms',
  WHATSAPP: 'whatsapp',
  PUSH: 'push',
} as const;

// Shipment Status Transitions
export const SHIPMENT_STATUS_FLOW: Record<string, string[]> = {
  created: ['assigned', 'cancelled'],
  assigned: ['container_assigned', 'cancelled'],
  container_assigned: ['vehicle_assigned', 'cancelled'],
  vehicle_assigned: ['driver_assigned', 'cancelled'],
  driver_assigned: ['lock_assigned', 'cancelled'],
  lock_assigned: ['tracking_activated', 'cancelled'],
  tracking_activated: ['in_transit', 'cancelled'],
  in_transit: ['at_checkpoint', 'at_border', 'arrived', 'cancelled'],
  at_checkpoint: ['in_transit', 'at_border', 'arrived', 'cancelled'],
  at_border: ['in_transit', 'arrived', 'cancelled'],
  arrived: ['unlock_authorized', 'cancelled'],
  unlock_authorized: ['delivered', 'cancelled'],
  delivered: ['container_returned', 'closed'],
  container_returned: ['closed', 'archived'],
  closed: ['archived'],
  archived: [],
  cancelled: [],
};

// Container ISO Codes
export const CONTAINER_ISO_CODES: Record<string, { length: number; width: number; height: number }> = {
  '20GP': { length: 6.058, width: 2.438, height: 2.591 },
  '40GP': { length: 12.192, width: 2.438, height: 2.591 },
  '40HC': { length: 12.192, width: 2.438, height: 2.896 },
  '45HC': { length: 13.716, width: 2.438, height: 2.896 },
  '20RF': { length: 5.898, width: 2.286, height: 2.392 },
  '40RF': { length: 11.583, width: 2.286, height: 2.533 },
  '20OT': { length: 6.058, width: 2.438, height: 0.914 },
  '40OT': { length: 12.192, width: 2.438, height: 0.914 },
  '20FL': { length: 6.058, width: 2.438, height: 0.152 },
  '40FL': { length: 12.192, width: 2.438, height: 0.152 },
};

// Cache Keys
export const CACHE_KEYS = {
  SHIPMENT: 'cds:shipment:',
  CONTAINER: 'cds:container:',
  LOCK: 'cds:lock:',
  VEHICLE: 'cds:vehicle:',
  DRIVER: 'cds:driver:',
  METRICS: 'cds:metrics:',
  ANALYTICS: 'cds:analytics:',
} as const;

// Cache TTL (seconds)
export const CACHE_TTL = {
  SHORT: 60, // 1 minute
  MEDIUM: 300, // 5 minutes
  LONG: 900, // 15 minutes
  HOURLY: 3600,
  DAILY: 86400,
} as const;

// Queue Names
export const QUEUE_NAMES = {
  LOCK_SYNC: 'cds:lock-sync',
  GEOFENCE_CHECK: 'cds:geofence-check',
  NOTIFICATIONS: 'cds:notifications',
  ANALYTICS: 'cds:analytics',
  EXPORT: 'cds:export',
  AI_PROCESS: 'cds:ai-process',
} as const;

// Webhook Events
export const WEBHOOK_EVENTS = {
  SHIPMENT_CREATED: 'shipment.created',
  SHIPMENT_UPDATED: 'shipment.updated',
  SHIPMENT_STATUS_CHANGED: 'shipment.status_changed',
  SHIPMENT_DELIVERED: 'shipment.delivered',
  LOCK_ASSIGNED: 'lock.assigned',
  LOCK_UNLOCKED: 'lock.unlocked',
  LOCK_TAMPERED: 'lock.tampered',
  LOCK_LOW_BATTERY: 'lock.low_battery',
  LOCK_OFFLINE: 'lock.offline',
  INCIDENT_CREATED: 'incident.created',
  INCIDENT_RESOLVED: 'incident.resolved',
  ALERT_TRIGGERED: 'alert.triggered',
} as const;

// Export Formats
export const EXPORT_FORMATS = {
  PDF: 'pdf',
  EXCEL: 'xlsx',
  CSV: 'csv',
} as const;

// Date Formats
export const DATE_FORMATS = {
  ISO: 'yyyy-MM-ddTHH:mm:ss.SSSZ',
  DATE_ONLY: 'yyyy-MM-dd',
  TIME_ONLY: 'HH:mm:ss',
  DISPLAY: 'dd MMM yyyy HH:mm',
  SHORT: 'dd/MM/yyyy',
} as const;

// Map Styles
export const MAP_STYLES = {
  LIGHT: 'light',
  DARK: 'dark',
  SATELLITE: 'satellite',
  TERRAIN: 'terrain',
} as const;

// Error Codes
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;
