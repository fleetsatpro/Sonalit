/**
 * Connectivity simulator.
 *
 * Resilience that has only been reasoned about is not resilience. A yard tablet
 * on a dying 2G cell is genuinely hard to reproduce at a desk, so the failure
 * modes that matter — high latency, partial loss, an API that is up but
 * erroring, Centrifugo down while REST is fine — are injectable here and
 * exercised deliberately.
 *
 * Off unless explicitly enabled, and unreachable in a production build: the
 * whole module short-circuits on `import.meta.env.PROD`, so no amount of
 * localStorage tampering by an end user can degrade their own connection.
 */

export type ChaosProfile =
  | 'off'
  | 'offline'
  | '2g'
  | '3g'
  | 'high_latency'
  | 'packet_loss'
  | 'random_disconnect'
  | 'api_down'
  | 'realtime_down'
  | 'sync_failure';

interface ChaosConfig {
  enabled: boolean;
  profile: ChaosProfile;
  /** Extra latency in ms applied to every simulated call. */
  latencyMs: number;
  /** 0..1 probability that a given call fails outright. */
  failureRate: number;
}

const PROFILES: Record<ChaosProfile, Omit<ChaosConfig, 'enabled' | 'profile'>> = {
  off: { latencyMs: 0, failureRate: 0 },
  offline: { latencyMs: 0, failureRate: 1 },
  // Real 2G round-trips to a distant origin sit in the seconds, which is
  // exactly the band that trips DEGRADED without tripping OFFLINE.
  '2g': { latencyMs: 2_500, failureRate: 0.15 },
  '3g': { latencyMs: 700, failureRate: 0.05 },
  high_latency: { latencyMs: 6_000, failureRate: 0 },
  packet_loss: { latencyMs: 300, failureRate: 0.35 },
  random_disconnect: { latencyMs: 200, failureRate: 0.5 },
  api_down: { latencyMs: 100, failureRate: 1 },
  // The API is fine; only the realtime transport is dead. Exercises the
  // fallback ladder without touching sync.
  realtime_down: { latencyMs: 0, failureRate: 0 },
  sync_failure: { latencyMs: 200, failureRate: 0 },
};

const STORAGE_KEY = 'sonalit-chaos-profile';

function isProd(): boolean {
  try {
    return import.meta.env.PROD === true;
  } catch {
    return true;
  }
}

function loadProfile(): ChaosProfile {
  if (isProd()) return 'off';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && raw in PROFILES) return raw as ChaosProfile;
  } catch { /* storage unavailable; stay off */ }
  return 'off';
}

const initial = loadProfile();

export const CHAOS: ChaosConfig = {
  enabled: initial !== 'off',
  profile: initial,
  ...PROFILES[initial],
};

export function setChaosProfile(profile: ChaosProfile): void {
  if (isProd()) return;
  CHAOS.profile = profile;
  CHAOS.enabled = profile !== 'off';
  const p = PROFILES[profile];
  CHAOS.latencyMs = p.latencyMs;
  CHAOS.failureRate = p.failureRate;
  try {
    if (profile === 'off') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, profile);
  } catch { /* not worth failing over */ }
}

export function chaosProfiles(): ChaosProfile[] {
  return Object.keys(PROFILES) as ChaosProfile[];
}

/** Should this simulated call fail? */
export function chaosShouldFail(): boolean {
  if (!CHAOS.enabled) return false;
  if (CHAOS.profile === 'realtime_down') return false;
  return Math.random() < CHAOS.failureRate;
}

/** Should a sync push be forced to report a server failure? */
export function chaosSyncShouldFail(): boolean {
  return CHAOS.enabled && (CHAOS.profile === 'sync_failure' || CHAOS.profile === 'api_down');
}

export function chaosRealtimeDown(): boolean {
  return CHAOS.enabled && (CHAOS.profile === 'realtime_down' || CHAOS.profile === 'offline' || CHAOS.profile === 'api_down');
}

export async function chaosDelay(): Promise<void> {
  if (!CHAOS.enabled || CHAOS.latencyMs <= 0) return;
  // Jittered so simulated runs do not all line up on a round number.
  const ms = CHAOS.latencyMs * (0.7 + Math.random() * 0.6);
  await new Promise<void>(resolve => { setTimeout(resolve, ms); });
}
