import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardList,
  LockKeyhole,
  MapPin,
  RefreshCw,
  Truck,
  Unlock,
} from 'lucide-react';

type ActivityIconProps = {
  kind: unknown;
  className?: string;
};

function iconFor(kind: unknown) {
  const value = String(kind ?? '').toLowerCase();
  if (value.includes('unclamp') || value.includes('unlock') || value.includes('remove')) return Unlock;
  if (value.includes('clamp') || value.includes('lock') || value.includes('tamper')) return LockKeyhole;
  if (value.includes('depart') || value.includes('vehicle') || value.includes('trip')) return Truck;
  if (value.includes('checkpoint') || value.includes('location') || value.includes('gps')) return MapPin;
  if (value.includes('sync') || value.includes('update')) return RefreshCw;
  if (value.includes('arrival') || value.includes('deliver') || value.includes('complete')) return CheckCircle2;
  if (value.includes('ai') || value.includes('intelligence')) return Bot;
  if (value.includes('alert') || value.includes('incident') || value.includes('exception')) return AlertTriangle;
  if (value.includes('booking') || value.includes('document') || value.includes('manifest')) return ClipboardList;
  return Activity;
}

export function CDSActivityIcon({ kind, className = '' }: ActivityIconProps) {
  const Icon = iconFor(kind);
  return (
    <span className={['cds-activity-icon', className].filter(Boolean).join(' ')} aria-hidden="true">
      <Icon size={16} strokeWidth={1.9} />
    </span>
  );
}
