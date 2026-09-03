/**
 * Feature flags for the resilience layer.
 *
 * Every part of this subsystem ships behind a flag because it changes what
 * happens when the network fails — the hardest thing to be confident about
 * before real devices meet real yards. A flag that is off must leave the app
 * behaving exactly as it did before this layer existed, which is why the
 * defaults below are deliberately conservative and why nothing here silently
 * enables itself.
 *
 * Resolution order, first hit wins:
 *   1. a build-time env var (VITE_OFFLINE_*), for per-environment rollout
 *   2. a localStorage override, for enabling a flag on one device during a
 *      field trial without a redeploy — non-production builds only
 *   3. the default below
 */

export type OfflineFlag =
  | 'OFFLINE_MODE'
  | 'OFFLINE_SYNC'
  | 'OFFLINE_QR'
  | 'OFFLINE_CDS'
  | 'OFFLINE_GPS'
  | 'OFFLINE_MAPS'
  | 'LOW_BANDWIDTH_MODE';

/**
 * OFFLINE_MODE is the master switch: local storage, the connectivity manager
 * and the outbox. On by default because with everything below it off, it only
 * makes the app honest about connectivity — it does not change any write path.
 *
 * OFFLINE_SYNC (pull/push against the new endpoints) defaults on so a device
 * that queued work can actually deliver it; without it the outbox would fill up
 * and never drain.
 *
 * The per-surface flags default off. Each one opens a specific offline write
 * path, and those are earned per surface with real devices, not switched on
 * wholesale.
 */
const DEFAULTS: Record<OfflineFlag, boolean> = {
  OFFLINE_MODE: true,
  OFFLINE_SYNC: true,
  OFFLINE_QR: false,
  OFFLINE_CDS: false,
  OFFLINE_GPS: false,
  OFFLINE_MAPS: false,
  LOW_BANDWIDTH_MODE: true,
};

const ENV_PREFIX = 'VITE_';
const LS_PREFIX = 'sonalit-flag:';

function parseBool(v: unknown): boolean | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'on') return true;
  if (s === 'false' || s === '0' || s === 'off') return false;
  return null;
}

function fromEnv(flag: OfflineFlag): boolean | null {
  try {
    return parseBool(import.meta.env[`${ENV_PREFIX}${flag}`]);
  } catch {
    return null;
  }
}

function fromStorage(flag: OfflineFlag): boolean | null {
  try {
    if (import.meta.env.PROD === true) return null;
    return parseBool(localStorage.getItem(`${LS_PREFIX}${flag}`));
  } catch {
    return null;
  }
}

const cache = new Map<OfflineFlag, boolean>();

export function isEnabled(flag: OfflineFlag): boolean {
  const cached = cache.get(flag);
  if (cached !== undefined) return cached;
  const value = fromEnv(flag) ?? fromStorage(flag) ?? DEFAULTS[flag];
  cache.set(flag, value);
  return value;
}

/** Override a flag for this session. Non-production only. */
export function setFlag(flag: OfflineFlag, value: boolean | null): void {
  try {
    if (import.meta.env.PROD === true) return;
    if (value === null) localStorage.removeItem(`${LS_PREFIX}${flag}`);
    else localStorage.setItem(`${LS_PREFIX}${flag}`, String(value));
  } catch { /* storage unavailable */ }
  cache.delete(flag);
}

export function allFlags(): Record<OfflineFlag, boolean> {
  return Object.fromEntries(
    (Object.keys(DEFAULTS) as OfflineFlag[]).map(f => [f, isEnabled(f)]),
  ) as Record<OfflineFlag, boolean>;
}

/** Clear the memoised values. Test seam. */
export function _resetFlags(): void {
  cache.clear();
}
