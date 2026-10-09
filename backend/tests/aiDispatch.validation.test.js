'use strict';

const mockQuery = jest.fn(async () => ({ rows: [] }));
const mockAiClient = {
  hasAnthropic: jest.fn(() => true),
  hasGroqFallback: jest.fn(() => false),
  createMessage: jest.fn(),
  isRetryableAnthropicError: jest.fn(() => false),
};

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-test', org_id: '22222222-2222-4222-8222-222222222222', role: 'dispatcher' };
    next();
  },
}));
jest.mock('../src/config/database', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../src/utils/orgScopedDb', () => ({ withOrg: jest.fn(async (_orgId, fn) => fn({ query: mockQuery })) }));
jest.mock('../src/utils/aiClient', () => mockAiClient);
jest.mock('../src/services/aiSwarm', () => ({ runDecisionFabric: jest.fn() }));
jest.mock('../src/services/spatial/worldContextService', () => ({ buildWorldContext: jest.fn() }));
jest.mock('../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const express = require('express');
const request = require('supertest');
const router = require('../src/routes/ai');
const app = express();
app.use(express.json());
app.use('/ai', router);

describe('Copilot dispatch tool execution contract', () => {
  beforeEach(() => {
    mockQuery.mockClear();
    mockAiClient.createMessage.mockReset();
    mockAiClient.hasAnthropic.mockReturnValue(true);
    mockAiClient.hasGroqFallback.mockReturnValue(false);
  });

  test('rejects malformed geofence arguments before any geofence write', async () => {
    mockAiClient.createMessage
      .mockResolvedValueOnce({
        _provider: 'test-provider',
        stop_reason: 'tool_use',
        content: [{
          type: 'tool_use',
          id: 'tool-1',
          name: 'create_geofence',
          input: { name: 'Test fence', location: 'Nairobi', radius_m: '300', unexpected: true },
        }],
      })
      .mockResolvedValueOnce({
        _provider: 'test-provider',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'The invalid geometry request was rejected.' }],
      });

    const response = await request(app).post('/ai/dispatch').send({ command: 'Analyze corridor operations', history: [] });

    expect(response.status).toBe(200);
    expect(response.body.response).toContain('invalid geometry request');
    expect(mockAiClient.createMessage).toHaveBeenCalledTimes(2);
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO geofences/i.test(String(sql)))).toBe(false);
    const followUp = mockAiClient.createMessage.mock.calls[1][0].messages;
    const rejection = followUp[followUp.length - 1].content[0];
    expect(rejection.is_error).toBe(true);
    expect(JSON.parse(rejection.content).error).toBe('invalid_tool_input');
  });

  test('rejects non-string commands before invoking a provider', async () => {
    const response = await request(app).post('/ai/dispatch').send({ command: 42, history: [] });
    expect(response.status).toBe(400);
    expect(mockAiClient.createMessage).not.toHaveBeenCalled();
  });

  test('rejects oversized commands before invoking a provider', async () => {
    const response = await request(app).post('/ai/dispatch').send({ command: 'x'.repeat(4001) });
    expect(response.status).toBe(413);
    expect(mockAiClient.createMessage).not.toHaveBeenCalled();
  });

  test('simplifies a dense routed corridor within a stated tolerance and verifies persisted geometry', async () => {
    const previousFetch = global.fetch;
    let persistedCoordinates = null;
    const osrmCoordinates = Array.from({ length: 1601 }, (_, index) => [
      index / 1600,
      0.00018 * Math.sin((Math.PI * 80 * index) / 1600),
    ]);

    mockQuery.mockImplementation(async (sql, params = []) => {
      if (/INSERT INTO geofences/i.test(String(sql))) {
        persistedCoordinates = JSON.parse(params[2]);
        return { rows: [{ id: 'geo-route-test-1' }] };
      }
      if (/SELECT coordinates FROM geofences/i.test(String(sql))) {
        return { rows: persistedCoordinates ? [{ coordinates: persistedCoordinates }] : [] };
      }
      if (/DELETE FROM geofences/i.test(String(sql))) return { rows: [] };
      return { rows: [] };
    });
    global.fetch = jest.fn(async (url) => {
      if (!String(url).startsWith('https://router.project-osrm.org/route/v1/driving/')) {
        throw new Error('Unexpected network request in geofence test');
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 'Ok',
          routes: [{ distance: 111195, geometry: { coordinates: osrmCoordinates } }],
        }),
      };
    });

    try {
      const response = await request(app)
        .post('/ai/dispatch')
        .send({ command: 'Create a corridor geofence from 0,0 to 0,1 with a 300m buffer', history: [] });

      expect(response.status).toBe(200);
      expect(response.body.task).toMatchObject({ type: 'geofence', completed: true });
      expect(response.body.created).toHaveLength(1);
      expect(response.body.created[0]).toMatchObject({
        geofence_id: 'geo-route-test-1',
        source_path_points: 1601,
        path_simplification_tolerance_m: 10,
        fallback_used: false,
        geometry_verification: { persisted_path_points: expect.any(Number) },
      });
      expect(response.body.created[0].path_points).toBeLessThan(800);
      expect(response.body.created[0].geometry_verification.start_drift_m).toBeLessThanOrEqual(1500);
      expect(response.body.created[0].geometry_verification.end_drift_m).toBeLessThanOrEqual(1500);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO geofences/i.test(String(sql)))).toBe(true);
      expect(mockQuery.mock.calls.some(([sql]) => /SELECT coordinates FROM geofences/i.test(String(sql)))).toBe(true);
      expect(persistedCoordinates?.buffer_polygon).toHaveLength(2 * response.body.created[0].path_points + 1);
    } finally {
      global.fetch = previousFetch;
      mockQuery.mockReset().mockImplementation(async () => ({ rows: [] }));
    }
  });

});
