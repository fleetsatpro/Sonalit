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
      'Radio Okapi DRC',
    ];

    for (const name of names) {
      const feed = RSS_FEEDS.find((candidate) => candidate.name === name);
      expect(feed).toBeDefined();
    expect(feed.fallback_url.startsWith('https://news.google.com/rss/search?')).toBe(true);
    }
  });

  test('Radio Okapi retains its direct source and uses a DRC-targeted French discovery fallback', () => {
    const feed = RSS_FEEDS.find((candidate) => candidate.name === 'Radio Okapi DRC');
    expect(feed.url).toBe('https://www.radiookapi.net/feed');
    expect(feed.country_code).toBe('CD');
    expect(feed.fallback_url).toMatch(/^https:\/\/news\\.google\\.com\/rss\/search\\?/);
    expect(feed.fallback_url).toContain('radiookapi.net');
    expect(feed.fallback_url).toContain('Bukavu');
  });

  test('fallback feeds preserve the regional country scope', () => {
    const scoped = RSS_FEEDS.filter((feed) => feed.fallback_url);
    expect(scoped.length).toBeGreaterThanOrEqual(7);
    expect(scoped.every((feed) => feed.country_code)).toBe(true);
  });
});