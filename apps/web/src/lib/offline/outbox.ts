/**
 * Durable transactional outbox.
 *
 * Everything a worker does offline lands here before it is anyone else's
 * problem. Three properties matter, and each one is a bug that has bitten a
 * field app somewhere:
 *
 * 1. **The local state change and the outbox entry are one transaction.** If
 *    they are not, a process death between them leaves the UI claiming work
 *    happened with nothing queued to make it true. `recordOperation` takes the
 *    caller's local mutation as a callback and runs it inside the same Dexie
 *    transaction as the insert, so either both land or neither does.
 *
 * 2. **The id is minted before the first attempt and never changes.** It is the
 *    idempotency key. A retry after a lost ACK carries the same key, so the
 *    server recognises the operation instead of performing it twice.
 *
 * 3. **Nothing is deleted because it failed.** A permanent rejection stays
 *    visible with the server's reason attached. The worker did the work; the
 *    least the app can do is not pretend otherwise.
 *
 * Ordering is priority first, then the device-local sequence. That is what
 * makes a panic overtake a photo without letting two operations on the same
 * container swap places.
 */

import { getSpec } from './capabilities.js';
import { db } from './db.js';
import { isExhausted, nextAttemptAt, type ClassifiedError } from './retryPolicy.js';
import { PRIORITY, type OutboxEntry, type OutboxStatus, type Priority } from './types.js';
import { CLIENT_SCHEMA_VERSION } from './types.js';

/** Above this, new non-critical operations are refused rather than silently piling up. */
export const MAX_QUEUE_DEPTH = 5_000;

function newId(): string {
  // crypto.randomUUID needs a secure context. The field surfaces are HTTPS, but
  // a plain-http dev host would not have it, and losing the queue to a
  // ReferenceError is not worth the elegance.
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

const SEQUENCE_KEY = 'outbox:sequence';

/**
 * Next device-local sequence number.
 *
 * Persisted rather than derived from the queue, because deriving it from
 * `max(localSequence)` would reuse numbers once acknowledged entries are pruned
 * — and a reused sequence silently reorders operations on the server.
 */
async function nextSequence(): Promise<number> {
  const row = await db.sync_meta.get(SEQUENCE_KEY);
  const next = (typeof row?.value === 'number' ? row.value : 0) + 1;
  await db.sync_meta.put({ key: SEQUENCE_KEY, value: next });
  return next;
}

export interface RecordOperationInput {
  type: string;
  entityId?: string | null;
  label: string;
  payload: Record<string, unknown>;
  /** For transport 'http', the request the outbox will replay. */
  request?: OutboxEntry['request'];
  dependsOn?: string[];
  /** Overrides the matrix default. Used for escalating a panic. */
  priority?: Priority;
  ownerUserId: string;
  ownerOrgId: string;
}

export class QueueFullError extends Error {
  constructor() {
    super('The offline queue is full. Reconnect to let queued work sync before recording more.');
    this.name = 'QueueFullError';
  }
}

/**
 * Record an operation, atomically with its local effect.
 *
 * `applyLocally` receives the same Dexie transaction and should perform the
 * optimistic local mutation (marking a container's status, inserting the local
 * copy of an incident). If it throws, the outbox entry is rolled back with it,
 * so the UI can never show a change that has no queued operation behind it.
 */
export async function recordOperation(
  input: RecordOperationInput,
  applyLocally?: () => Promise<void>,
): Promise<OutboxEntry> {
  const spec = getSpec(input.type);
  if (!spec) throw new Error(`Unknown operation type: ${input.type}`);

  const priority = input.priority ?? spec.priority;

  // The depth guard protects critical work from being crowded out by bulk
  // telemetry, so it applies only to the lower bands. A panic is never refused
  // for lack of queue space.
  if (priority > PRIORITY.CRITICAL) {
    const depth = await db.outbox.where('status').anyOf('PENDING', 'FAILED_RETRYABLE', 'SYNCING').count();
    if (depth >= MAX_QUEUE_DEPTH) throw new QueueFullError();
  }

  const now = Date.now();
  const entry: OutboxEntry = {
    id: newId(),
    localSequence: 0, // assigned inside the transaction
    type: input.type,
    transport: spec.transport,
    entityType: spec.entityType,
    entityId: input.entityId ?? null,
    label: input.label,
    priority,
    payload: input.payload,
    ...(input.request ? { request: input.request } : {}),
    dependsOn: input.dependsOn ?? [],
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: now,
    lastAttemptAt: null,
    clientCreatedAt: now,
    schemaVersion: CLIENT_SCHEMA_VERSION,
    ownerUserId: input.ownerUserId,
    ownerOrgId: input.ownerOrgId,
    lastErrorCode: null,
    lastErrorMessage: null,
    serverResult: null,
    acknowledgedAt: null,
  };

  // The transaction spans every store an `applyLocally` callback might touch —
  // `entities` for an optimistic state change, `gps_buffer` for the telemetry
  // handoff. Dexie refuses writes to a table outside the declared scope, and
  // narrowing this would silently break atomicity for exactly the callers that
  // need it most.
  await db.transaction('rw', db.outbox, db.sync_meta, db.entities, db.gps_buffer, async () => {
    entry.localSequence = await nextSequence();
    await db.outbox.add(entry);
    if (applyLocally) await applyLocally();
  });

  notify();
  return entry;
}

// ── Reading ──────────────────────────────────────────────────────────────────

export async function getEntry(id: string): Promise<OutboxEntry | undefined> {
  return db.outbox.get(id);
}

export async function listForUser(userId: string): Promise<OutboxEntry[]> {
  const rows = await db.outbox.where('ownerUserId').equals(userId).toArray();
  return rows.sort(compareForDrain);
}

/** Priority band first, then the device's own ordering. */
export function compareForDrain(a: OutboxEntry, b: OutboxEntry): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.localSequence - b.localSequence;
}

/**
 * Entries eligible to be sent right now.
 *
 * Three filters, all necessary:
 *  - status must be PENDING or FAILED_RETRYABLE (SYNCING is in flight,
 *    ACKNOWLEDGED is done, and the two terminal failure states need a human)
 *  - the backoff deadline must have passed
 *  - every dependency must already be ACKNOWLEDGED — a photo cannot upload
 *    before the incident it hangs off exists server-side
 */
export async function dueEntries(userId: string, now: number = Date.now()): Promise<OutboxEntry[]> {
  const all = await db.outbox.where('ownerUserId').equals(userId).toArray();

  const acknowledged = new Set(all.filter(e => e.status === 'ACKNOWLEDGED').map(e => e.id));
  // A dependency that no longer exists (pruned after acknowledgement) is
  // satisfied, not blocking. Treating it as blocking would strand the dependent
  // entry forever.
  const known = new Set(all.map(e => e.id));

  return all
    .filter(e => e.status === 'PENDING' || e.status === 'FAILED_RETRYABLE')
    .filter(e => e.nextAttemptAt <= now)
    .filter(e => e.dependsOn.every(d => !known.has(d) || acknowledged.has(d)))
    .sort(compareForDrain);
}

export interface OutboxCounts {
  pending: number;
  syncing: number;
  acknowledged: number;
  failedRetryable: number;
  failedPermanent: number;
  conflict: number;
  /** Age of the oldest unacknowledged entry in ms, or null when the queue is clear. */
  oldestPendingAgeMs: number | null;
}

export async function counts(userId: string, now: number = Date.now()): Promise<OutboxCounts> {
  const all = await db.outbox.where('ownerUserId').equals(userId).toArray();
  const by = (s: OutboxStatus) => all.filter(e => e.status === s).length;

  const unresolved = all.filter(
    e => e.status === 'PENDING' || e.status === 'SYNCING' || e.status === 'FAILED_RETRYABLE',
  );
  const oldest = unresolved.reduce<number | null>(
    (acc, e) => (acc === null || e.clientCreatedAt < acc ? e.clientCreatedAt : acc),
    null,
  );

  return {
    pending: by('PENDING'),
    syncing: by('SYNCING'),
    acknowledged: by('ACKNOWLEDGED'),
    failedRetryable: by('FAILED_RETRYABLE'),
    failedPermanent: by('FAILED_PERMANENT'),
    conflict: by('CONFLICT'),
    oldestPendingAgeMs: oldest === null ? null : now - oldest,
  };
}

// ── Transitions ──────────────────────────────────────────────────────────────

export async function markSyncing(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const now = Date.now();
  await db.transaction('rw', db.outbox, async () => {
    for (const id of ids) {
      await db.outbox.update(id, { status: 'SYNCING', lastAttemptAt: now });
    }
  });
  notify();
}

export async function markAcknowledged(
  id: string,
  serverResult: Record<string, unknown> | null,
): Promise<void> {
  await db.outbox.update(id, {
    status: 'ACKNOWLEDGED',
    serverResult,
    acknowledgedAt: Date.now(),
    lastErrorCode: null,
    lastErrorMessage: null,
  });
  notify();
}

/**
 * Record a failure, deciding whether it will be tried again.
 *
 * A retryable class that has exhausted its attempt budget becomes permanent
 * here rather than looping forever. That is a deliberate trade: an operation
 * nobody ever looks at is as lost as one that was deleted, so after roughly a
 * day of escalating attempts it stops being the queue's problem and starts
 * being a person's.
 */
export async function markFailure(
  id: string,
  err: ClassifiedError,
  now: number = Date.now(),
  random: () => number = Math.random,
): Promise<OutboxStatus> {
  const entry = await db.outbox.get(id);
  if (!entry) return 'FAILED_PERMANENT';

  const attempts = entry.attempts + 1;

  let status: OutboxStatus = err.status;
  if (status === 'FAILED_RETRYABLE' && isExhausted(attempts)) {
    status = 'FAILED_PERMANENT';
  }

  await db.outbox.update(id, {
    status,
    attempts,
    lastAttemptAt: now,
    nextAttemptAt: status === 'FAILED_RETRYABLE' ? nextAttemptAt(attempts, now, random) : now,
    lastErrorCode: err.code,
    lastErrorMessage: status === 'FAILED_PERMANENT' && isExhausted(attempts)
      ? `${err.message} (gave up after ${attempts} attempts)`
      : err.message,
  });

  notify();
  return status;
}

/**
 * Put a stuck entry back in the queue.
 *
 * Offered for FAILED_PERMANENT and CONFLICT because both are states a person
 * can meaningfully act on — a rejection may have been caused by something since
 * fixed, and a conflict may be resolvable by re-reading the record and deciding
 * to proceed. The attempt counter resets so the entry gets a fresh budget.
 */
export async function retryEntry(id: string): Promise<void> {
  const entry = await db.outbox.get(id);
  if (!entry) return;
  if (entry.status !== 'FAILED_PERMANENT' && entry.status !== 'FAILED_RETRYABLE' && entry.status !== 'CONFLICT') {
    return;
  }
  await db.outbox.update(id, {
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: Date.now(),
    lastErrorCode: null,
    lastErrorMessage: null,
  });
  notify();
}

/**
 * Discard an entry.
 *
 * Only ever a deliberate human act on an entry that has already failed
 * permanently or conflicted — never something the queue does on its own, and
 * never available for work that is merely waiting.
 */
export async function dismissEntry(id: string): Promise<void> {
  const entry = await db.outbox.get(id);
  if (!entry) return;
  if (entry.status !== 'FAILED_PERMANENT' && entry.status !== 'CONFLICT') return;
  await db.outbox.delete(id);
  notify();
}

/**
 * Recover entries stranded in SYNCING by a process death.
 *
 * Called on startup. SYNCING means "sent, outcome unknown", which is exactly
 * what idempotency exists to make safe: re-sending is correct, because the
 * server will either apply it once or recognise the key and report the original
 * result. What would be wrong is assuming either success or failure.
 */
export async function recoverInFlight(): Promise<number> {
  const stuck = await db.outbox.where('status').equals('SYNCING').toArray();
  if (stuck.length === 0) return 0;
  const now = Date.now();
  await db.transaction('rw', db.outbox, async () => {
    for (const e of stuck) {
      await db.outbox.update(e.id, { status: 'PENDING', nextAttemptAt: now });
    }
  });
  notify();
  return stuck.length;
}

/**
 * Prune acknowledged history.
 *
 * Only ACKNOWLEDGED rows, and only ones older than the window. Nothing
 * unacknowledged is ever pruned, whatever the storage pressure — retention
 * cleanup must never be the reason a shift's work disappears.
 */
export async function pruneAcknowledged(olderThanMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  const stale = await db.outbox
    .where('status').equals('ACKNOWLEDGED')
    .filter(e => (e.acknowledgedAt ?? e.clientCreatedAt) < cutoff)
    .primaryKeys();
  if (stale.length === 0) return 0;
  await db.outbox.bulkDelete(stale);
  notify();
  return stale.length;
}

// ── Change notification ──────────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeOutbox(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function notify(): void {
  for (const l of listeners) {
    try { l(); } catch { /* a subscriber must not break the queue */ }
  }
}
