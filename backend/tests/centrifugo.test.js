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
    mockFetch.mockResolvedValueOnce({ ok: true });
    const { publish } = require('../src/realtime/centrifugo');
    await publish('vehicle:update', { vehicleId: 'v1' });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/publish'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Authorization': 'apikey secret-key' }),
      })
    );
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
