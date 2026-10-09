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
});
