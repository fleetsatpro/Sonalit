describe('Centrifugo publish client', () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.CENTRIFUGO_URL;
  const originalApiUrl = process.env.CENTRIFUGO_API_URL;
  const originalKey = process.env.CENTRIFUGO_API_KEY;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalUrl == null) delete process.env.CENTRIFUGO_URL; else process.env.CENTRIFUGO_URL = originalUrl;
    if (originalApiUrl == null) delete process.env.CENTRIFUGO_API_URL; else process.env.CENTRIFUGO_API_URL = originalApiUrl;
    if (originalKey == null) delete process.env.CENTRIFUGO_API_KEY; else process.env.CENTRIFUGO_API_KEY = originalKey;
    delete process.env.CENTRIFUGO_PORT;
    jest.resetModules();
  });

  test('normalizes a Railway private hostname to the Centrifugo API port', () => {
    process.env.CENTRIFUGO_PORT = '8000';
    const { normalizeCentrifugoUrl } = require('../../src/realtime/centrifugo');
    expect(normalizeCentrifugoUrl('centrifugo.railway.internal')).toBe(
      'http://centrifugo.railway.internal:8000'
    );
    expect(normalizeCentrifugoUrl('centrifugo.railway.internal:9100')).toBe(
      'http://centrifugo.railway.internal:9100'
    );
  });

  test('preserves explicit HTTPS URLs without inventing a port', () => {
    const { normalizeCentrifugoUrl } = require('../../src/realtime/centrifugo');
    expect(normalizeCentrifugoUrl('https://rt.example.com')).toBe('https://rt.example.com');
  });

  test('uses X-API-Key and the canonical API URL', async () => {
    process.env.CENTRIFUGO_API_URL = 'http://centrifugo.internal:8000';
    delete process.env.CENTRIFUGO_URL;
    process.env.CENTRIFUGO_API_KEY = 'test-key';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: jest.fn() });
    global.fetch = fetchMock;

    const { publish } = require('../../src/realtime/centrifugo');
    await publish('org#test', { type: 'test' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://centrifugo.internal:8000/api/publish',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
      })
    );
  });

  test('does not throw when Centrifugo is unreachable', async () => {
    process.env.CENTRIFUGO_API_URL = 'http://centrifugo.internal:8000';
    process.env.CENTRIFUGO_API_KEY = 'test-key';
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const { publish } = require('../../src/realtime/centrifugo');
    await expect(publish('org#test', { type: 'test' })).resolves.toBeUndefined();
  });
});