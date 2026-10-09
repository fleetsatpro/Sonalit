/**
 * Public surface and lifecycle for the offline layer.
 *
 * One import point, one start call, one stop call. Screens should never reach
 * into the individual modules to wire timers — that is how the existing
 * `navigator.onLine` sprawl happened, and it is what this replaces.
 *
 * Everything here is defensive to the point of being boring: if IndexedDB is
 * unavailable, if a flag is off, if the schema will not open, the layer stands
 * down and the app behaves exactly as it did before. A resilience feature that
 * can crash the application it protects is a net loss.
 */

import { checkEligibility, getSpec, type Eligibility, type EligibilityContext } from './capabilities.js';
import {
  getSnapshot as connectivitySnapshot, isDegraded, isReachable, startConnectivity,
  stopConnectivity, subscribe as subscribeConnectivity, probeNow,
} from './connectivity.js';
import { db, isStorageAvailable, purgeUserData, requestPersistence, storageEstimate, unsyncedCount } from './db.js';
import { getDeviceId } from './device.js';
import { applyLocalChange, findEntityBy, getEntity, listEntities, pruneEntities } from './entities.js';
import { isEnabled, type OfflineFlag } from './flags.js';
import { bufferedCount, chooseInterval, flushToOutbox, recordFix } from './gpsBuffer.js';
import {
  counts, dismissEntry, listForUser, pruneAcknowledged, recordOperation, retryEntry,
  subscribeOutbox, type RecordOperationInput,
} from './outbox.js';
import { canActOnScan, decodeScan, resolveScan } from './qr.js';
import { lastSyncRun, queueDepth, runSync, SyncBlockedError } from './syncEngine.js';

export interface OfflineIdentity {
  userId: string;
  orgId: string;
  role: string;
}

/**
 * How often to attempt a sync when the link is healthy. Deliberately not
 * aggressive: a drain is also triggered by reconnection, by recording an
 * operation, and by the tab becoming visible, so the timer is a backstop rather
 * than the mechanism.
 */
const SYNC_INTERVAL_MS = 60_000;
/** In degraded mode, back off rather than compete with the worker's own requests. */
const SYNC_INTERVAL_DEGRADED_MS = 180_000;

/** Storage ratio at which non-critical cached data starts being pruned. */
const STORAGE_PRESSURE_RATIO = 0.85;

let identity: OfflineIdentity | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let available = false;
let blocked: SyncBlockedError | null = null;
let lifecycleGeneration = 0;
let activeTick: Promise<void> | null = null;
let unsubscribeReconnect: (() => void) | null = null;

type StatusListener = () => void;
const statusListeners = new Set<StatusListener>();

function announce(): void {
  for (const l of statusListeners) {
    try { l(); } catch { /* a subscriber must not break the loop */ }
  }
}

export function subscribeOfflineStatus(fn: StatusListener): () => void {
  statusListeners.add(fn);
  const unsubOutbox = subscribeOutbox(fn);
  const unsubConn = subscribeConnectivity(fn);
  return () => {
    statusListeners.delete(fn);
    unsubOutbox();
    unsubConn();
  };
}

/** Why sync is refusing to run, if it is. */
export function syncBlockedReason(): SyncBlockedError | null {
  return blocked;
}

async function tick(): Promise<void> {
  const session = identity;
  if (!session || !available) {
    if (timer) clearTimeout(timer);
    timer = null;
    return;
  }
  if (activeTick) {
    await activeTick;
    return;
  }

  const generation = lifecycleGeneration;
  const work = (async () => {
    try {
      const result = await runSync(session.userId, session.orgId);
      // A result from a prior login/tenant must not update the new session.
      if (generation === lifecycleGeneration && identity === session) {
        blocked = result.blocked;
        if (result.pull || result.push) announce();
      }
    } catch {
      // runSync does not throw, but a future change might. The loop survives.
    }

    if (generation === lifecycleGeneration && identity === session && available) {
      try { await relieveStoragePressure(); } catch { /* cleanup must not wedge sync */ }
    }
  })();
  activeTick = work;

  try {
    await work;
  } finally {
    if (activeTick === work) activeTick = null;
    if (!identity || !available) {
      if (timer) clearTimeout(timer);
      timer = null;
      return;
    }
    if (generation === lifecycleGeneration && identity === session) schedule();
    else void tick();
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  if (!identity || !available) return;
  const interval = isDegraded() ? SYNC_INTERVAL_DEGRADED_MS : SYNC_INTERVAL_MS;
  timer = setTimeout(() => { void tick(); }, interval);
}

/**
 * Free space before the browser decides to for us.
 *
 * Order matters and is the same as the failure-priority order everywhere else:
 * acknowledged outbox history first (pure history), then cached entities the
 * device has not touched in a week. Unsynced operations are never candidates,
 * whatever the pressure — a retention sweep must not be the thing that loses a
 * shift's work.
 */
async function relieveStoragePressure(): Promise<void> {
  const est = await storageEstimate();
  if (est.ratio == null || est.ratio < STORAGE_PRESSURE_RATIO) {
    // Routine housekeeping even without pressure, so it never builds up.
    await pruneAcknowledged();
    return;
  }

  await pruneAcknowledged(24 * 60 * 60 * 1000);
  await pruneEntities(7 * 24 * 60 * 60 * 1000, ['cds_container', 'cds_booking']);
  announce();
}

/**
 * Start the offline layer for a signed-in user.
 *
 * Purges another user's data first: a shared yard tablet must never open onto
 * the previous worker's shift. Their unsynced work is preserved (see
 * `purgeUserData`) but is not visible or actionable from this session.
 */
export async function startOffline(id: OfflineIdentity): Promise<boolean> {
  if (!isEnabled('OFFLINE_MODE')) return false;

  const generation = ++lifecycleGeneration;
  if (timer) clearTimeout(timer);
  timer = null;
  unsubscribeReconnect?.();
  unsubscribeReconnect = null;
  identity = null;
  blocked = null;
  available = false;

  const storageAvailable = await isStorageAvailable();
  if (generation !== lifecycleGeneration) return false;
  if (!storageAvailable) {
    // No durable storage. The app runs exactly as it did before this layer.
    return false;
  }
  available = true;

  const previous = await db.sync_meta.get('session:identity');
  if (generation !== lifecycleGeneration) return false;
  if (previous?.value && typeof previous.value === 'object') {
    const prev = previous.value as { userId?: unknown; orgId?: unknown };
    if (typeof prev.userId === 'string' && (prev.userId !== id.userId || prev.orgId !== id.orgId)) {
      // A tenant change is a hard security boundary. Unlike a normal logout,
      // there is no safe reason to retain unsent work from the previous org on
      // a shared device where it could later be surfaced or replayed.
      await purgeUserData(prev.userId, { keepUnsyncedOutbox: false });
      if (generation !== lifecycleGeneration) return false;
    }
  } else if (typeof previous?.value === 'string' && previous.value !== id.userId) {
    await purgeUserData(previous.value);
    if (generation !== lifecycleGeneration) return false;
  }
  await db.sync_meta.put({ key: 'session:identity', value: { userId: id.userId, orgId: id.orgId } });
  if (generation !== lifecycleGeneration) return false;
  await db.sync_meta.delete('session:userId');
  if (generation !== lifecycleGeneration) return false;

  identity = id;
  blocked = null;

  void requestPersistence();
  startConnectivity();
  announce();

  // Keep exactly one reconnect subscription. Starting a new session or
  // signing out must detach the old callback before it can trigger another sync.
  unsubscribeReconnect?.();
  unsubscribeReconnect = subscribeConnectivity(() => {
    if (generation !== lifecycleGeneration || identity !== id || !available) return;
    if (isReachable()) void tick();
  });

  void tick();
  return true;
}

/**
 * Stop syncing and clear this user's device data.
 *
 * Unacknowledged work is kept by default — a token expiring mid-shift is not
 * consent to throw away what somebody did. It becomes visible again when that
 * same user signs back in on this device.
 */
export async function stopOffline({ purge = true }: { purge?: boolean } = {}): Promise<void> {
  lifecycleGeneration += 1;
  unsubscribeReconnect?.();
  unsubscribeReconnect = null;
  if (timer) clearTimeout(timer);
  timer = null;
  stopConnectivity();

  const id = identity;
  identity = null;
  blocked = null;

  if (purge && id && available) {
    try {
      await purgeUserData(id.userId);
      await db.sync_meta.delete('session:identity');
      await db.sync_meta.delete('session:userId');
    } catch { /* a failed purge must not block sign-out */ }
  }
  announce();
}

/** Force a sync now. Used by the retry button in the sync centre. */
export async function syncNow(): Promise<void> {
  if (!identity) return;
  await probeNow();
  await tick();
}

export interface OfflineStatus {
  enabled: boolean;
  storageAvailable: boolean;
  connectivity: ReturnType<typeof connectivitySnapshot>;
  deviceId: string;
  queue: Awaited<ReturnType<typeof counts>> | null;
  gpsBuffered: number;
  blocked: { code: string; message: string } | null;
  lastSyncAt: number | null;
}

export async function getOfflineStatus(): Promise<OfflineStatus> {
  const connectivity = connectivitySnapshot();
  const base: OfflineStatus = {
    enabled: isEnabled('OFFLINE_MODE'),
    storageAvailable: available,
    connectivity,
    deviceId: getDeviceId(),
    queue: null,
    gpsBuffered: 0,
    blocked: blocked ? { code: blocked.code, message: blocked.message } : null,
    lastSyncAt: connectivity.lastSuccessfulSyncAt,
  };
  if (!identity || !available) return base;

  return {
    ...base,
    queue: await counts(identity.userId, identity.orgId),
    gpsBuffered: await bufferedCount(identity.userId),
  };
}

/**
 * Record an operation, honouring the capability matrix.
 *
 * The one function feature code should call. It refuses before anything is
 * written, so a worker learns that an action needs a connection *before* they
 * believe it is done — which is the difference between an honest app and one
 * that quietly loses work.
 */
export async function performOperation(
  input: RecordOperationInput & { localEntity?: EligibilityContext['localEntity'] },
): Promise<{ ok: true; id: string } | { ok: false; eligibility: Eligibility }> {
  if (!identity) throw new Error('Offline layer not started');
  if (input.ownerUserId !== identity.userId || input.ownerOrgId !== identity.orgId) {
    throw new Error('offline_identity_mismatch');
  }

  const eligibility = checkEligibility(input.type, {
    role: identity.role,
    online: isReachable(),
    localEntity: input.localEntity,
  });

  if (!eligibility.allowed) return { ok: false, eligibility };

  const entry = await recordOperation(input);
  // Opportunistic: if this was queued because one request failed rather than
  // because the device is dark, the next drain may well succeed immediately.
  void tick();
  return { ok: true, id: entry.id };
}

export {
  // capability matrix
  checkEligibility, getSpec,
  // connectivity
  connectivitySnapshot, isDegraded, isReachable, probeNow,
  // storage
  db, purgeUserData, storageEstimate, unsyncedCount,
  // entities
  applyLocalChange, findEntityBy, getEntity, listEntities,
  // outbox
  counts, dismissEntry, listForUser, retryEntry,
  // gps
  chooseInterval, flushToOutbox, recordFix,
  // qr
  canActOnScan, decodeScan, resolveScan,
  // engine
  lastSyncRun, queueDepth, runSync, SyncBlockedError,
  // flags
  isEnabled,
  // device
  getDeviceId,
};

export type { Eligibility, EligibilityContext, OfflineFlag, RecordOperationInput };
export * from './types.js';
