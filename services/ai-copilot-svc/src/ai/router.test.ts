import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AIModel, InferenceAdapter, InferenceResponse } from './types.js';

// The registry and the adapters are the router's two collaborators, and
// both do I/O (Postgres, HTTP). Mocking them is what makes the routing and
// fallback logic — the part worth testing — observable in isolation.
const { mockGetModels, mockInfer } = vi.hoisted(() => ({
  mockGetModels: vi.fn(),
  mockInfer: vi.fn(),
}));

vi.mock('./registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./registry.js')>();
  return { ...actual, getModels: mockGetModels };
});

vi.mock('./adapters/index.js', () => ({
  adapterFor: (): InferenceAdapter =>
    ({ provider: 'openai_compatible', infer: mockInfer }) as unknown as InferenceAdapter,
}));

const { infer, resetHealth } = await import('./router.js');
const { AllModelsFailedError, NoEligibleModelError } = await import('./types.js');

let idCounter = 0;
function model(overrides: Partial<AIModel> = {}): AIModel {
  idCounter += 1;
  return {
    model_id: `00000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`,
    name: `model-${String(idCounter)}`,
    version: '1',
    provider: 'openai_compatible',
    provider_model: 'test',
    capabilities: ['general'],
    license: 'Apache-2.0',
    license_is_open_source: true,
    self_hosted: true,
    context_length: 32000,
    quantization: null,
    hardware_profile: null,
    endpoint: 'http://vllm:8000/v1',
    api_key_env: null,
    max_data_classification: 'operational',
    supports_tools: true,
    supports_streaming: true,
    routing_priority: 100,
    benchmark_score: null,
    status: 'production',
    approved_for_production: true,
    ...overrides,
  };
}

function response(model_id: string): InferenceResponse {
  return {
    text: 'ok',
    tool_calls: [],
    stop_reason: 'end_turn',
    model_id,
    model_version: '1',
    input_tokens: 10,
    output_tokens: 5,
    latency_ms: 42,
  };
}

const request = {
  capability: 'general' as const,
  classification: 'operational' as const,
  messages: [{ role: 'user' as const, content: 'status of convoy 17' }],
};

beforeEach(() => {
  resetHealth();
  mockGetModels.mockReset();
  mockInfer.mockReset();
});

describe('infer', () => {
  it('routes to the lowest-priority (smallest) capable model', async () => {
    const small = model({ name: 'small', routing_priority: 10 });
    const large = model({ name: 'large', routing_priority: 90 });
    mockGetModels.mockResolvedValue([large, small]);
    mockInfer.mockImplementation((m: AIModel) => Promise.resolve(response(m.model_id)));

    const { result, attempts } = await infer(request);

    expect(result.model_id).toBe(small.model_id);
    expect(attempts).toEqual([{ model_id: small.model_id, name: 'small', ok: true }]);
    expect(mockInfer).toHaveBeenCalledTimes(1);
  });

  // §49 — the fallback chain is the reason a single provider outage does
  // not take the AI plane down.
  it('falls through to the next model when the first fails', async () => {
    const first = model({ name: 'first', routing_priority: 10 });
    const second = model({ name: 'second', routing_priority: 20 });
    mockGetModels.mockResolvedValue([first, second]);
    mockInfer
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockImplementation((m: AIModel) => Promise.resolve(response(m.model_id)));

    const { result, attempts } = await infer(request);

    expect(result.model_id).toBe(second.model_id);
    expect(attempts).toEqual([
      { model_id: first.model_id, name: 'first', ok: false, error: 'connection refused' },
      { model_id: second.model_id, name: 'second', ok: true },
    ]);
  });

  // Rule 4 / §49 — exhausting the chain must surface as an error the caller
  // has to handle, never a synthesised answer.
  it('throws AllModelsFailedError rather than fabricating a response', async () => {
    mockGetModels.mockResolvedValue([model({ name: 'a' }), model({ name: 'b' })]);
    mockInfer.mockRejectedValue(new Error('upstream 503'));

    await expect(infer(request)).rejects.toBeInstanceOf(AllModelsFailedError);
    expect(mockInfer).toHaveBeenCalledTimes(2);
  });

  it('throws NoEligibleModelError when classification clears no model', async () => {
    mockGetModels.mockResolvedValue([model({ max_data_classification: 'internal' })]);

    await expect(infer({ ...request, classification: 'restricted' })).rejects.toBeInstanceOf(
      NoEligibleModelError,
    );
    expect(mockInfer).not.toHaveBeenCalled();
  });

  it('skips models whose context window cannot hold the request', async () => {
    const tiny = model({ name: 'tiny', context_length: 100, routing_priority: 10 });
    const roomy = model({ name: 'roomy', context_length: 128000, routing_priority: 20 });
    mockGetModels.mockResolvedValue([tiny, roomy]);
    mockInfer.mockImplementation((m: AIModel) => Promise.resolve(response(m.model_id)));

    const { result, attempts } = await infer({
      ...request,
      messages: [{ role: 'user', content: 'x'.repeat(40_000) }],
    });

    expect(result.model_id).toBe(roomy.model_id);
    expect(attempts[0]).toMatchObject({ name: 'tiny', ok: false });
    // The oversized prompt is a routing mismatch, so the adapter is never
    // called for it — only the model that could actually hold it.
    expect(mockInfer).toHaveBeenCalledTimes(1);
  });

  // Health is tracked per model, not globally: one dead self-hosted
  // endpoint must not take healthy models out of rotation with it.
  it('stops routing to a model after repeated failures, then recovers others', async () => {
    const flaky = model({ name: 'flaky', routing_priority: 10 });
    const stable = model({ name: 'stable', routing_priority: 20 });
    mockGetModels.mockResolvedValue([flaky, stable]);
    mockInfer.mockImplementation((m: AIModel) =>
      m.name === 'flaky'
        ? Promise.reject(new Error('down'))
        : Promise.resolve(response(m.model_id)),
    );

    for (let i = 0; i < 3; i += 1) await infer(request);

    mockInfer.mockClear();
    const { attempts } = await infer(request);

    expect(attempts).toEqual([{ model_id: stable.model_id, name: 'stable', ok: true }]);
    expect(mockInfer).toHaveBeenCalledTimes(1);
  });

  it('requires tool support only when tools are supplied', async () => {
    const noTools = model({ name: 'no-tools', supports_tools: false, routing_priority: 10 });
    const withTools = model({ name: 'with-tools', supports_tools: true, routing_priority: 20 });
    mockGetModels.mockResolvedValue([noTools, withTools]);
    mockInfer.mockImplementation((m: AIModel) => Promise.resolve(response(m.model_id)));

    const { result } = await infer({
      ...request,
      tools: [{ name: 'get_convoy', description: 'x', input_schema: { type: 'object' } }],
    });

    expect(result.model_id).toBe(withTools.model_id);
  });
});
