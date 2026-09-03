/**
 * The one place that knows whether Sonalit is reachable.
 *
 * `navigator.onLine` is scattered across seven files in this app today, and it
 * answers the wrong question: it reports whether a network interface is up, not
 * whether our API is answering. A captive portal, a cell tower that accepts
 * associations but routes nothing, an Android radio that stays "connected" to a
 * dead AP — all of them report online while every request fails. Meanwhile the
 * inverse is rarer but real: a WebView can report offline while requests
 * succeed. So `navigator.onLine` is used here as a *hint that shortcuts a
 * probe*, never as the verdict.
 *
 * The verdict comes from actual traffic:
 *
 *   - Every real API call reports its outcome here (see
 *     `attachConnectivityReporter` in lib/api.ts). That is free signal, and it is the highest-quality signal
 *     there is: it is exactly the thing we care about succeeding.
 *   - A lightweight probe fills the gaps when the app is idle. It is a HEAD-like
 *     GET against a small endpoint, on a schedule that stretches as things get
 *     worse, because a health check that saturates a 2G link is a bug.
 *
 * DEGRADED exists because a slow link needs different behaviour from a dead
 * one: keep working, send less. It is entered on latency, not on failure.
 */

import { CHAOS, chaosDelay, chaosShouldFail } from './chaos.js';

import type { ConnectivitySnapshot, ConnectivityState } from './types.js';

type Listener = (s: ConnectivitySnapshot) => void;

/** Above this round-trip, the link is treated as degraded. Roughly 3G-on-a-bad-day. */
const DEGRADED_LATENCY_MS = 2_000;

/**
 * Consecutive probe failures before declaring OFFLINE.
 *
 * Two, not one: a single failed request is extremely common on mobile and
 * flipping the whole app into offline mode over one dropped packet produces a
 * UI that strobes between modes on a merely mediocre connection.
 */
const OFFLINE_AFTER_FAILURES = 2;

const PROBE_INTERVAL = {
  ONLINE: 60_000,
  DEGRADED: 30_000,
  /** Fast enough to notice recovery, slow enough not to drain a battery in a dead zone. */
  OFFLINE: 15_000,
  UNKNOWN: 5_000,
  SYNCING: 60_000,
} as const;

const LATENCY_WINDOW = 5;

let snapshot: ConnectivitySnapshot = {
  state: 'UNKNOWN',
  networkUp: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
  apiReachable: false,
  realtimeConnected: false,
  latencyMs: null,
  lastSuccessfulRequestAt: null,
  lastSuccessfulSyncAt: null,
  consecutiveFailures: 0,
};

const listeners = new Set<Listener>();
const latencies: number[] = [];
let probeTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;
let probing = false;
/** Set while a sync run owns the state, so probes do not clobber SYNCING. */
let syncingDepth = 0;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid] ?? null;
  const lo = s[mid - 1];
  const hi = s[mid];
  return lo != null && hi != null ? (lo + hi) / 2 : null;
}

function emit(): void {
  const s = getSnapshot();
  for (const l of listeners) {
    // One misbehaving subscriber must not stop the others from learning that
    // the network came back.
    try { l(s); } catch { /* subscriber's problem */ }
  }
}

/**
 * Derive the state from the evidence.
 *
 * Exported for testing: this is the decision the whole layer turns on, and it
 * should be verifiable without a browser, a timer or a network.
 */
export function deriveState(input: {
  networkUp: boolean;
  apiReachable: boolean;
  consecutiveFailures: number;
  latencyMs: number | null;
  everProbed: boolean;
}): ConnectivityState {
  if (!input.everProbed) return 'UNKNOWN';

  // The OS saying "no interface" is trustworthy in the negative direction: if
  // there is genuinely no network, there is no point probing to confirm it.
  if (!input.networkUp) return 'OFFLINE';

  if (!input.apiReachable) {
    return input.consecutiveFailures >= OFFLINE_AFTER_FAILURES ? 'OFFLINE' : 'DEGRADED';
  }

  if (input.latencyMs != null && input.latencyMs > DEGRADED_LATENCY_MS) return 'DEGRADED';

  return 'ONLINE';
}

let everProbed = false;

function recompute(): void {
  const next = syncingDepth > 0 && snapshot.apiReachable
    ? 'SYNCING'
    : deriveState({
      networkUp: snapshot.networkUp,
      apiReachable: snapshot.apiReachable,
      consecutiveFailures: snapshot.consecutiveFailures,
      latencyMs: snapshot.latencyMs,
      everProbed,
    });

  if (next !== snapshot.state) {
    snapshot = { ...snapshot, state: next };
    emit();
  }
}

export function getSnapshot(): ConnectivitySnapshot {
  return { ...snapshot };
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * Report the outcome of a real API request.
 *
 * This is the primary sensor. `latencyMs` is optional because not every caller
 * measures it, but when it is supplied it feeds the degraded-mode decision.
 */
export function reportRequestOutcome(ok: boolean, latencyMs?: number): void {
  everProbed = true;

  if (ok) {
    if (typeof latencyMs === 'number' && Number.isFinite(latencyMs)) {
      latencies.push(latencyMs);
      if (latencies.length > LATENCY_WINDOW) latencies.shift();
    }
    snapshot = {
      ...snapshot,
      apiReachable: true,
      consecutiveFailures: 0,
      latencyMs: median(latencies),
      lastSuccessfulRequestAt: Date.now(),
      networkUp: true,
    };
  } else {
    snapshot = {
      ...snapshot,
      apiReachable: false,
      consecutiveFailures: snapshot.consecutiveFailures + 1,
    };
  }
  recompute();
  scheduleProbe();
}

export function reportRealtimeState(connected: boolean): void {
  if (snapshot.realtimeConnected === connected) return;
  snapshot = { ...snapshot, realtimeConnected: connected };
  emit();
}

export function reportSyncSuccess(): void {
  snapshot = { ...snapshot, lastSuccessfulSyncAt: Date.now() };
  emit();
}

/**
 * Mark a sync run in progress. Reference-counted, because the pull and push
 * phases both claim it and the state must not drop back to ONLINE between them.
 */
export function beginSync(): () => void {
  syncingDepth++;
  recompute();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    syncingDepth = Math.max(0, syncingDepth - 1);
    recompute();
  };
}

/** True when it is worth attempting network work at all. */
export function isReachable(): boolean {
  return snapshot.state === 'ONLINE' || snapshot.state === 'DEGRADED' || snapshot.state === 'SYNCING';
}

/**
 * Degraded mode: send less, not nothing.
 *
 * Callers use this to defer media, widen polling and shrink page sizes. It is
 * deliberately a question the caller asks rather than a global switch that
 * silently disables features.
 */
export function isDegraded(): boolean {
  return snapshot.state === 'DEGRADED';
}

/**
 * Probe endpoint: GET /api/v1/sync/ping, mounted ahead of authentication.
 *
 * It has to sit under the API base rather than at the SPA origin. `/health` on
 * the origin is served by Vercel and stays green while the Railway API is down,
 * which is precisely the outage this is meant to detect.
 */
const PROBE_PATH = '/sync/ping';

/**
 * Lightweight reachability probe.
 *
 * Injectable so tests, and the chaos simulator, can drive the state machine
 * without a network.
 */
let probeFn: () => Promise<boolean> = defaultProbe;

async function defaultProbe(): Promise<boolean> {
  const base = (import.meta.env['VITE_API_BASE_URL'] as string | undefined) ?? '/api/v1';
  const controller = new AbortController();
  // Shorter than the app's 15s API timeout on purpose: a probe that takes ten
  // seconds to fail has already told us the link is unusable.
  const timeout = setTimeout(() => { controller.abort(); }, 5_000);
  try {
    const res = await fetch(`${base}${PROBE_PATH}`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
      credentials: 'omit',
    });
    // A 401 still proves the API answered — reachability and authentication are
    // different questions. A 404 does not: it usually means a misrouted proxy,
    // which is indistinguishable from the API being unreachable.
    return res.ok || res.status === 401;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Replace the probe. Test/chaos seam. */
export function setProbe(fn: () => Promise<boolean>): void {
  probeFn = fn;
}

export async function probeNow(): Promise<boolean> {
  if (probing) return snapshot.apiReachable;
  probing = true;
  const started_ = Date.now();
  try {
    if (CHAOS.enabled) {
      await chaosDelay();
      if (chaosShouldFail()) {
        reportRequestOutcome(false);
        return false;
      }
    }
    const ok = await probeFn();
    reportRequestOutcome(ok, ok ? Date.now() - started_ : undefined);
    return ok;
  } finally {
    probing = false;
  }
}

function scheduleProbe(): void {
  if (!started) return;
  if (probeTimer) clearTimeout(probeTimer);
  const interval = PROBE_INTERVAL[snapshot.state];
  probeTimer = setTimeout(() => { void probeNow(); }, interval);
}

/**
 * Start listening. Idempotent — every screen that needs connectivity calls it
 * on mount and only the first call takes effect.
 */
export function startConnectivity(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  window.addEventListener('online', () => {
    snapshot = { ...snapshot, networkUp: true };
    // The OS says the interface came back. Verify immediately rather than
    // believing it — this is precisely where captive portals lie.
    void probeNow();
  });

  window.addEventListener('offline', () => {
    snapshot = { ...snapshot, networkUp: false, apiReachable: false };
    everProbed = true;
    recompute();
    scheduleProbe();
  });

  // A backgrounded tab's timers are throttled to near-nothing, so the snapshot
  // is stale the moment the worker looks at the screen again. Re-probe on
  // becoming visible so the first thing they see is true.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void probeNow();
  });

  void probeNow();
}

export function stopConnectivity(): void {
  if (probeTimer) clearTimeout(probeTimer);
  probeTimer = null;
  started = false;
}

/** Reset to a pristine state. Test seam only. */
export function _reset(): void {
  stopConnectivity();
  listeners.clear();
  latencies.length = 0;
  everProbed = false;
  syncingDepth = 0;
  probeFn = defaultProbe;
  snapshot = {
    state: 'UNKNOWN',
    networkUp: true,
    apiReachable: false,
    realtimeConnected: false,
    latencyMs: null,
    lastSuccessfulRequestAt: null,
    lastSuccessfulSyncAt: null,
    consecutiveFailures: 0,
  };
}

export { DEGRADED_LATENCY_MS, OFFLINE_AFTER_FAILURES, PROBE_INTERVAL };
