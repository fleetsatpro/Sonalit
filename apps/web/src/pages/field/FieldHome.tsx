import { Link } from '@tanstack/react-router';
import { Anchor, ChevronRight, LogOut, Package, Truck } from 'lucide-react';
import { useMemo } from 'react';

import { usePortQueue, useYardQueue } from '../cds/hooks.js';

import { useFieldAuth } from './fieldAuth.js';
import { OfflineBanner } from './OfflineBanner.js';

// A field account is one team, by construction: the backend gate in
// routes/cds.js lets a yard_agent reach only the clamp flow and a port_agent
// only the unclamp flow, so showing the other tile would be showing a screen
// whose every request 403s.
const ROLE_LABEL: Record<string, string> = {
  yard_agent: 'Yard Team', port_agent: 'Port Team',
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  if (h < 21) return 'Good evening';
  return 'Working late';
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  if (!first) return '?';
  return (first + (parts[1]?.[0] ?? '')).toUpperCase();
}

export default function FieldHome() {
  const worker = useFieldAuth(s => s.worker);
  const device = useFieldAuth(s => s.device);
  const signOut = useFieldAuth(s => s.signOut);
  const role = worker?.role ?? '';
  const canYard = role === 'yard_agent';
  const canPort = role === 'port_agent';

  const yardQueue = useYardQueue(canYard);
  const portQueue = usePortQueue(canPort);
  const pendingClamp = useMemo(
    () => (yardQueue.data?.data ?? []).reduce((n, b) => n + Number(b['pending_containers'] ?? 0), 0),
    [yardQueue.data]
  );
  const inTransit = portQueue.data?.data?.length ?? 0;

  // Deliberately no auto-redirect into the single tile. On a shared tablet the
  // first thing that matters is *who the device thinks you are* — every clamp
  // from here is signed into the custody chain under this name, so the crew
  // gets one screen to notice they're still signed in as the last shift
  // before they act.
  const name = worker?.name || 'Field crew';

  return (
    <div className="min-h-screen w-full bg-ink-0 text-text-0 flex flex-col relative overflow-hidden">
      {/* Ambient glow — orange bleeding from top-left, cyan from bottom-right, echoing
          the yard/port split before the user has even picked a tile. */}
      <div className="pointer-events-none absolute -top-24 -left-24 w-72 h-72 rounded-full opacity-[.14] blur-3xl"
        style={{ background: 'radial-gradient(closest-side, #ff7a00, transparent)' }} />
      <div className="pointer-events-none absolute -bottom-32 -right-16 w-80 h-80 rounded-full opacity-[.12] blur-3xl"
        style={{ background: 'radial-gradient(closest-side, #37e6ff, transparent)' }} />

      <header className="relative flex items-center justify-between px-5 pt-6 pb-2">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #ff7a00, #F0B429)' }}>
            <Truck size={16} strokeWidth={2.5} color="#170d00" />
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-text-2 leading-none">Sonalit CDS</div>
            <div className="text-[15px] font-bold leading-tight mt-0.5">Field Ops</div>
          </div>
        </div>
        <button
          onClick={() => { void signOut(); }}
          className="w-9 h-9 rounded-lg bg-white/[.05] border border-white/10 text-text-1 flex items-center justify-center active:scale-95 transition-transform cursor-pointer"
          aria-label="Hand over device"
        >
          <LogOut size={16} />
        </button>
      </header>

      <div className="relative px-5 mt-4 mb-6 flex items-center gap-3">
        <div className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-[13px] font-bold"
          style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)' }}>
          {initials(name)}
        </div>
        <div className="min-w-0">
          <div className="text-[19px] font-bold leading-tight truncate">{greeting()}, {name.split(' ')[0]}</div>
          <div className="text-[11px] font-mono text-text-2 mt-0.5">
            {ROLE_LABEL[role] ?? role}{device ? ` · ${[device.label, device.site].filter(Boolean).join(' · ')}` : ''}
          </div>
        </div>
      </div>

      <div className="relative -mx-1">
        <OfflineBanner />
      </div>

      <main className="relative flex-1 px-5 space-y-3">
        {canYard && (
          <RoleTile
            to="/field/yard"
            title="Yard Team"
            subtitle="Clamp e-locks onto containers before dispatch"
            icon={<Truck size={26} strokeWidth={1.8} />}
            accent="#ff7a00"
            stat={pendingClamp > 0 ? `${pendingClamp} pending clamp` : 'All caught up'}
            statLoading={yardQueue.isLoading}
            urgent={pendingClamp > 0}
          />
        )}
        {canPort && (
          <RoleTile
            to="/field/port"
            title="Port Team"
            subtitle="Unclamp e-locks on arrival at port"
            icon={<Anchor size={26} strokeWidth={1.8} />}
            accent="#37e6ff"
            stat={inTransit > 0 ? `${inTransit} in transit` : 'Queue is empty'}
            statLoading={portQueue.isLoading}
            urgent={inTransit > 0}
          />
        )}
        {!canYard && !canPort && (
          <div className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5 text-[12px] text-text-2">
            This account isn't set up for Yard or Port field ops. Ask a supervisor to assign the Yard Agent or Port Agent role.
          </div>
        )}
      </main>

      <footer className="relative p-5 text-center text-[10px] font-mono text-text-2/70 flex items-center justify-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-cds-teal animate-pulse-dot" />
        Real-time sync with CDS control room
      </footer>
    </div>
  );
}

// accent takes a hex literal rather than a Tailwind class because the glow/
// tint below is computed by appending an alpha suffix to it at render time —
// there's no Tailwind utility for that. The two callers pass the same hex as
// cds-orange (#ff7a00) and cds-cyan (#37e6ff) so it still tracks the token
// palette in tailwind.config.ts, just via the one place Tailwind can't reach.
function RoleTile({ to, title, subtitle, icon, accent, stat, statLoading, urgent }: {
  to: string; title: string; subtitle: string; icon: React.ReactNode; accent: string;
  stat: string; statLoading: boolean; urgent: boolean;
}) {
  return (
    <Link
      to={to}
      className="group block rounded-2xl border border-white/[.08] bg-white/[.03] p-5 active:scale-[.985] transition-all relative overflow-hidden"
      style={{ boxShadow: `inset 0 0 0 1px ${accent}10, 0 8px 28px -14px ${accent}66` }}
    >
      {/* Diagonal sheen — a thin band of the accent colour cutting across the
          card, the same trick the CTA gradient buttons use, so a static tile
          still reads as "live equipment" rather than a flat list row. */}
      <div className="pointer-events-none absolute inset-0 opacity-[.06]"
        style={{ background: `linear-gradient(115deg, transparent 40%, ${accent} 50%, transparent 60%)` }} />

      <div className="relative flex items-center gap-4">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center flex-shrink-0 transition-transform group-active:scale-95"
          style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}44`, boxShadow: `0 0 20px -6px ${accent}88` }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[17px] font-bold text-text-0 leading-tight">{title}</div>
          <div className="text-[12px] text-text-2 mt-1 leading-snug">{subtitle}</div>
          <div className="mt-2.5 inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-bold font-mono uppercase tracking-wide"
            style={urgent
              ? { color: accent, background: `${accent}1a`, border: `1px solid ${accent}44` }
              : { color: 'rgba(255,255,255,.45)', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.08)' }}>
            <Package size={10} />
            {statLoading ? 'Loading…' : stat}
          </div>
        </div>
        <ChevronRight size={20} className="text-text-2 flex-shrink-0 transition-transform group-active:translate-x-0.5" />
      </div>
    </Link>
  );
}
