'use strict';

const mockQuery = jest.fn();
const mockWithOrg = jest.fn(async (_orgId, fn) => fn({ query: mockQuery }));
jest.mock('../src/utils/orgScopedDb', () => ({ withOrg: (...args) => mockWithOrg(...args) }));

const ledger = require('../src/services/copilotActionLedger');

const orgId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const actionId = '44444444-4444-4444-8444-444444444444';
const input = { name: 'Nairobi risk zone', location: 'Nairobi', risk_level: 'high', radius_km: 5 };

describe('Copilot action ledger', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockWithOrg.mockClear();
  });

  test('reserves one idempotent action row and returns the created receipt', async () => {
    let inserted;
    mockQuery.mockImplementation(async (sql, params) => {
      if (/INSERT INTO public\.copilot_action_runs/.test(sql)) {
        inserted = {
          id: actionId,
          org_id: params[0],
          request_id: params[1],
          user_id: params[2],
          command: params[3],
          tool_name: params[4],
          action_input: JSON.parse(params[5]),
          input_hash: params[6],
          risk_level: params[7],
          status: params[8],
          expires_at: new Date(Date.now() + 600000).toISOString(),
          created_at: new Date().toISOString(),
        };
        return { rows: [inserted] };
      }
      return { rows: [] };
    });

    const result = await ledger.createActionRun({
      orgId, userId: 'user-1', requestId, command: 'Create a high-risk zone around Nairobi',
      toolName: 'create_risk_zone', input, riskLevel: 'high', status: 'pending_confirmation',
    });

    expect(result.duplicate).toBe(false);
    expect(result.run).toMatchObject({ id: actionId, org_id: orgId, request_id: requestId, status: 'pending_confirmation' });
    expect(mockWithOrg).toHaveBeenCalledWith(orgId, expect.any(Function));
    expect(mockQuery.mock.calls.some(([sql]) => /ON CONFLICT \(org_id, request_id\) DO NOTHING/.test(sql))).toBe(true);
  });

  test('replays matching idempotency keys and rejects a key reused for different input', async () => {
    let row;
    let forceConflict = false;
    mockQuery.mockImplementation(async (sql, params) => {
      if (/INSERT INTO public\.copilot_action_runs/.test(sql)) {
        if (forceConflict) return { rows: [] };
        row = {
          id: actionId, org_id: params[0], request_id: params[1], user_id: params[2],
          command: params[3], tool_name: params[4], action_input: JSON.parse(params[5]),
          input_hash: params[6], risk_level: params[7], status: params[8],
        };
        return { rows: [row] };
      }
      if (/FROM public\.copilot_action_runs WHERE org_id=\$1 AND request_id=\$2/.test(sql)) {
        return { rows: row ? [row] : [] };
      }
      return { rows: [] };
    });

    const args = { orgId, userId: 'user-1', requestId, command: 'Create a high-risk zone around Nairobi', toolName: 'create_risk_zone', input, riskLevel: 'high', status: 'pending_confirmation' };
    await ledger.createActionRun(args);
    forceConflict = true;
    const replay = await ledger.createActionRun(args);
    expect(replay.duplicate).toBe(true);

    await expect(ledger.createActionRun({ ...args, input: { ...input, radius_km: 20 } }))
      .rejects.toThrow('idempotency_conflict');
  });

  test('claims a pending approval under lock only once', async () => {
    const pending = {
      id: actionId, org_id: orgId, user_id: 'user-1', status: 'pending_confirmation',
      expires_at: new Date(Date.now() + 60000).toISOString(),
    };
    mockQuery.mockImplementation(async (sql, params) => {
      if (/SELECT .*FROM public\.copilot_action_runs WHERE id=\$1 AND org_id=\$2 FOR UPDATE/s.test(sql)) {
        return { rows: [pending] };
      }
      if (/UPDATE public\.copilot_action_runs SET status='executing'/.test(sql)) {
        return { rows: [{ ...pending, status: 'executing', confirmed_by: params[2] }] };
      }
      return { rows: [] };
    });

    const claimed = await ledger.claimActionRun({ orgId, actionId, userId: 'user-1' });
    expect(claimed.mode).toBe('claimed');
    expect(claimed.run.status).toBe('executing');
  });

  test('tool trace summaries do not persist credentials or whole evidence arrays', () => {
    const inputSummary = ledger.summarizeToolInput({
      location: 'Nairobi',
      api_key: 'never-persist-this',
      confirmation_token: 'also-secret',
      geometry: [[1, 2], [3, 4]],
    });
    expect(inputSummary).toMatchObject({ location: 'Nairobi', geometry: { type: 'array', count: 2 } });
    expect(JSON.stringify(inputSummary)).not.toContain('never-persist-this');
    expect(JSON.stringify(inputSummary)).not.toContain('also-secret');

    const resultSummary = ledger.summarizeToolResult({
      created: true,
      risk_zone_id: 'zone-1',
      vehicles: [{ registration: 'private-registration' }],
    });
    expect(resultSummary).toMatchObject({ created: true, risk_zone_id: 'zone-1', counts: { vehicles: 1 } });
    expect(JSON.stringify(resultSummary)).not.toContain('private-registration');
  });
});
