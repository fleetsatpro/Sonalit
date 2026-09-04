import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { InferenceResponse } from '../ai/types.js';
import type { ToolContext, ToolResult } from '../tools/types.js';

const { mockInfer, mockExecuteTool, mockToolsForContext, mockRecordAudit } = vi.hoisted(() => ({
  mockInfer: vi.fn(),
  mockExecuteTool: vi.fn(),
  mockToolsForContext: vi.fn(),
  mockRecordAudit: vi.fn(() => Promise.resolve()),
}));

vi.mock('../ai/router.js', () => ({ infer: mockInfer }));
vi.mock('../tools/index.js', () => ({
  executeTool: mockExecuteTool,
  toolsForContext: mockToolsForContext,
}));
vi.mock('../ai/audit.js', () => ({
  newRequestId: () => 'req-1',
  recordAudit: mockRecordAudit,
}));

const { runCommander } = await import('./agent.js');
const { NoEligibleModelError, AllModelsFailedError } = await import('../ai/types.js');

const ctx: ToolContext = {
  org_id: '00000000-0000-4000-8000-00000000000a',
  user_id: 'u1',
  role: 'operator',
  request_id: 'req-1',
};

function modelSays(
  text: string,
  toolCalls: InferenceResponse['tool_calls'] = [],
): InferenceResponse {
  return {
    text,
    tool_calls: toolCalls,
    stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    model_id: 'row-uuid',
    model_name: 'qwen3-32b',
    provider_model: 'Qwen/Qwen3-32B',
    model_version: '1',
    input_tokens: 10,
    output_tokens: 20,
    latency_ms: 5,
  };
}

function toolResult(overrides: Partial<ToolResult> = {}): ToolResult {
  return {
    success: true,
    data: { count: 1 },
    source: 'database',
    timestamp: new Date().toISOString(),
    freshness_seconds: 10,
    confidence: 1,
    permitted: true,
    warnings: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockInfer.mockReset();
  mockExecuteTool.mockReset();
  mockRecordAudit.mockClear();
  mockToolsForContext.mockReturnValue([
    { name: 'query_vehicles', description: 'd', input_schema: { type: 'object' } },
  ]);
});

describe('runCommander', () => {
  it('answers directly when the model needs no tools', async () => {
    mockInfer.mockResolvedValue({ result: modelSays('Twelve vehicles are active.'), attempts: [] });

    const res = await runCommander({ message: 'how many active?', ctx });

    expect(res.answer).toBe('Twelve vehicles are active.');
    expect(res.completion_reason).toBe('answered');
    expect(res.prompt_version).toBe('commander-v1');
    expect(mockRecordAudit).toHaveBeenCalledOnce();
  });

  it('runs tools and feeds their results back to the model', async () => {
    mockInfer
      .mockResolvedValueOnce({
        result: modelSays('', [{ id: 't1', name: 'query_vehicles', input: {} }]),
        attempts: [],
      })
      .mockResolvedValueOnce({ result: modelSays('Two vehicles are low on fuel.'), attempts: [] });
    mockExecuteTool.mockResolvedValue(toolResult());

    const res = await runCommander({ message: 'which are low on fuel?', ctx });

    expect(res.tools_used).toEqual(['query_vehicles']);
    expect(res.answer).toBe('Two vehicles are low on fuel.');
    const second = mockInfer.mock.calls[1]?.[0] as { messages: { role: string }[] };
    expect(second.messages.some((m) => m.role === 'tool')).toBe(true);
  });

  // §15/§47 — the label comes from the tool's declared source, in code, so
  // a model cannot promote its own reasoning to "observed".
  it('derives evidence kind from the tool source, not the model', async () => {
    mockInfer
      .mockResolvedValueOnce({
        result: modelSays('', [{ id: 't1', name: 'assess_convoy_risk', input: {} }]),
        attempts: [],
      })
      .mockResolvedValueOnce({ result: modelSays('Risk is elevated.'), attempts: [] });
    mockExecuteTool.mockResolvedValue(toolResult({ source: 'computed' }));

    const res = await runCommander({ message: 'risk?', ctx });

    expect(res.evidence[0]?.kind).toBe('computed');
    expect(res.evidence[0]?.source).toBe('assess_convoy_risk');
  });

  // §9 — an agent that can loop indefinitely eventually will.
  it('stops when the tool budget is exhausted and says the answer is partial', async () => {
    mockInfer.mockResolvedValue({
      result: modelSays('', [{ id: 't1', name: 'query_vehicles', input: {} }]),
      attempts: [],
    });
    mockExecuteTool.mockResolvedValue(toolResult());

    const res = await runCommander({
      message: 'investigate',
      ctx,
      budget: { max_tool_calls: 2 },
    });

    expect(res.completion_reason).toBe('tool_budget_exhausted');
    expect(res.answer).toContain('incomplete');
    expect(res.confidence).toBe('low');
  });

  // A model must not overshoot by batching its requests.
  it('counts a whole batch against the budget', async () => {
    mockInfer.mockResolvedValue({
      result: modelSays('', [
        { id: 't1', name: 'query_vehicles', input: {} },
        { id: 't2', name: 'query_vehicles', input: {} },
        { id: 't3', name: 'query_vehicles', input: {} },
      ]),
      attempts: [],
    });
    mockExecuteTool.mockResolvedValue(toolResult());

    const res = await runCommander({ message: 'go', ctx, budget: { max_tool_calls: 2 } });

    expect(res.completion_reason).toBe('tool_budget_exhausted');
    expect(mockExecuteTool).not.toHaveBeenCalled();
  });

  it('stops when the reasoning turn budget is reached', async () => {
    mockInfer.mockResolvedValue({
      result: modelSays('', [{ id: 't1', name: 'query_vehicles', input: {} }]),
      attempts: [],
    });
    mockExecuteTool.mockResolvedValue(toolResult());

    const res = await runCommander({
      message: 'loop forever',
      ctx,
      budget: { max_turns: 2, max_tool_calls: 100 },
    });

    expect(res.completion_reason).toBe('tool_budget_exhausted');
    expect(res.warnings.join(' ')).toContain('reasoning turns');
  });

  // §49/§62 — no model means Commander says so. It never answers from the
  // model's own memory, because there is no model.
  it('reports model unavailability instead of answering unsourced', async () => {
    mockInfer.mockRejectedValue(new NoEligibleModelError('general', 'none registered'));

    const res = await runCommander({ message: 'status?', ctx });

    expect(res.completion_reason).toBe('model_unavailable');
    expect(res.answer).toContain('unavailable');
    // Rule 3 — the rest of the platform is explicitly unaffected.
    expect(res.answer).toContain('unaffected');
    expect(res.confidence).toBe('insufficient');
  });

  it('reports unavailability when every model in the chain fails', async () => {
    mockInfer.mockRejectedValue(new AllModelsFailedError('general', []));
    const res = await runCommander({ message: 'status?', ctx });
    expect(res.completion_reason).toBe('model_unavailable');
  });

  it('refuses to proceed when the role has no tools', async () => {
    mockToolsForContext.mockReturnValue([]);

    const res = await runCommander({ message: 'anything', ctx });

    expect(res.completion_reason).toBe('no_tools_permitted');
    expect(mockInfer).not.toHaveBeenCalled();
  });

  // §14 — a client must not be able to widen what the model can reference
  // just by asserting a screen.
  it('ignores screen context that is not authorised', async () => {
    mockInfer.mockResolvedValue({ result: modelSays('Which convoy do you mean?'), attempts: [] });

    const res = await runCommander({
      message: 'what is wrong with this?',
      ctx,
      context: { entity_type: 'convoy', entity_id: 'convoy-secret' },
      authoriseContext: () => Promise.resolve(false),
    });

    expect(res.warnings.join(' ')).toContain('not authorised');
    const prompt = (mockInfer.mock.calls[0]?.[0] as { messages: { content: string }[] }).messages[0]
      ?.content;
    // The id must not reach the model: naming it would confirm it exists.
    expect(prompt).not.toContain('convoy-secret');
  });

  it('treats context as unauthorised when no authoriser is supplied', async () => {
    mockInfer.mockResolvedValue({ result: modelSays('Please clarify.'), attempts: [] });

    const res = await runCommander({
      message: 'what is wrong with this?',
      ctx,
      context: { entity_type: 'convoy', entity_id: 'convoy-17' },
    });

    expect(res.warnings.join(' ')).toContain('not authorised');
  });

  it('passes authorised context through to the model', async () => {
    mockInfer.mockResolvedValue({ result: modelSays('It is running late.'), attempts: [] });

    await runCommander({
      message: 'what is wrong with this?',
      ctx,
      context: { entity_type: 'convoy', entity_id: 'convoy-17' },
      authoriseContext: () => Promise.resolve(true),
    });

    const prompt = (mockInfer.mock.calls[0]?.[0] as { messages: { content: string }[] }).messages[0]
      ?.content;
    expect(prompt).toContain('convoy-17');
  });

  // Rule 4 — a failed lookup is not an empty result.
  it('tells the model a failed tool means unavailable, not empty', async () => {
    mockInfer
      .mockResolvedValueOnce({
        result: modelSays('', [{ id: 't1', name: 'query_vehicles', input: {} }]),
        attempts: [],
      })
      .mockResolvedValueOnce({ result: modelSays('I could not check.'), attempts: [] });
    mockExecuteTool.mockResolvedValue(
      toolResult({ success: false, data: null, error: 'db down', confidence: 0 }),
    );

    const res = await runCommander({ message: 'check', ctx });

    const toolMessage = (
      mockInfer.mock.calls[1]?.[0] as { messages: { content: string }[] }
    ).messages.find((m) => m.content.includes('failed'));
    expect(toolMessage?.content).toContain('do not treat this as an empty result');
    expect(res.evidence[0]?.summary).toContain('failed');
  });

  // §48 — an answer is only as current as its stalest input.
  it('reports the oldest data age across all evidence', async () => {
    mockInfer
      .mockResolvedValueOnce({
        result: modelSays('', [
          { id: 't1', name: 'query_vehicles', input: {} },
          { id: 't2', name: 'query_alerts', input: {} },
        ]),
        attempts: [],
      })
      .mockResolvedValueOnce({ result: modelSays('done'), attempts: [] });
    mockExecuteTool
      .mockResolvedValueOnce(toolResult({ freshness_seconds: 12 }))
      .mockResolvedValueOnce(toolResult({ freshness_seconds: 3600 }));

    const res = await runCommander({ message: 'status', ctx });

    expect(res.data_age_seconds).toBe(3600);
    // Stale evidence caps confidence regardless of volume.
    expect(res.confidence).toBe('medium');
  });

  it('audits every run, including failures', async () => {
    mockInfer.mockRejectedValue(new AllModelsFailedError('general', []));

    await runCommander({ message: 'x', ctx });

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'all_models_failed',
        prompt_version: 'commander-v1',
        org_id: ctx.org_id,
      }),
    );
  });
});
