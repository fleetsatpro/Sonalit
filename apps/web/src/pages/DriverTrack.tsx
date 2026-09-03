import { useParams } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';


import { selectProvider } from '../lib/trackingProviders.js';

import type { Capability, TrackingFix, TrackingProvider } from '../lib/trackingProviders.js';
import type { CSSProperties, ReactNode } from 'react';

/**
 * Driver tracking activation — the entire driver-facing surface of Sonalit.
 *
 * Scan, grant location, drive. No map, no journey detail, no telemetry readout
 * and no "stop tracking" button: the operational journey ends the session, so a
 * driver cannot end one by accident and has no reason to stay here.
 *
 * Location capture is delegated to a TrackingProvider (see lib/trackingProviders),
 * so the native background path is a different adapter rather than a different
 * screen. What this page will not do is overstate the adapter it got: on the
 * open web it says plainly that the page must stay open, because a browser tab
 * genuinely stops producing fixes once it is backgrounded. Guardian is told the
 * same thing through the capability block.
 *
 * Nothing reads as activated until a real fix arrives — permission granted is
 * not the same as GPS working.
 */

const API = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';

type Phase =
  | 'loading' | 'invalid' | 'ended'
  | 'permission' | 'permission_denied' | 'services_off'
  | 'activating' | 'awaiting_fix' | 'active' | 'completed';

interface Journey {
  vehicle?: string | null;
  container?: string | null;
  destination?: string | null;
  containers?: number | null;
}

const BUFFER_KEY = 'sonalit-track-buffer';

function loadBuffer(): TrackingFix[] {
  try { return JSON.parse(localStorage.getItem(BUFFER_KEY) ?? '[]') as TrackingFix[]; }
  catch { return []; }
}
function saveBuffer(fixes: TrackingFix[]) {
  // Cap the queue: a long dead zone should cost the oldest points, not the
  // ability to record new ones.
  try { localStorage.setItem(BUFFER_KEY, JSON.stringify(fixes.slice(-500))); } catch { /* quota */ }
}

export default function DriverTrack() {
  const { token } = useParams({ strict: false }) as { token?: string };

  const [phase, setPhase] = useState<Phase>('loading');
  const [journey, setJourney] = useState<Journey>({});
  const [message, setMessage] = useState('');
  const [denials, setDenials] = useState(0);
  const [minimal, setMinimal] = useState(false);
  const [backgroundOk, setBackgroundOk] = useState(false);

  const provider = useRef<TrackingProvider | null>(null);
  const sessionToken = useRef<string | null>(null);
  const pollTimer = useRef<number | null>(null);
  const stopped = useRef(false);

  if (provider.current === null) provider.current = selectProvider();

  /* ─── Validate the link ─────────────────────────────────────────────────── */
  useEffect(() => {
    if (!token) { setPhase('invalid'); return; }
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch(`${API}/track/${token}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) { setJourney((body.data?.journey ?? {}) as Journey); setPhase('permission'); return; }
        // A spent, revoked or finished link is a dead end by design.
        setMessage(body.message ?? 'This tracking link is not valid.');
        setPhase(res.status === 404 ? 'invalid' : 'ended');
      } catch {
        if (!cancelled) { setMessage('Could not reach Sonalit. Check your connection.'); setPhase('invalid'); }
      }
    })();

    return () => { cancelled = true; };
  }, [token]);

  /* ─── Telemetry ─────────────────────────────────────────────────────────── */

  const endJourney = useCallback(() => {
    stopped.current = true;
    void provider.current?.stop();
    if (pollTimer.current !== null) { window.clearInterval(pollTimer.current); pollTimer.current = null; }
    try { localStorage.removeItem(BUFFER_KEY); } catch { /* ignore */ }
    setPhase('completed');
    setMinimal(false);
  }, []);

  const flush = useCallback(async (pending: TrackingFix[]): Promise<boolean> => {
    if (!sessionToken.current || !pending.length) return true;
    try {
      const res = await fetch(`${API}/track/session/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tracking-Session': sessionToken.current },
        body: JSON.stringify({ locations: pending }),
      });
      if (!res.ok) return false;
      const body = await res.json().catch(() => ({}));
      if (body.data?.terminated) endJourney();
      return true;
    } catch { return false; }
  }, [endJourney]);

  const reportCapability = useCallback(async (cap: Partial<Capability>) => {
    if (!sessionToken.current) return;
    try {
      await fetch(`${API}/track/session/capability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tracking-Session': sessionToken.current },
        body: JSON.stringify({
          permission_status: cap.location_permission,
          background_status: cap.background_status,
          location_services_enabled: cap.location_services ?? null,
          failure_reason: cap.failure_reason ?? null,
        }),
      });
    } catch { /* reported again on the next change */ }
  }, []);

  const beginTracking = useCallback(async () => {
    const p = provider.current;
    if (!p) return;

    await p.start(
      (fix) => {
        if (stopped.current) return;
        // First real fix is what turns "Waiting for location" into activated.
        setPhase((prev) => (prev === 'awaiting_fix' ? 'active' : prev));
        void (async () => {
          const queue = [...loadBuffer(), fix];
          if (!navigator.onLine) { saveBuffer(queue); return; }
          const ok = await flush(queue);
          saveBuffer(ok ? [] : queue);
        })();
      },
      (kind) => {
        if (stopped.current) return;
        if (kind === 'permission_denied') {
          setDenials((d) => d + 1);
          setPhase('permission_denied');
          void reportCapability({ location_permission: 'denied', failure_reason: 'revoked_mid_journey' });
        } else if (kind === 'position_unavailable') {
          setPhase('services_off');
          void reportCapability({ location_services: false, failure_reason: 'position_unavailable' });
        }
      },
    );

    const onOnline = () => {
      void (async () => { const q = loadBuffer(); if (q.length && await flush(q)) saveBuffer([]); })();
    };
    window.addEventListener('online', onOnline);

    // The only poll this page makes: so the journey can stop the phone without
    // the driver doing anything.
    pollTimer.current = window.setInterval(() => {
      void (async () => {
        if (!sessionToken.current || stopped.current) return;
        try {
          const res = await fetch(`${API}/track/session/state`, {
            headers: { 'X-Tracking-Session': sessionToken.current },
          });
          const body = await res.json().catch(() => ({}));
          if (body.data?.terminated) endJourney();
        } catch { /* offline — retry next tick */ }
      })();
    }, 60_000);
  }, [flush, endJourney, reportCapability]);

  /* ─── Activation ────────────────────────────────────────────────────────── */

  const activate = useCallback(async () => {
    if (!token || !provider.current) return;
    setPhase('activating');

    // Real OS permission flow, then verify the outcome.
    const cap = await provider.current.requestCapability();

    if (cap.location_permission !== 'granted') {
      setDenials((d) => d + 1);
      setPhase(cap.location_services === false ? 'services_off' : 'permission_denied');
      return;
    }

    try {
      const res = await fetch(`${API}/track/${token}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          permission_status: 'granted',
          // Reported as measured, never as hoped. The server re-normalises and
          // pins a web runtime to 'unsupported' regardless of what we send.
          runtime: cap.runtime,
          platform: cap.platform,
          background_status: cap.background_status,
          location_services_enabled: cap.location_services,
          gps_available: true,
          failure_reason: cap.failure_reason,
          app_version: (import.meta.env['VITE_APP_VERSION'] as string | undefined) ?? null,
          device: { label: navigator.userAgent.slice(0, 120) },
        }),
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setMessage(body.message ?? 'Tracking could not be activated.');
        setPhase(res.status === 409 || res.status === 410 ? 'ended' : 'permission_denied');
        return;
      }

      sessionToken.current = body.data?.session_token ?? null;
      // Trust the server's resolution, not our own claim, so the driver sees
      // exactly what Guardian sees.
      setBackgroundOk(body.data?.background_reliable === true);
      setPhase('awaiting_fix');
      await beginTracking();
    } catch {
      setMessage('Could not reach Sonalit. Check your connection and try again.');
      setPhase('permission_denied');
    }
  }, [token, beginTracking]);

  /* Collapse the confirmation — no dashboard. */
  useEffect(() => {
    if (phase !== 'active') return;
    const t = window.setTimeout(() => setMinimal(true), 2000);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => () => {
    void provider.current?.stop();
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
            {/* Web genuinely stops when the page is backgrounded, so say so
                rather than implying an unattended journey is covered. */}
            <p style={S.sub}>
              {backgroundOk
                ? 'You can continue your journey.'
                : 'Keep this page open while you drive.'}
            </p>
            {journey.vehicle ? <div style={S.vehicle}>{journey.vehicle}</div> : null}
          </Centered>
        )}

        {phase === 'active' && minimal && (
          <Centered>
            <div style={S.dot} />
            <p style={{ ...S.sub, marginTop: 18 }}>
              {backgroundOk
                ? 'Tracking is active. You can put your phone away.'
                : 'Tracking is active. Keep this page open.'}
            </p>
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

// `satisfies` rather than a Record annotation: values stay checked as
// CSSProperties, but keys stay literal so S.card doesn't trip
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
