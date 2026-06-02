import React from 'react';
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react';

// ── PortalShell ───────────────────────────────────────────────────────────────
interface PortalShellProps { children: React.ReactNode; className?: string; }
export function PortalShell({ children, className = '' }: PortalShellProps) {
  return (
    <div
      className={`portal-root relative overflow-x-hidden ${className}`}
      style={{ background: 'var(--p-bg)', minHeight: '100dvh' }}
    >
      {children}
    </div>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────
interface StatCardProps {
  label: string;
  value: React.ReactNode;
  sub?: string;
  accent?: 'green' | 'orange' | 'red' | 'blue' | 'default';
  className?: string;
}
const ACCENT: Record<NonNullable<StatCardProps['accent']>, string> = {
  green: 'border-green-500/30 shadow-green-500/10',
  orange: 'border-orange-500/30 shadow-orange-500/10',
  red: 'border-red-500/30 shadow-red-500/10',
  blue: 'border-blue-500/30 shadow-blue-500/10',
  default: 'border-white/[0.07]',
};
export function StatCard({ label, value, sub, accent = 'default', className = '' }: StatCardProps) {
  return (
    <div
      className={`rounded-xl border p-4 shadow-lg ${ACCENT[accent]} ${className}`}
      style={{ background: 'linear-gradient(145deg,var(--p-surface),var(--p-surface2))' }}
    >
      <p className="text-xs text-white/40 uppercase tracking-widest mb-1">{label}</p>
      <p className="mono text-2xl font-medium text-white leading-none">{value}</p>
      {sub && <p className="text-xs text-white/40 mt-1">{sub}</p>}
    </div>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────
const BADGE_STYLES: Record<string, string> = {
  in_transit: 'bg-green-900/40 border-green-700/60 text-green-400',
  completed:  'bg-blue-900/40 border-blue-700/60 text-blue-400',
  pending:    'bg-gray-700/30 border-gray-600/60 text-gray-400',
  cancelled:  'bg-red-900/40 border-red-700/60 text-red-400',
  critical:   'bg-red-900/40 border-red-700/60 text-red-400',
  warning:    'bg-amber-900/40 border-amber-700/60 text-amber-400',
  info:       'bg-blue-900/30 border-blue-700/60 text-blue-300',
  intact:     'bg-green-900/40 border-green-700/60 text-green-400',
  compromised:'bg-red-900/40 border-red-700/60 text-red-400',
  unverified: 'bg-amber-900/30 border-amber-700/60 text-amber-400',
};
export function Badge({ label, variant }: { label: string; variant?: string }) {
  const cls = BADGE_STYLES[variant ?? label.toLowerCase()] ?? 'bg-gray-700/30 border-gray-600/60 text-gray-400';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      {label}
    </span>
  );
}

// ── ProgressBar ───────────────────────────────────────────────────────────────
export function ProgressBar({ pct, className = '' }: { pct: number; className?: string }) {
  return (
    <div className={`h-1.5 rounded-full bg-white/10 overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full bg-orange-500 transition-all duration-700"
        style={{ width: `${Math.min(Math.max(pct, 0), 100)}%` }}
      />
    </div>
  );
}

// ── RouteRibbon ───────────────────────────────────────────────────────────────
export function RouteRibbon({ origin, destination, progress }: { origin: string; destination: string; progress?: number | null }) {
  return (
    <div className="flex items-center gap-2 text-xs w-full overflow-hidden">
      <span className="text-white/60 truncate max-w-[40%]">{origin}</span>
      <div className="flex-1 flex items-center gap-0 min-w-0">
        <div className="h-px flex-1 bg-white/10 relative">
          {progress != null && (
            <div
              className="absolute inset-y-0 left-0 bg-orange-500/60 rounded-full"
              style={{ width: `${progress}%` }}
            />
          )}
        </div>
        <span className="text-orange-500/80 mx-1">→</span>
      </div>
      <span className="text-white/60 truncate max-w-[40%] text-right">{destination}</span>
    </div>
  );
}

// ── MapShell ──────────────────────────────────────────────────────────────────
export function MapShell({ children, className = '', style }: { children?: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`relative rounded-xl overflow-hidden border border-white/[0.07] ${className}`}
      style={{ background: '#0a0f1c', ...style }}
    >
      {children}
    </div>
  );
}

// ── TruckRow ──────────────────────────────────────────────────────────────────
interface TruckRowProps {
  registration: string;
  driverName: string | null;
  isMyCargo: boolean;
  speedKmh: number | null;
  lastPing: string | null;
}
export function TruckRow({ registration, driverName, isMyCargo, speedKmh, lastPing }: TruckRowProps) {
  return (
    <div className={`flex items-center justify-between px-3 py-2.5 rounded-lg border ${isMyCargo ? 'border-orange-500/30 bg-orange-500/5' : 'border-white/[0.06] bg-white/[0.02]'}`}>
      <div className="flex items-center gap-3 min-w-0">
        <span className={`w-2 h-2 rounded-full shrink-0 ${isMyCargo ? 'bg-orange-400 glow-orange' : 'bg-white/20'}`} />
        <div className="min-w-0">
          <p className="mono text-sm font-medium text-white">{registration}</p>
          {driverName && <p className="text-xs text-white/40 truncate">{driverName}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {speedKmh != null && (
          <span className="mono text-xs text-white/50">{Math.round(speedKmh)} km/h</span>
        )}
        {lastPing && (
          <span className="mono text-xs text-white/30">{relativeTime(lastPing)}</span>
        )}
        {isMyCargo && <span className="text-xs text-orange-400/80 font-semibold">YOUR CARGO</span>}
      </div>
    </div>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────
export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const sz = size === 'sm' ? 'w-7 h-7 text-xs' : size === 'lg' ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-xs';
  return (
    <div className={`${sz} rounded-full bg-orange-900/50 border border-orange-700/40 flex items-center justify-center shrink-0`}>
      <span className="font-bold text-orange-300">{initials}</span>
    </div>
  );
}

// ── EscortPanel ───────────────────────────────────────────────────────────────
const ROLE_LABELS: Record<string, string> = {
  armed_escort: 'Armed Escort',
  reaction_unit: 'Reaction Unit',
  traffic_management: 'Traffic Mgmt',
  medic: 'Medic',
};
interface EscortPanelProps {
  callsign: string;
  role: string;
  company: string | null;
  vehicleReg: string | null;
}
export function EscortPanel({ callsign, role, company, vehicleReg }: EscortPanelProps) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-blue-900/10 border border-blue-700/20">
      <div className="w-2 h-2 rounded-full bg-blue-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">{callsign}</p>
        <p className="text-xs text-blue-300/70">{ROLE_LABELS[role] ?? role}{company ? ` · ${company}` : ''}</p>
      </div>
      {vehicleReg && <span className="mono text-xs text-white/40">{vehicleReg}</span>}
    </div>
  );
}

// ── RosterItem ────────────────────────────────────────────────────────────────
export function RosterItem({ name, sub, badge }: { name: string; sub?: string; badge?: string }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white truncate">{name}</p>
        {sub && <p className="text-xs text-white/40 truncate">{sub}</p>}
      </div>
      {badge && <Badge label={badge} />}
    </div>
  );
}

// ── LedgerEvent ───────────────────────────────────────────────────────────────
interface LedgerEventProps {
  seq: number;
  kind: string;
  location: string | null;
  timestamp: string;
  officer: string | null;
  sealIntact: boolean | null;
  hash: string;
  verified: boolean;
  isLast: boolean;
}
const KIND_LABELS: Record<string, string> = {
  departure: 'Departure',
  checkpoint: 'Checkpoint',
  handoff: 'Handoff',
  seal_check: 'Seal Check',
  arrival: 'Arrival',
  exception: 'Exception',
};
export function LedgerEvent({ seq, kind, location, timestamp, officer, sealIntact, hash, verified, isLast }: LedgerEventProps) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className={`w-3 h-3 rounded-full border-2 shrink-0 mt-0.5 ${verified ? 'border-green-500 bg-green-500/20' : 'border-red-500 bg-red-500/20'}`} />
        {!isLast && <div className="w-px flex-1 bg-white/10 my-1" />}
      </div>
      <div className="pb-5 flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold text-white">{KIND_LABELS[kind] ?? kind}</span>
          {sealIntact === true && <ShieldCheck size={13} className="text-green-400" />}
          {sealIntact === false && <ShieldAlert size={13} className="text-red-400" />}
          {sealIntact === null && kind === 'seal_check' && <ShieldQuestion size={13} className="text-amber-400" />}
        </div>
        {location && <p className="text-xs text-white/50 mb-1">{location}</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
          <span className="mono text-xs text-white/30">{new Date(timestamp).toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' })}</span>
          {officer && <span className="text-xs text-white/40">{officer}</span>}
          <span className={`mono text-[10px] truncate max-w-[12ch] ${verified ? 'text-green-400/50' : 'text-red-400/50'}`} title={hash}>
            #{seq} {hash.slice(0, 8)}…
          </span>
        </div>
      </div>
    </div>
  );
}

// ── BottomNav ─────────────────────────────────────────────────────────────────
interface NavItem { label: string; icon: React.ReactNode; active?: boolean; onClick: () => void; }
export function BottomNav({ items }: { items: NavItem[] }) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.07] flex safe-b"
      style={{ background: 'rgba(7,11,22,0.97)', backdropFilter: 'blur(12px)' }}>
      {items.map((item, i) => (
        <button
          key={i}
          onClick={item.onClick}
          className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${item.active ? 'text-orange-400' : 'text-white/40 hover:text-white/70'}`}
        >
          {item.icon}
          <span className="text-[10px] font-medium">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
export function relativeTime(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
}
