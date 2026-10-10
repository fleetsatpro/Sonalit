'use strict';

describe('country-local intelligence publication boundary scheduling', () => {
  const originalEnv = { ...process.env };
  let schedule;

  beforeEach(() => {
    jest.resetModules();
    process.env.INTEL_PUBLICATION_COUNTRIES = 'KE,CD';
    process.env.INTEL_PUBLICATION_TIMEZONE_MAP_JSON = JSON.stringify({
      KE: 'Africa/Nairobi',
      CD: 'Africa/Kinshasa',
    });

    // These tests exercise only the pure calendar helpers; do not open a
    // database connection or invoke any collection/publication side effects.
    jest.doMock('../src/config/database', () => ({
      query: jest.fn(),
      globalQuery: jest.fn(),
    }));

    schedule = require('../src/utils/intelligenceAgents');
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('does not re-arm the same country boundary every second inside the midnight tolerance window', () => {
    // 21:02 UTC is 00:02 on the next calendar day in Nairobi.
    const now = new Date('2026-10-10T21:02:00.000Z');

    expect(schedule.isCountryPublicationBoundary('KE', now)).toBe(true);
    expect(schedule.nextCountryPublicationBoundary('KE', now).toISOString())
      .toBe('2026-10-11T21:00:05.000Z');
    expect(schedule.msUntilNextCountryPublicationBoundary('KE', now))
      .toBe(23 * 60 * 60 * 1000 + 58 * 60 * 1000 + 5 * 1000);
  });

  test('chooses the next actual country boundary when another country is still in its previous evening', () => {
    const now = new Date('2026-10-10T21:02:00.000Z');

    // Nairobi is already 00:02; Kinshasa is 22:02 and reaches midnight at
    // 23:00:05 UTC. The scheduler must not collapse this to a one-second timer.
    expect(schedule.isCountryPublicationBoundary('CD', now)).toBe(false);
    expect(schedule.msUntilAnyCountryPublicationBoundary(now))
      .toBe(1 * 60 * 60 * 1000 + 58 * 60 * 1000 + 5 * 1000);
  });
});
