/**
 * Device-side operational database.
 *
 * ── Why Dexie and not RxDB ───────────────────────────────────────────────────
 *
 * Dexie is already a dependency of this app (lib/db.ts declared a store and
 * never used it), it wraps IndexedDB, and IndexedDB gives us everything the
 * offline layer actually needs: durable persistence across process death,
 * multi-store transactions, indexed queries, versioned schemas with migration
 * hooks, and capacity measured in hundreds of megabytes rather than
 * localStorage's five. RxDB would add a large dependency and an RxJS surface to
 * get the same storage plus a replication protocol we cannot use — Sonalit's
 * authority is PostgreSQL behind an authenticated REST API with row-level
 * security, not a replication endpoint, and bending RxDB's protocol onto that
 * would mean writing the same pull/push logic anyway with an extra layer under
 * it. The prompt's preference for RxDB is conditional on there being no
 * adequate local store; there is one, so we extended it.
 *
 * PostgreSQL remains the authority. Everything in here is a device-side working
 * copy plus the queue of things this device has done that Sonalit has not yet
 * confirmed.
 *
 * ── Why every store is user-scoped ───────────────────────────────────────────
 *
 * A yard tablet is a shared device. `ownerUserId` on every row, plus a purge on
 * logout and on user switch, is what stops the next worker's shift from opening
 * onto the previous worker's containers.
 */
import Dexie, { type EntityTable } from 'dexie';

import type { BufferedFix, ConflictRecord, LocalEntity, OutboxEntry, SyncMeta } from './types.js';

/**
 * Legacy stores from the original lib/db.ts. They were declared but never
 * written to, so nothing reads them — they are carried forward only so that a
 * browser holding the v1 database upgrades cleanly instead of throwing
 * VersionError on open.
 */
interface LegacyGpsFix { id: string; device_id: string; lat: number; lon: number; ts: number }
interface LegacyPendingUpload { id: string; kind: string; payload: string; created_at: number }

class SonalitDB extends Dexie {
  gps_fixes!: EntityTable<LegacyGpsFix, 'id'>;
  pending_uploads!: EntityTable<LegacyPendingUpload, 'id'>;

  /** Replicated server state. Primary key is `${entityType}:${entityId}`. */
  entities!: EntityTable<LocalEntity, 'key'>;
  /** Durable queue of local operations awaiting server confirmation. */
  outbox!: EntityTable<OutboxEntry, 'id'>;
  /** GPS fixes buffered for batched upload. */
  gps_buffer!: EntityTable<BufferedFix, 'id'>;
  /** Conflicts the server refused to resolve for us. */
  conflicts!: EntityTable<ConflictRecord, 'id'>;
  /** Checkpoints, device id, last-sync times. */
  sync_meta!: EntityTable<SyncMeta, 'key'>;

  constructor() {
    super('sonalit');

    this.version(1).stores({
      gps_fixes: 'id, device_id, ts',
      pending_uploads: 'id, kind, created_at',
    });

    this.version(2).stores({
      gps_fixes: 'id, device_id, ts',
      pending_uploads: 'id, kind, created_at',

      // `[entityType+entityId]` is the natural lookup (QR scan resolves a
      // container number to a row); `entityType` alone drives list screens.
      entities: 'key, entityType, [entityType+entityId], orgId, ownerLookup, lastSyncedAt',

      // The drain loop's hot query is "PENDING or FAILED_RETRYABLE, whose
      // nextAttemptAt has passed, in priority then sequence order", so status
      // and nextAttemptAt are both indexed. localSequence is the tiebreaker
      // that preserves causal order within a device.
      outbox: 'id, status, priority, nextAttemptAt, localSequence, ownerUserId, [status+nextAttemptAt]',

      gps_buffer: 'id, vehicleId, sequence, deviceTime, ownerUserId',
      conflicts: 'id, entityType, detectedAt, ownerUserId',
      sync_meta: 'key',
    });
  }
}

export const db = new SonalitDB();

/**
 * Is durable storage actually available?
 *
 * IndexedDB is absent or throws in private browsing on some engines, and inside
 * certain WebViews. The offline layer must degrade to "online only" there
 * rather than take the app down with it — a resilience feature that crashes the
 * app it protects is worse than no feature.
 */
export async function isStorageAvailable(): Promise<boolean> {
  try {
    if (typeof indexedDB === 'undefined') return false;
    await db.open();
    return true;
  } catch {
    return false;
  }
}

export interface StorageEstimate {
  usageBytes: number | null;
  quotaBytes: number | null;
  /** 0..1, or null when the browser will not say. */
  ratio: number | null;
}

/** Best-effort storage pressure reading. Not supported everywhere. */
export async function storageEstimate(): Promise<StorageEstimate> {
  try {
    const nav = navigator as Navigator & { storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> } };
    if (!nav.storage?.estimate) return { usageBytes: null, quotaBytes: null, ratio: null };
    const est = await nav.storage.estimate();
    const usage = est.usage ?? null;
    const quota = est.quota ?? null;
    return {
      usageBytes: usage,
      quotaBytes: quota,
      ratio: usage != null && quota != null && quota > 0 ? usage / quota : null,
    };
  } catch {
    return { usageBytes: null, quotaBytes: null, ratio: null };
  }
}

/**
 * Ask the browser to exempt this origin from eviction under storage pressure.
 *
 * Without it, a device that fills up can have its IndexedDB cleared by the OS,
 * taking unsynced field work with it. The browser may refuse; there is no
 * fallback, which is one reason the outbox is also bounded by retention rules.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    const nav = navigator as Navigator & { storage?: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> } };
    if (!nav.storage?.persist) return false;
    if (nav.storage.persisted && (await nav.storage.persisted())) return true;
    return await nav.storage.persist();
  } catch {
    return false;
  }
}

/**
 * Purge everything belonging to a user.
 *
 * Called on logout and whenever a different user signs in on this device.
 *
 * `keepUnsyncedOutbox` exists because "clear the data" and "throw away work
 * somebody did" are different decisions. Cached entities, GPS and resolved
 * outbox rows go unconditionally — they are a copy of server state and the next
 * user must not see them. Unacknowledged operations are held by default: they
 * are the only record that the work happened, and a logout (deliberate or
 * forced by an expiring token) is not consent to discard a shift. A caller that
 * genuinely needs a clean device — handing hardware to another organisation,
 * say — passes false and takes the loss knowingly.
 */
export async function purgeUserData(
  userId: string,
  { keepUnsyncedOutbox = true }: { keepUnsyncedOutbox?: boolean } = {},
): Promise<{ entities: number; gps: number; outbox: number; conflicts: number }> {
  const counts = { entities: 0, gps: 0, outbox: 0, conflicts: 0 };

  // Array form: Dexie's variadic overload tops out at five tables, and the
  // purge has to span all six atomically — a half-purged device would leave one
  // user's rows visible to the next.
  await db.transaction('rw', [db.entities, db.gps_buffer, db.outbox, db.conflicts, db.sync_meta], async () => {
    counts.entities = await db.entities.where('ownerLookup').equals(userId).delete();
    counts.gps = await db.gps_buffer.where('ownerUserId').equals(userId).delete();
    counts.conflicts = await db.conflicts.where('ownerUserId').equals(userId).delete();

    const owned = db.outbox.where('ownerUserId').equals(userId);
    if (keepUnsyncedOutbox) {
      const rows = await owned.toArray();
      const disposable = rows
        .filter(r => r.status === 'ACKNOWLEDGED' || r.status === 'FAILED_PERMANENT')
        .map(r => r.id);
      await db.outbox.bulkDelete(disposable);
      counts.outbox = disposable.length;
    } else {
      counts.outbox = await owned.delete();
    }

    // The pull checkpoint is per-user because scope is per-user: a different
    // role sees a different slice, so resuming from someone else's checkpoint
    // would skip rows this user has never seen.
    await db.sync_meta.delete(`checkpoint:${userId}`);
  });

  return counts;
}

/** How many operations this user has that Sonalit has not confirmed. */
export async function unsyncedCount(userId: string): Promise<number> {
  const rows = await db.outbox.where('ownerUserId').equals(userId).toArray();
  return rows.filter(r => r.status !== 'ACKNOWLEDGED' && r.status !== 'FAILED_PERMANENT').length;
}
