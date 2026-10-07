'use strict';

describe('intelligence provider mesh', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.CEREBRAS_API_KEY;\n    delete process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT;\n    delete process.env.INTEL_ALLOW_FREE_CONFIDENTIAL;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    for (let i = 1; i <= 5; i += 1) {
      delete process.env[`OPEN_SOURCE_API_KEY_${i}`];
      delete process.env[`OPEN_SOURCE_BASE_URL_${i}`];
    }
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('exposes independent open-weight vendor lanes when configured', () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key-123';
    process.env.NVIDIA_API_KEY = 'nvidia-test-key-123';
    process.env.CEREBRAS_API_KEY = 'cerebras-test-key-123';

    const ai = require('../src/utils/aiClient');
    const caps = ai.providerCapabilities();

    expect(caps.open_weight).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'qwen3.5-397b-openrouter', configured: true }),
      expect.objectContaining({ label: 'deepseek-v3.2-openrouter', configured: true }),
      expect.objectContaining({ label: 'nemotron3-super-nvidia', configured: true }),
      expect.objectContaining({ label: 'nemotron3-ultra-550b-nvidia', configured: true }),
      expect.objectContaining({ label: 'nemotron3.5-lightning-30b-nvidia', configured: true }),
      expect.objectContaining({ label: 'gpt-oss-120b-cerebras', configured: true }),\n      expect.objectContaining({ label: 'deepseek-v4-flash-openrouter', configured: true }),\n      expect.objectContaining({ label: 'minimax-m3-openrouter-free', configured: true, free: true }),\n      expect.objectContaining({ label: 'inkling-openrouter-free', configured: true, free: true }),\n      expect.objectContaining({ label: 'laguna-s21-openrouter-free', configured: true, free: true }),\n      expect.objectContaining({ label: 'gemma4-26b-openrouter-free', configured: true, free: true }),\n      expect.objectContaining({ label: 'nemotron3-nano-omni-openrouter-free', configured: true, free: true }),
    ]));
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

  test('free lanes remain policy-gated for non-public data', async () => {\n    process.env.OPENROUTER_API_KEY = 'openrouter-test-key-123';\n    const ai = require('../src/utils/aiClient');\n    const caps = ai.providerCapabilities();\n    expect(caps.free_open_weight_enabled).toBe(false);\n    expect(ai.hasAnyProvider({ dataClassification: 'internal' })).toBe(false);\n    process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT = 'true';\n    expect(ai.hasAnyProvider({ dataClassification: 'public' })).toBe(true);\n    expect(ai.hasAnyProvider({ dataClassification: 'internal' })).toBe(false);\n  });\n\n  test('free lanes can be explicitly enabled for public publication evidence', async () => {\n    process.env.OPENROUTER_API_KEY = 'openrouter-test-key-123';\n    process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT = 'true';\n    jest.doMock('openai', () => class MockOpenAI {\n      constructor(options) {\n        this.options = options;\n        this.chat = { completions: { create: jest.fn(async () => ({\n          choices: [{ message: { content: '{"ok":true}', tool_calls: [] } }],\n        })) };\n      }\n    });\n    const ai = require('../src/utils/aiClient');\n    const response = await ai.createMessage({\n      dataClassification: 'public',\n      providerHints: ['minimax-m3-openrouter-free'],\n      system: 'Return JSON.',\n      messages: [{ role: 'user', content: 'test' }],\n      max_tokens: 100,\n    });\n    expect(response._provider).toBe('minimax-m3-openrouter-free');\n    expect(response._free_provider).toBe(true);\n  });\n\n  test('provider hints are advisory and do not remove the global failover mesh', async () => {
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
