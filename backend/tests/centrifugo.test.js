'use strict';

process.env.JWT_SECRET = 'test-jwt-secret';

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock('../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

describe('centrifugo publish()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CENTRIFUGO_API_KEY;
    delete process.env.CENTRIFUGO_API_URL;
    // Force module re-evaluation with new env
    jest.resetModules();
  });

  test('does nothing when CENTRIFUGO_API_KEY is not set', async () => {
    const { publish } = require('../src/realtime/centrifugo');
    await publish('test-channel', { foo: 1 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('prefers the dedicated HTTP API URL over the legacy URL', async () => {
    process.env.CENTRIFUGO_API_KEY = 'secret-key';
    process.env.CENTRIFUGO_API_URL = 'http://centrifugo.railway.internal:8000';
    process.env.CENTRIFUGO_URL = 'wss://rt.sonalit.io/connection/websocket';
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: {} }) });
    const { publish } = require('../src/realtime/centrifugo');
    await publish('vehicle:update', { vehicleId: 'v1' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://centrifugo.railway.internal:8000/api/publish',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-API-Key': 'secret-key' }),
      })
    );
  });

  test('POSTs to /api/publish with correct headers when API key is set', async () => {
    process.env.CENTRIFUGO_API_KEY = 'secret-key';
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: {} }) });
    const { publish } = require('../src/realtime/centrifugo');
    await publish('vehicle:update', { vehicleId: 'v1' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/publish'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-API-Key': 'secret-key' }),
      })
    );
  });

  test('logs warning when Centrifugo returns an application-level error with HTTP 200', async () => {
    process.env.CENTRIFUGO_API_KEY = 'secret-key';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: { code: 105, message: 'channel not allowed' } }),
    });
    const { publish } = require('../src/realtime/centrifugo');
    const { warn } = require('../src/utils/logger');
    await publish('test-channel', {});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('channel not allowed'));
  });

  test('logs warning on non-ok response', async () => {
    process.env.CENTRIFUGO_API_KEY = 'secret-key';
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });
    const { publish } = require('../src/realtime/centrifugo');
    const { warn } = require('../src/utils/logger');
    await publish('test-channel', {});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('503'));
  });

  test('logs warning on fetch network error', async () => {
    process.env.CENTRIFUGO_API_KEY = 'secret-key';
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { publish } = require('../src/realtime/centrifugo');
    const { warn } = require('../src/utils/logger');
    await publish('test-channel', {});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });
});
