/**
 * Operation Capability Matrix — the single place that decides what Sonalit will
 * let someone do without a server.
 *
 * The default is ONLINE_REQUIRED. Making everything offline-capable is the
 * failure mode this file exists to prevent: an offline path around a control is
 * a way to defeat that control, and "the app let me" is not an authorisation.
 * An operation earns an offline classification only when a queued version of it
 * is genuinely equivalent to a live one — same validation, same authorisation,
 * same audit — just delayed.
 *
 * Three classifications:
 *
 *   OFFLINE_ALLOWED
 *     Append-only field observations. Recording that something was seen cannot
 *     be wrong in a way the server would have caught, and the record is the
 *     point. Worst case it is rejected later, and the event survives for review.
 *
 *   OFFLINE_ALLOWED_WITH_RESTRICTIONS
 *     Changes to shared state. Permitted only with the concurrency and role
 *     conditions named in `restrictions`, and every one of them is enforced
 *     again server-side — the checks here exist to avoid queueing work that is
 *     already doomed, not to be the authorisation.
 *
 *   ONLINE_REQUIRED
 *     Anything where the legitimacy of the action depends on the server saying
 *     yes at the time it happens: issuing an authorisation, commanding physical
 *     hardware, administrative or destructive changes. These do not queue. The
 *     UI says so plainly instead of pretending.
 *
 * Note what is deliberately ONLINE_REQUIRED below. An e-lock command is not
 * queueable because a queued command is indistinguishable, to the person
 * standing at the container, from a lock that actually opened. Delivery
 * *confirmation* likewise stays online: the field can record that a delivery
 * happened (an observation), but only Sonalit can complete the business
 * transaction that follows from it.
 */

export type Capability =
  | 'OFFLINE_ALLOWED'
  | 'OFFLINE_ALLOWED_WITH_RESTRICTIONS'
  | 'ONLINE_REQUIRED';

import { PRIORITY, type OutboxTransport, type Priority } from './types.js';

export interface OperationSpec {
  /** Stable identifier, matching the server-side handler registry where transport is 'sync'. */
  type: string;
  capability: Capability;
  entityType: string;
  transport: OutboxTransport;
  priority: Priority;
  /** Roles permitted to queue this. Re-checked on the server; this only avoids doomed queueing. */
  roles: string[];
  /** Human sentence shown when the operation is refused offline. */
  onlineReason?: string;
  /** Conditions that must hold for a restricted operation to be queueable. */
  restrictions?: {
    /** The entity must have been synced, and its revision sent with the change. */
    requiresRevision?: boolean;
    /** The entity must be present in the local mirror — no blind writes to unseen ids. */
    requiresLocalEntity?: boolean;
    /** Refuse to queue if the local copy is older than this (ms). */
    maxStalenessMs?: number;
  };
}

/** Twelve hours. Past that, a container's status on this device is a rumour. */
const STALE_LIMIT_MS = 12 * 60 * 60 * 1000;

const FIELD_ROLES = ['admin', 'dispatcher', 'operator', 'cfo', 'yard_agent', 'port_agent', 'response_crew'];
const OFFICE_ROLES = ['admin', 'dispatcher', 'operator'];

const SPECS: readonly OperationSpec[] = Object.freeze([
  // ── Append-only field records ──────────────────────────────────────────────
  {
    type: 'cds_incident.create',
    capability: 'OFFLINE_ALLOWED',
    entityType: 'cds_incident',
    transport: 'sync',
    priority: PRIORITY.CRITICAL,
    roles: FIELD_ROLES,
  },
  {
    type: 'cds_trip.observation',
    capability: 'OFFLINE_ALLOWED',
    entityType: 'cds_trip',
    transport: 'sync',
    priority: PRIORITY.SUPPORTING,
    roles: FIELD_ROLES,
  },
  {
    type: 'gps.batch',
    capability: 'OFFLINE_ALLOWED',
    entityType: 'gps',
    transport: 'sync',
    priority: PRIORITY.TELEMETRY,
    roles: FIELD_ROLES,
  },

  // ── Shared state, guarded by optimistic concurrency ────────────────────────
  {
    type: 'cds_container.status_change',
    capability: 'OFFLINE_ALLOWED_WITH_RESTRICTIONS',
    entityType: 'cds_container',
    transport: 'sync',
    priority: PRIORITY.CRITICAL,
    roles: FIELD_ROLES,
    restrictions: {
      requiresRevision: true,
      requiresLocalEntity: true,
      maxStalenessMs: STALE_LIMIT_MS,
    },
  },

  // ── Existing hardened routes, replayed by the outbox ───────────────────────
  // These keep their own server-side validation and audit. The outbox only
  // decides when the request is made and guarantees it is made exactly once.
  {
    type: 'cds_container.clamp',
    capability: 'OFFLINE_ALLOWED_WITH_RESTRICTIONS',
    entityType: 'cds_container',
    transport: 'http',
    priority: PRIORITY.CRITICAL,
    roles: [...OFFICE_ROLES, 'yard_agent'],
    restrictions: { requiresLocalEntity: true, maxStalenessMs: STALE_LIMIT_MS },
  },
  {
    type: 'cds_container.unclamp',
    capability: 'OFFLINE_ALLOWED_WITH_RESTRICTIONS',
    entityType: 'cds_container',
    transport: 'http',
    priority: PRIORITY.CRITICAL,
    roles: [...OFFICE_ROLES, 'port_agent'],
    restrictions: { requiresLocalEntity: true, maxStalenessMs: STALE_LIMIT_MS },
  },

  // ── Refused offline, stated plainly ────────────────────────────────────────
  {
    type: 'elock.command',
    capability: 'ONLINE_REQUIRED',
    entityType: 'cds_electronic_lock',
    transport: 'sync',
    priority: PRIORITY.CRITICAL,
    roles: OFFICE_ROLES,
    onlineReason:
      'An e-lock command has to reach the lock to mean anything. Queuing one would show a lock as open when it is still shut.',
  },
  {
    type: 'cds_trip.complete_delivery',
    capability: 'ONLINE_REQUIRED',
    entityType: 'cds_trip',
    transport: 'http',
    priority: PRIORITY.CRITICAL,
    roles: OFFICE_ROLES,
    onlineReason:
      'Completing a delivery starts custody and invoicing steps that only Sonalit can authorise. Record the delivery as an observation now and complete it once you are back online.',
  },
  {
    type: 'convoy.lifecycle_change',
    capability: 'ONLINE_REQUIRED',
    entityType: 'convoy',
    transport: 'http',
    priority: PRIORITY.CRITICAL,
    roles: OFFICE_ROLES,
    onlineReason: 'Starting or ending a convoy affects every vehicle on it and needs live confirmation.',
  },
  {
    type: 'admin.user_change',
    capability: 'ONLINE_REQUIRED',
    entityType: 'user',
    transport: 'http',
    priority: PRIORITY.BACKGROUND,
    roles: ['admin'],
    onlineReason: 'Permission changes are always applied live.',
  },
]);

const BY_TYPE = new Map(SPECS.map(s => [s.type, s]));

export function getSpec(type: string): OperationSpec | undefined {
  return BY_TYPE.get(type);
}

export function allSpecs(): readonly OperationSpec[] {
  return SPECS;
}

export interface EligibilityContext {
  role: string;
  /** Whether the device currently believes it can reach Sonalit. */
  online: boolean;
  /** The local mirror row backing this operation, when the matrix requires one. */
  localEntity?: { revision: number | null; lastSyncedAt: number } | undefined;
  /** Injectable for tests. */
  now?: number;
}

export type Eligibility =
  | { allowed: true; spec: OperationSpec }
  | { allowed: false; code: EligibilityFailure; reason: string; spec?: OperationSpec };

export type EligibilityFailure =
  | 'unknown_operation'
  | 'forbidden_role'
  | 'online_required'
  | 'not_synced'
  | 'stale_data'
  | 'missing_revision';

/**
 * May this operation be recorded right now?
 *
 * Called before anything is written locally, so a refusal is visible to the
 * worker before they believe the work is done — which is the whole point. When
 * the device is online every operation is allowed; the matrix only ever
 * constrains the offline path.
 */
export function checkEligibility(type: string, ctx: EligibilityContext): Eligibility {
  const spec = BY_TYPE.get(type);
  if (!spec) {
    return {
      allowed: false,
      code: 'unknown_operation',
      reason: `Unknown operation: ${type}`,
    };
  }

  if (!spec.roles.includes(ctx.role)) {
    return {
      allowed: false,
      code: 'forbidden_role',
      reason: 'Your role cannot perform this action.',
      spec,
    };
  }

  // Online: the server is the authority and will answer for itself.
  if (ctx.online) return { allowed: true, spec };

  if (spec.capability === 'ONLINE_REQUIRED') {
    return {
      allowed: false,
      code: 'online_required',
      reason: spec.onlineReason ?? 'This action needs a live connection to Sonalit.',
      spec,
    };
  }

  if (spec.capability === 'OFFLINE_ALLOWED') return { allowed: true, spec };

  const r = spec.restrictions ?? {};
  const now = ctx.now ?? Date.now();

  if (r.requiresLocalEntity && !ctx.localEntity) {
    return {
      allowed: false,
      code: 'not_synced',
      reason: 'This record has not been synced to your device, so it cannot be changed offline.',
      spec,
    };
  }

  if (ctx.localEntity) {
    if (r.requiresRevision && ctx.localEntity.revision == null) {
      return {
        allowed: false,
        code: 'missing_revision',
        reason: 'Your copy of this record is missing version information. Reconnect to refresh it.',
        spec,
      };
    }
    if (r.maxStalenessMs != null && now - ctx.localEntity.lastSyncedAt > r.maxStalenessMs) {
      return {
        allowed: false,
        code: 'stale_data',
        reason: 'Your copy of this record is too old to change safely offline. Reconnect to refresh it.',
        spec,
      };
    }
  }

  return { allowed: true, spec };
}
