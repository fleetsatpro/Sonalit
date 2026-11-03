'use strict';

const { assessManualPublicationRetry, manualRetryCooldownMinutes } = require('../src/utils/publicationManualRetryPolicy');

describe('manual publication retry cooldown policy', () => {
  const now = new Date('2026-10-09T09:00:00.000Z');

  test('allows a deliberate retry after cooldown even when automated retries are exhausted', () => {
    expect(assessManualPublicationRetry({
      status: 'draft', now, cooldownMinutes: 60,
      deepResearch: { recovery_attempts: 3, recovery_max_attempts: 3, recovery_exhausted: true,
        last_attempt_at: '2026-10-09T07:00:00.000Z', next_attempt_at: '2026-10-09T08:00:00.000Z' },
    })).toMatchObject({ allowed: true, cooldownMinutes: 60 });
  });

  test('rejects requests before next_attempt_at with exact retry timestamp', () => {
    expect(assessManualPublicationRetry({ status: 'review', now, cooldownMinutes: 60,
      deepResearch: { next_attempt_at: '2026-10-09T09:30:00.000Z' } })).toMatchObject({
      allowed: false, statusCode: 429, code: 'publication_retry_cooldown', retryAt: '2026-10-09T09:30:00.000Z',
    });
  });

  test('applies cooldown for legacy rows with last_attempt_at but no next_attempt_at', () => {
    expect(assessManualPublicationRetry({ status: 'draft', now, cooldownMinutes: 60,
      deepResearch: { last_attempt_at: '2026-10-09T08:30:00.000Z' } })).toMatchObject({
      allowed: false, statusCode: 429, code: 'publication_retry_cooldown', retryAt: '2026-10-09T09:30:00.000Z',
    });
  });

  test('fails closed when stored retry timestamps are malformed', () => {
    expect(assessManualPublicationRetry({ status: 'draft', now, cooldownMinutes: 60,
      deepResearch: { next_attempt_at: 'not-a-timestamp' } })).toMatchObject({
      allowed: false, statusCode: 409, code: 'publication_retry_metadata_invalid',
    });
  });

  test('rejects published and unknown status rows', () => {
    expect(assessManualPublicationRetry({ status: 'published', now })).toMatchObject({ allowed: false, statusCode: 409 });
    expect(assessManualPublicationRetry({ status: 'unknown', now })).toMatchObject({ allowed: false, statusCode: 409 });
  });

  test('clamps cooldown configuration to a safe range', () => {
    expect(manualRetryCooldownMinutes(1)).toBe(5);
    expect(manualRetryCooldownMinutes(99999)).toBe(1440);
    expect(manualRetryCooldownMinutes('invalid')).toBe(60);
  });
});
