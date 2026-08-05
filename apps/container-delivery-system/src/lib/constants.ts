export const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  created: 'Created',
  customer_assigned: 'Customer Assigned',
  container_assigned: 'Container Assigned',
  vehicle_assigned: 'Vehicle Assigned',
  driver_assigned: 'Driver Assigned',
  lock_assigned: 'Lock Assigned',
  tracking_active: 'Tracking Active',
  in_transit: 'In Transit',
  checkpoint: 'Checkpoint',
  border_crossing: 'Border Crossing',
  arrived: 'Arrived',
  unlock_authorized: 'Unlock Authorized',
  delivered: 'Delivered',
  container_returned: 'Container Returned',
  closed: 'Closed',
  archived: 'Archived',
};

export const CONTAINER_TYPES: Record<string, string> = {
  '20GP': "20' General Purpose",
  '40GP': "40' General Purpose",
  '40HC': "40' High Cube",
  '20RF': "20' Reefer",
  '40RF': "40' Reefer",
  '20OT': "20' Open Top",
  '40OT': "40' Open Top",
  '20FR': "20' Flat Rack",
  '40FR': "40' Flat Rack",
  '20TK': "20' Tank",
};

export const ALERT_SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff5c5c',
  high: '#ff5c5c',
  medium: '#ffb020',
  low: '#33d6a8',
  info: '#6b7380',
};

export const RISK_BADGE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  low: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'LOW' },
  medium: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'MED' },
  high: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'HIGH' },
  critical: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'CRIT' },
};

export const STATUS_BADGE_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  in_transit: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'IN TRANSIT' },
  transit: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'IN TRANSIT' },
  delivered: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'DELIVERED' },
  delayed: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'DELAYED' },
  pending: { bg: 'bg-ink-3', color: 'text-text-1', label: 'PENDING' },
  active: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'ACTIVE' },
  idle: { bg: 'bg-ink-3', color: 'text-text-1', label: 'IDLE' },
  available: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'AVAILABLE' },
  assigned: { bg: 'bg-cds-orange-dim', color: 'text-cds-orange', label: 'ASSIGNED' },
  locked: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'LOCKED' },
  unlocked: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'UNLOCKED' },
  offline: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'OFFLINE' },
  tampered: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'TAMPERED' },
  maintenance: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'MAINTENANCE' },
  created: { bg: 'bg-ink-3', color: 'text-text-1', label: 'CREATED' },
  arrived: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'ARRIVED' },
  closed: { bg: 'bg-ink-3', color: 'text-text-1', label: 'CLOSED' },
};

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', path: '/cds', icon: 'dashboard' },
  { id: 'shipments', label: 'Shipments', path: '/cds/shipments', icon: 'shipments' },
  { id: 'containers', label: 'Containers', path: '/cds/containers', icon: 'containers' },
  { id: 'locks', label: 'E-Locks', path: '/cds/locks', icon: 'locks' },
  { id: 'live', label: 'Live Tracking', path: '/cds/live', icon: 'live' },
  { id: 'drivers', label: 'Drivers', path: '/cds/drivers', icon: 'drivers' },
  { id: 'vehicles', label: 'Vehicles', path: '/cds/vehicles', icon: 'vehicles' },
  { id: 'transporters', label: 'Transporters', path: '/cds/transporters', icon: 'transporters' },
  { id: 'customers', label: 'Customers', path: '/cds/customers', icon: 'customers' },
  { id: 'delivery', label: 'Delivery Ops', path: '/cds/delivery', icon: 'delivery' },
  { id: 'geofences', label: 'Geofences', path: '/cds/geofences', icon: 'geofences' },
  { id: 'inbox', label: 'AI Inbox', path: '/cds/inbox', icon: 'inbox' },
  { id: 'incidents', label: 'Incidents', path: '/cds/incidents', icon: 'incidents' },
  { id: 'alerts', label: 'Alerts', path: '/cds/alerts', icon: 'alerts' },
  { id: 'documents', label: 'Documents', path: '/cds/documents', icon: 'documents' },
  { id: 'reports', label: 'Reports', path: '/cds/reports', icon: 'reports' },
  { id: 'analytics', label: 'Analytics', path: '/cds/analytics', icon: 'analytics' },
  { id: 'audit', label: 'Audit Logs', path: '/cds/audit', icon: 'audit' },
  { id: 'settings', label: 'Settings', path: '/cds/settings', icon: 'settings' },
] as const;
