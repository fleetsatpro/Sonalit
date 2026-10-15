import { describe, expect, it } from 'vitest';
import type { OfficialWeatherWarningFeed } from './spatialClient.js';
import { buildOfficialWarningAreaCollection } from './weatherWarningGeometry.js';

const RING = [[35.0, -1.0], [37.0, -1.0], [37.0, 1.0], [35.0, 1.0], [35.0, -1.0]];

function feed(overrides: Partial<OfficialWeatherWarningFeed> = {}): OfficialWeatherWarningFeed {
  return {
    source: 'Kenya Meteorological Department CAP feed',
    sourceUrl: 'https://meteo.go.ke/api/cap/rss.xml',
    scope: 'National feed; geometry is only as supplied by CAP',
    status: 'AVAILABLE',
    receivedAt: '2026-10-15T07:00:00.000Z',
    recordCount: 1,
    activeCount: 1,
    scheduledCount: 0,
    alerts: [{
      id: 'cap-test-1',
      title: 'Test heavy rainfall warning',
      severity: 'Severe',
      urgency: 'Immediate',
      activeState: 'ACTIVE',
      verifiedCap: true,
      source: 'Kenya Meteorological Department',
      areas: [{ description: 'Fixture-only test area', polygons: [RING] }],
    }],
    semantics: 'Unit-test fixture; not a real warning.',
    ...overrides,
  };
}

describe('official weather warning map geometry', () => {
  it('draws only a verified CAP polygon supplied by the official feed', () => {
    const result = buildOfficialWarningAreaCollection(feed());
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry.type).toBe('Polygon');
    expect(result.features[0].geometry.coordinates[0]).toEqual(RING);
    expect(result.features[0].properties.severity).toBe('severe');
    expect(result.features[0].properties.area).toBe('Fixture-only test area');
  });

  it('includes upcoming verified CAP areas but never inferred or unverified areas', () => {
    const source = feed({
      alerts: [
        { ...feed().alerts[0], id: 'upcoming', activeState: 'UPCOMING' },
        { ...feed().alerts[0], id: 'unverified', verifiedCap: false },
        { ...feed().alerts[0], id: 'expired-state', activeState: 'DETAILS_UNVERIFIED' },
      ],
    });
    const result = buildOfficialWarningAreaCollection(source);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.activeState).toBe('UPCOMING');
  });

  it('fails closed for unavailable feeds, open rings, invalid coordinates and degenerate polygons', () => {
    expect(buildOfficialWarningAreaCollection(feed({ status: 'UNAVAILABLE' })).features).toHaveLength(0);
    const invalid = feed({ alerts: [{ ...feed().alerts[0], areas: [{ description: 'bad', polygons: [
      [[35, -1], [37, -1], [37, 1], [35, 1]],
      [[35, -1], [181, -1], [37, 1], [35, -1]],
      [[35, -1], [35, -1], [35, -1], [35, -1]],
      [[35, -1], [37, 1], [35, 1], [37, -1], [35, -1]], // self-intersecting bow-tie
    ] }] }] });
    expect(buildOfficialWarningAreaCollection(invalid).features).toHaveLength(0);
  });

  it('retains valid stale-cache geometry with an explicit stale status for subdued rendering', () => {
    const result = buildOfficialWarningAreaCollection(feed({ status: 'STALE_FALLBACK' }));
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties.feedStatus).toBe('STALE_FALLBACK');
  });
});
