export interface CDSViewDef {
  id: string;
  label: string;
  sub: string;
}

export const CDS_VIEWS: CDSViewDef[] = [
  { id: 'dashboard', label: 'Operations Overview', sub: 'TODAY · TENANT-WIDE OPERATIONAL STATE' },
  { id: 'live', label: 'Live Movement', sub: 'TRACKING EVIDENCE · TRIP PROGRESS' },
  { id: 'bookings', label: 'Booking Desk', sub: 'CUSTOMER INTAKE · PLANNING · DISPATCH' },
  { id: 'port', label: 'Port Clearance', sub: 'ARRIVAL · UNCLAMP · SEAL VERIFICATION' },
  { id: 'pulse', label: 'Booking Health', sub: 'LIFECYCLE · DELAY · STALE RECORDS' },
  { id: 'containers', label: 'Container Register', sub: 'EQUIPMENT IDENTITY · CONDITION · INSPECTIONS' },
  { id: 'locks', label: 'E-Lock Control', sub: 'DEVICE HEALTH · ASSIGNMENTS · SEAL EVENTS' },
  { id: 'transporters', label: 'Transport Partners', sub: 'CARRIER CAPACITY · SERVICE PROFILE' },
  { id: 'inbox', label: 'Activity & Custody', sub: 'FIELD EVENTS · LOCK EVENTS · TRIP TRANSITIONS' },
  { id: 'analytics', label: 'Performance Intelligence', sub: 'OPERATIONAL TRENDS · EQUIPMENT · LOCKS' },
  { id: 'reports', label: 'Operational Reports', sub: 'EVIDENCE-BASED EXPORTS' },
  { id: 'settings', label: 'Configuration', sub: 'TENANT PREFERENCES · FIELD ACCESS' },
];

export const PIPELINE_STAGES = [
  { id: 'received', label: 'Received', dot: 'bg-blue-500', text: 'text-blue-400', dim: 'bg-blue-500/10' },
  { id: 'clamping', label: 'Clamping', dot: 'bg-cds-orange', text: 'text-cds-orange', dim: 'bg-cds-orange/10' },
  { id: 'in_transit', label: 'In Transit', dot: 'bg-cds-teal', text: 'text-cds-teal', dim: 'bg-cds-teal/10' },
  { id: 'at_port', label: 'At Port', dot: 'bg-cds-amber', text: 'text-cds-amber', dim: 'bg-cds-amber/10' },
  { id: 'unclamping', label: 'Unclamping', dot: 'bg-purple-500', text: 'text-purple-400', dim: 'bg-purple-500/10' },
  { id: 'completed', label: 'Completed', dot: 'bg-emerald-500', text: 'text-emerald-400', dim: 'bg-emerald-500/10' },
] as const;

export const STATUS_COLORS: Record<string, string> = {
  active: '#33d6a8', online: '#33d6a8', available: '#33d6a8', locked: '#33d6a8',
  dispatched: '#33d6a8', delivered: '#33d6a8', completed: '#22c55e', installed: '#33d6a8',
  in_transit: '#37e6ff', transit: '#37e6ff', assigned: '#ff7a00',
  pending: '#ffb020', awaiting_lock: '#ffb020', maintenance: '#ffb020',
  delayed: '#ff5c5c', offline: '#ff5c5c', tampered: '#ff5c5c', critical: '#ff5c5c',
  removed: '#a78bfa', unlocked: '#a78bfa',
  idle: '#64748b', retired: '#64748b', suspended: '#64748b', damaged: '#ff5c5c',
  at_port: '#ffb020', arrived: '#33d6a8', booked: '#ff7a00', awaiting_pickup: '#ffb020',
  created: '#64748b', draft: '#64748b',
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
  installed: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'INSTALLED' },
  dispatched: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'DISPATCHED' },
  in_transit: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'IN TRANSIT' },
  transit: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'IN TRANSIT' },
  checkpoint: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'CHECKPOINT' },
  delayed: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'DELAYED' },
  at_port: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'AT PORT' },
  arrived: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'ARRIVED' },
  delivered: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'DELIVERED' },
  lock_removed: { bg: 'bg-purple-500/15', color: 'text-purple-400', label: 'UNCLAMPED' },
  removed: { bg: 'bg-purple-500/15', color: 'text-purple-400', label: 'REMOVED' },
  completed: { bg: 'bg-emerald-500/15', color: 'text-emerald-400', label: 'COMPLETED' },
  archived: { bg: 'bg-ink-3', color: 'text-text-1', label: 'ARCHIVED' },
  cancelled: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'CANCELLED' },
  active: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'ACTIVE' },
  idle: { bg: 'bg-ink-3', color: 'text-text-1', label: 'IDLE' },
  available: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'AVAILABLE' },
  booked: { bg: 'bg-cds-orange-dim', color: 'text-cds-orange', label: 'BOOKED' },
  awaiting_pickup: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'AWAITING PICKUP' },
  unlocked: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'UNLOCKED' },
  offline: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'OFFLINE' },
  tampered: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'TAMPERED' },
  maintenance: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'MAINTENANCE' },
  closed: { bg: 'bg-ink-3', color: 'text-text-1', label: 'CLOSED' },
  in_progress: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'IN PROGRESS' },
  generating: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'GENERATING' },
  ready: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'READY' },
  failed: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'FAILED' },
  on_break: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'ON BREAK' },
  off_duty: { bg: 'bg-ink-3', color: 'text-text-1', label: 'OFF DUTY' },
  suspended: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'SUSPENDED' },
  damaged: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'DAMAGED' },
  retired: { bg: 'bg-ink-3', color: 'text-text-1', label: 'RETIRED' },
  in_use: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'IN USE' },
  decommissioned: { bg: 'bg-ink-3', color: 'text-text-1', label: 'DECOMMISSIONED' },
  inactive: { bg: 'bg-ink-3', color: 'text-text-1', label: 'INACTIVE' },
};

export const RISK_BADGE_STYLES: Record<
  string,
  { bg: string; color: string; label: string }
> = {
  low: { bg: 'bg-cds-teal-dim', color: 'text-cds-teal', label: 'LOW' },
  medium: { bg: 'bg-cds-amber-dim', color: 'text-cds-amber', label: 'MEDIUM' },
  high: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'HIGH' },
  critical: { bg: 'bg-cds-red-dim', color: 'text-cds-red', label: 'CRITICAL' },
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
