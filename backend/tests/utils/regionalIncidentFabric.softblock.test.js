'use strict';

jest.mock('../../src/config/database', () => ({ query: jest.fn() }));
jest.mock('../../src/utils/telegramMtproto', () => ({
  fetchChannelMessages: jest.fn(),
  isConfigured: jest.fn(() => false),
  fetchPublicChannelPreview: jest.fn()
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
}));

describe('regional RSS soft-block fallback', () => {
  const feed = {
    name: 'Blocked source',
    url: 'https://primary.example/feed',
    fallback_url: 'https://news.google.com/rss/search?q=test',
    country_code: 'KE',
    reliability: 70
  };

  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    delete global.fetch;
  });

  test('falls back when a primary feed returns HTML instead of RSS', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () => '<html><body>challenge</body></html>'
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => 'application/rss+xml' },
        text: async () => '<rss><channel><item><title>Kenya road closure reported</title><description>Kenya incident</description><link>https://example.test/1</link><pubDate>Thu, 01 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>'
      });

    const { fetchRss } = require('../../src/utils/regionalIncidentFabric');
    const items = await fetchRss(feed);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(1);
    expect(items[0].raw_metadata.fallback_used).toBe(true);
    expect(items[0].raw_metadata.feed_url).toBe(feed.fallback_url);
  });

  test('falls back when a primary feed parses but yields no regional items', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => 'application/rss+xml' },
        text: async () => '<rss><channel><item><title>Unrelated sports headline</title><description>Football</description><link>https://example.test/2</link></item></channel></rss>'
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        headers: { get: () => 'application/rss+xml' },
        text: async () => '<rss><channel><item><title>Kenya security alert</title><description>Kenya incident</description><link>https://example.test/3</link></item></channel></rss>'
      });

    const { fetchRss } = require('../../src/utils/regionalIncidentFabric');
    const items = await fetchRss(feed);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(items).toHaveLength(1);
    expect(items[0].raw_metadata.fallback_used).toBe(true);
    expect(items[0].raw_metadata.feed_url).toBe(feed.fallback_url);
  });
});
