/**
 * Keeping a driver's browser tab alive for a whole journey.
 *
 * THE CONSTRAINT THIS EXISTS UNDER
 * Drivers are often not contracted, so we cannot ask them to install anything.
 * The tracker therefore has to be a scanned web page — and a web page cannot
 * hold location once it stops being the foreground tab. `watchPosition` is
 * suspended by Chrome and Safari the moment the page is hidden, Service Workers
 * have no geolocation access, and Periodic Background Sync cannot read GPS.
 * There is no web API that does background location. That is a platform fact,
 * not a gap in this file.
 *
 * So the goal is NOT "run invisibly" — that is unreachable without a native
 * runtime or an e-lock. The goal is "the driver never has to touch the phone
 * again after scanning", which IS reachable: if the screen never sleeps, the
 * page never leaves the foreground, and the fixes never stop.
 *
 * Three layers, strongest first:
 *
 *   1. Screen Wake Lock  — the real mechanism. Keeps the display on, so the
 *                          page stays foreground for the whole journey.
 *   2. Silent audio      — best-effort. A page playing media is treated as
 *                          active by some browsers and is frozen later than a
 *                          silent one. UNVERIFIED on real devices; it is a
 *                          hedge, never a promise.
 *   3. Visibility catch-up — when the page does come back, resume instantly
 *                          rather than waiting for the next natural tick.
 *
 * NOTHING HERE CHANGES WHAT WE REPORT. The runtime is still `web`, so the
 * server still pins background_status to 'unsupported', and the health engine
 * still derives LIVE/DELAYED/SIGNAL_LOST from real fix freshness. If a driver
 * locks the phone anyway, the command centre sees it go stale — which is the
 * whole point. A keep-alive that failed must never look like one that worked.
 */

export interface KeepAwakeState {
  /** True only while a real screen wake lock is held. */
  screenHeld: boolean;
  /** Why we could not hold the screen, when we could not. */
  reason: 'unsupported' | 'denied' | 'released' | null;
}

type Listener = (state: KeepAwakeState) => void;

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', cb: () => void): void;
}

let sentinel: WakeLockSentinelLike | null = null;
let audio: HTMLAudioElement | null = null;
let listeners: Listener[] = [];
let state: KeepAwakeState = { screenHeld: false, reason: null };
let wired = false;

function emit() {
  const snapshot = { ...state };
  for (const l of listeners) l(snapshot);
}

function setState(next: Partial<KeepAwakeState>) {
  state = { ...state, ...next };
  emit();
}

export function subscribeKeepAwake(fn: Listener): () => void {
  listeners = [...listeners, fn];
  fn({ ...state });
  return () => { listeners = listeners.filter(l => l !== fn); };
}

export function keepAwakeState(): KeepAwakeState {
  return { ...state };
}

/* ─── Layer 1: screen wake lock ───────────────────────────────────────────── */

interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

async function acquireScreenLock(): Promise<void> {
  const wl = (navigator as Navigator & WakeLockNavigator).wakeLock;
  if (!wl) { setState({ screenHeld: false, reason: 'unsupported' }); return; }
  if (sentinel && !sentinel.released) return;

  try {
    const s = await wl.request('screen');
    sentinel = s;
    setState({ screenHeld: true, reason: null });
    // The OS drops the lock whenever the page hides; note it honestly rather
    // than leaving a stale "screen held" claim behind.
    s.addEventListener('release', () => {
      if (sentinel === s) sentinel = null;
      setState({ screenHeld: false, reason: 'released' });
    });
  } catch {
    // Chrome rejects when the document is not visible, and on low battery.
    sentinel = null;
    setState({ screenHeld: false, reason: 'denied' });
  }
}

/* ─── Layer 2: silent audio (best effort, never promised) ─────────────────── */

/** 0.05s of silence. Small enough to inline, long enough to loop cleanly. */
const SILENCE =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=';

function startSilentAudio(): void {
  if (audio) return;
  try {
    const el = new Audio(SILENCE);
    el.loop = true;
    el.volume = 0;                 // silent, but "playing" as far as the tab is concerned
    // Must be kicked off inside the activation gesture or it is blocked. A
    // rejection here is not an error worth surfacing — layer 1 is the mechanism
    // that matters and this one is only a hedge.
    void el.play().catch(() => undefined);
    audio = el;
  } catch { /* no audio element available */ }
}

function stopSilentAudio(): void {
  if (!audio) return;
  try { audio.pause(); audio.src = ''; } catch { /* already gone */ }
  audio = null;
}

/* ─── Public control ──────────────────────────────────────────────────────── */

/**
 * Start keeping the page awake. Call from inside the driver's activation tap:
 * both layers need a user gesture, and neither can be started later without one.
 *
 * `onResume` fires whenever the page becomes visible again, so the caller can
 * immediately flush its buffer and re-arm location instead of waiting for the
 * next tick.
 */
export function startKeepAwake(onResume?: () => void): void {
  void acquireScreenLock();
  startSilentAudio();

  if (wired) return;
  wired = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    // A wake lock is always dropped when the page hides. Re-take it the instant
    // the driver looks at the phone again, so one glance restores the journey.
    void acquireScreenLock();
    onResume?.();
  });
}

export function stopKeepAwake(): void {
  stopSilentAudio();
  const s = sentinel;
  sentinel = null;
  if (s && !s.released) void s.release().catch(() => undefined);
  setState({ screenHeld: false, reason: null });
}
