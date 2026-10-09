'use strict';

const {
  createPublicResearchFetcher,
  isPublicResearchAddress,
} = require('../src/utils/publicResearchFetch');

const PUBLIC_V4 = [{ address: '93.184.216.34', family: 4 }];
const PUBLIC_V4_ALT = [{ address: '1.1.1.1', family: 4 }];

function response(status, headers = {}, body = '') {
  return { status, headers, body: Buffer.isBuffer(body) ? body : Buffer.from(String(body)) };
}

describe('public intelligence research fetch boundary', () => {
  test.each([
    '127.0.0.1',
    '10.0.0.8',
    '172.16.0.10',
    '192.168.1.2',
    '169.254.169.254',
    '192.0.2.1',
    '192.88.99.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
  ])('rejects private or reserved IP address %s', address => {
    expect(isPublicResearchAddress(address)).toBe(false);
  });

  test('accepts a representative globally routable IPv4 address', () => {
    expect(isPublicResearchAddress('93.184.216.34')).toBe(true);
  });

  test('blocks local IP targets before starting any request', async () => {
    const requestOnce = jest.fn();
    const fetchPublic = createPublicResearchFetcher({ resolveAddresses: jest.fn(), requestOnce });
    await expect(fetchPublic('https://127.0.0.1/admin')).rejects.toMatchObject({ failureClass: 'invalid_data' });
    await expect(fetchPublic('https://169.254.169.254/system')).rejects.toMatchObject({ failureClass: 'invalid_data' });
    expect(requestOnce).not.toHaveBeenCalled();
  });

  test('rejects non-HTTPS, URL credentials, and nonstandard ports', async () => {
    const requestOnce = jest.fn();
    const fetchPublic = createPublicResearchFetcher({ resolveAddresses: jest.fn(), requestOnce });
    await expect(fetchPublic('http://source.test/report')).rejects.toThrow('must use HTTPS');
    await expect(fetchPublic('https://user:pass@source.test/report')).rejects.toThrow('credentials are forbidden');
    await expect(fetchPublic('https://source.test:8443/report')).rejects.toThrow('port is not permitted');
    expect(requestOnce).not.toHaveBeenCalled();
  });

  test('rejects hostname resolution when any answer is private or reserved', async () => {
    const resolveAddresses = jest.fn(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ]);
    const requestOnce = jest.fn();
    const fetchPublic = createPublicResearchFetcher({ resolveAddresses, requestOnce });
    await expect(fetchPublic('https://poisoned-source.test/report')).rejects.toMatchObject({ failureClass: 'invalid_data' });
    expect(resolveAddresses).toHaveBeenCalledWith('poisoned-source.test');
    expect(requestOnce).not.toHaveBeenCalled();
  });

  test('follows public redirects only after independently resolving and validating each host', async () => {
    const resolveAddresses = jest.fn(async host => host === 'publisher.test' ? PUBLIC_V4 : PUBLIC_V4_ALT);
    const requestOnce = jest.fn(async url => {
      if (url.hostname === 'publisher.test') {
        return response(302, { location: 'https://cdn.test/security/report' });
      }
      return response(200, { 'content-type': 'text/html; charset=utf-8' }, '<article>Verified article body</article>');
    });
    const fetchPublic = createPublicResearchFetcher({ resolveAddresses, requestOnce });
    const result = await fetchPublic('https://publisher.test/redirect');
    expect(result.ok).toBe(true);
    expect(result.url).toBe('https://cdn.test/security/report');
    expect(await result.text()).toContain('Verified article body');
    expect(resolveAddresses.mock.calls.map(call => call[0])).toEqual(['publisher.test', 'cdn.test']);
    expect(requestOnce).toHaveBeenNthCalledWith(2, expect.any(URL), PUBLIC_V4_ALT, expect.objectContaining({ maxBytes: 2 * 1024 * 1024 }));
  });

  test('rejects a redirect to a private IP without requesting the redirected target', async () => {
    const requestOnce = jest.fn(async () => response(302, { location: 'https://127.0.0.1/private' }));
    const fetchPublic = createPublicResearchFetcher({ resolveAddresses: jest.fn(async () => PUBLIC_V4), requestOnce });
    await expect(fetchPublic('https://publisher.test/redirect')).rejects.toMatchObject({ failureClass: 'invalid_data' });
    expect(requestOnce).toHaveBeenCalledTimes(1);
  });

  test('fails closed when an upstream response exceeds the configured body limit', async () => {
    const requestOnce = jest.fn(async () => response(200, { 'content-type': 'text/html' }, Buffer.alloc(11, 65)));
    const fetchPublic = createPublicResearchFetcher({ resolveAddresses: jest.fn(async () => PUBLIC_V4), requestOnce });
    await expect(fetchPublic('https://publisher.test/large', { maxBytes: 10 })).rejects.toThrow('exceeds the byte limit');
  });

  test('exposes the exact response bytes for binary consumers', async () => {
    const bytes = Buffer.from('bounded-binary-fixture');
    const requestOnce = jest.fn(async () => response(200, { 'content-type': 'application/octet-stream' }, bytes));
    const fetchPublic = createPublicResearchFetcher({ resolveAddresses: jest.fn(async () => PUBLIC_V4), requestOnce });
    const result = await fetchPublic('https://publisher.test/asset', { maxBytes: bytes.length });
    expect(Buffer.from(await result.arrayBuffer())).toEqual(bytes);
  });

  test('supports guarded JSON parsing required by the GDELT collector', async () => {
    const requestOnce = jest.fn(async () => response(200, { 'content-type': 'application/json' }, '{"articles":[{"title":"Route disruption"}]}'));
    const fetchPublic = createPublicResearchFetcher({ resolveAddresses: jest.fn(async () => PUBLIC_V4), requestOnce });
    const result = await fetchPublic('https://api.gdeltproject.org/api/v2/doc/doc');
    await expect(result.json()).resolves.toEqual({ articles: [{ title: 'Route disruption' }] });
  });

  test('enforces a bounded redirect count', async () => {
    const requestOnce = jest.fn(async url => response(302, { location: 'https://publisher.test/next?path=' + encodeURIComponent(url.pathname) }));
    const fetchPublic = createPublicResearchFetcher({ resolveAddresses: jest.fn(async () => PUBLIC_V4), requestOnce });
    await expect(fetchPublic('https://publisher.test/start')).rejects.toThrow('redirect limit exceeded');
    expect(requestOnce).toHaveBeenCalledTimes(4);
  });
});
