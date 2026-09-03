/**
 * Shared vocabulary for the offline layer.
 *
 * The types here are deliberately explicit about the distinction the rest of
 * the UI keeps getting wrong when it is left implicit: *recorded on the device*
 * and *accepted by Sonalit* are different facts, and a screen that renders them
 * the same way is lying to the person holding the phone.
 */

/** Local schema version. Sent to the server so it can refuse to misread us. */
export const CLIENT_SCHEMA_VERSION = 1;

// ── Connectivity ─────────────────────────────────────────────────────────────

/**
 * DEGRADED is not a nice-to-have. A network that exists but is unusable — a
 * captive portal, a saturated cell, an API that is up but 20 seconds slow —
 * behaves nothing like either ONLINE or OFFLINE, and code that only knows the
 * two extremes hammers a dying link with full-fat requests.
 */
export type ConnectivityState = 'UNKNOWN' | 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'SYNCING';

export interface ConnectivitySnapshot {
  state: ConnectivityState;
  /** navigator.onLine — a hint, never the verdict. */
  networkUp: boolean;
  /** Did the last real request to the Sonalit API succeed? */
  apiReachable: boolean;
  /** Centrifugo status, tracked separately: realtime can die while the API is fine. */
  realtimeConnected: boolean;
  /** Rolling median round-trip in ms, or null if unmeasured. */
  latencyMs: number | null;
  lastSuccessfulRequestAt: number | null;
  lastSuccessfulSyncAt: number | null;
  /** Consecutive failed probes; drives the state machine's hysteresis. */
  consecutiveFailures: number;
}

// ── Outbox ───────────────────────────────────────────────────────────────────

/**
 * Priority bands. Lower number wins. These are why a photo cannot delay a
 * panic: the drain loop sorts on this before anything else.
 */
export const PRIORITY = {
  EMERGENCY: 0,
  CRITICAL: 1,
  TELEMETRY: 2,
  SUPPORTING: 3,
  BACKGROUND: 4,
} as const;

export type Priority = (typeof PRIORITY)[keyof typeof PRIORITY];

/**
 * Outbox lifecycle.
 *
 * Six states rather than a boolean because they are genuinely six different
 * things a worker might need to be told, and collapsing any pair of them
 * produces a screen that either over-promises or loses work:
 *
 *   PENDING            recorded here, not sent
 *   SYNCING            in flight; outcome unknown
 *   ACKNOWLEDGED       the server said it applied this
 *   FAILED_RETRYABLE   it will be tried again on its own
 *   FAILED_PERMANENT   it will not; a human has to do something
 *   CONFLICT           the server refused because the world moved on
 */
export type OutboxStatus =
  | 'PENDING'
  | 'SYNCING'
  | 'ACKNOWLEDGED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_PERMANENT'
  | 'CONFLICT';

/**
 * How an operation reaches the server.
 *
 *   'http' — replay the original REST call against its existing route, with the
 *            operation id as `x-idempotency-key`. Used for anything that already
 *            has a hardened endpoint (clamp, unclamp). Nothing about that route's
 *            validation, authorisation or audit changes; the outbox only decides
 *            *when* the call happens.
 *   'sync' — batch through POST /sync/push. Used for operations that had no
 *            offline story before and need conflict-aware, transactional
 *            application.
 *
 * One outbox, two transports. The alternative — a second server-side path that
 * re-implements clamp — would be a second business-rule engine, which is the
 * one thing this layer must not become.
 */
export type OutboxTransport = 'http' | 'sync';

export interface OutboxEntry {
  /** UUID. Doubles as the idempotency key and the server-side operation id. */
  id: string;
  /** Monotonic per-device counter. Preserves intra-device causal order. */
  localSequence: number;
  /** Operation type from the capability matrix, e.g. 'cds_container.status_change'. */
  type: string;
  transport: OutboxTransport;
  entityType: string;
  entityId: string | null;
  /** Short human label, so the sync centre can name the action without decoding a payload. */
  label: string;
  priority: Priority;
  payload: Record<string, unknown>;
  /** For transport 'http': the request to replay. */
  request?: { method: 'POST' | 'PATCH' | 'PUT'; url: string; body: Record<string, unknown> };
  /**
   * Ids of entries that must be ACKNOWLEDGED first. A photo cannot upload
   * before the incident it belongs to exists server-side.
   */
  dependsOn: string[];
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms. The drain loop skips entries whose time has not come. */
  nextAttemptAt: number;
  lastAttemptAt: number | null;
  /** Device-observed creation time, preserved end to end. */
  clientCreatedAt: number;
  schemaVersion: number;
  /** Scopes every row to the user who created it. Cleared on logout / user switch. */
  ownerUserId: string;
  ownerOrgId: string;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  /** Server's own words once it has spoken, for the audit trail. */
  serverResult: Record<string, unknown> | null;
  acknowledgedAt: number | null;
}

// ── Local entity mirror ──────────────────────────────────────────────────────

/**
 * A replicated row plus the metadata that lets the UI tell the truth about it.
 * `serverUpdatedAt` and `lastSyncedAt` are different questions: "when did this
 * last change" versus "when did we last hear anything at all".
 */
export interface LocalEntity {
  /** `${entityType}:${entityId}` — Dexie primary key. */
  key: string;
  entityType: string;
  entityId: string;
  orgId: string;
  /**
   * The user this cached copy belongs to. Scope is per-user, so one worker's
   * mirror is never another's — and the logout purge indexes on this.
   */
  ownerLookup: string;
  data: Record<string, unknown>;
  revision: number | null;
  serverUpdatedAt: string | null;
  lastSyncedAt: number;
  /** Set when a local operation has changed this row but not yet been accepted. */
  locallyModified: boolean;
}

// ── GPS ──────────────────────────────────────────────────────────────────────

export interface BufferedFix {
  /** `${deviceTime}` is not unique across vehicles; the id is minted locally. */
  id: string;
  vehicleId: string;
  tripId: string | null;
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  /** Device-observed instant. Never replaced by receipt time. */
  deviceTime: string;
  sequence: number;
  ownerUserId: string;
  ownerOrgId: string;
}

// ── Sync metadata ────────────────────────────────────────────────────────────

export interface SyncMeta {
  key: string;
  value: unknown;
}

export interface ConflictRecord {
  id: string;
  operationId: string;
  entityType: string;
  entityId: string | null;
  label: string;
  localPayload: Record<string, unknown>;
  serverSnapshot: Record<string, unknown> | null;
  reason: string;
  detectedAt: number;
  ownerUserId: string;
}

/** One operation's outcome as reported by POST /sync/push. */
export type PushOutcome = 'accepted' | 'duplicate' | 'rejected' | 'conflict' | 'retryable';

export interface PushResult {
  operation_id: string;
  outcome: PushOutcome;
  result?: Record<string, unknown> | null;
  entity_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
}

export interface PullChange {
  seq: number;
  entity_type: string;
  entity_id: string;
  operation: 'upsert' | 'delete';
  revision: number | null;
  server_updated_at: string | null;
  data: Record<string, unknown> | null;
}
