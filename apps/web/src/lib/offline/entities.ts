/**
 * Reading the local mirror.
 *
 * Every read here returns freshness alongside the data, and callers are
 * expected to render it. A container's status shown without "last synced 3h
 * ago" is indistinguishable from live truth, and a worker making a decision on
 * a three-hour-old status deserves to know that is what they are looking at.
 */

import { db } from './db.js';

import type { LocalEntity } from './types.js';

export interface Fresh<T> {
  data: T;
  /** ms since this row was last confirmed against the server. */
  ageMs: number;
  /** True when the value shown reflects an operation Sonalit has not confirmed. */
  locallyModified: boolean;
  revision: number | null;
}

function wrap(row: LocalEntity, now: number): Fresh<Record<string, unknown>> {
  return {
    data: row.data,
    ageMs: now - row.lastSyncedAt,
    locallyModified: row.locallyModified,
    revision: row.revision,
  };
}

export async function getEntity(
  entityType: string,
  entityId: string,
  now: number = Date.now(),
): Promise<Fresh<Record<string, unknown>> | null> {
  const row = await db.entities.get(`${entityType}:${entityId}`);
  return row ? wrap(row, now) : null;
}

export async function listEntities(
  entityType: string,
  now: number = Date.now(),
): Promise<Fresh<Record<string, unknown>>[]> {
  const rows = await db.entities.where('entityType').equals(entityType).toArray();
  return rows.map(r => wrap(r, now));
}

/**
 * Find one entity by a field value — the QR path, where the scanned code is a
 * container number rather than a UUID.
 *
 * A linear scan over the type's rows, deliberately: the replicated slice for a
 * field role is hundreds of rows, not millions, and adding a Dexie index per
 * searchable field would mean a schema migration every time a new lookup is
 * wanted.
 */
export async function findEntityBy(
  entityType: string,
  field: string,
  value: string,
  now: number = Date.now(),
): Promise<Fresh<Record<string, unknown>> | null> {
  const target = value.trim().toUpperCase();
  const rows = await db.entities.where('entityType').equals(entityType).toArray();
  const hit = rows.find(r => String(r.data[field] ?? '').trim().toUpperCase() === target);
  return hit ? wrap(hit, now) : null;
}

/**
 * Apply an optimistic local change.
 *
 * Marks the row `locallyModified`, which is what stops the next pull from
 * overwriting it before the queued operation has been accepted. Must be called
 * inside the same transaction as the outbox insert — `recordOperation` provides
 * exactly that via its `applyLocally` callback.
 */
export async function applyLocalChange(
  entityType: string,
  entityId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const key = `${entityType}:${entityId}`;
  const row = await db.entities.get(key);
  if (!row) return;
  await db.entities.update(key, {
    data: { ...row.data, ...patch },
    locallyModified: true,
  });
}

/**
 * Prune the mirror under storage pressure.
 *
 * Only rows that are neither locally modified nor recently synced. A row
 * backing an unsent operation is never dropped: losing it would leave the
 * queued change with no context to display and no revision to conflict against.
 */
export async function pruneEntities(olderThanMs: number, keepTypes: string[] = []): Promise<number> {
  const cutoff = Date.now() - olderThanMs;
  const keep = new Set(keepTypes);
  const stale = await db.entities
    .filter(r => !r.locallyModified && !keep.has(r.entityType) && r.lastSyncedAt < cutoff)
    .primaryKeys();
  if (stale.length === 0) return 0;
  await db.entities.bulkDelete(stale);
  return stale.length;
}
