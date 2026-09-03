import { useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { CSSProperties, ReactNode } from 'react';

/**
 * Driver tracking activation — the entire driver-facing surface of Sonalit.
 *
 * The product rule is that the driver has almost nothing to do: scan, grant
 * location access, drive. So this page deliberately has no map, no journey
 * detail, no telemetry readout and no "stop tracking" button. The operational
 * journey ends the session (container delivered, convoy ended); a driver cannot
 * end it by accident, and there is nothing here worth staying on.
 *
 * After activation the UI collapses to an ambient confirmation rather than a
 * dashboard. It stays on screen for one honest reason: on the open web,
 * geolocation only runs while the page is alive. We therefore report our real
 * background capability to the server instead of claiming one we don't have —
 * Guardian would rather see "reliability at risk" than a green light that lies.
 *
 * Nothing is shown as LIVE until a real fix exists: activation puts the session
 * in `awaiting_location`, and this page holds on "Starting…" until the first
 * position lands.
 */

const API = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

type Phase =
  | 'loading'
  | 'invalid'
  | 'ended'
  | 'permission'
  | 'permission_denied'
  | 'services_off'
  | 'activating'
  | 'awaiting_fix'
  | 'active'
  | 'completed';

interface Journey {
  vehicle?: string | null;
  driver?: string | null;
  container?: string | null;
  destination?: string | null;
  booking?: string | null;
  containers?: number | null;
}

interface QueuedFix {
  lat: number; lng: number;
  accuracy_m: number | null; altitude_m: number | null;
  speed_kph: number | null; heading: number | null;
  device_time: string; battery_level: number | null;
  network_status: string; buffered: boolean;
}

const BUFFER_KEY = 'sonalit-track-buffer';
const TOKEN_KEY = 'sonalit-track-session';

/** Capacitor shells can hold location in the background; a browser tab cannot. */
function isNativeShell(): boolean {
  return typeof (window as unknown as { Capacitor?: unknown }).Capacitor !== 'undefined';
}

async function readBattery(): Promise<number | null> {
  try {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> };
    if (!nav.getBattery) return null;
    const b = await nav.getBattery();
    return Math.round(b.level * 100);
  } catch { return null; }
}

function loadBuffer(): QueuedFix[] {
  try { return JSON.parse(localStorage.getItem(BUFFER_KEY) ?? '[]') as QueuedFix[]; }
  catch { return []; }
}
function saveBuffer(fixes: QueuedFix[]) {
  // Cap the queue: a very long dead zone should cost the oldest points, not the
  // ability to store new ones.
  try { localStorage.setItem(BUFFER_KEY, JSON.stringify(fixes.slice(-500))); } catch { /* quota */ }
}

export default function DriverTrack() {
  const { token } = useParams({ strict: false }) as { token?: string };

  const [phase, setPhase] = useState<Phase>('loading');
  const [journey, setJourney] = useState<Journey>({});
  const [message, setMessage] = useState('');
  const [denials, setDenials] = useState(0);
  const [minimal, setMinimal] = useState(false);

  const sessionToken = useRef<string | null>(null);
  const watchId = useRef<number | null>(null);
  const pollTimer = useRef<number | null>(null);
  const stopped = useRef(false);

  /* ─── Validate the link ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!token) { setPhase('invalid'); return; }
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`${API}/track/${token}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (res.ok) {
          setJourney((body.data?.journey ?? {}) as Journey);
          setPhase('permission');
          return;
        }
        // A spent, revoked or finished link is a dead end by design — a driver
        // must never be able to restart a journey that has ended.
        setMessage(body.message ?? 'This tracking link is not valid.');
        setPhase(res.status === 404 ? 'invalid' : 'ended');
      } catch {
        if (!cancelled) { setMessage('Could not reach Sonalit. Check your connection.'); setPhase('invalid'); }
      }
    })();

    return () => { cancelled = true; };
  }, [token]);

  /* ─── Telemetry ─────────────────────────────────────────────────────────── */

  // Declared before flush(), which calls it: the journey can end mid-batch.
  const endJourney = useCallback(() => {
    stopped.current = true;
    if (watchId.current !== null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null; }
    if (pollTimer.current !== null) { window.clearInterval(pollTimer.current); pollTimer.current = null; }
    try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(BUFFER_KEY); } catch { /* ignore */ }
    setPhase('completed');
    setMinimal(false);
  }, []);

  const flush = useCallback(async (pending: QueuedFix[]): Promise<boolean> => {
    if (!sessionToken.current || !pending.length) return true;
    try {
      const res = await fetch(`${API}/track/session/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tracking-Session': sessionToken.current },
        body: JSON.stringify({ locations: pending }),
      });
      if (!res.ok) return false;
      const body = await res.json().catch(() => ({}));
      // The journey ended somewhere else in Sonalit — stop collecting, now.
      if (body.data?.terminated) endJourney();
      return true;
    } catch {
      return false;
    }
  }, [endJourney]);

  const startWatching = useCallback(() => {
    if (watchId.current !== null) return;

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (stopped.current) return;
        void (async () => {
          const battery = await readBattery();
          const fix: QueuedFix = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy_m: pos.coords.accuracy ?? null,
            altitude_m: pos.coords.altitude ?? null,
            speed_kph: pos.coords.speed != null ? pos.coords.speed * 3.6 : null,
            heading: pos.coords.heading ?? null,
            device_time: new Date(pos.timestamp).toISOString(),
            battery_level: battery,
            network_status: navigator.onLine ? 'online' : 'offline',
            buffered: !navigator.onLine,
          };

          // First real fix is what turns "Starting…" into activated — permission
          // granted is not the same as GPS working.
          setPhase((p) => (p === 'awaiting_fix' ? 'active' : p));

          const queue = [...loadBuffer(), fix];
          if (!navigator.onLine) { saveBuffer(queue); return; }

          const ok = await flush(queue);
          saveBuffer(ok ? [] : queue);
        })();
      },
      (err) => {
        if (stopped.current) return;
        // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE
        if (err.code === 1) { setDenials((d) => d + 1); setPhase('permission_denied'); }
        else if (err.code === 2) setPhase('services_off');
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
    );

    // Flush whatever the dead zone accumulated the moment we are back.
    const onOnline = () => { void (async () => { const q = loadBuffer(); if (q.length && await flush(q)) saveBuffer([]); })(); };
    window.addEventListener('online', onOnline);

    // The only poll this page makes: it exists so the journey can stop the
    // driver's phone without the driver doing anything.
    pollTimer.current = window.setInterval(() => {
      void (async () => {
        if (!sessionToken.current || stopped.current) return;
        try {
          const res = await fetch(`${API}/track/session/state`, {
            headers: { 'X-Tracking-Session': sessionToken.current },
          });
          const body = await res.json().catch(() => ({}));
          if (body.data?.terminated) endJourney();
        } catch { /* offline — try again next tick */ }
      })();
    }, 60_000);
  }, [flush, endJourney]);

  /* ─── Activation ────────────────────────────────────────────────────────── */

  const activate = useCallback(async () => {
    if (!token) return;
    setPhase('activating');

    // Ask the operating system for real permission. Never fake this dialog.
    const position = await new Promise<GeolocationPosition | null>((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve(p),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 30_000 },
      );
    });

    // Verify the outcome rather than assuming it.
    let permission = 'denied';
    try {
      const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
      if (status?.state === 'granted') permission = 'granted';
      else if (status?.state === 'prompt') permission = position ? 'granted' : 'not_determined';
    } catch {
      permission = position ? 'granted' : 'denied';
    }
    if (position) permission = 'granted';

    if (permission !== 'granted') {
      setDenials((d) => d + 1);
      setPhase('permission_denied');
      return;
    }

    const battery = await readBattery();
    try {
      const res = await fetch(`${API}/track/${token}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permission_status: 'granted',
          // Honest, not optimistic: a browser tab cannot hold location in the
          // background, and Guardian needs to know that.
          background_status: isNativeShell() ? 'granted' : 'unsupported',
          location_services_enabled: true,
          gps_available: true,
          platform: isNativeShell() ? 'capacitor' : 'web',
          app_version: (import.meta.env['VITE_APP_VERSION'] as string | undefined) ?? null,
          device: { label: navigator.userAgent.slice(0, 120), battery },
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMessage(body.message ?? 'Tracking could not be activated.');
        setPhase(res.status === 409 || res.status === 410 ? 'ended' : 'permission_denied');
        return;
      }

      sessionToken.current = body.data?.session_token ?? null;
      try { if (sessionToken.current) localStorage.setItem(TOKEN_KEY, sessionToken.current); } catch { /* ignore */ }

      setPhase('awaiting_fix');
      startWatching();
    } catch {
      setMessage('Could not reach Sonalit. Check your connection and try again.');
      setPhase('permission_denied');
    }
  }, [token, startWatching]);

  /* Collapse the confirmation into the ambient state — no dashboard. */
  useEffect(() => {
    if (phase !== 'active') return;
    const t = window.setTimeout(() => setMinimal(true), 2000);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => () => {
    if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
    if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
  }, []);

  /* ─── Screens ───────────────────────────────────────────────────────────── */

  return (
    <div style={S.page}>
      <style>{css}</style>
      <div style={S.card}>
        {phase === 'loading' && <Centered><div style={S.pulse} /><p style={S.sub}>Checking journey…</p></Centered>}

        {phase === 'invalid' && (
          <Centered>
            <div style={{ ...S.glyph, color: '#ff5c5c' }}>✕</div>
            <h1 style={S.h1}>Link not valid</h1>
            <p style={S.sub}>{message || 'This tracking link is not valid.'}</p>
          </Centered>
        )}

        {phase === 'ended' && (
          <Centered>
            <div style={{ ...S.glyph, color: '#94a3b8' }}>✓</div>
            <h1 style={S.h1}>Journey completed</h1>
            <p style={S.sub}>{message || 'This tracking link is no longer active.'}</p>
          </Centered>
        )}

        {phase === 'permission' && (
          <Centered>
            <div style={S.glyph}>📍</div>
            <h1 style={S.h1}>Location access required</h1>
            <p style={S.sub}>Sonalit needs your location to track this journey.</p>
            {journey.vehicle ? <div style={S.vehicle}>{journey.vehicle}</div> : null}
            <button style={S.button} onClick={() => void activate()}>Allow location</button>
          </Centered>
        )}

        {phase === 'activating' && <Centered><div style={S.pulse} /><p style={S.sub}>Starting…</p></Centered>}

        {phase === 'awaiting_fix' && (
          <Centered>
            <div style={S.pulse} />
            <h1 style={S.h1}>Waiting for location</h1>
            <p style={S.sub}>Keep this screen open for a moment.</p>
          </Centered>
        )}

        {phase === 'permission_denied' && (
          <Centered>
            <div style={{ ...S.glyph, color: '#ffb020' }}>⚠️</div>
            <h1 style={S.h1}>Location access is required</h1>
            <p style={S.sub}>
              {denials >= 2
                ? 'Location is still disabled. Please enable location access for this site in your device settings, then try again.'
                : (message || 'Sonalit couldn’t start journey tracking.')}
            </p>
            <button style={S.button} onClick={() => void activate()}>Try again</button>
          </Centered>
        )}

        {phase === 'services_off' && (
          <Centered>
            <div style={S.glyph}>📍</div>
            <h1 style={S.h1}>Location is turned off</h1>
            <p style={S.sub}>Please turn on Location Services, then try again.</p>
            <button style={S.button} onClick={() => void activate()}>Try again</button>
          </Centered>
        )}

        {phase === 'active' && !minimal && (
          <Centered>
            <div style={{ ...S.glyph, color: '#33d6a8' }}>✓</div>
            <h1 style={S.h1}>Tracking activated</h1>
            <p style={S.sub}>You can continue your journey.</p>
            {journey.vehicle ? <div style={S.vehicle}>{journey.vehicle}</div> : null}
          </Centered>
        )}

        {phase === 'active' && minimal && (
          <Centered>
            <div style={S.dot} />
            <p style={{ ...S.sub, marginTop: 18 }}>Tracking is active. You can put your phone away.</p>
          </Centered>
        )}

        {phase === 'completed' && (
          <Centered>
            <div style={{ ...S.glyph, color: '#33d6a8' }}>✓</div>
            <h1 style={S.h1}>Journey completed</h1>
            <p style={S.sub}>Tracking has stopped. Thank you.</p>
          </Centered>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div style={S.centered}>{children}</div>;
}

// `satisfies` rather than a Record annotation: the values are still checked as
// CSSProperties, but the keys stay literal so S.card doesn't trip
// noPropertyAccessFromIndexSignature.
const S = {
  page: {
    minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'radial-gradient(120% 100% at 50% 0%, #0e1626 0%, #070b16 55%, #04060d 100%)',
    padding: 24, fontFamily: 'var(--p-sans, system-ui, sans-serif)', color: '#e2e8f0',
  },
  card: { width: '100%', maxWidth: 400 },
  centered: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' },
  glyph: { fontSize: 44, lineHeight: 1, marginBottom: 18 },
  h1: { fontSize: 22, fontWeight: 700, margin: '0 0 8px', letterSpacing: '-0.01em' },
  sub: { fontSize: 14.5, lineHeight: 1.5, color: 'rgba(226,232,240,0.6)', margin: 0, maxWidth: 320 },
  vehicle: {
    marginTop: 20, fontFamily: 'var(--p-mono, ui-monospace, monospace)', fontSize: 15,
    letterSpacing: '0.12em', color: '#F0B429',
    border: '1px solid rgba(240,180,41,0.25)', borderRadius: 10, padding: '8px 16px',
  },
  button: {
    marginTop: 28, width: '100%', maxWidth: 320, height: 52, borderRadius: 14, border: 'none',
    background: '#f97316', color: '#170d00', fontSize: 15.5, fontWeight: 700, cursor: 'pointer',
    fontFamily: 'inherit',
  },
  pulse: {
    width: 46, height: 46, borderRadius: '50%', marginBottom: 18,
    border: '2px solid rgba(240,180,41,0.25)', borderTopColor: '#F0B429',
    animation: 'sonalit-spin 0.9s linear infinite',
  },
  dot: {
    width: 12, height: 12, borderRadius: '50%', background: '#33d6a8',
    boxShadow: '0 0 14px rgba(51,214,168,0.7)', animation: 'sonalit-breathe 2.4s ease-in-out infinite',
  },
} satisfies Record<string, CSSProperties>;

const css = `
  @keyframes sonalit-spin { to { transform: rotate(360deg); } }
  @keyframes sonalit-breathe { 0%,100% { opacity: .45; } 50% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    [style*="sonalit-spin"], [style*="sonalit-breathe"] { animation: none !important; }
  }
`;
