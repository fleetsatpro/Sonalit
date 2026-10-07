'use strict';

describe('intelligence provider mesh', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_GPT_OSS_120B_FREE_MODEL;
    delete process.env.OPENROUTER_GPT_OSS_20B_FREE_MODEL;
    delete process.env.OPENROUTER_GLM45_AIR_FREE_MODEL;
    delete process.env.OPENROUTER_LING30_FLASH_VL_MODEL;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.CEREBRAS_API_KEY;
    delete process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT;
    delete process.env.INTEL_ALLOW_FREE_CONFIDENTIAL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    for (let i = 1; i <= 5; i += 1) {
      delete process.env[`OPEN_SOURCE_API_KEY_${i}`];
      delete process.env[`OPEN_SOURCE_BASE_URL_${i}`];
      delete process.env[`OPEN_SOURCE_MODEL_${i}`];
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('exposes current independent open-weight and free vendor lanes when configured', () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key-123';
    process.env.NVIDIA_API_KEY = 'nvidia-test-key-123';
    process.env.CEREBRAS_API_KEY = 'cerebras-test-key-123';

    const ai = require('../src/utils/aiClient');
    const caps = ai.providerCapabilities();
    const labels = caps.open_weight.map(p => p.label);

    expect(caps.open_weight).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'qwen3.5-397b-openrouter', configured: true }),
      expect.objectContaining({ label: 'deepseek-v3.2-openrouter', configured: true }),
      expect.objectContaining({ label: 'deepseek-v4-flash-openrouter', configured: true }),
      expect.objectContaining({ label: 'nemotron3-super-nvidia', configured: true }),
      expect.objectContaining({ label: 'nemotron3-ultra-550b-nvidia', configured: true }),
      expect.objectContaining({ label: 'nemotron3.5-lightning-30b-nvidia', configured: true }),
      expect.objectContaining({ label: 'gpt-oss-120b-cerebras', configured: true }),
      expect.objectContaining({ label: 'openrouter-free-router', configured: true, free: true }),
      expect.objectContaining({ label: 'apodex-1.1-mini-openrouter-free', configured: true, free: true }),
      expect.objectContaining({ label: 'gpt-oss-120b-openrouter-free', configured: true, free: true }),
      expect.objectContaining({ label: 'glm-4.5-air-openrouter-free', configured: true, free: true }),
      expect.objectContaining({ label: 'ling3.0-flash-vl-openrouter-free', configured: true, free: true }),
      expect.objectContaining({ label: 'gemma4-26b-openrouter-free', configured: true, free: true }),
      expect.objectContaining({ label: 'gemma4-31b-openrouter-free', configured: true, free: true }),
      expect.objectContaining({ label: 'nemotron3-nano-omni-openrouter-free', configured: true, free: true }),
      expect.objectContaining({ label: 'nemotron3-ultra-openrouter-free', configured: true, free: true }),
      expect.objectContaining({ label: 'nemotron3-super-openrouter-free', configured: true, free: true }),
      expect.objectContaining({ label: 'nemotron3.5-lightning-openrouter-free', configured: true, free: true }),
      expect.objectContaining({ label: 'laguna-s21-openrouter-free', configured: true, free: true }),
    ]));

    expect(labels).not.toEqual(expect.arrayContaining([
      'minimax-m3-openrouter-free',
      'minimax-m2.7-openrouter-free',
      'inkling-openrouter-free',
    ]));

    expect(caps.open_weight.find(p => p.label === 'gemma4-31b-openrouter-free').model)
      .toBe('google/gemma-4-31b-it:free');
    expect(caps.open_weight.find(p => p.label === 'nemotron3-super-openrouter-free').model)
      .toBe('nvidia/nemotron-3-super-120b-a12b:free');
  });

  test('keeps arbitrary self-hosted open-source slots working', () => {
    process.env.OPEN_SOURCE_API_KEY_1 = 'self-hosted-test-key';
    process.env.OPEN_SOURCE_BASE_URL_1 = 'https://llm.example.invalid/v1';
    process.env.OPEN_SOURCE_MODEL_1 = 'custom-open-model';

    const ai = require('../src/utils/aiClient');
    const caps = ai.providerCapabilities();

    expect(caps.open_source[0]).toMatchObject({
      label: 'qwen3.5-397b-primary',
      model: 'custom-open-model',
      configured: true,
    });
    expect(ai.hasAnyProvider()).toBe(true);
  });

  test('free lanes remain policy-gated for non-public data', () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key-123';
    const ai = require('../src/utils/aiClient');
    const caps = ai.providerCapabilities();

    expect(caps.free_open_weight_enabled).toBe(false);
    expect(caps.open_weight).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'openrouter-free-router', active_for_public: false }),
      expect.objectContaining({ label: 'gpt-oss-120b-openrouter-free', active_for_public: false }),
    ]));
    expect(ai.hasAnyProvider({ dataClassification: 'internal' })).toBe(true);

    process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT = 'true';
    const enabledCaps = ai.providerCapabilities();

    expect(enabledCaps.free_open_weight_enabled).toBe(true);
    expect(enabledCaps.open_weight).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'openrouter-free-router', active_for_public: true, free: true }),
      expect.objectContaining({ label: 'apodex-1.1-mini-openrouter-free', active_for_public: true, free: true }),
      expect.objectContaining({ label: 'gpt-oss-120b-openrouter-free', active_for_public: true, free: true }),
    ]));
    expect(ai.hasAnyProvider({ dataClassification: 'public' })).toBe(true);
    expect(ai.hasAnyProvider({ dataClassification: 'internal' })).toBe(true);
  });

  test('free publication routing can explicitly select the dynamic free router', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key-123';
    process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT = 'true';

    jest.doMock('openai', () => class MockOpenAI {
      constructor(options) {
        this.options = options;
        this.chat = {
          completions: {
            create: jest.fn(async () => ({
              choices: [{ message: { content: '{"ok":true}', tool_calls: [] } }],
            })),
          },
        };
      }
    });

    const ai = require('../src/utils/aiClient');
    const response = await ai.createMessage({
      dataClassification: 'public',
      providerHints: ['openrouter-free-router'],
      system: 'Return JSON.',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 100,
    });

    expect(response._provider).toBe('openrouter-free-router');
    expect(response._free_provider).toBe(true);
  });

  test('structured research output is forwarded only to capable OpenRouter lanes', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key-123';
    process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT = 'true';

    let lastRequest;
    jest.doMock('openai', () => class MockOpenAI {
      constructor(options) {
        this.options = options;
        this.chat = {
          completions: {
            create: jest.fn(async request => {
              lastRequest = request;
              return { choices: [{ message: { content: '{"results":[]}' } }] };
            }),
          },
        };
      }
    });

    const ai = require('../src/utils/aiClient');
    await ai.createMessage({
      dataClassification: 'public',
      providerHints: ['openrouter-free-router'],
      system: 'Return structured JSON.',
      responseFormat: {
        type: 'json_schema',
        json_schema: {
          name: 'test_schema',
          strict: true,
          schema: {
            type: 'object',
            properties: { results: { type: 'array', items: { type: 'string' } } },
            required: ['results'],
            additionalProperties: false,
          },
        },
      },
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 100,
    });

    expect(lastRequest.response_format).toEqual(expect.objectContaining({
      type: 'json_schema',
    }));
  });

  test('rotates automatically from a stale model id after a provider 404', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key-123';
    process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT = 'true';
    process.env.OPENROUTER_GPT_OSS_120B_FREE_MODEL = 'openai/retired-model:free';

    const seen = [];
    jest.doMock('openai', () => class MockOpenAI {
      constructor() {
        this.chat = {
          completions: {
            create: jest.fn(async request => {
              seen.push(request.model);
              if (request.model === 'openai/retired-model:free') {
                const error = new Error('model not found');
                error.status = 404;
                throw error;
              }
              return { choices: [{ message: { content: '{"ok":true}', tool_calls: [] } }] };
            }),
          },
        };
      }
    });

    const ai = require('../src/utils/aiClient');
    const response = await ai.createMessage({
      dataClassification: 'public',
      allowFreeProviders: true,
      preferFreeProviders: true,
      providerHints: ['gpt-oss-120b-openrouter-free'],
      system: 'Return JSON.',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 100,
    });

    expect(response._provider).toBe('gpt-oss-120b-openrouter-free');
    expect(seen).toEqual([
      'openai/retired-model:free',
      'openai/gpt-oss-120b:free',
    ]);
    expect(ai.resolvedOpenWeightModel(
      ai.providerCapabilities().open_weight.find(p => p.label === 'gpt-oss-120b-openrouter-free')
    )).toBe('openai/gpt-oss-120b:free');
  });


  test('does not immediately fail when all providers are in a short retryable cooldown', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key-123';
    process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT = 'true';
    process.env.INTEL_PROVIDER_WAIT_MAX_MS = '5000';

    jest.useFakeTimers();
    jest.doMock('openai', () => class MockOpenAI {
      constructor() {
        this.chat = {
          completions: {
            create: jest.fn(async () => ({
              choices: [{ message: { content: '{"ok":true}', tool_calls: [] } }],
            })),
          },
        };
      }
    });

    const ai = require('../src/utils/aiClient');
    const response = await ai.createMessage({
      dataClassification: 'public',
      allowFreeProviders: true,
      preferFreeProviders: true,
      providerHints: ['gpt-oss-20b-openrouter-free'],
      system: 'Return JSON.',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 100,
    });

    expect(response._free_provider).toBe(true);
    jest.useRealTimers();
  });

  test('prefers free publication lanes when explicitly requested', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key-123';
    process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT = 'true';

    jest.doMock('openai', () => class MockOpenAI {
      constructor() {
        this.chat = {
          completions: {
            create: jest.fn(async () => ({
              choices: [{ message: { content: '{"ok":true}', tool_calls: [] } }],
            })),
          },
        };
      }
    });

    const ai = require('../src/utils/aiClient');
    const response = await ai.createMessage({
      dataClassification: 'public',
      allowFreeProviders: true,
      preferFreeProviders: true,
      providerHints: ['gpt-oss-20b-openrouter-free'],
      system: 'Return JSON.',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 100,
    });

    expect(response._provider).toBe('gpt-oss-20b-openrouter-free');
    expect(response._free_provider).toBe(true);
  });

  test('provider hints are advisory and do not remove the global failover mesh', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key-123';
    process.env.NVIDIA_API_KEY = 'nvidia-test-key-123';

    jest.doMock('openai', () => class MockOpenAI {
      constructor(options) {
        this.options = options;
        this.chat = {
          completions: {
            create: jest.fn(async () => ({
              choices: [{ message: { content: '{"ok":true}', tool_calls: [] } }],
            })),
          },
        };
      }
    });

    const ai = require('../src/utils/aiClient');
    const response = await ai.createMessage({
      providerHints: ['deepseek-v3.2-openrouter'],
      system: 'Return JSON.',
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 100,
    });

    expect(response._provider).toBe('deepseek-v3.2-openrouter');
    expect(response._provider_kind).toBe('open-weight');
  });
});
