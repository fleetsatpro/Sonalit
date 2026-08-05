export const PIPELINE_STAGES = [
  { id: 'received', label: 'Received', dot: 'bg-blue-500', text: 'text-blue-400', dim: 'bg-blue-500/10' },
  { id: 'clamping', label: 'Clamping', dot: 'bg-cds-orange', text: 'text-cds-orange', dim: 'bg-cds-orange/10' },
  { id: 'in_transit', label: 'In Transit', dot: 'bg-cds-teal', text: 'text-cds-teal', dim: 'bg-cds-teal/10' },
  { id: 'at_port', label: 'At Port', dot: 'bg-cds-amber', text: 'text-cds-amber', dim: 'bg-cds-amber/10' },
  { id: 'unclamping', label: 'Unclamping', dot: 'bg-purple-500', text: 'text-purple-400', dim: 'bg-purple-500/10' },
  { id: 'completed', label: 'Completed', dot: 'bg-emerald-500', text: 'text-emerald-400', dim: 'bg-emerald-500/10' },
] as const;

export const SHIPMENT_STATUS_LABELS: Record<string, string> = {
  created: 'Created',
  vehicle_assigned: 'Vehicle Assigned',
  driver_assigned: 'Driver Assigned',
  awaiting_lock: 'Awaiting Lock',
  locked: 'Locked',
  dispatched: 'Dispatched',
  checkpoint: 'Checkpoint',
  delayed: 'Delayed',
  at_port: 'At Port',
  delivered: 'Delivered',
  lock_removed: 'Lock Removed',
  completed: 'Completed',
  archived: 'Archived',
  draft: 'Draft',
  pending: 'Pending',
  approved: 'Approved',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  cancelled: 'Cancelled',
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

export const RISK_BADGE_STYLES: Record<
  string,
  { bg: string; color: string; label: string }
> = {
  low: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'LOW' },
  medium: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'MED' },
  high: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'HIGH' },
  critical: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'CRIT' },
};

export const STATUS_BADGE_STYLES: Record<
  string,
  { bg: string; color: string; label: string }
> = {
  created: { bg: 'bg-ink-3', color: 'text-text-1', label: 'CREATED' },
  draft: { bg: 'bg-ink-3', color: 'text-text-1', label: 'DRAFT' },
  pending: { bg: 'bg-ink-3', color: 'text-text-1', label: 'PENDING' },
  approved: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'APPROVED' },
  assigned: { bg: 'bg-cds-orange-dim', color: 'text-cds-orange', label: 'ASSIGNED' },
  vehicle_assigned: { bg: 'bg-cds-orange-dim', color: 'text-cds-orange', label: 'VEH ASSIGNED' },
  driver_assigned: { bg: 'bg-cds-orange-dim', color: 'text-cds-orange', label: 'DRV ASSIGNED' },
  awaiting_lock: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'AWAITING LOCK' },
  locked: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'LOCKED' },
  dispatched: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'DISPATCHED' },
  in_transit: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'IN TRANSIT' },
  transit: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'IN TRANSIT' },
  checkpoint: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'CHECKPOINT' },
  delayed: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'DELAYED' },
  at_port: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'AT PORT' },
  arrived: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'ARRIVED' },
  delivered: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'DELIVERED' },
  lock_removed: { bg: 'bg-purple-500/15', color: 'text-purple-400', label: 'UNCLAMPED' },
  completed: { bg: 'bg-emerald-500/15', color: 'text-emerald-400', label: 'COMPLETED' },
  archived: { bg: 'bg-ink-3', color: 'text-text-1', label: 'ARCHIVED' },
  cancelled: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'CANCELLED' },
  active: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'ACTIVE' },
  idle: { bg: 'bg-ink-3', color: 'text-text-1', label: 'IDLE' },
  available: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'AVAILABLE' },
  unlocked: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'UNLOCKED' },
  offline: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'OFFLINE' },
  tampered: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'TAMPERED' },
  maintenance: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'MAINTENANCE' },
  closed: { bg: 'bg-ink-3', color: 'text-text-1', label: 'CLOSED' },
  in_progress: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'IN PROGRESS' },
  generating: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'GENERATING' },
  ready: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'READY' },
  failed: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'FAILED' },
};

export const NAV_ITEMS = [
  { id: 'pipeline', label: 'Pipeline', path: '/cds', icon: 'dashboard' },
  { id: 'clamp', label: 'Clamp', path: '/cds/clamp', icon: 'locks' },
  { id: 'unclamp', label: 'Unclamp', path: '/cds/unclamp', icon: 'locks' },
  { id: 'reports', label: 'Reports', path: '/cds/reports', icon: 'reports' },
  { id: 'settings', label: 'Settings', path: '/cds/settings', icon: 'settings' },
] as const;
