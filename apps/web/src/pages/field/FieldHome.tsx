import { Link } from '@tanstack/react-router';
import { Anchor, Truck, LogOut } from 'lucide-react';
import { useAuthStore } from '../../stores/auth.js';

export default function FieldHome() {
  const user = useAuthStore(s => s.user);
  const clearAuth = useAuthStore(s => s.clearAuth);

  return (
    <div className="min-h-screen w-full bg-[#0B111C] text-white flex flex-col">
      <header className="flex items-center justify-between px-5 pt-6 pb-4">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-widest text-white/40">Sonalit CDS</div>
          <div className="text-lg font-bold">Field Ops</div>
        </div>
        <button
          onClick={() => { clearAuth(); window.location.href = '/login'; }}
          className="w-9 h-9 rounded-lg bg-white/[.05] border border-white/10 text-white/60 flex items-center justify-center"
          aria-label="Sign out"
        >
          <LogOut size={16} />
        </button>
      </header>

      <div className="px-5 mb-4">
        <div className="text-[11px] font-mono text-white/50">
          Signed in as <span className="text-white/80">{user?.name || user?.email}</span>
        </div>
      </div>

      <main className="flex-1 px-5 py-2 space-y-3">
        <RoleTile
          to="/field/yard"
          title="Yard Team"
          subtitle="Clamp e-locks onto containers before dispatch"
          icon={<Truck size={28} strokeWidth={1.6} />}
          accent="#ff7a00"
        />
        <RoleTile
          to="/field/port"
          title="Port Team"
          subtitle="Unclamp e-locks on arrival at port"
          icon={<Anchor size={28} strokeWidth={1.6} />}
          accent="#37e6ff"
        />
      </main>

      <footer className="p-5 text-center text-[10px] font-mono text-white/25">
        Sonalit Field · Real-time sync with CDS control room
      </footer>
    </div>
  );
}

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
          <div className="text-[16px] font-bold text-white">{title}</div>
          <div className="text-[12px] text-white/50 mt-0.5">{subtitle}</div>
        </div>
        <div className="text-white/30 text-xl">›</div>
      </div>
    </Link>
  );
}
