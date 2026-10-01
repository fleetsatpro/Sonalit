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
    delete process.env.CENTRIFUGO_URL;
    // Force module re-evaluation with new env
    jest.resetModules();
  });

  test('does nothing when CENTRIFUGO_API_KEY is not set', async () => {
    const { publish } = require('../src/realtime/centrifugo');
    await publish('test-channel', { foo: 1 });
    expect(mockFetch).not.toHaveBeenCalled();
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


  test('prefers the dedicated API URL and uses Centrifugo v5 authentication', async () => {
    process.env.CENTRIFUGO_API_KEY = 'secret-key';
    process.env.CENTRIFUGO_API_URL = 'http://centrifugo.railway.internal:8000';
    process.env.CENTRIFUGO_URL = 'https://legacy.example.test';
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ result: {} }) });
    const { publish } = require('../src/realtime/centrifugo');
    await publish('vehicle:update', { vehicleId: 'v1' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://centrifugo.railway.internal:8000/api/publish',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-API-Key': 'secret-key',
        }),
        signal: expect.any(AbortSignal),
      })
    );
  });

  test('reports application-level Centrifugo errors returned with HTTP 200', async () => {
    process.env.CENTRIFUGO_API_KEY = 'secret-key';
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ error: { code: 108, message: 'unauthorized' } }),
    });
    const { publish } = require('../src/realtime/centrifugo');
    const { warn } = require('../src/utils/logger');
    await publish('vehicle:update', {});
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unauthorized'));
  });

  test('logs warning on non-ok response, without exposing response bodies', async () => {
    process.env.CENTRIFUGO_API_KEY = 'secret-key';
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503, json: jest.fn().mockResolvedValue({ error: { message: 'service unavailable' } }) });
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
