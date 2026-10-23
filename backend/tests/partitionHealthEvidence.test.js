'use strict';

const { classifyPartitionEvidence } = require('../src/utils/partitionHealthEvidence');

const NOW = Date.parse('2026-10-24T00:00:00.000Z');
const freshAt = new Date(NOW - 60_000).toISOString();

describe('partition maintenance evidence classification', () => {
  test('does not report absent evidence as healthy', () => {
    expect(classifyPartitionEvidence(undefined, NOW)).toEqual({
      status: 'unknown',
      checked_at: null,
      detail: 'No successful partition-check evidence',
    });
  });

  test('requires an explicit true boolean for a passing check', () => {
    expect(classifyPartitionEvidence({ checked_at: freshAt, partitions_ok: true }, NOW).status).toBe('healthy');
    expect(classifyPartitionEvidence({ checked_at: freshAt, partitions_ok: null }, NOW)).toMatchObject({
      status: 'unknown',
      detail: 'Partition-check result is missing or inconclusive',
    });
    expect(classifyPartitionEvidence({ checked_at: freshAt, partitions_ok: undefined }, NOW).status).toBe('unknown');
    expect(classifyPartitionEvidence({ checked_at: freshAt, partitions_ok: 'true' }, NOW).status).toBe('unknown');
  });

  test('preserves explicit negative evidence as degraded', () => {
    expect(classifyPartitionEvidence({ checked_at: freshAt, partitions_ok: false }, NOW)).toMatchObject({
      status: 'degraded',
      detail: 'Partition maintenance reported a failure',
    });
  });

  test('does not accept stale, malformed, or future evidence as healthy', () => {
    expect(classifyPartitionEvidence({
      checked_at: new Date(NOW - 2 * 60 * 60 * 1000 - 1).toISOString(),
      partitions_ok: true,
    }, NOW).status).toBe('unknown');
    expect(classifyPartitionEvidence({ checked_at: 'not-a-timestamp', partitions_ok: true }, NOW).status).toBe('unknown');
    expect(classifyPartitionEvidence({
      checked_at: new Date(NOW + 1_000).toISOString(),
      partitions_ok: true,
    }, NOW).status).toBe('unknown');
  });
});
