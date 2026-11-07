'use strict';

process.env.JWT_SECRET = 'traffic-route-test-jwt-secret';

const express = require('express');
const request = require('supertest');

const mockGetTrafficIncidents = jest.fn();
const mockGetProviderHealth = jest.fn();

jest.mock('../src/middleware/auth', () => ({
  authenticate: jest.fn((req, _res, next) => {
    req.user = { id: 'operator-1', role: 'admin', status: 'active', org_id: 'org-a' };
    next();
  }),
}));

jest.mock('../src/services/spatial/tomtomTrafficGateway', () => ({
  getTrafficIncidents: (...args) => mockGetTrafficIncidents(...args),
  getProviderHealth: (...args) => mockGetProviderHealth(...args),
}));

describe('traffic incident degraded-state contract', () => {
  const previousApiKey = process.env.TOMTOM_API_KEY;

  beforeEach(() => {
    process.env.TOMTOM_API_KEY = 'test-tomtom-key-not-real';
    mockGetTrafficIncidents.mockReset();
    mockGetProviderHealth.mockReset();
    mockGetProviderHealth.mockReturnValue({
      status: 'UNAVAILABLE',
      circuitState: 'OPEN',
      lastSuccessAt: '2026-10-09T19:00:00.000Z',
      lastAttemptAt: '2026-10-09T19:01:00.000Z',
      lastErrorClass: 'circuit_open',
      lastErrorMessage: 'Provider circuit is open',
      apiKey: 'must-not-be-returned',
    });
  });

  afterAll(() => {
    if (previousApiKey === undefined) delete process.env.TOMTOM_API_KEY;
    else process.env.TOMTOM_API_KEY = previousApiKey;
  });

  function makeApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/v1/traffic', require('../src/routes/traffic'));
    app.use((err, _req, res, _next) => res.status(500).json({ error: 'Internal server error' }));
    return app;
  }

  const validBbox = '35,-2,37,-1';

  test('circuit-open is 503 with a bounded retry hint and explicit unknown-road-state semantics', async () => {
    const error = Object.assign(new Error('Provider circuit is open'), { failureClass: 'circuit_open' });
    mockGetTrafficIncidents.mockRejectedValue(error);

    const response = await request(makeApp())
      .get('/api/v1/traffic/incidents')
      .query({ bbox: validBbox })
      .expect(503);

    expect(response.headers['retry-after']).toBe('30');
    expect(response.body).toMatchObject({
      type: 'FeatureCollection',
      features: [],
      configured: true,
      coverage: { complete: false },
      health: { status: 'DEGRADED', providerStatus: 'UNAVAILABLE', circuitState: 'OPEN', failureClass: 'circuit_open' },
      error: {
        code: 'TRAFFIC_PROVIDER_UNAVAILABLE',
        reason: 'circuit_open',
        message: expect.stringContaining('not confirmed clear'),
      },
    });
    expect(response.body.health.lastErrorMessage).toBeUndefined();
    expect(JSON.stringify(response.body)).not.toContain('must-not-be-returned');
  });

  test('provider rate limiting stays degraded and recommends backoff instead of becoming HTTP 500', async () => {
    mockGetTrafficIncidents.mockRejectedValue(
      Object.assign(new Error('Provider budget exhausted'), { failureClass: 'rate_limited' }),
    );

    const response = await request(makeApp())
      .get('/api/v1/traffic/incidents')
      .query({ bbox: validBbox })
      .expect(503);

    expect(response.headers['retry-after']).toBe('60');
    expect(response.body.error.code).toBe('TRAFFIC_PROVIDER_UNAVAILABLE');
    expect(response.body.health.failureClass).toBe('rate_limited');
  });

  test('malformed provider content becomes 502 while preserving the explicit data gap', async () => {
    mockGetTrafficIncidents.mockRejectedValue(
      Object.assign(new Error('Provider returned malformed JSON'), { failureClass: 'malformed' }),
    );

    const response = await request(makeApp())
      .get('/api/v1/traffic/incidents')
      .query({ bbox: validBbox })
      .expect(502);

    expect(response.body.error.reason).toBe('malformed');
    expect(response.body.coverage.complete).toBe(false);
    expect(response.body.error.message).toContain('Road conditions are unknown');
  });

  test('a genuinely successful low-observation response remains a successful, attributed collection', async () => {
    mockGetTrafficIncidents.mockResolvedValue({
      observations: [],
      coverage: { complete: false, queryScope: 'bounded TomTom viewport' },
      health: { status: 'PARTIAL', providerId: 'tomtom-traffic-incidents' },
    });

    const response = await request(makeApp())
      .get('/api/v1/traffic/incidents')
      .query({ bbox: validBbox })
      .expect(200);

    expect(response.body).toMatchObject({
      type: 'FeatureCollection',
      features: [],
      configured: true,
      coverage: { complete: false, queryScope: 'bounded TomTom viewport' },
      health: { status: 'PARTIAL' },
    });
    expect(response.body.error).toBeUndefined();
  });

  test('an invalid bbox is rejected before querying the provider', async () => {
    const response = await request(makeApp())
      .get('/api/v1/traffic/incidents')
      .query({ bbox: '37,-1,35,-2' })
      .expect(400);

    expect(response.body.error).toBe('Invalid traffic bbox');
    expect(mockGetTrafficIncidents).not.toHaveBeenCalled();
  });

  test('an unknown programming error is not disguised as provider degradation', async () => {
    mockGetTrafficIncidents.mockRejectedValue(new TypeError('unexpected local defect'));

    await request(makeApp())
      .get('/api/v1/traffic/incidents')
      .query({ bbox: validBbox })
      .expect(500);

    expect(mockGetProviderHealth).not.toHaveBeenCalled();
  });

  test('unconfigured traffic remains explicitly unconfigured and does not call the provider', async () => {
    delete process.env.TOMTOM_API_KEY;

    const response = await request(makeApp())
      .get('/api/v1/traffic/incidents')
      .query({ bbox: validBbox })
      .expect(200);

    expect(response.body).toMatchObject({ type: 'FeatureCollection', features: [], configured: false });
    expect(mockGetTrafficIncidents).not.toHaveBeenCalled();
  });
});
