/**
 * These rules decide whether a shift's work survives a bad network, so they are
 * pure functions with no Dexie, no axios and no browser — testable exactly.
 */
import { describe, expect, it } from 'vitest';

import {
  backoffMs, classifyHttp, classifyPushOutcome, isExhausted, MAX_ATTEMPTS,
  MAX_BACKOFF_MS, nextAttemptAt,
} from './retryPolicy.js';

describe('classifyHttp', () => {
  it('treats a missing response as retryable, not failed', () => {
    // The single most common field case: the request never got an answer, so
    // the operation's fate is unknown — and unknown must never be treated as
    // failed, or the work is discarded.
    const c = classifyHttp({ message: 'Network Error', code: 'ECONNABORTED' });
    expect(c.errorClass).toBe('NETWORK_FAILURE');
    expect(c.status).toBe('FAILED_RETRYABLE');
    expect(c.retryable).toBe(true);
  });

  it('keeps a 401 retryable so an expired token never discards queued work', () => {
    const c = classifyHttp({ status: 401 });
    expect(c.errorClass).toBe('AUTHENTICATION_FAILURE');
    expect(c.status).toBe('FAILED_RETRYABLE');
  });

  it('makes a 403 permanent — retrying cannot grant permission', () => {
    const c = classifyHttp({ status: 403, body: { message: 'Not permitted' } });
    expect(c.errorClass).toBe('AUTHORIZATION_FAILURE');
    expect(c.status).toBe('FAILED_PERMANENT');
    expect(c.retryable).toBe(false);
    expect(c.message).toBe('Not permitted');
  });

  it('routes a 409 to its own CONFLICT state, neither success nor failure', () => {
    const c = classifyHttp({ status: 409 });
    expect(c.status).toBe('CONFLICT');
    expect(c.retryable).toBe(false);
  });

  it('treats 5xx as retryable and 4xx validation as permanent', () => {
    expect(classifyHttp({ status: 500 }).status).toBe('FAILED_RETRYABLE');
    expect(classifyHttp({ status: 503 }).status).toBe('FAILED_RETRYABLE');
    expect(classifyHttp({ status: 400 }).status).toBe('FAILED_PERMANENT');
    expect(classifyHttp({ status: 404 }).status).toBe('FAILED_PERMANENT');
  });

  it('treats 408/429 as retryable back-pressure', () => {
    expect(classifyHttp({ status: 408 }).retryable).toBe(true);
    expect(classifyHttp({ status: 429 }).retryable).toBe(true);
  });

  it('flags a schema mismatch as permanent rather than looping', () => {
    expect(classifyHttp({ status: 426 }).errorClass).toBe('SCHEMA_FAILURE');
    expect(classifyHttp({ status: 426 }).status).toBe('FAILED_PERMANENT');
  });
});

describe('classifyPushOutcome', () => {
  it('acknowledges a duplicate — that is the whole point of idempotency', () => {
    // Server saw this operation before and did not re-apply it. That is a
    // success: it is exactly the answer that makes a lost ACK harmless.
    const c = classifyPushOutcome('duplicate');
    expect(c.status).toBe('ACKNOWLEDGED');
    expect(c.errorClass).toBe('DUPLICATE');
  });

  it('acknowledges an accepted operation', () => {
    expect(classifyPushOutcome('accepted').status).toBe('ACKNOWLEDGED');
  });

  it('preserves the server reason on rejection', () => {
    const c = classifyPushOutcome('rejected', 'invalid_status', 'status must be one of: available');
    expect(c.status).toBe('FAILED_PERMANENT');
    expect(c.code).toBe('invalid_status');
    expect(c.message).toContain('available');
  });

  it('routes a conflict to CONFLICT, never to success or failure', () => {
    const c = classifyPushOutcome('conflict', 'revision_conflict', 'Changed elsewhere');
    expect(c.status).toBe('CONFLICT');
    expect(c.retryable).toBe(false);
  });

  it('defaults an unrecognised outcome to retryable', () => {
    // Forward compatibility: a newer server outcome must not be read as
    // success, and must not permanently discard the operation either.
    expect(classifyPushOutcome('something_new').status).toBe('FAILED_RETRYABLE');
  });
});

describe('backoff', () => {
  it('is immediate on the first attempt', () => {
    expect(backoffMs(0, () => 0.5)).toBe(0);
  });

  it('grows with each attempt', () => {
    const fixed = () => 0.5;
    const delays = [1, 2, 3, 4, 5].map(a => backoffMs(a, fixed));
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    }
  });

  it('jitters within half the base so a convoy does not retry in lockstep', () => {
    // Every device in a convoy loses signal in the same tunnel and regains it in
    // the same second. Without jitter they would all retry in the same
    // millisecond and turn a recovered link into a self-inflicted outage.
    const low = backoffMs(3, () => 0);
    const high = backoffMs(3, () => 0.999);
    expect(low).toBeLessThan(high);
    expect(high / low).toBeLessThanOrEqual(2.01);
  });

  it('never exceeds the ceiling', () => {
    expect(backoffMs(99, () => 0.999)).toBeLessThanOrEqual(MAX_BACKOFF_MS);
  });

  it('schedules the next attempt relative to now', () => {
    const now = 1_000_000;
    expect(nextAttemptAt(0, now, () => 0.5)).toBe(now);
    expect(nextAttemptAt(2, now, () => 0.5)).toBeGreaterThan(now);
  });
});

describe('attempt budget', () => {
  it('gives up only after the full budget', () => {
    expect(isExhausted(MAX_ATTEMPTS - 1)).toBe(false);
    expect(isExhausted(MAX_ATTEMPTS)).toBe(true);
  });
});
