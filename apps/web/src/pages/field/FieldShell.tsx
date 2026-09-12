/**
 * Route shell for /field/**.
 *
 * This is what makes the Field app a separate app rather than a page inside
 * the operator dashboard: it hangs off the router root, not off authRoute, so
 * it never consults the operator session and an operator session never
 * unlocks it. The only credentials in play are the ones in
 * lib/fieldSession.ts.
 *
 * It also owns the boot sequence. The stored device and session tokens are
 * verified against the server before anything renders, so a revoked tablet
 * lands on the pairing screen instead of discovering the problem halfway
 * through a clamp.
 *
 * And it holds the one realtime subscription for the whole field app, so a
 * crew moving between the home screen and their queue never drops the
 * connection — and so a clamp made at the gate reaches the port tablet the
 * moment it happens rather than on its next 15s poll.
 */
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';

import { useCDSRealtime } from '../cds/useCDSRealtime.js';

import { useFieldAuth } from './fieldAuth.js';
import { PairScreen, LockScreen, PinChangeScreen } from './FieldLogin.js';

export default function FieldShell() {
  const phase = useFieldAuth(s => s.phase);
  const worker = useFieldAuth(s => s.worker);
  const mustChangePin = useFieldAuth(s => s.mustChangePin);
  const boot = useFieldAuth(s => s.boot);
  const path = useRouterState({ select: s => s.location.pathname });
  const navigate = useNavigate();

  useEffect(() => { void boot(); }, [boot]);

  // Subscribes on the field session's own realtime token (see
  // backend/src/routes/realtime.js) — no operator credentials involved.
  useCDSRealtime(worker?.org_id);

  // A yard account on /field/port (or the reverse) would render a screen whose
  // every request 403s — the backend gate in routes/cds.js is scoped per role.
  // Bounce to the home screen instead of showing a dead surface.
  const wrongTeam = Boolean(
    worker && (
      (path.startsWith('/field/yard') && worker.role !== 'yard_agent') ||
      (path.startsWith('/field/port') && worker.role !== 'port_agent') ||
      (path.startsWith('/field/response') && worker.role !== 'response_crew') ||
      // Departures is yard work and the backend gate scopes it to yard_agent,
      // so anyone else lands on the same dead surface the other three avoid.
      (path.startsWith('/field/departures') && worker.role !== 'yard_agent')
    ),
  );
  useEffect(() => {
    if (wrongTeam) void navigate({ to: '/field' });
  }, [wrongTeam, navigate]);

  if (phase === 'booting') {
    return (
      <div className="min-h-screen w-full bg-ink-0 text-text-2 flex items-center justify-center gap-2 text-[12px] font-mono">
        <Loader2 size={16} className="animate-spin" /> Checking this device…
      </div>
    );
  }
  if (phase === 'unpaired') return <PairScreen />;
  if (phase === 'locked' || !worker) return <LockScreen />;
  if (mustChangePin) {
    return <PinChangeScreen onDone={() => { useFieldAuth.setState({ mustChangePin: false }); }} />;
  }
  // The redirect above is queued in an effect, so hold the frame rather than
  // mounting the wrong team's screen for one render — YardApp/PortApp fire
  // their queue fetches on mount, which is exactly what would 403.
  if (wrongTeam) return null;

  return <Outlet />;
}
