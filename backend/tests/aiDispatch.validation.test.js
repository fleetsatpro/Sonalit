'use strict';

const mockQuery = jest.fn(async () => ({ rows: [] }));
let mockRole = 'dispatcher';
let mockActionRun = null;
const mockActionLedger = {
  createActionRun: jest.fn(),
  finishActionRun: jest.fn(),
  getActionRun: jest.fn(),
  listPendingActionRuns: jest.fn(),
  claimActionRun: jest.fn(),
  declineActionRun: jest.fn(),
  recordToolTrace: jest.fn(),
  summarizeToolInput: jest.fn((input) => ({
    name: input && input.name,
    location: input && input.location,
    risk_level: input && input.risk_level,
    zone_type: input && input.zone_type,
    radius_km: input && input.radius_km,
  })),
  makeActionReceipt: jest.fn((run) => run ? ({
    id: run.id, request_id: run.request_id, tool_name: run.tool_name,
    risk_level: run.risk_level, status: run.status,
    created_at: run.created_at || null, completed_at: run.completed_at || null,
  }) : null),
};
const mockAiClient = {
  hasAnthropic: jest.fn(() => true),
  hasGroqFallback: jest.fn(() => false),
  createMessage: jest.fn(),
  isRetryableAnthropicError: jest.fn(() => false),
};

jest.mock('../src/middleware/auth', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: 'user-test', org_id: '22222222-2222-4222-8222-222222222222', role: mockRole };
    next();
  },
}));
jest.mock('../src/config/database', () => ({ query: (...args) => mockQuery(...args) }));
jest.mock('../src/config/redis', () => ({ getRedis: () => null }));
jest.mock('../src/utils/orgScopedDb', () => ({ withOrg: jest.fn(async (_orgId, fn) => fn({ query: mockQuery })) }));
jest.mock('../src/utils/aiClient', () => mockAiClient);
jest.mock('../src/services/aiSwarm', () => ({ runDecisionFabric: jest.fn() }));
jest.mock('../src/services/spatial/worldContextService', () => ({ buildWorldContext: jest.fn() }));
jest.mock('../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../src/services/copilotActionLedger', () => mockActionLedger);

const express = require('express');
const request = require('supertest');
const { runDecisionFabric } = require('../src/services/aiSwarm');
const router = require('../src/routes/ai');
const app = express();
app.use(express.json());
app.use('/ai', router);

describe('Copilot dispatch tool execution contract', () => {
  beforeEach(() => {
    mockRole = 'dispatcher';
    mockActionRun = null;
    mockQuery.mockReset().mockImplementation(async () => ({ rows: [] }));
    mockActionLedger.createActionRun.mockReset().mockImplementation(async (args) => {
      mockActionRun = {
        id: '44444444-4444-4444-8444-444444444444',
        org_id: args.orgId,
        request_id: args.requestId,
        user_id: String(args.userId),
        command: args.command,
        tool_name: args.toolName,
        action_input: args.input,
        input_hash: 'test-hash',
        risk_level: args.riskLevel,
        status: args.status || 'executing',
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
      };
      return { run: mockActionRun, duplicate: false };
    });
    mockActionLedger.finishActionRun.mockReset().mockImplementation(async (args) => ({
      ...(mockActionRun || {}),
      id: args.actionId,
      org_id: args.orgId,
      status: args.status,
      result: args.result,
      error_code: args.errorCode || null,
      completed_at: new Date().toISOString(),
    }));
    mockActionLedger.getActionRun.mockReset().mockImplementation(async () => mockActionRun);
    mockActionLedger.listPendingActionRuns.mockReset().mockResolvedValue([]);
    mockActionLedger.claimActionRun.mockReset().mockImplementation(async () => ({
      mode: 'claimed',
      run: { ...(mockActionRun || {}), status: 'executing' },
    }));
    mockActionLedger.declineActionRun.mockReset().mockImplementation(async () => ({
      ...(mockActionRun || {}), status: 'denied', error_code: 'operator_declined',
    }));
    mockActionLedger.recordToolTrace.mockReset().mockResolvedValue('trace-test');
    mockActionLedger.makeActionReceipt.mockClear();
    mockAiClient.createMessage.mockReset();
    runDecisionFabric.mockReset();
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

    const response = await request(app).post('/ai/dispatch').send({ command: 'Corridor operations summary', history: [] });

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

  test('simplifies an oversized dense routed corridor within a stated tolerance and verifies persisted geometry', async () => {
    const previousFetch = global.fetch;
    let persistedCoordinates = null;
    // Keep the same road-like curve but sample it densely enough to cross the
    // new 10,000-point cap and exercise metre-bounded simplification end-to-end.
    const osrmCoordinates = Array.from({ length: 12001 }, (_, index) => [
      index / 12000,
      0.00018 * Math.sin((Math.PI * 160 * index) / 12000),
    ]);

    mockQuery.mockImplementation(async (sql, params = []) => {
      if (/ST_Buffer\\(/i.test(String(sql))) {
        return { rows: [{
          geojson: {
            type: 'Polygon',
            coordinates: [[
              [-0.01, -0.01],
              [1.01, -0.01],
              [1.01, 0.01],
              [-0.01, 0.01],
              [-0.01, -0.01],
            ]],
          },
          geometry_valid: true,
          covers_centerline: true,
          geometry_type: 'ST_Polygon',
        }] };
      }
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
        source_path_points: 12001,
        path_simplification_tolerance_m: 10,
        buffer_polygon_method: 'postgis-geography-buffer',
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

  test('routes investigation requests through the Decision Fabric instead of the dispatch tool loop', async () => {
    runDecisionFabric.mockResolvedValue({
      answer: 'Evidence-backed result from the Decision Fabric.',
      decision: 'MONITOR',
      risk_level: 'LOW',
      confidence: 0.88,
      recommended_actions: [],
      risks: [],
      evidence: ['query_vehicles', 'query_maintenance'],
      missing_data: [],
      swarm: [],
      meta: { degraded: false, latency_ms: 25, agent_count: 10 },
    });

    const response = await request(app).post('/ai/dispatch').send({
      command: 'Which vehicles are overdue for maintenance?',
      history: [],
    });

    expect(response.status).toBe(200);
    expect(response.body.answer).toContain('Evidence-backed result');
    expect(response.body.source).toBe('decision-fabric');
    expect(runDecisionFabric).toHaveBeenCalledTimes(1);
    expect(runDecisionFabric.mock.calls[0][0].command).toBe('Which vehicles are overdue for maintenance?');
    expect(mockAiClient.createMessage).not.toHaveBeenCalled();
  });

  test("creates the requested Nairobi administrative boundary from the action lane", async () => {
    const previousFetch = global.fetch;
    let persistedCoordinates = null;
    mockQuery.mockImplementation(async (sql, params) => {
      if (/INSERT INTO geofences/i.test(String(sql))) {
        persistedCoordinates = JSON.parse(params[2]);
        return { rows: [{ id: 'geofence-boundary-test' }] };
      }
      if (/SELECT type, coordinates FROM geofences/i.test(String(sql))) {
        return { rows: [{ type: 'polygon', coordinates: persistedCoordinates }] };
      }
      return { rows: [] };
    });
    const placeOnly = [{
      class: 'place',
      type: 'city',
      lat: '-1.2864',
      lon: '36.8172',
      display_name: 'Nairobi, Nairobi County, Kenya',
      address: { city: 'Nairobi', county: 'Nairobi County', country: 'Kenya', country_code: 'ke' },
    }];
    const boundaryMetadata = {
      boundaryID: 'KEN-ADM1-32016919',
      boundaryName: 'Kenya',
      boundaryISO: 'KEN',
      boundaryYearRepresented: '2020',
      boundaryType: 'ADM1',
      boundarySource: 'RCMRD GeoPortal, Africa GeoPortal',
      boundaryLicense: 'Public Domain',
      simplifiedGeometryGeoJSON: 'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/KEN/ADM1/geoBoundaries-KEN-ADM1_simplified.geojson',
    };
    const boundaryCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        properties: { shapeName: 'Nairobi City County', shapeID: 'KEN-ADM1-NAIROBI' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [36.70, -1.35],
            [36.95, -1.35],
            [36.95, -1.15],
            [36.70, -1.15],
            [36.70, -1.35],
          ]],
        },
      }],
    };
    const response = (payload) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(payload),
    });
    global.fetch = jest.fn(async (url) => {
      const requested = String(url);
      if (requested.startsWith('https://nominatim.openstreetmap.org/search?')) return response(placeOnly);
      if (requested === 'https://www.geoboundaries.org/api/current/gbOpen/KEN/ADM1/') return response(boundaryMetadata);
      if (requested === boundaryMetadata.simplifiedGeometryGeoJSON) return response(boundaryCollection);
      throw new Error('Unexpected upstream request: ' + requested);
    });
    try {
      const response = await request(app).post('/ai/dispatch').send({
        command: "Create a geofence matching Nairobi's official administrative boundary",
        history: [],
        request_id: '55555555-5555-4555-8555-555555555555',
      });

      expect(response.status).toBe(200);
      expect(response.body.task).toMatchObject({ type: 'geofence', completed: true });
      expect(response.body.created[0]).toMatchObject({
        type: 'geofence',
        geofence_id: 'geofence-boundary-test',
        fence_type: 'boundary',
        precision: 'source-backed-administrative-boundary',
        geometry_source: expect.stringContaining('geoBoundaries'),
        source_year: '2020',
        source_license: 'Public Domain',
        source_id: 'KEN-ADM1-NAIROBI',
      });
      expect(response.body.created[0].vertex_count).toBeGreaterThanOrEqual(3);
      expect(response.body.action_receipt).toMatchObject({ status: 'succeeded', tool_name: 'create_geofence' });
      expect(mockAiClient.createMessage).not.toHaveBeenCalled();
      expect(runDecisionFabric).not.toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledTimes(3);
    } finally {
      global.fetch = previousFetch;
    }
  });

  test('tutorial questions never trigger a geofence write', async () => {
    runDecisionFabric.mockResolvedValue({
      answer: 'To create a geofence, specify a location and a supported radius.',
      decision: 'MONITOR',
      risk_level: 'LOW',
      confidence: 0.7,
      recommended_actions: [],
      risks: [],
      evidence: [],
      missing_data: [],
      swarm: [],
      meta: { degraded: false, latency_ms: 10, agent_count: 10 },
    });
    mockAiClient.createMessage.mockResolvedValue({
      _provider: 'test-provider',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'To create a geofence, specify a location and a supported radius.' }],
    });

    const response = await request(app).post('/ai/dispatch').send({
      command: 'How do I create a geofence around Nairobi?',
      history: [],
    });

    expect(response.status).toBe(200);
    expect(response.body.response).toContain('specify a location');
    expect(mockActionLedger.createActionRun).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO geofences/i.test(String(sql)))).toBe(false);
  });

  test('does not clamp an invalid geofence radius or ask the model to reinterpret it', async () => {
    const response = await request(app).post('/ai/dispatch').send({
      command: 'Create a geofence around Nairobi with radius 200 km',
      history: [],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('geofence_request_not_understood');
    expect(response.body.message).toContain('will not silently change');
    expect(mockAiClient.createMessage).not.toHaveBeenCalled();
    expect(mockActionLedger.createActionRun).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO geofences/i.test(String(sql)))).toBe(false);
  });

  test('does not create a geofence for impossible latitude/longitude coordinates', async () => {
    const response = await request(app).post('/ai/dispatch').send({
      command: 'Create a geofence around 95, 200',
      history: [],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('geofence_request_not_understood');
    expect(mockAiClient.createMessage).not.toHaveBeenCalled();
    expect(mockActionLedger.createActionRun).not.toHaveBeenCalled();
  });

  test('does not let the model reinterpret an invalid high-risk radius', async () => {
    const response = await request(app).post('/ai/dispatch').send({
      command: 'Create a high-risk zone around Nairobi with radius 200 km',
      history: [],
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('risk_zone_request_not_understood');
    expect(response.body.message).toContain('will not guess');
    expect(mockAiClient.createMessage).not.toHaveBeenCalled();
    expect(mockActionLedger.createActionRun).not.toHaveBeenCalled();
    expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO risk_zones/i.test(String(sql)))).toBe(false);
  });

  test('high-risk risk-zone writes stage an approval instead of executing immediately', async () => {
    const previous = process.env.COPILOT_ACTION_SECRET;
    process.env.COPILOT_ACTION_SECRET = 'dispatch-test-secret-with-more-than-thirty-two-bytes';
    mockAiClient.createMessage.mockResolvedValue({
      _provider: 'test-provider',
      stop_reason: 'tool_use',
      content: [{
        type: 'tool_use',
        id: 'risk-zone-tool',
        name: 'create_risk_zone',
        input: {
          name: 'Nairobi security hotspot',
          location: 'Nairobi',
          risk_level: 'high',
          zone_type: 'security',
          description: 'Repeated security incidents reported',
          radius_km: 5,
        },
      }],
    });

    try {
      const response = await request(app).post('/ai/dispatch').send({
        command: 'Create a high-risk zone around Nairobi',
        history: [],
      });

      expect(response.status).toBe(200);
      expect(response.body.source).toBe('approval-required');
      expect(response.body.pending_actions).toHaveLength(1);
      expect(response.body.pending_actions[0]).toMatchObject({
        tool_name: 'create_risk_zone',
        risk_level: 'high',
        title: 'High Risk Zone — Nairobi',
      });
      expect(response.body.action_receipt.status).toBe('pending_confirmation');
      expect(mockAiClient.createMessage).not.toHaveBeenCalled();
      expect(mockActionLedger.createActionRun).toHaveBeenCalledWith(expect.objectContaining({
        toolName: 'create_risk_zone',
        status: 'pending_confirmation',
        riskLevel: 'high',
      }));
      expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO risk_zones/i.test(String(sql)))).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.COPILOT_ACTION_SECRET;
      else process.env.COPILOT_ACTION_SECRET = previous;
    }
  });

  test('explicit confirmation executes a staged risk-zone action and returns a durable receipt', async () => {
    const previousSecret = process.env.COPILOT_ACTION_SECRET;
    const previousFetch = global.fetch;
    process.env.COPILOT_ACTION_SECRET = 'dispatch-confirm-secret-with-more-than-thirty-two-bytes';
    const orgId = '22222222-2222-4222-8222-222222222222';
    const actionId = '44444444-4444-4444-8444-444444444444';
    const { signActionConfirmation } = require('../src/services/copilotActionPolicy');
    mockActionRun = {
      id: actionId,
      org_id: orgId,
      request_id: '33333333-3333-4333-8333-333333333333',
      user_id: 'user-test',
      command: 'Create a high-risk zone around Nairobi',
      tool_name: 'create_risk_zone',
      action_input: {
        name: 'Nairobi security hotspot',
        location: 'Nairobi',
        risk_level: 'high',
        zone_type: 'security',
        description: 'Repeated security incidents reported',
        radius_km: 5,
      },
      risk_level: 'high',
      status: 'pending_confirmation',
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
    };
    mockActionLedger.getActionRun.mockResolvedValue(mockActionRun);
    mockActionLedger.claimActionRun.mockResolvedValue({
      mode: 'claimed',
      run: { ...mockActionRun, status: 'executing', confirmed_by: 'user-test' },
    });
    mockActionLedger.finishActionRun.mockImplementation(async (args) => ({
      ...mockActionRun,
      status: args.status,
      result: args.result,
      error_code: args.errorCode || null,
      completed_at: new Date().toISOString(),
    }));
    mockQuery.mockImplementation(async (sql) => {
      if (/INSERT INTO risk_zones/i.test(String(sql))) {
        return { rows: [{ id: 'risk-zone-1', name: 'Nairobi security hotspot', risk_level: 'high', zone_type: 'security', lat: -1.2864, lng: 36.8172, radius_km: 5 }] };
      }
      return { rows: [] };
    });
    global.fetch = jest.fn(async (url) => {
      if (!String(url).startsWith('https://geocoding-api.open-meteo.com/')) throw new Error('Unexpected network request');
      return { ok: true, status: 200, json: async () => ({ results: [{ latitude: -1.2864, longitude: 36.8172, name: 'Nairobi', admin1: 'Nairobi County', country: 'Kenya' }] }) };
    });

    try {
      const token = signActionConfirmation({
        actionId, orgId, userId: 'user-test', expiresAt: mockActionRun.expires_at,
      });
      const response = await request(app).post('/ai/dispatch/confirm').send({
        action_id: actionId,
        confirmation_token: token,
        approved: true,
      });

      expect(response.status).toBe(200);
      expect(response.body.task).toMatchObject({ type: 'risk_zone', completed: true });
      expect(response.body.created[0]).toMatchObject({ type: 'risk_zone', risk_zone_id: 'risk-zone-1' });
      expect(response.body.action_receipt).toMatchObject({ id: actionId, status: 'succeeded' });
      expect(mockActionLedger.claimActionRun).toHaveBeenCalledWith({ orgId, actionId, userId: 'user-test' });
      expect(mockQuery.mock.calls.some(([sql]) => /INSERT INTO risk_zones/i.test(String(sql)))).toBe(true);
    } finally {
      global.fetch = previousFetch;
      if (previousSecret === undefined) delete process.env.COPILOT_ACTION_SECRET;
      else process.env.COPILOT_ACTION_SECRET = previousSecret;
    }
  });

  test('decision history is scoped to the authenticated user inside the tenant', async () => {
    const response = await request(app).get('/ai/decision/history?limit=5');
    expect(response.status).toBe(200);
    expect(mockQuery.mock.calls.some(([sql, params]) =>
      /FROM public\.copilot_decisions/.test(String(sql))
      && /user_id = \$2/.test(String(sql))
      && Array.isArray(params) && params[1] === 'user-test'
    )).toBe(true);
  });

});
