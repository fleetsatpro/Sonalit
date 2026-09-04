import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

import type { PoolClient } from 'pg';

// withOrgContext does real I/O. Mocking it lets these tests assert the
// property that matters most: that a handler is only ever reached through
// an org-scoped context, and with which org id.
const { mockWithOrgContext, orgCalls } = vi.hoisted(() => {
  const orgCalls: string[] = [];
  return {
    orgCalls,
    mockWithOrgContext: vi.fn(async (orgId: string, fn: (c: PoolClient) => Promise<unknown>) => {
      orgCalls.push(orgId);
      return fn({ query: () => Promise.resolve({ rows: [] }) } as unknown as PoolClient);
    }),
  };
});

vi.mock('../db.js', () => ({ withOrgContext: mockWithOrgContext }));

const { registerTool, executeTool, toolsForContext, clearRegistry } = await import('./registry.js');

const ctx = {
  org_id: 'org-a',
  user_id: 'user-1',
  role: 'operator' as const,
  request_id: 'req-1',
};

beforeEach(() => {
  clearRegistry();
  orgCalls.length = 0;
  mockWithOrgContext.mockClear();
});

function registerEcho(overrides: Partial<Parameters<typeof registerTool>[0]> = {}): void {
  registerTool({
    name: 'echo',
    description: 'Echoes its argument',
    action_level: 'read',
    required_role: 'analyst',
    source: 'database',
    input_schema: z.object({ value: z.string() }),
    handler: (args: { value: string }) => Promise.resolve({ echoed: args.value }),
    ...overrides,
  } as Parameters<typeof registerTool>[0]);
}

describe('executeTool', () => {
  it('validates arguments and returns the §12 contract on success', async () => {
    registerEcho();
    const res = await executeTool('echo', { value: 'hi' }, ctx);

    expect(res.success).toBe(true);
    expect(res.data).toEqual({ echoed: 'hi' });
    expect(res.source).toBe('database');
    expect(res.permitted).toBe(true);
    expect(res.confidence).toBe(1);
    expect(res.warnings).toEqual([]);
    expect(typeof res.timestamp).toBe('string');
    // §12 — null means "unknown", and must not be conflated with "fresh".
    expect(res.freshness_seconds).toBeNull();
  });

  // §59 — the isolation guarantee. A handler has no route to an unscoped
  // connection, so it cannot read another tenant's rows even if its SQL
  // omits an org filter (which is exactly the bug in the legacy tools).
  it('runs every handler inside the caller’s org context', async () => {
    registerEcho();
    await executeTool('echo', { value: 'x' }, ctx);
    await executeTool('echo', { value: 'y' }, { ...ctx, org_id: 'org-b' });

    expect(orgCalls).toEqual(['org-a', 'org-b']);
  });

  // §11 — a model can emit any shape; the handler must never see it.
  it('rejects invalid arguments without invoking the handler', async () => {
    const handler = vi.fn();
    registerEcho({ handler });

    const res = await executeTool('echo', { value: 42 }, ctx);

    expect(res.success).toBe(false);
    expect(res.error).toContain('Invalid arguments');
    expect(handler).not.toHaveBeenCalled();
    expect(mockWithOrgContext).not.toHaveBeenCalled();
  });

  it('denies a caller whose role is below the tool’s requirement', async () => {
    const handler = vi.fn();
    registerEcho({ required_role: 'admin', handler });

    const res = await executeTool('echo', { value: 'x' }, { ...ctx, role: 'analyst' });

    expect(res.success).toBe(false);
    expect(res.permitted).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('admits a caller whose role outranks the requirement', async () => {
    registerEcho({ required_role: 'operator' });
    const res = await executeTool('echo', { value: 'x' }, { ...ctx, role: 'admin' });
    expect(res.success).toBe(true);
  });

  // These results are fed back to the model as tool output, so a structured
  // refusal it can read beats an exception that aborts the turn.
  it('returns a structured failure for an unknown tool', async () => {
    const res = await executeTool('does_not_exist', {}, ctx);
    expect(res.success).toBe(false);
    expect(res.error).toContain('Unknown tool');
  });

  // Rule 4 — a failed lookup must not be readable as "nothing matched".
  it('warns that a failed tool means unavailable, not empty', async () => {
    registerEcho({ handler: () => Promise.reject(new Error('connection lost')) });

    const res = await executeTool('echo', { value: 'x' }, ctx);

    expect(res.success).toBe(false);
    expect(res.data).toBeNull();
    expect(res.confidence).toBe(0);
    expect(res.warnings.join(' ')).toContain('unavailable, not empty');
  });

  // §48 — a tool that knows how old its data is must be able to say so,
  // or Commander cannot distinguish "current" from "last known".
  it('reports freshness from a tool that can determine it', async () => {
    registerTool({
      name: 'aged',
      description: 'Returns data with a known age',
      action_level: 'read',
      required_role: 'analyst',
      source: 'computed',
      input_schema: z.object({}),
      handler: () => Promise.resolve({ data_age_seconds: 420 }),
      freshness: (data: { data_age_seconds: number }) => data.data_age_seconds,
    } as Parameters<typeof registerTool>[0]);

    const res = await executeTool('aged', {}, ctx);

    expect(res.freshness_seconds).toBe(420);
  });

  // Unknown must never be reported as fresh.
  it('leaves freshness null when a tool cannot determine it', async () => {
    registerEcho();
    const res = await executeTool('echo', { value: 'x' }, ctx);
    expect(res.freshness_seconds).toBeNull();
  });

  // Without an extractor a tool's caveats stay buried in its payload, and
  // ToolResult.warnings — which Commander uses to cap confidence — is
  // silently always empty.
  it('lifts a tool’s own warnings into the result contract', async () => {
    registerTool({
      name: 'caveated',
      description: 'Returns data with caveats',
      action_level: 'read',
      required_role: 'analyst',
      source: 'computed',
      input_schema: z.object({}),
      handler: () => Promise.resolve({ warnings: ['ETA data unavailable'] }),
      warnings: (data: { warnings: string[] }) => data.warnings,
    } as Parameters<typeof registerTool>[0]);

    const res = await executeTool('caveated', {}, ctx);

    expect(res.warnings).toEqual(['ETA data unavailable']);
  });

  it('refuses to register two tools under one name', () => {
    registerEcho();
    expect(() => {
      registerEcho();
    }).toThrow(/already registered/);
  });
});

describe('toolsForContext', () => {
  // §18's principle applied to tools: a tool the caller cannot invoke is
  // never described to the model, so it cannot be attempted and its
  // existence does not leak through a refusal.
  it('describes only the tools the caller’s role permits', () => {
    registerEcho({ name: 'analyst_tool', required_role: 'analyst' });
    registerEcho({ name: 'admin_tool', required_role: 'admin' });

    const names = toolsForContext({ ...ctx, role: 'operator' }).map((t) => t.name);

    expect(names).toEqual(['analyst_tool']);
  });

  it('converts Zod schemas to plain JSON Schema for the model', () => {
    registerTool({
      name: 'shaped',
      description: 'd',
      action_level: 'read',
      required_role: 'analyst',
      source: 'database',
      input_schema: z.object({
        status: z.enum(['active', 'idle']).optional().describe('the status'),
        limit: z.number().optional(),
        name: z.string(),
      }),
      handler: () => Promise.resolve(null),
    });

    const tool = toolsForContext(ctx)[0];
    if (!tool) throw new Error('expected the registered tool to be listed');

    expect(tool.input_schema).toEqual({
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'idle'], description: 'the status' },
        limit: { type: 'number' },
        name: { type: 'string' },
      },
      // Only the non-optional field is required, and no $ref/allOf wrapping
      // that open-weight models handle poorly.
      required: ['name'],
    });
  });
});
