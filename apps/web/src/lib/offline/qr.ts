/**
 * Offline QR resolution.
 *
 * A QR code is data, not a permission. Decoding one has never needed a network
 * and should not pretend to — but resolving it to a record, and then acting on
 * that record, are two very different things, and the split below is the whole
 * point of this module.
 *
 *   decode  → pure string parsing, always available
 *   resolve → look the entity up in the local mirror, offline-capable
 *   act     → goes through the capability matrix, which may well say no
 *
 * Offline QR must not become a way around a control. If an operation requires
 * live authorisation, the scan still succeeds and the record still displays —
 * and the action says ONLINE VALIDATION REQUIRED instead of quietly succeeding.
 */

import { checkEligibility, type Eligibility } from './capabilities.js';
import { findEntityBy, getEntity, type Fresh } from './entities.js';

export type ScanKind = 'container' | 'booking' | 'trip' | 'guardian_session' | 'unknown';

export interface DecodedScan {
  kind: ScanKind;
  /** The identifier the code carries — a UUID, a container number, a token. */
  value: string;
  /** The raw scanned text, kept for diagnostics and for codes we cannot classify. */
  raw: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** ISO 6346: four letters then seven digits, e.g. MSKU1234567. */
const CONTAINER_RE = /^[A-Z]{4}\d{7}$/;

/**
 * Classify a scanned string.
 *
 * Sonalit codes are URLs carrying a typed path; a bare container number is also
 * accepted because printed container plates are scanned directly. Anything else
 * is `unknown`, which the UI shows as "not a Sonalit code" rather than guessing.
 */
export function decodeScan(raw: string): DecodedScan {
  const text = raw.trim();

  // sonalit://container/<id>, or https://<host>/scan/container/<id>
  const m = /(?:^sonalit:\/\/|\/scan\/)(container|booking|trip|guardian)\/([\w-]+)/i.exec(text);
  if (m) {
    const [, type, value] = m;
    const kind: ScanKind =
      type?.toLowerCase() === 'container' ? 'container'
        : type?.toLowerCase() === 'booking' ? 'booking'
          : type?.toLowerCase() === 'trip' ? 'trip'
            : 'guardian_session';
    return { kind, value: value ?? '', raw: text };
  }

  const upper = text.toUpperCase();
  if (CONTAINER_RE.test(upper)) return { kind: 'container', value: upper, raw: text };
  if (UUID_RE.test(text)) return { kind: 'unknown', value: text, raw: text };

  return { kind: 'unknown', value: text, raw: text };
}

export type ResolutionStatus = 'resolved' | 'not_found' | 'unsupported';

export interface ScanResolution {
  status: ResolutionStatus;
  scan: DecodedScan;
  entityType: string | null;
  entityId: string | null;
  entity: Fresh<Record<string, unknown>> | null;
  /** Set when the record resolved but the copy is old enough to matter. */
  staleWarning: string | null;
}

const ENTITY_TYPE_FOR: Partial<Record<ScanKind, string>> = {
  container: 'cds_container',
  booking: 'cds_booking',
  trip: 'cds_trip',
};

/** Beyond an hour, say so. Below it, a container's details do not drift enough to warn about. */
const STALE_WARN_MS = 60 * 60 * 1000;

/**
 * Resolve a scan against the local mirror.
 *
 * No network. If the entity was replicated, it resolves; if it was not, the
 * honest answer is "not on this device", not a spinner that never ends.
 */
export async function resolveScan(
  raw: string,
  now: number = Date.now(),
): Promise<ScanResolution> {
  const scan = decodeScan(raw);
  const entityType = ENTITY_TYPE_FOR[scan.kind] ?? null;

  const base: ScanResolution = {
    status: 'unsupported',
    scan,
    entityType,
    entityId: null,
    entity: null,
    staleWarning: null,
  };

  if (!entityType) return base;

  // A container plate carries its ISO number, not its Sonalit id, so try the
  // id first and fall back to the natural key.
  let entity = UUID_RE.test(scan.value) ? await getEntity(entityType, scan.value, now) : null;
  let entityId = entity ? scan.value : null;

  if (!entity && scan.kind === 'container') {
    entity = await findEntityBy(entityType, 'number', scan.value, now);
    entityId = entity ? String(entity.data['id'] ?? '') : null;
  }
  if (!entity && scan.kind === 'booking') {
    entity = await findEntityBy(entityType, 'booking_number', scan.value, now);
    entityId = entity ? String(entity.data['id'] ?? '') : null;
  }

  if (!entity) return { ...base, status: 'not_found' };

  const staleWarning = entity.ageMs > STALE_WARN_MS
    ? `Last synced ${formatAge(entity.ageMs)} ago — details may have changed.`
    : null;

  return { status: 'resolved', scan, entityType, entityId, entity, staleWarning };
}

function formatAge(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/**
 * Can this scanned record be acted on right now?
 *
 * Thin on purpose — it delegates to the capability matrix rather than growing
 * its own rules, so there is exactly one place that decides what is permitted
 * offline, and the QR path cannot drift away from it.
 */
export function canActOnScan(
  operationType: string,
  resolution: ScanResolution,
  ctx: { role: string; online: boolean; now?: number },
): Eligibility {
  return checkEligibility(operationType, {
    role: ctx.role,
    online: ctx.online,
    localEntity: resolution.entity
      ? { revision: resolution.entity.revision, lastSyncedAt: (ctx.now ?? Date.now()) - resolution.entity.ageMs }
      : undefined,
    ...(ctx.now !== undefined ? { now: ctx.now } : {}),
  });
}
