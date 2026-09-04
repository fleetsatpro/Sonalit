import { describe, it, expect } from 'vitest';

import { toolsForContext } from '../index.js';

import type { ToolContext } from '../types.js';

// Importing ../index.js registers the real tools. This is a smoke test over
// that registration: zodToJsonSchema throws on any Zod construct it cannot
// render, so a schema the models could not consume fails here rather than
// mid-conversation in production.
const ctx: ToolContext = {
  org_id: 'org-a',
  user_id: 'user-1',
  role: 'admin',
  request_id: 'req-1',
};

describe('registered fleet tools', () => {
  it('registers the ported read tools', () => {
    const names = toolsForContext(ctx).map((t) => t.name);
    // Containment rather than an exact list: registering a tool elsewhere
    // should not fail the fleet suite.
    expect(names).toEqual(
      expect.arrayContaining([
        'query_alerts',
        'query_convoys',
        'query_risk_zones',
        'query_vehicles',
      ]),
    );
  });

  it('renders every tool schema as a plain object schema', () => {
    for (const tool of toolsForContext(ctx)) {
      expect(tool.input_schema).toMatchObject({ type: 'object' });
      expect(JSON.stringify(tool.input_schema)).not.toContain('$ref');
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('exposes vehicle filters with usable enums', () => {
    const vehicles = toolsForContext(ctx).find((t) => t.name === 'query_vehicles');
    const props = (vehicles?.input_schema as { properties: Record<string, unknown> }).properties;

    expect(props['status']).toEqual({
      type: 'string',
      enum: ['active', 'idle', 'maintenance', 'offline'],
      description: 'Filter by vehicle status',
    });
    // All filters are optional, so a bare call is valid.
    expect((vehicles?.input_schema as { required?: string[] }).required).toBeUndefined();
  });
});
