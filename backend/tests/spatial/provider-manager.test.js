const { SpatialProviderManager, classifyFailure } = require('../../src/services/spatial/providerManager');

describe('spatial provider manager', () => {
  test('registers providers with explicit capabilities and bounded health state', async () => {
    const manager = new SpatialProviderManager();
    manager.register('test-provider', {
      query: jest.fn().mockResolvedValue({
        observations: [{ id: 'obs-1', observedAt: '2026-09-24T12:00:00Z' }],
        health: { status: 'LIVE' },
      }),
      health: jest.fn().mockReturnValue({ status: 'LIVE' }),
      capabilities: ['point', 'live', 'test'],
      maxPerMinute: 10,
      maxConcurrent: 2,
    });

    const result = await manager.query('test-provider', { latitude: 1, longitude: 2 });
    expect(result.observations).toHaveLength(1);
    expect(manager.names()).toEqual(['test-provider']);

    const health = manager.getHealthSnapshot()['test-provider'];
    expect(health.capabilities).toEqual(['point', 'live', 'test']);
    expect(health.manager.requestCount).toBe(1);
    expect(health.manager.successCount).toBe(1);
    expect(health.manager.activeRequests).toBe(0);
    expect(health.manager.circuitState).toBe('CLOSED');
  });

  test('classifies provider failures without hiding the failure class', async () => {
    const manager = new SpatialProviderManager();
    const error = Object.assign(new Error('provider throttled'), { failureClass: 'rate_limited' });

    manager.register('limited', {
      query: jest.fn().mockRejectedValue(error),
      health: () => ({ status: 'RATE_LIMITED' }),
      maxPerMinute: 10,
      maxConcurrent: 1,
    });

    await expect(manager.query('limited')).rejects.toMatchObject({ failureClass: 'rate_limited' });
    const health = manager.getHealthSnapshot().limited;
    expect(health.manager.lastFailureClass).toBe('rate_limited');
    expect(health.manager.failureCount).toBe(1);
  });

  test('accepts legacy gateway error.class without collapsing to unknown', () => {
    expect(classifyFailure(Object.assign(new Error('auth'), { class: 'auth_required' }))).toBe('auth_required');
  });

  test('querySettled isolates one provider failure from successful providers', async () => {
    const manager = new SpatialProviderManager();
    manager.register('good', {
      query: jest.fn().mockResolvedValue({ observations: ['ok'] }),
      maxPerMinute: 10,
      maxConcurrent: 2,
    });
    manager.register('bad', {
      query: jest.fn().mockRejectedValue(Object.assign(new Error('timeout'), { failureClass: 'timeout' })),
      maxPerMinute: 10,
      maxConcurrent: 2,
    });

    const results = await manager.querySettled([
      { provider: 'good', args: {} },
      { provider: 'bad', args: {} },
    ]);

    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');
    expect(classifyFailure(results[1].reason)).toBe('timeout');
  });

  test('rejects duplicate provider registration', () => {
    const manager = new SpatialProviderManager();
    manager.register('duplicate', { query: async () => ({}) });
    expect(() => manager.register('duplicate', { query: async () => ({}) }))
      .toThrow('Spatial provider already registered: duplicate');
  });
});
