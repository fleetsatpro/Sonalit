'use strict';

const { classifyOperationalFreshness } = require('../src/services/spatial/worldContextService');

describe('world-context operational freshness', () => {
  const now = Date.parse('2026-09-24T00:00:00.000Z');

  test('does not invent freshness for missing or invalid timestamps', () => {
    expect(classifyOperationalFreshness(null, now)).toBe('UNKNOWN');
    expect(classifyOperationalFreshness('not-a-date', now)).toBe('UNKNOWN');
  });

  test('classifies recent, delayed, and stale telemetry', () => {
    expect(classifyOperationalFreshness('2026-09-23T23:59:30.000Z', now)).toBe('LIVE');
    expect(classifyOperationalFreshness('2026-09-23T23:56:00.000Z', now)).toBe('DELAYED');
    expect(classifyOperationalFreshness('2026-09-23T23:50:00.000Z', now)).toBe('STALE');
  });
});
