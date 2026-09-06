/**
 * The sync engine: pull authoritative state down, push local operations up.
 *
 * Recovery order is the thing to get right, and it is not arbitrary. When
 * connectivity returns the engine does, in this order:
 *
 *   1. **Re-establish authorisation.** POST /sync/device. A device that has been
 *      dark may have had its user's permissions changed or its own access
 *      revoked, and it cannot know that on its own. Nothing else runs until the
 *      server has confirmed who this is and what they may see.
 *   2. **Push, highest priority first.** Field work goes up before anything is
 *      pulled down. If the link dies again after ten seconds, ten seconds spent
 *      delivering a security incident beats ten seconds spent refreshing a
 *      container list.
 *   3. **Pull.** Reconcile the local mirror with the server's current truth,
 *      page by page, resumably.
 *
 * Push-before-pull also avoids a subtle trap: pulling first would overwrite the
 * local copy of a record this device has an unsent change for, and the change
 * would then be pushed against a revision it never actually saw.
 *
 * Partial success is preserved throughout. Every operation carries its own
 * outcome; nothing is marked good or bad in bulk.
 */

import { api } from '../api.js';

import { chaosDelay, chaosSyncShouldFail, CHAOS } from './chaos.js';
import { beginSync, isDegraded, isReachable, reportRequestOutcome, reportSyncSuccess } from './connectivity.js';
import { db } from './db.js';
import { getDeviceId } from './device.js';
import { isEnabled } from './flags.js';
import {
  counts, dueEntries, markAcknowledged, markFailure, markSyncing, recoverInFlight,
} from './outbox.js';
import { classifyHttp, classifyPushOutcome, type ClassifiedError } from './retryPolicy.js';
import {
  CLIENT_SCHEMA_VERSION, type LocalEntity, type OutboxEntry, type PullChange, type PushResult,
} from './types.js';

import type { AxiosError, AxiosRequestConfig } from 'axios';

/** How many operations go up in one push. Matches the server's MAX_BATCH. */
const PUSH_BATCH = 50;
/** Pull page size when the link is healthy. */
const PULL_LIMIT = 200;
/** Pull page size in degraded mode — smaller pages fail cheaper and resume sooner. */
const PULL_LIMIT_DEGRADED = 25;
/** Safety valve so one run cannot loop forever on a busy org. */
const MAX_PULL_PAGES = 50;

function checkpointKey(userId: string): string {
  return `checkpoint:${userId}`;
}

export async function getCheckpoint(userId: string): Promise<number> {
  const row = await db.sync_meta.get(checkpointKey(userId));
  return typeof row?.value === 'number' ? row.value : 0;
}

async function setCheckpoint(userId: string, value: number): Promise<void> {
  await db.sync_meta.put({ key: checkpointKey(userId), value });
}

function syncHeaders(): Record<string, string> {
  return {
    'x-sync-device': getDeviceId(),
    'x-sync-schema': String(CLIENT_SCHEMA_VERSION),
    'x-sync-platform': typeof navigator === 'undefined' ? 'unknown' : navigator.platform || 'web',
  };
}

/** Normalise an axios failure into the shape retryPolicy understands. */
function toHttpLike(err: unknown): Parameters<typeof classifyHttp>[0] {
  const e = err as AxiosError<{ error?: string; message?: string; code?: string }>;
  return {
    status: e.response?.status,
    code: e.code,
    message: e.message,
    body: e.response?.data,
  };
}

/**
 * One measured request. Feeds the connectivity manager from real traffic rather
 * than a separate probe, and applies chaos when the simulator is on.
 */
async function measured<T>(fn: () => Promise<T>): Promise<T> {
  if (CHAOS.enabled) {
    await chaosDelay();
    if (chaosSyncShouldFail()) {
      reportRequestOutcome(false);
      const err = new Error('chaos: simulated sync failure') as AxiosError;
      err.response = { status: 503, data: {}, statusText: '', headers: {}, config: {} as never };
      throw err;
    }
  }
  const started = Date.now();
  try {
    const out = await fn();
    reportRequestOutcome(true, Date.now() - started);
    return out;
  } catch (err) {
    // A 4xx means the server answered — the link is fine, the request was not.
    // Counting it as a connectivity failure would flip a perfectly good device
    // into offline mode over a validation error.
    const status = (err as AxiosError).response?.status;
    reportRequestOutcome(status != null && status < 500, status != null ? Date.now() - started : undefined);
    throw err;
  }
}

// ── Authorisation refresh ────────────────────────────────────────────────────

export interface DeviceRegistration {
  device_id: string;
  entity_types: string[];
  operation_types: string[];
  server_checkpoint: number;
  schema_version: number;
}

export class SyncBlockedError extends Error {
  readonly code: 'device_revoked' | 'schema_incompatible' | 'unauthorized';
  constructor(code: SyncBlockedError['code'], message: string) {
    super(message);
    this.name = 'SyncBlockedError';
    this.code = code;
  }
}

/**
 * Confirm this device may still sync, and learn what it is allowed to hold.
 *
 * A 403 here is not a transient failure to be retried — it means access was
 * revoked while the device was offline, and the correct response is to stop
 * syncing and tell the user, not to keep hammering the endpoint.
 */
export async function registerDevice(): Promise<DeviceRegistration> {
  try {
    const { data } = await measured(() =>
      api.post<DeviceRegistration>('/sync/device', {}, { headers: syncHeaders() }),
    );
    return data;
  } catch (err) {
    const e = err as AxiosError<{ error?: string; message?: string }>;
    const status = e.response?.status;
    if (status === 403) {
      throw new SyncBlockedError('device_revoked', 'This device is no longer authorised to sync.');
    }
    if (status === 426) {
      throw new SyncBlockedError(
        'schema_incompatible',
        e.response?.data?.message ?? 'App update required before this device can sync.',
      );
    }
    throw err;
  }
}

// ── Pull ─────────────────────────────────────────────────────────────────────

export interface PullSummary {
  applied: number;
  deleted: number;
  pages: number;
  checkpoint: number;
  hasMore: boolean;
}

/**
 * Apply one page of changes to the local mirror.
 *
 * The `locallyModified` guard is the important line. A row with an unsent local
 * change is NOT overwritten by the server's version: doing so would erase the
 * optimistic state under the worker's feet while the operation that justifies
 * it is still queued. The server's revision is recorded anyway, so the pending
 * push will be correctly detected as conflicting when it lands.
 */
async function applyChanges(
  changes: PullChange[],
  userId: string,
  orgId: string,
): Promise<{ applied: number; deleted: number }> {
  let applied = 0;
  let deleted = 0;
  const now = Date.now();

  await db.transaction('rw', db.entities, async () => {
    for (const c of changes) {
      const key = `${c.entity_type}:${c.entity_id}`;

      if (c.operation === 'delete') {
        await db.entities.delete(key);
        deleted++;
        continue;
      }
      if (!c.data) continue;

      const existing = await db.entities.get(key);
      if (existing?.locallyModified) {
        // Keep the local body; take the server's revision so the conflict is
        // detectable rather than silent.
        await db.entities.update(key, {
          revision: c.revision,
          serverUpdatedAt: c.server_updated_at,
          lastSyncedAt: now,
        });
        applied++;
        continue;
      }

      const row: LocalEntity = {
        key,
        entityType: c.entity_type,
        entityId: c.entity_id,
        orgId,
        ownerLookup: userId,
        data: c.data,
        revision: c.revision,
        serverUpdatedAt: c.server_updated_at,
        lastSyncedAt: now,
        locallyModified: false,
      };
      await db.entities.put(row);
      applied++;
    }
  });

  return { applied, deleted };
}

/**
 * Walk the change feed until caught up or the page budget runs out.
 *
 * The checkpoint is committed after every page, so an interruption costs at
 * most one page rather than the whole run. That is what makes a device on a
 * link that drops every thirty seconds able to make progress at all.
 */
export async function pull(userId: string, orgId: string): Promise<PullSummary> {
  const summary: PullSummary = { applied: 0, deleted: 0, pages: 0, checkpoint: 0, hasMore: false };
  let checkpoint = await getCheckpoint(userId);
  // Smaller pages on a weak link: each one fails cheaper and the checkpoint
  // advances sooner, so a device on a connection that drops every thirty
  // seconds still makes forward progress instead of restarting a 200-row page
  // it never finishes.
  const limit = isEnabled('LOW_BANDWIDTH_MODE') && isDegraded() ? PULL_LIMIT_DEGRADED : PULL_LIMIT;

  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    const { data } = await measured(() =>
      api.get<{ changes: PullChange[]; checkpoint: number; hasMore: boolean }>('/sync/pull', {
        params: { checkpoint, limit },
        headers: syncHeaders(),
      }),
    );

    summary.pages++;

    if (data.changes.length > 0) {
      const res = await applyChanges(data.changes, userId, orgId);
      summary.applied += res.applied;
      summary.deleted += res.deleted;
    }

    checkpoint = data.checkpoint;
    await setCheckpoint(userId, checkpoint);
    summary.checkpoint = checkpoint;
    summary.hasMore = data.hasMore;

    if (!data.hasMore) break;
  }

  return summary;
}

// ── Push ─────────────────────────────────────────────────────────────────────

export interface PushSummary {
  attempted: number;
  accepted: number;
  duplicate: number;
  rejected: number;
  conflict: number;
  retryable: number;
}

const EMPTY_PUSH: PushSummary = {
  attempted: 0, accepted: 0, duplicate: 0, rejected: 0, conflict: 0, retryable: 0,
};

/** Record a conflict locally so the sync centre can show it without a round trip. */
async function recordConflict(entry: OutboxEntry, result: PushResult): Promise<void> {
  await db.conflicts.put({
    id: entry.id,
    operationId: entry.id,
    entityType: entry.entityType,
    entityId: entry.entityId,
    label: entry.label,
    localPayload: entry.payload,
    serverSnapshot: (result.result ?? null) as Record<string, unknown> | null,
    reason: result.error_message ?? 'This record changed while your device was offline.',
    detectedAt: Date.now(),
    ownerUserId: entry.ownerUserId,
  });
}

function tally(summary: PushSummary, cls: ClassifiedError, outcome: string): void {
  if (outcome === 'accepted') summary.accepted++;
  else if (outcome === 'duplicate') summary.duplicate++;
  else if (cls.status === 'CONFLICT') summary.conflict++;
  else if (cls.status === 'FAILED_PERMANENT') summary.rejected++;
  else summary.retryable++;
}

/**
 * Push entries whose transport is 'sync', as one batch.
 *
 * The whole batch shares a request, but each operation keeps its own outcome:
 * seven accepted, one duplicate, one conflict and one retryable stay ten
 * distinct facts. A transport-level failure is the only thing that applies to
 * all of them, and even then it applies as "unknown", not "failed".
 */
async function pushSyncBatch(entries: OutboxEntry[], summary: PushSummary): Promise<void> {
  const operations = entries.map(e => ({
    operation_id: e.id,
    type: e.type,
    entity_id: e.entityId,
    payload: e.payload,
    client_created_at: new Date(e.clientCreatedAt).toISOString(),
    local_sequence: e.localSequence,
  }));

  await markSyncing(entries.map(e => e.id));

  let results: PushResult[];
  try {
    const { data } = await measured(() =>
      api.post<{ results: PushResult[] }>('/sync/push', { operations }, { headers: syncHeaders() }),
    );
    results = data.results;
  } catch (err) {
    // The request itself failed, so no operation's fate is known. Every entry
    // goes back to retryable — never to failed, which would be a claim the
    // server made a decision it may not have made.
    const cls = classifyHttp(toHttpLike(err));
    for (const e of entries) {
      await markFailure(e.id, cls);
      summary.retryable++;
    }
    return;
  }

  const byId = new Map(results.map(r => [r.operation_id, r]));

  for (const e of entries) {
    const r = byId.get(e.id);
    if (!r) {
      // The server did not mention this operation. Unknown, so retryable.
      await markFailure(e.id, {
        errorClass: 'SERVER_FAILURE',
        status: 'FAILED_RETRYABLE',
        retryable: true,
        code: 'missing_result',
        message: 'Sonalit did not report an outcome for this action.',
      });
      summary.retryable++;
      continue;
    }

    const cls = classifyPushOutcome(r.outcome, r.error_code, r.error_message);
    tally(summary, cls, r.outcome);

    if (cls.status === 'ACKNOWLEDGED') {
      await markAcknowledged(e.id, r.result ?? null);
      await clearLocalModification(e);
    } else {
      if (cls.status === 'CONFLICT') await recordConflict(e, r);
      await markFailure(e.id, cls);
    }
  }
}

/**
 * Push one entry whose transport is 'http', by replaying its original request.
 *
 * The operation id rides as `x-idempotency-key`, which is what the existing
 * middleware already understands — so a retry after a lost ACK returns the
 * original response instead of performing the action again. Nothing about the
 * target route changes.
 */
async function pushHttpEntry(entry: OutboxEntry, summary: PushSummary): Promise<void> {
  if (!entry.request) {
    await markFailure(entry.id, {
      errorClass: 'VALIDATION_FAILURE',
      status: 'FAILED_PERMANENT',
      retryable: false,
      code: 'malformed_entry',
      message: 'This queued action is missing the request it should replay.',
    });
    summary.rejected++;
    return;
  }

  // Captured before the awaits so the narrowing above survives them — TypeScript
  // widens `entry.request` back to optional across an await boundary, and a
  // non-null assertion here would be asserting exactly the thing this queue
  // exists to be careful about.
  const request = entry.request;

  await markSyncing([entry.id]);

  const config: AxiosRequestConfig = {
    headers: { ...syncHeaders(), 'x-idempotency-key': entry.id },
  };

  try {
    const { data } = await measured(() =>
      api.request<Record<string, unknown>>({
        method: request.method,
        url: request.url,
        data: request.body,
        ...config,
      }),
    );
    await markAcknowledged(entry.id, data ?? null);
    await clearLocalModification(entry);
    summary.accepted++;
  } catch (err) {
    const cls = classifyHttp(toHttpLike(err));
    if (cls.status === 'CONFLICT') {
      await recordConflict(entry, {
        operation_id: entry.id,
        outcome: 'conflict',
        error_message: cls.message,
      });
    }
    await markFailure(entry.id, cls);
    tally(summary, cls, 'failed');
  }
}

/**
 * The optimistic local change has now been confirmed (or superseded), so the
 * row is no longer holding the server's version at bay.
 */
async function clearLocalModification(entry: OutboxEntry): Promise<void> {
  if (!entry.entityId) return;
  const key = `${entry.entityType}:${entry.entityId}`;
  const row = await db.entities.get(key);
  if (row?.locallyModified) {
    await db.entities.update(key, { locallyModified: false });
  }
}

export async function push(userId: string): Promise<PushSummary> {
  const summary: PushSummary = { ...EMPTY_PUSH };
  const due = await dueEntries(userId);
  if (due.length === 0) return summary;

  // Already sorted by priority then sequence. Slice the highest-priority window
  // so a huge telemetry backlog cannot starve a newly recorded incident.
  const window = due.slice(0, PUSH_BATCH);
  summary.attempted = window.length;

  const syncEntries = window.filter(e => e.transport === 'sync');
  const httpEntries = window.filter(e => e.transport === 'http');

  // HTTP entries first: those are the existing hardened operations (clamp,
  // unclamp) and they are what a yard worker is waiting on.
  for (const e of httpEntries) {
    await pushHttpEntry(e, summary);
  }

  if (syncEntries.length > 0) {
    await pushSyncBatch(syncEntries, summary);
  }

  return summary;
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface SyncRunSummary {
  ranAt: number;
  pull: PullSummary | null;
  push: PushSummary | null;
  blocked: SyncBlockedError | null;
  error: string | null;
}

let running = false;
let lastRun: SyncRunSummary | null = null;

export function lastSyncRun(): SyncRunSummary | null {
  return lastRun;
}

/**
 * One full sync cycle.
 *
 * Single-flight: a second caller while one is in progress is a no-op rather
 * than a queue, because two concurrent runs would race on the checkpoint and
 * could push the same entry twice. (Twice is safe thanks to idempotency, but
 * it is wasted bandwidth on a link that has none.)
 *
 * Never throws. A sync engine that can take the app down with it is worse than
 * no sync engine — the worker's ability to keep recording work locally must not
 * depend on this succeeding.
 */
export async function runSync(userId: string, orgId: string): Promise<SyncRunSummary> {
  const result: SyncRunSummary = { ranAt: Date.now(), pull: null, push: null, blocked: null, error: null };

  if (running) return result;
  if (!isEnabled('OFFLINE_SYNC')) return result;
  if (!isReachable()) return result;

  running = true;
  const endSync = beginSync();

  try {
    await recoverInFlight();

    // 1. Authorisation first. Everything below depends on still being allowed.
    await registerDevice();

    // 2. Field work up before state comes down.
    result.push = await push(userId);

    // 3. Reconcile.
    result.pull = await pull(userId, orgId);

    reportSyncSuccess();
  } catch (err) {
    if (err instanceof SyncBlockedError) {
      result.blocked = err;
    } else {
      result.error = err instanceof Error ? err.message : String(err);
    }
  } finally {
    running = false;
    endSync();
    lastRun = result;
  }

  return result;
}

export async function queueDepth(userId: string): Promise<number> {
  const c = await counts(userId);
  return c.pending + c.syncing + c.failedRetryable;
}

/** Test seam. */
export function _resetEngine(): void {
  running = false;
  lastRun = null;
}
