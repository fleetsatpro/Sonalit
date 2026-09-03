/**
 * Error classification and backoff.
 *
 * Pure functions, no I/O, no Dexie, no axios instance — the whole point is that
 * the rules deciding whether a worker's shift survives a bad network are
 * testable without a browser or a server.
 *
 * The classification is the load-bearing part. "Retry on failure" is not a
 * policy: retrying a validation error forever burns battery on a link that has
 * none to spare, and giving up on a timeout throws away work that would have
 * succeeded on the next attempt. Every failure has to land in exactly one
 * bucket, and the bucket decides what happens to the queued operation.
 */

import type { OutboxStatus } from './types.js';

export type ErrorClass =
  | 'NETWORK_FAILURE'
  | 'SERVER_FAILURE'
  | 'AUTHENTICATION_FAILURE'
  | 'AUTHORIZATION_FAILURE'
  | 'VALIDATION_FAILURE'
  | 'CONFLICT'
  | 'DUPLICATE'
  | 'SCHEMA_FAILURE'
  | 'RATE_LIMITED'
  | 'UNKNOWN';

export interface ClassifiedError {
  errorClass: ErrorClass;
  /** What the outbox entry becomes as a result. */
  status: OutboxStatus;
  retryable: boolean;
  code: string;
  message: string;
}

/** The shape we need from an axios error, without depending on axios here. */
export interface HttpLikeError {
  status?: number | undefined;
  code?: string | undefined;
  message?: string | undefined;
  body?: { error?: string; message?: string; code?: string } | undefined;
}

function bodyMessage(e: HttpLikeError, fallback: string): string {
  return e.body?.message ?? e.body?.error ?? e.message ?? fallback;
}

/**
 * Map a transport failure to a class and an outbox status.
 *
 * The choices worth arguing about:
 *
 * - **No status at all → retryable.** The request never got an answer, so the
 *   operation's fate is unknown, and unknown is not failed. This is the
 *   overwhelmingly common case in the field and it must never lose work.
 *
 * - **401 → retryable, not permanent.** An expired access token is a transport
 *   problem, not a business rejection. The refresh interceptor renews it and
 *   the next drain succeeds. Discarding a shift's work because a token aged out
 *   would be absurd.
 *
 * - **403 → permanent.** Authorisation was refused. Retrying cannot change that
 *   and the queue should stop pretending it might; the worker needs to be told.
 *
 * - **409 → CONFLICT, its own terminal state.** Not a failure and not a
 *   success. The local event is preserved and surfaced for review; silently
 *   dropping it or silently forcing it are both wrong.
 *
 * - **422/426 → schema.** The client is speaking a dialect the server will not
 *   accept. Retrying the same payload is pointless; the app needs updating.
 */
export function classifyHttp(e: HttpLikeError): ClassifiedError {
  const status = e.status;

  if (status == null) {
    return {
      errorClass: 'NETWORK_FAILURE',
      status: 'FAILED_RETRYABLE',
      retryable: true,
      code: e.code ?? 'network_error',
      message: 'No response from Sonalit.',
    };
  }

  if (status === 401) {
    return {
      errorClass: 'AUTHENTICATION_FAILURE',
      status: 'FAILED_RETRYABLE',
      retryable: true,
      code: 'unauthenticated',
      message: 'Sign-in expired. Work is held on this device until you sign in again.',
    };
  }

  if (status === 403) {
    return {
      errorClass: 'AUTHORIZATION_FAILURE',
      status: 'FAILED_PERMANENT',
      retryable: false,
      code: e.body?.code ?? 'forbidden',
      message: bodyMessage(e, 'Sonalit did not permit this action.'),
    };
  }

  if (status === 409) {
    return {
      errorClass: 'CONFLICT',
      status: 'CONFLICT',
      retryable: false,
      code: e.body?.code ?? 'conflict',
      message: bodyMessage(e, 'This record changed while your device was offline.'),
    };
  }

  if (status === 422 || status === 426) {
    return {
      errorClass: 'SCHEMA_FAILURE',
      status: 'FAILED_PERMANENT',
      retryable: false,
      code: e.body?.code ?? 'schema_incompatible',
      message: bodyMessage(e, 'This app version cannot sync with Sonalit. Update required.'),
    };
  }

  if (status === 408 || status === 429) {
    return {
      errorClass: 'RATE_LIMITED',
      status: 'FAILED_RETRYABLE',
      retryable: true,
      code: status === 429 ? 'rate_limited' : 'request_timeout',
      message: 'Sonalit is busy. Retrying shortly.',
    };
  }

  if (status >= 500) {
    return {
      errorClass: 'SERVER_FAILURE',
      status: 'FAILED_RETRYABLE',
      retryable: true,
      code: 'server_error',
      message: 'Sonalit had a problem handling this. Retrying.',
    };
  }

  if (status >= 400) {
    return {
      errorClass: 'VALIDATION_FAILURE',
      status: 'FAILED_PERMANENT',
      retryable: false,
      code: e.body?.code ?? `http_${status}`,
      message: bodyMessage(e, 'Sonalit did not accept this action.'),
    };
  }

  return {
    errorClass: 'UNKNOWN',
    status: 'FAILED_RETRYABLE',
    retryable: true,
    code: `http_${status}`,
    message: bodyMessage(e, 'Unexpected response from Sonalit.'),
  };
}

/**
 * Map a per-operation outcome from POST /sync/push.
 *
 * `duplicate` is a success. It is the server saying "I already did this" — the
 * exact answer that makes a lost ACK harmless — and treating it as anything
 * else would either lose the acknowledgement or re-run the work.
 */
export function classifyPushOutcome(
  outcome: string,
  errorCode?: string | null,
  errorMessage?: string | null,
): ClassifiedError {
  switch (outcome) {
    case 'accepted':
      return {
        errorClass: 'UNKNOWN',
        status: 'ACKNOWLEDGED',
        retryable: false,
        code: 'accepted',
        message: 'Confirmed by Sonalit.',
      };
    case 'duplicate':
      return {
        errorClass: 'DUPLICATE',
        status: 'ACKNOWLEDGED',
        retryable: false,
        code: 'duplicate',
        message: 'Already recorded by Sonalit.',
      };
    case 'conflict':
      return {
        errorClass: 'CONFLICT',
        status: 'CONFLICT',
        retryable: false,
        code: errorCode ?? 'conflict',
        message: errorMessage ?? 'This record changed while your device was offline.',
      };
    case 'rejected':
      return {
        errorClass: 'VALIDATION_FAILURE',
        status: 'FAILED_PERMANENT',
        retryable: false,
        code: errorCode ?? 'rejected',
        message: errorMessage ?? 'Not accepted by Sonalit.',
      };
    case 'retryable':
    default:
      return {
        errorClass: 'SERVER_FAILURE',
        status: 'FAILED_RETRYABLE',
        retryable: true,
        code: errorCode ?? 'retryable',
        message: errorMessage ?? 'Sonalit could not complete this yet. Retrying.',
      };
  }
}

// ── Backoff ──────────────────────────────────────────────────────────────────

/** Base delays in ms, indexed by attempt count. Beyond the table, MAX applies. */
const SCHEDULE = [0, 2_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000] as const;
export const MAX_BACKOFF_MS = 600_000; // 10 minutes

/**
 * Attempts after which a retryable failure is treated as permanent.
 *
 * Not infinity: a queue that retries forever is a queue nobody ever looks at,
 * and the work rots there unseen. Roughly a day of escalating attempts is long
 * enough to outlast any realistic outage and short enough that a genuinely
 * stuck operation reaches a human while the shift still remembers it.
 */
export const MAX_ATTEMPTS = 24;

/**
 * Full jitter. Every device in a convoy loses signal in the same tunnel and
 * regains it in the same second; without jitter they would all retry in the
 * same millisecond and turn a recovered link into a self-inflicted outage.
 */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const idx = Math.min(Math.max(attempt, 0), SCHEDULE.length - 1);
  const base = Math.min(SCHEDULE[idx] ?? MAX_BACKOFF_MS, MAX_BACKOFF_MS);
  if (base === 0) return 0;
  return Math.round(base / 2 + random() * (base / 2));
}

/** When should this entry next be attempted? */
export function nextAttemptAt(
  attempt: number,
  now: number = Date.now(),
  random: () => number = Math.random,
): number {
  return now + backoffMs(attempt, random);
}

/** Has a retryable entry exhausted its lifetime? */
export function isExhausted(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}
