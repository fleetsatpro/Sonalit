const { RSS_FEEDS } = require('../../src/utils/regionalIncidentFabric');

describe('regional incident provider resilience', () => {
  test('known blocked direct feeds have a Google News fallback', () => {
    const names = [
      'KNA Kenya',
      'K24 Kenya',
      'Tuko Kenya',
      'Addis Standard',
      'The Reporter Ethiopia',
      'Zehabesha Ethiopia',
      'Sudan Tribune',
    ];

    for (const name of names) {
      const feed = RSS_FEEDS.find((candidate) => candidate.name === name);
      expect(feed).toBeDefined();
      expect(feed.fallback_url).toMatch(/^https:\/\/news\.google\.com\/rss\/search\?/);
    }
  });

  test('fallback feeds preserve the regional country scope', () => {
    const scoped = RSS_FEEDS.filter((feed) => feed.fallback_url);
    expect(scoped.length).toBeGreaterThanOrEqual(7);
    expect(scoped.every((feed) => feed.country_code)).toBe(true);
  });
});