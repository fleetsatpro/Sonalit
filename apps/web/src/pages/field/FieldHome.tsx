import { Link, useNavigate } from '@tanstack/react-router';
import { Anchor, Truck, LogOut } from 'lucide-react';
import { useEffect } from 'react';

import { useAuthStore } from '../../stores/auth.js';

// yard_agent/port_agent are scoped, single-purpose logins (see migration 077
// + the field-role gating in backend/src/routes/cds.js) — a device carrying
// one of those accounts has no use for the other team's tile, since the API
// would 403 it anyway. admin/dispatcher/operator keep both: they're the
// roles a supervisor actually carries between yard and port.
const CAN_YARD = new Set(['admin', 'dispatcher', 'operator', 'yard_agent']);
const CAN_PORT = new Set(['admin', 'dispatcher', 'operator', 'port_agent']);

export default function FieldHome() {
  const user = useAuthStore(s => s.user);
  const clearAuth = useAuthStore(s => s.clearAuth);
  const navigate = useNavigate();
  const role = user?.role ?? '';
  const canYard = CAN_YARD.has(role);
  const canPort = CAN_PORT.has(role);

  // A single-tile account skips the picker — there's nothing to pick.
  useEffect(() => {
    if (canYard && !canPort) void navigate({ to: '/field/yard' });
    else if (canPort && !canYard) void navigate({ to: '/field/port' });
  }, [canYard, canPort, navigate]);

  if ((canYard && !canPort) || (canPort && !canYard)) return null;

  return (
    <div className="min-h-screen w-full bg-ink-0 text-text-0 flex flex-col">
      <header className="flex items-center justify-between px-5 pt-6 pb-4">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-text-2">Sonalit CDS</div>
          <div className="text-lg font-bold">Field Ops</div>
        </div>
        <button
          onClick={() => { clearAuth(); window.location.href = '/login'; }}
          className="w-9 h-9 rounded-lg bg-white/[.05] border border-white/10 text-text-1 flex items-center justify-center"
          aria-label="Sign out"
        >
          <LogOut size={16} />
        </button>
      </header>

      <div className="px-5 mb-4">
        <div className="text-[11px] font-mono text-text-2">
          Signed in as <span className="text-text-1">{user?.name || user?.email}</span>
        </div>
      </div>

      <main className="flex-1 px-5 py-2 space-y-3">
        {canYard && (
          <RoleTile
            to="/field/yard"
            title="Yard Team"
            subtitle="Clamp e-locks onto containers before dispatch"
            icon={<Truck size={28} strokeWidth={1.6} />}
            accent="#ff7a00"
          />
        )}
        {canPort && (
          <RoleTile
            to="/field/port"
            title="Port Team"
            subtitle="Unclamp e-locks on arrival at port"
            icon={<Anchor size={28} strokeWidth={1.6} />}
            accent="#37e6ff"
          />
        )}
        {!canYard && !canPort && (
          <div className="rounded-2xl border border-white/[.08] bg-white/[.03] p-5 text-[12px] text-text-2">
            Your account isn't set up for Yard or Port field ops. Ask an admin to assign the Yard Agent or Port Agent role.
          </div>
        )}
      </main>

      <footer className="p-5 text-center text-[10px] font-mono text-text-2/70">
        Sonalit Field · Real-time sync with CDS control room
      </footer>
    </div>
  );
}

// accent takes a hex literal rather than a Tailwind class because the glow/
// tint below is computed by appending an alpha suffix to it at render time —
// there's no Tailwind utility for that. The two callers pass the same hex as
// cds-orange (#ff7a00) and cds-cyan (#37e6ff) so it still tracks the token
// palette in tailwind.config.ts, just via the one place Tailwind can't reach.
function RoleTile({ to, title, subtitle, icon, accent }: {
  to: string; title: string; subtitle: string;
  icon: React.ReactNode; accent: string;
}) {
  return (
    <Link
      to={to}
      className="block rounded-2xl border border-white/[.08] bg-white/[.03] p-5 active:brightness-110 transition-all"
      style={{ boxShadow: `inset 0 0 0 1px ${accent}10, 0 6px 24px -12px ${accent}55` }}
    >
      <div className="flex items-center gap-4">
        <div
          className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: `${accent}18`, color: accent, border: `1px solid ${accent}44` }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[16px] font-bold text-text-0">{title}</div>
          <div className="text-[12px] text-text-2 mt-0.5">{subtitle}</div>
        </div>
        <div className="text-text-2 text-xl">›</div>
      </div>
    </Link>
  );
}
