'use strict';

const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const {
  ACTION_POLICIES,
  READ_ONLY_TOOLS,
  authorizeCopilotTool,
  classifyCopilotCommand,
  hasExplicitActionIntent,
  signActionConfirmation,
  validatePolicyCoverage,
  verifyActionConfirmation,
} = require('../src/services/copilotActionPolicy');

const tenant = '22222222-2222-4222-8222-222222222222';
const user = { id: 'user-1', org_id: tenant, role: 'dispatcher' };

describe('Copilot enterprise action policy', () => {
  test('routes tutorial questions to investigation and never treats them as write consent', () => {
    const prompts = [
      'How do I create a geofence around Nairobi?',
      'Explain how to create a risk zone',
      'What is a high-risk zone?',
      'Should we mark Nairobi as a risk area?',
    ];
    for (const prompt of prompts) {
      expect(classifyCopilotCommand(prompt).kind).toBe('investigation');
      expect(hasExplicitActionIntent(prompt, 'create_geofence')).toBe(false);
      expect(hasExplicitActionIntent(prompt, 'create_risk_zone')).toBe(false);
    }
  });

  test('requires explicit geofence action language and distinguishes risk zones', () => {
    expect(classifyCopilotCommand('Create a polygon geofence around Nairobi').kind).toBe('action');
    expect(classifyCopilotCommand('Build a zone in Nairobi').kind).toBe('action');
    expect(hasExplicitActionIntent('Build a zone in Nairobi', 'create_geofence')).toBe(true);
    expect(hasExplicitActionIntent('Draw a high-precision geofence around Nairobi', 'create_geofence')).toBe(true);
    expect(hasExplicitActionIntent('Create a risk zone around Nairobi', 'create_geofence')).toBe(false);
    expect(hasExplicitActionIntent('Create a risk zone around Nairobi', 'create_risk_zone')).toBe(true);
    expect(hasExplicitActionIntent('Assess risk zones around Nairobi', 'create_risk_zone')).toBe(false);
  });

  test('keeps read operations available and gates mutations by role and tenant identity', () => {
    expect(READ_ONLY_TOOLS.length).toBeGreaterThanOrEqual(12);
    expect(authorizeCopilotTool({ toolName: 'query_vehicles', command: 'Show fleet status', user: { role: 'analyst' } }))
      .toMatchObject({ allowed: true, mutation: false });

    expect(authorizeCopilotTool({
      toolName: 'create_geofence',
      command: 'Create a geofence around Nairobi',
      user: { ...user, role: 'analyst' },
    })).toMatchObject({ allowed: false, code: 'insufficient_role' });

    expect(authorizeCopilotTool({
      toolName: 'create_geofence',
      command: 'Create a geofence around Nairobi',
      user,
    })).toMatchObject({ allowed: true, mutation: true, requires_confirmation: false, risk_level: 'medium' });

    expect(authorizeCopilotTool({
      toolName: 'create_risk_zone',
      command: 'Create a high-risk zone around Nairobi',
      user,
    })).toMatchObject({ allowed: true, mutation: true, requires_confirmation: true, risk_level: 'high' });

    expect(authorizeCopilotTool({
      toolName: 'create_risk_zone',
      command: 'Create a high-risk zone around Nairobi',
      user: { ...user, role: 'operator' },
    })).toMatchObject({ allowed: false, code: 'insufficient_role' });

    expect(authorizeCopilotTool({
      toolName: 'create_geofence',
      command: 'Create a geofence around Nairobi',
      user: { id: 'user-1', role: 'dispatcher' },
    })).toMatchObject({ allowed: false, code: 'tenant_identity_required' });
  });

  test('the actual model tool registry cannot grow without a server-side policy', () => {
    const routes = readFileSync(resolve(__dirname, '../src/routes/ai.js'), 'utf8');
    const start = routes.indexOf('const TOOLS = [');
    const end = routes.indexOf('const toolPolicyCoverage', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const registry = routes.slice(start, end);
    const toolNames = [...registry.matchAll(/name:\s*'([^']+)'/g)].map(match => match[1]);
    expect(toolNames.length).toBeGreaterThan(0);
    expect(validatePolicyCoverage(toolNames)).toMatchObject({ valid: true, unclassified_tools: [] });
  });

  test('fails closed for unknown tools and detects every registered tool policy', () => {
    expect(authorizeCopilotTool({ toolName: 'delete_convoy', command: 'Delete convoy', user }))
      .toMatchObject({ allowed: false, code: 'tool_policy_missing' });
    const coverage = validatePolicyCoverage([
      ...READ_ONLY_TOOLS,
      ...Object.keys(ACTION_POLICIES),
    ]);
    expect(coverage).toMatchObject({ valid: true, unclassified_tools: [] });
    expect(validatePolicyCoverage(['query_vehicles', 'dangerous_new_tool']).valid).toBe(false);
  });

  test('signs confirmation tokens and rejects tampering, identity mismatch and expiry', () => {
    const previous = process.env.COPILOT_ACTION_SECRET;
    process.env.COPILOT_ACTION_SECRET = 'test-only-secret-with-more-than-thirty-two-bytes';
    try {
      const action = {
        actionId: '33333333-3333-4333-8333-333333333333',
        orgId: tenant,
        userId: 'user-1',
        expiresAt: new Date(Date.now() + 60_000),
      };
      const token = signActionConfirmation(action);
      expect(verifyActionConfirmation(token)).toMatchObject({ valid: true, payload: { action_id: action.actionId, org_id: tenant, user_id: 'user-1' } });
      expect(verifyActionConfirmation(token + 'tampered').valid).toBe(false);
      const expired = signActionConfirmation({ ...action, expiresAt: new Date(Date.now() - 60_000) });
      expect(verifyActionConfirmation(expired)).toMatchObject({ valid: false, code: 'confirmation_expired' });
    } finally {
      if (previous === undefined) delete process.env.COPILOT_ACTION_SECRET;
      else process.env.COPILOT_ACTION_SECRET = previous;
    }
  });
});
