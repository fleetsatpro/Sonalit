'use strict';

describe('Kenya official CAP warning normalisation', () => {
  const { __testables } = require('../../src/services/spatial/officialWeatherWarningsService');

  it('preserves severity, expiry, provenance and valid CAP polygon coordinates', () => {
    const now = Date.now();
    const sent = new Date(now - 60_000).toISOString();
    const effective = new Date(now - 30_000).toISOString();
    const expires = new Date(now + 60 * 60_000).toISOString();
    const xml = '<?xml version="1.0"?><rss><channel><item>'
      + '<title>Heavy rainfall warning for Nairobi</title><link>https://meteo.go.ke/cap/ke-001</link><pubDate>' + sent + '</pubDate>'
      + '<cap:alert xmlns:cap="urn:oasis:names:tc:emergency:cap:1.2">'
      + '<cap:identifier>KE-KMD-001</cap:identifier><cap:sender>KMD</cap:sender><cap:sent>' + sent + '</cap:sent>'
      + '<cap:status>Actual</cap:status><cap:msgType>Alert</cap:msgType><cap:scope>Public</cap:scope>'
      + '<cap:info><cap:event>Heavy Rain</cap:event><cap:headline>Heavy rainfall warning</cap:headline>'
      + '<cap:description>Heavy rainfall is forecast for the listed area.</cap:description>'
      + '<cap:urgency>Immediate</cap:urgency><cap:severity>Severe</cap:severity><cap:certainty>Likely</cap:certainty>'
      + '<cap:effective>' + effective + '</cap:effective><cap:expires>' + expires + '</cap:expires>'
      + '<cap:area><cap:areaDesc>Nairobi County</cap:areaDesc><cap:polygon>-1.20,36.60 -1.20,37.00 -1.50,37.00 -1.50,36.60 -1.20,36.60</cap:polygon></cap:area>'
      + '</cap:info></cap:alert></item></channel></rss>';
    const feed = __testables.parseFeed(xml, new Date(now).toISOString(), now);
    expect(feed).toMatchObject({ recordCount: 1, activeCount: 1 });
    expect(feed.alerts[0]).toMatchObject({
      id: 'KE-KMD-001', title: 'Heavy rainfall warning', event: 'Heavy Rain',
      urgency: 'Immediate', severity: 'Severe', certainty: 'Likely',
      activeState: 'ACTIVE', verifiedCap: true, url: 'https://meteo.go.ke/cap/ke-001',
    });
    expect(feed.alerts[0].areas[0].polygons[0]).toEqual([
      [36.6, -1.2], [37, -1.2], [37, -1.5], [36.6, -1.5], [36.6, -1.2],
    ]);
  });

  it('does not count expired, test or private alerts as active', () => {
    const now = Date.now();
    const xml = '<rss><channel>'
      + '<item><title>Expired</title><cap:alert><cap:status>Actual</cap:status><cap:msgType>Alert</cap:msgType><cap:scope>Public</cap:scope><cap:info><cap:headline>Expired</cap:headline><cap:expires>' + new Date(now - 60_000).toISOString() + '</cap:expires></cap:info></cap:alert></item>'
      + '<item><title>Test</title><cap:alert><cap:status>Test</cap:status><cap:msgType>Alert</cap:msgType><cap:scope>Public</cap:scope><cap:info><cap:headline>Test</cap:headline></cap:info></cap:alert></item>'
      + '<item><title>Private</title><cap:alert><cap:status>Actual</cap:status><cap:msgType>Alert</cap:msgType><cap:scope>Private</cap:scope><cap:info><cap:headline>Private</cap:headline></cap:info></cap:alert></item>'
      + '</channel></rss>';
    const feed = __testables.parseFeed(xml, new Date(now).toISOString(), now);
    expect(feed.alerts).toHaveLength(0);
    expect(feed.activeCount).toBe(0);
  });

  it('does not turn an RSS-only entry into a verified CAP warning or trust off-domain links', () => {
    const xml = '<rss><channel><item><title>Official feed item</title><link>https://example.com/spoof</link><pubDate>Thu, 15 Oct 2026 07:00:00 GMT</pubDate></item></channel></rss>';
    const feed = __testables.parseFeed(xml, '2026-10-15T07:00:00.000Z', Date.parse('2026-10-15T07:00:00Z'));
    expect(feed.recordCount).toBe(1);
    expect(feed.activeCount).toBe(0);
    expect(feed.alerts[0].verifiedCap).toBe(false);
    expect(feed.alerts[0].url).toBeNull();
  });

  it('removes a cached warning after its validity window expires', () => {
    const now = Date.parse('2026-10-15T07:00:00.000Z');
    const xml = '<rss><channel><item><title>Short-lived rain warning</title>'
      + '<cap:alert><cap:identifier>KE-KMD-EXPIRING</cap:identifier><cap:sent>2026-10-15T06:59:00Z</cap:sent>'
      + '<cap:status>Actual</cap:status><cap:msgType>Alert</cap:msgType><cap:scope>Public</cap:scope>'
      + '<cap:info><cap:headline>Short-lived rain warning</cap:headline><cap:effective>2026-10-15T06:59:00Z</cap:effective>'
      + '<cap:expires>2026-10-15T07:01:00Z</cap:expires></cap:info></cap:alert>'
      + '</item></channel></rss>';
    const parsed = __testables.parseFeed(xml, new Date(now).toISOString(), now);
    expect(parsed.activeCount).toBe(1);

    const stale = __testables.revalidateFeedTime(parsed, Date.parse('2026-10-15T07:02:00.000Z'), 'STALE_FALLBACK');
    expect(stale.status).toBe('STALE_FALLBACK');
    expect(stale.alerts).toHaveLength(0);
    expect(stale.recordCount).toBe(0);
    expect(stale.activeCount).toBe(0);
    expect(parsed.alerts).toHaveLength(1);
    expect(parsed.activeCount).toBe(1);
  });

  it('does not treat an alert with an unparseable supplied expiry as verified active', () => {
    const now = Date.parse('2026-10-15T07:00:00.000Z');
    const xml = '<rss><channel><item><title>Unclear expiry</title>'
      + '<cap:alert><cap:identifier>KE-KMD-BAD-EXPIRY</cap:identifier><cap:sent>2026-10-15T06:59:00Z</cap:sent>'
      + '<cap:status>Actual</cap:status><cap:msgType>Alert</cap:msgType><cap:scope>Public</cap:scope>'
      + '<cap:info><cap:headline>Unclear expiry</cap:headline><cap:expires>not-a-date</cap:expires></cap:info>'
      + '</cap:alert></item></channel></rss>';
    const parsed = __testables.parseFeed(xml, new Date(now).toISOString(), now);
    const checked = __testables.revalidateFeedTime(parsed, now, 'AVAILABLE');
    expect(checked.alerts[0].verifiedCap).toBe(false);
    expect(checked.alerts[0].activeState).toBe('DETAILS_UNVERIFIED');
    expect(checked.activeCount).toBe(0);
  });

});
