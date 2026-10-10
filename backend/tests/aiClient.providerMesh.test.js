'use strict';

describe('intelligence provider mesh', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.REDIS_URL;
    delete process.env.INTEL_PERSIST_PROVIDER_CIRCUITS;
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
    for(let i=1;i<=100;i+=1) delete process.env['OPENAI_API_KEY_'+i];
    delete process.env.GROQ_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.GOOGLE_AI_API_KEY;
    delete process.env.GEMINI_PROVIDER_KEY;
    for(let i=1;i<=100;i+=1) delete process.env['GOOGLE_AI_API_KEY_'+i];
    delete process.env.GOOGLE_GEMINI_MODEL;
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

  test('hydrates persisted provider-account cooldowns before admitting work', async () => {
    process.env.REDIS_URL = 'redis://mock';
    process.env.INTEL_PERSIST_PROVIDER_CIRCUITS = 'true';
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key-123';
    process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT = 'true';

    const until = Date.now() + 60 * 60 * 1000;
    const blocked = new Set(['openrouter-paid:gpt-oss-120b-openrouter', 'openrouter-free:gpt-oss-120b-openrouter-free']);
    const redis = {
      mget: jest.fn(async keys => keys.map(key => {
        const group = decodeURIComponent(String(key).replace('sonalit:intelligence:ai:circuit:v3:', ''));
        return blocked.has(group) ? String(until) : '0';
      })),
      scan: jest.fn(async () => ['0', []]),
      get: jest.fn(async () => null),
      set: jest.fn(async () => 'OK'),
      del: jest.fn(async () => 1),
    };

    jest.doMock('../src/config/redis', () => ({ getRedis: () => redis }));
    const create = jest.fn(async () => ({
      choices: [{ message: { content: '{"ok":true}', tool_calls: [] } }],
    }));
    jest.doMock('openai', () => class MockOpenAI {
      constructor(){ this.chat={completions:{create}}; }
    });

    const ai = require('../src/utils/aiClient');
    await ai.hydrateFabricState();

    const policy = { dataClassification:'public', allowFreeProviders:true, preferFreeProviders:true };
    expect(ai.hasReadyProvider(policy)).toBe(true);
    await ai.createMessage({
      ...policy,
      providerHints:['gpt-oss-120b-openrouter-free'],
      system:'Return JSON.',
      messages:[{role:'user',content:'must not call a cooled account'}],
      max_tokens:100,
    });
    expect(create).toHaveBeenCalledTimes(1);

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

  test('rotates across the OpenAI key pool when a member is rate-limited', async () => {
    process.env.OPENAI_API_KEY_1 = 'key-one-test-token';
    process.env.OPENAI_API_KEY_2 = 'key-two-test-token';
    process.env.OPENAI_API_KEY_3 = 'key-three-test-token';

    const seen=[];
    jest.doMock('openai', () => class MockOpenAI {
      constructor(options = {}) {
        this.apiKey=options.apiKey;
        this.chat={completions:{create:jest.fn(async () => {
          const index=this.apiKey.includes('one')?1:this.apiKey.includes('two')?2:3;
          seen.push(index);
          if(index===1){ const error=new Error('Too Many Requests'); error.status=429; throw error; }
          return {choices:[{message:{content:'{"ok":true}',tool_calls:[]}}]};
        })}};
      }
    });

    const ai=require('../src/utils/aiClient');
    expect(ai.providerCapabilities().openai_key_pool_size).toBe(3);
    const response=await ai.createMessage({
      dataClassification:'public',
      providerHints:['openai-direct'],
      system:'Return JSON.',
      messages:[{role:'user',content:'test'}],
      max_tokens:100,
    });
    expect(response._provider).toBe('openai-direct');
    expect(seen).toEqual([1,2]);
  });

  test('routes public publication synthesis through the independent Gemini lane', async () => {
    process.env.GOOGLE_AI_API_KEY = 'google-test-key-123';

    const calls = [];
    jest.doMock('openai', () => class MockOpenAI {
      constructor(options = {}) {
        this.baseURL = options.baseURL || 'openai';
        this.chat = {
          completions: {
            create: jest.fn(async request => {
              calls.push({baseURL:this.baseURL,model:request.model,request});
              if (this.baseURL.includes('generativelanguage.googleapis.com')) {
                return { choices: [{ message: { content: '{"ok":true}', tool_calls: [] } }] };
              }
              throw new Error('unexpected provider');
            }),
          },
        };
      }
    });

    const ai = require('../src/utils/aiClient');
    const caps = ai.providerCapabilities();

    expect(caps.google_gemini).toMatchObject({
      label:'google-gemini-3.8-flash',
      configured:true,
      active_for_public:true,
      free:true,
    });

    const response = await ai.createMessage({
      dataClassification:'public',
      allowFreeProviders:true,
      preferFreeProviders:true,
      providerHints:['google-gemini-3.8-flash'],
      system:'Return JSON.',
      responseFormat:{type:'json_object'},
      messages:[{role:'user',content:'test'}],
      max_tokens:100,
    });

    expect(response._provider).toBe('google-gemini-3.8-flash');
    expect(response._free_provider).toBe(true);
    expect(calls[0].model).toBe('gemini-3.8-flash');
    expect(calls[0].baseURL).toContain('generativelanguage.googleapis.com');
  });

  test('rotates across the Gemini key pool when a member is rate-limited', async () => {
    process.env.GOOGLE_AI_API_KEY_1 = 'google-one-test-token';
    process.env.GOOGLE_AI_API_KEY_2 = 'google-two-test-token';

    const seen = [];
    jest.doMock('openai', () => class MockOpenAI {
      constructor(options = {}) {
        this.apiKey = options.apiKey;
        this.baseURL = options.baseURL || 'openai';
        this.chat = {
          completions: {
            create: jest.fn(async () => {
              const index = this.apiKey.includes('one') ? 1 : 2;
              seen.push(index);
              if (index === 1) {
                const error = new Error('Too Many Requests');
                error.status = 429;
                throw error;
              }
              return { choices: [{ message: { content: '{"ok":true}', tool_calls: [] } }] };
            }),
          },
        };
      }
    });

    const ai = require('../src/utils/aiClient');
    expect(ai.providerCapabilities().google_gemini.key_pool_size).toBe(2);
    const response = await ai.createMessage({
      dataClassification:'public',
      allowFreeProviders:true,
      preferFreeProviders:true,
      providerHints:['google-gemini-3.8-flash'],
      system:'Return JSON.',
      messages:[{role:'user',content:'test'}],
      max_tokens:100,
    });

    expect(response._provider).toBe('google-gemini-3.8-flash');
    expect(seen).toEqual([1,2]);
  });


  test('a shared Redis Gemini circuit cannot suppress healthy Gemini key-pool members', async () => {
    process.env.GOOGLE_AI_API_KEY_1 = 'google-one-test-token';
    process.env.GOOGLE_AI_API_KEY_2 = 'google-two-test-token';
    process.env.REDIS_URL = 'redis://mock';
    process.env.INTEL_PERSIST_PROVIDER_CIRCUITS = 'true';

    const until = Date.now() + 60 * 60 * 1000;
    const redis = {
      mget: jest.fn(async keys => keys.map(key => {
        const group = decodeURIComponent(String(key).replace('sonalit:intelligence:ai:circuit:v3:', ''));
        return group === 'google-gemini' ? String(until) : '0';
      })),
      set: jest.fn(async () => 'OK'),
      del: jest.fn(async () => 1),
    };

    jest.doMock('../src/config/redis', () => ({ getRedis: () => redis }));
    jest.doMock('openai', () => class MockOpenAI {
      constructor(options = {}) {
        this.apiKey = options.apiKey;
        this.baseURL = options.baseURL || 'openai';
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
    await ai.hydrateFabricState();

    const policy = {
      dataClassification:'public',
      allowFreeProviders:true,
      preferFreeProviders:true,
      providerHints:['google-gemini-3.8-flash'],
    };
    expect(ai.hasReadyProvider(policy)).toBe(true);
    const response = await ai.createMessage({
      ...policy,
      system:'Return JSON.',
      messages:[{role:'user',content:'Gemini must remain usable when one persisted shared circuit is stale.'}],
      max_tokens:100,
    });
    expect(response._provider).toBe('google-gemini-3.8-flash');
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


  test('one OpenRouter free-lane 429 does not circuit-break sibling free models', async () => {
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key-123';
    process.env.GROQ_API_KEY = 'groq-test-key-123';
    process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT = 'true';

    const calls = [];
    jest.doMock('openai', () => class MockOpenAI {
      constructor(options = {}) {
        this.baseURL = options.baseURL || 'openai';
        this.chat = {
          completions: {
            create: jest.fn(async request => {
              calls.push({ baseURL: this.baseURL, model: request.model });
              if (this.baseURL.includes('openrouter.ai') && request.model === 'openai/gpt-oss-120b:free') {
                const error = new Error('Too Many Requests');
                error.status = 429;
                throw error;
              }
              if (this.baseURL.includes('openrouter.ai')) {
                return { choices: [{ message: { content: '{"ok":true}', tool_calls: [] } }] };
              }
              if (this.baseURL.includes('api.groq.com')) {
                return { choices: [{ message: { content: '{"ok":true}', tool_calls: [] } }] };
              }
              throw new Error('unexpected provider');
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

    expect(response._free_provider).toBe(true);
    expect(response._provider).not.toBe('gpt-oss-120b-openrouter-free');
    expect(response._provider).toMatch(/openrouter-free/);
    expect(calls.filter(c => c.baseURL.includes('openrouter.ai'))).toHaveLength(2);
    expect(calls.filter(c => c.baseURL.includes('api.groq.com'))).toHaveLength(0);
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


  test('half-open probes the hinted public OpenRouter rescue lane after all ordinary providers fail',async()=>{
    process.env.OPENROUTER_API_KEY='openrouter-test-key-123';
    process.env.OPENROUTER_FREE_ROUTER_MODEL='openrouter/free';
    process.env.GOOGLE_AI_API_KEY='google-test-key-123';
    process.env.GOOGLE_GEMINI_MODEL='gemini-test-model';
    process.env.OPENAI_API_KEY='openai-test-key-123';
    process.env.OPENAI_MODEL='openai-test-model';
    process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT='true';
    process.env.REDIS_URL='redis://mock';
    process.env.INTEL_PERSIST_PROVIDER_CIRCUITS='true';

    const until=Date.now()+6*60*60*1000;
    const prefix='sonalit:intelligence:ai:circuit:v3:';
    const redis={
      mget:jest.fn(async keys=>keys.map(key=>{
        const group=decodeURIComponent(String(key).replace(prefix,''));
        return group.startsWith('openrouter-')?String(until):'0';
      })),
      scan:jest.fn(async()=>['0',[]]),
      get:jest.fn(async()=>null),
      set:jest.fn(async()=> 'OK'),
      del:jest.fn(async()=>1),
    };
    const calls=[];
    const errorWithStatus=(message,status)=>Object.assign(new Error(message),{status});
    const mockOpenAI = class MockOpenAI{
      constructor(options={}){
        this.apiKey=options.apiKey;
        this.baseURL=options.baseURL||'openai';
        this.chat={completions:{create:jest.fn(async request=>{
          const call={apiKey:this.apiKey,baseURL:this.baseURL,model:request.model};
          calls.push(call);
          if(this.apiKey==='google-test-key-123'){
            if(request.model!=='gemini-test-model')throw new Error('Unexpected Gemini model: '+JSON.stringify(call));
            throw errorWithStatus('Gemini rate limit',429);
          }
          if(this.apiKey==='openai-test-key-123'){
            if(request.model!=='openai-test-model')throw new Error('Unexpected OpenAI model: '+JSON.stringify(call));
            throw errorWithStatus('OpenAI insufficient credit balance',402);
          }
          if(this.apiKey==='openrouter-test-key-123'&&request.model==='openrouter/free'){
            return {choices:[{message:{content:'{"results":[]}',tool_calls:[]}}]};
          }
          throw new Error('Unexpected provider credential/model in half-open test: '+JSON.stringify(call));
        })}};
      }
    };

    let ai;
    // Register both dependency mocks inside Jest's isolated registry. Doing
    // this outside isolateModules can leave the provider graph bound to a
    // prior test's provider clients even after resetModules().
    jest.isolateModules(()=>{
      jest.doMock('../src/config/redis',()=>({getRedis:()=>redis}));
      jest.doMock('openai',()=>mockOpenAI);
      ai=require('../src/utils/aiClient');
    });
    const response=await ai.createMessage({
      dataClassification:'public',
      allowFreeProviders:true,
      preferFreeProviders:true,
      providerHints:['google-gemini-3.8-flash','openrouter-free-router'],
      system:'Return structured JSON.',
      messages:[{role:'user',content:'Use only supplied public evidence and return JSON.'}],
      max_tokens:100,
    });

    if(response._provider!=='openrouter-free-router'){
      throw new Error('Expected the half-open OpenRouter rescue lane; got '+response._provider+'; calls='+JSON.stringify(calls));
    }
    expect(calls.length).toBeGreaterThan(0);
    expect(response._free_provider).toBe(true);
    expect(calls.some(c=>c.model==='gemini-test-model'&&c.apiKey==='google-test-key-123')).toBe(true);
    expect(calls.some(c=>c.model==='openai-test-model'&&c.apiKey==='openai-test-key-123')).toBe(true);
    expect(calls.filter(c=>c.apiKey==='openrouter-test-key-123')).toEqual([
      expect.objectContaining({model:'openrouter/free'})
    ]);
  });
  test('half-open rescue does not discard a stale cooling snapshot after a concurrent circuit clear',()=>{
    const fs=require('fs');
    const path=require('path');
    const source=fs.readFileSync(path.join(__dirname,'../src/utils/aiClient.js'),'utf8');
    const start=source.indexOf('function halfOpenRouterBlockReason');
    const end=source.indexOf('\nfunction logHalfOpenProbeSkipped',start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const gate=source.slice(start,end);
    expect(gate).toContain('coolingAtStart.has(provider.name)');
    expect(gate).toContain('attempted.has(provider.name)');
    // The circuit may be cleared by another concurrent request after this
    // request snapshots candidates; current cooling state must not suppress
    // this request's sole, policy-constrained attempt.
    expect(gate).not.toContain('providerCooling(provider)');
    expect(source).toContain('AI provider half-open recovery probe skipped: reason=');
  });


  test('OpenRouter 429 diagnostics expose quota metadata without logging raw provider text or credentials',()=>{
    const {openRouterRateLimitDiagnostic}=require('../src/utils/aiClient');
    const diagnostic=openRouterRateLimitDiagnostic({
      status:429,
      headers:{
        'retry-after':'60',
        'x-ratelimit-remaining':'0',
        'x-ratelimit-limit':'50',
        'x-ratelimit-reset-requests':'1781049600'
      },
      error:{
        error:{
          code:429,
          type:'rate_limit_exceeded',
          message:'Private request text and sk-or-secret-must-never-be-logged',
          metadata:{error_type:'rate_limit_exceeded',provider_code:'429'}
        }
      }
    });
    expect(diagnostic).toContain('error_type=rate_limit_exceeded');
    expect(diagnostic).toContain('provider_code=429');
    expect(diagnostic).toContain('retry_after_ms=60000');
    expect(diagnostic).toContain('rate_limit_remaining=0');
    expect(diagnostic).toContain('rate_limit_limit=50');
    expect(diagnostic).toContain('rate_limit_reset=1781049600');
    expect(diagnostic).not.toContain('sk-or-secret');
    expect(diagnostic).not.toContain('Private request text');
  });

  test('OpenRouter reset timestamps in epoch milliseconds are not misread as seconds',()=>{
    const {openRouterRateLimitDiagnostic}=require('../src/utils/aiClient');
    const resetAt=Date.now()+15*60*1000;
    const diagnostic=openRouterRateLimitDiagnostic({
      status:429,
      headers:{'x-ratelimit-reset-requests':String(resetAt)}
    });
    const match=diagnostic.match(/retry_after_ms=(\d+)/);
    expect(match).not.toBeNull();
    const retryAfterMs=Number(match[1]);
    expect(retryAfterMs).toBeGreaterThan(14*60*1000);
    expect(retryAfterMs).toBeLessThanOrEqual(15*60*1000);
    expect(diagnostic).toContain('rate_limit_reset='+String(resetAt));
  });


  test('a fresh half-open Retry-After replaces a stale persisted OpenRouter circuit deadline',async()=>{
    process.env.OPENROUTER_API_KEY='openrouter-test-key-123';
    process.env.OPENROUTER_FREE_ROUTER_MODEL='openrouter/free';
    process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT='true';
    process.env.REDIS_URL='redis://mock';
    process.env.INTEL_PERSIST_PROVIDER_CIRCUITS='true';

    const staleUntil=Date.now()+6*60*60*1000;
    const prefix='sonalit:intelligence:ai:circuit:v3:';
    const redis={
      mget:jest.fn(async keys=>keys.map(key=>{
        const group=decodeURIComponent(String(key).replace(prefix,''));
        return group.startsWith('openrouter-')?String(staleUntil):'0';
      })),
      scan:jest.fn(async()=>['0',[]]),
      get:jest.fn(async()=>null),
      set:jest.fn(async()=> 'OK'),
      del:jest.fn(async()=>1),
    };
    const calls=[];
    const mockOpenAI=class MockOpenAI{
      constructor(options={}){
        this.apiKey=options.apiKey;
        this.baseURL=options.baseURL||'openai';
        this.chat={completions:{create:jest.fn(async request=>{
          calls.push({apiKey:this.apiKey,baseURL:this.baseURL,model:request.model});
          const error=Object.assign(new Error('OpenRouter free-router rate limit'),{
            status:429,
            headers:{
              'retry-after':'360',
              'x-ratelimit-remaining':'0',
              'x-ratelimit-limit':'50',
              'x-ratelimit-reset-requests':String(Date.now()+6*60*1000)
            }
          });
          throw error;
        })}};
      }
    };

    let ai;
    jest.isolateModules(()=>{
      jest.doMock('../src/config/redis',()=>({getRedis:()=>redis}));
      jest.doMock('openai',()=>mockOpenAI);
      ai=require('../src/utils/aiClient');
    });

    let caught;
    try{
      await ai.createMessage({
        dataClassification:'public',
        allowFreeProviders:true,
        preferFreeProviders:true,
        providerHints:['openrouter-free-router'],
        system:'Return structured JSON.',
        messages:[{role:'user',content:'Use only supplied public evidence and return JSON.'}],
        max_tokens:100,
      });
    }catch(error){
      caught=error;
    }

    expect(caught).toBeDefined();
    expect(caught.status).toBe(429);
    expect(calls).toEqual([expect.objectContaining({model:'openrouter/free'})]);

    const laneKey=prefix+encodeURIComponent('openrouter-free:openrouter-free-router');
    const writes=redis.set.mock.calls.filter(call=>call[0]===laneKey);
    expect(writes.length).toBeGreaterThan(0);
    const refreshedUntil=Number(writes[writes.length-1][1]);
    expect(refreshedUntil).toBeLessThan(staleUntil);
    expect(refreshedUntil-Date.now()).toBeGreaterThan(5*60*1000);
    expect(refreshedUntil-Date.now()).toBeLessThanOrEqual(6*60*1000);
  });

  test('quarantines a fully failed OpenAI key pool and routes subsequent public work to the open-weight mesh', async () => {
    process.env.OPENAI_API_KEY_1 = 'key-one-invalid-token';
    process.env.OPENAI_API_KEY_2 = 'key-two-invalid-token';
    process.env.OPENROUTER_API_KEY = 'openrouter-test-key-123';
    process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT = 'true';

    const calls=[];
    jest.doMock('openai', () => class MockOpenAI {
      constructor(options = {}) {
        this.apiKey=options.apiKey;
        this.baseURL=options.baseURL || 'openai';
        this.chat={completions:{create:jest.fn(async request=>{
          calls.push({baseURL:this.baseURL,apiKey:this.apiKey,model:request.model});
          if(this.baseURL==='openai'){
            const error=new Error('Invalid API key');
            error.status=401;
            throw error;
          }
          if(this.baseURL.includes('openrouter.ai')){
            return {choices:[{message:{content:'{"ok":true}',tool_calls:[]}}]};
          }
          throw new Error('unexpected provider '+this.baseURL);
        })}};
      }
    });

    const ai=require('../src/utils/aiClient');
    const policy={
      dataClassification:'public',
      allowFreeProviders:true,
      preferFreeProviders:true,
      providerHints:['openai-direct'],
      system:'Return JSON.',
      messages:[{role:'user',content:'Use a healthy public open-weight lane after credential failures.'}],
      max_tokens:100,
    };

    // Simulate several publication agents entering the same exhausted pool at once.
    const concurrent=await Promise.all(
      Array.from({length:4},()=>ai.createMessage(policy))
    );
    expect(concurrent).toHaveLength(4);
    expect(concurrent.every(response=>response._provider==='openrouter-free-router')).toBe(true);
    // Pool serialization + provider cooldown must stop queued agents from
    // replaying all credentials after the first request has quarantined them.
    expect(calls.filter(call=>call.baseURL==='openai')).toHaveLength(2);

    const capabilities=ai.providerCapabilities();
    expect(capabilities.openai_ready_key_pool_size).toBe(0);
    expect(capabilities.openai_cooling_down).toBe(true);
    expect(capabilities.openai_retry_in_ms).toBeGreaterThan(0);

    const subsequent=await ai.createMessage(policy);
    expect(subsequent._provider).toBe('openrouter-free-router');
    expect(calls.filter(call=>call.baseURL==='openai')).toHaveLength(2);
    expect(calls.filter(call=>call.baseURL.includes('openrouter.ai')).length).toBeGreaterThanOrEqual(5);
  });


  test('persists OpenAI account-credit exhaustion as a long-lived circuit',async()=>{
    const apiKey='openai-key-persistence-test-12345';
    process.env.OPENAI_API_KEY_1=apiKey;
    process.env.REDIS_URL='redis://mock';
    process.env.INTEL_PERSIST_PROVIDER_CIRCUITS='true';

    const values=new Map();
    const redis={
      mget:jest.fn(async keys=>keys.map(key=>values.has(key)?values.get(key):null)),
      scan:jest.fn(async()=>['0',[]]),
      get:jest.fn(async()=>null),
      set:jest.fn(async(key,value)=>{values.set(String(key),String(value));return 'OK';}),
      del:jest.fn(async key=>{values.delete(String(key));return 1;}),
    };
    const calls=[];
    const mockOpenAI=class MockOpenAI{
      constructor(options={}){
        this.apiKey=options.apiKey;
        this.baseURL=options.baseURL||'openai';
        this.chat={completions:{create:jest.fn(async request=>{
          calls.push({apiKey:this.apiKey,baseURL:this.baseURL,model:request.model});
          throw Object.assign(new Error('You have no credits remaining'),{status:429});
        })}};
      }
    };
    let ai;
    jest.isolateModules(()=>{
      jest.doMock('../src/config/redis',()=>({getRedis:()=>redis}));
      jest.doMock('openai',()=>mockOpenAI);
      ai=require('../src/utils/aiClient');
    });

    let caught;
    try{
      await ai.createMessage({
        dataClassification:'internal',
        providerHints:['openai-direct'],
        system:'Return concise text.',
        messages:[{role:'user',content:'Test provider account exhaustion handling.'}],
        max_tokens:50,
      });
    }catch(error){caught=error;}

    expect(caught).toBeDefined();
    expect(caught.status).toBe(429);
    expect(calls).toHaveLength(1);

    const circuitKey='sonalit:intelligence:ai:circuit:v3:openai';
    expect(values.has(circuitKey)).toBe(true);
    const circuitUntil=Number(values.get(circuitKey));
    expect(circuitUntil-Date.now()).toBeGreaterThan(5*60*60*1000);
    expect(circuitUntil-Date.now()).toBeLessThanOrEqual(6*60*60*1000);

    const keyStateEntry=[...values.entries()].find(([key])=>key.startsWith('sonalit:intelligence:ai:key-state:v1:openai:'));
    expect(keyStateEntry).toBeDefined();
    expect(keyStateEntry[0]).not.toContain(apiKey);
    const keyState=JSON.parse(keyStateEntry[1]);
    expect(keyState.downUntil-Date.now()).toBeGreaterThan(5*60*60*1000);
    expect(keyState.failureCount).toBeGreaterThan(0);

    const capabilities=ai.providerCapabilities();
    expect(capabilities.openai_cooling_down).toBe(true);
    expect(capabilities.openai_retry_in_ms).toBeGreaterThan(5*60*60*1000);
  });

  test('restores Gemini per-key cooldown after a module restart',async()=>{
    const apiKey='gemini-key-persistence-test-12345';
    process.env.GOOGLE_AI_API_KEY_1=apiKey;
    process.env.REDIS_URL='redis://mock';
    process.env.INTEL_PERSIST_PROVIDER_CIRCUITS='true';
    process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT='true';

    const values=new Map();
    const redis={
      mget:jest.fn(async keys=>keys.map(key=>values.has(key)?values.get(key):null)),
      scan:jest.fn(async()=>['0',[]]),
      get:jest.fn(async()=>null),
      set:jest.fn(async(key,value)=>{values.set(String(key),String(value));return 'OK';}),
      del:jest.fn(async key=>{values.delete(String(key));return 1;}),
    };
    const calls=[];
    const mockOpenAI=class MockOpenAI{
      constructor(options={}){
        this.apiKey=options.apiKey;
        this.baseURL=options.baseURL||'openai';
        this.chat={completions:{create:jest.fn(async request=>{
          calls.push({apiKey:this.apiKey,baseURL:this.baseURL,model:request.model});
          throw Object.assign(new Error('You have no credits remaining'),{status:429});
        })}};
      }
    };
    const loadAi=()=>{
      let loaded;
      jest.isolateModules(()=>{
        jest.doMock('../src/config/redis',()=>({getRedis:()=>redis}));
        jest.doMock('openai',()=>mockOpenAI);
        loaded=require('../src/utils/aiClient');
      });
      return loaded;
    };

    const firstAi=loadAi();
    let firstError;
    try{
      await firstAi.createMessage({
        dataClassification:'public',
        allowFreeProviders:true,
        preferFreeProviders:true,
        providerHints:['google-gemini-3.8-flash'],
        system:'Return JSON only.',
        messages:[{role:'user',content:'Check per-key cooldown persistence.'}],
        max_tokens:50,
      });
    }catch(error){firstError=error;}
    expect(firstError).toBeDefined();
    expect(calls).toHaveLength(1);

    const keyStateEntry=[...values.entries()].find(([key])=>key.startsWith('sonalit:intelligence:ai:key-state:v1:google-gemini:'));
    expect(keyStateEntry).toBeDefined();
    expect(keyStateEntry[0]).not.toContain(apiKey);
    expect(JSON.parse(keyStateEntry[1]).downUntil-Date.now()).toBeGreaterThan(5*60*60*1000);

    const secondAi=loadAi();
    await expect(secondAi.createMessage({
      dataClassification:'public',
      allowFreeProviders:true,
      preferFreeProviders:true,
      providerHints:['google-gemini-3.8-flash'],
      system:'Return JSON only.',
      messages:[{role:'user',content:'The persisted cooldown should block another request.'}],
      max_tokens:50,
    })).rejects.toThrow('all configured providers are cooling down');
    expect(calls).toHaveLength(1);
    expect(secondAi.providerCapabilities().google_gemini.ready_key_pool_size).toBe(0);
    expect(secondAi.providerCapabilities().google_gemini.cooling_down).toBe(true);
  });


  test('reports configured Groq models and their circuit posture instead of configuration-only readiness',()=>{
    process.env.GROQ_API_KEY='groq-test-key-123';
    const ai=require('../src/utils/aiClient');
    const caps=ai.providerCapabilities();
    expect(caps.gpt_oss_120b).toBe(true);
    expect(caps.groq_lanes).toEqual(expect.arrayContaining([
      expect.objectContaining({label:'gpt-oss-120b-groq',configured:true,cooling_down:expect.any(Boolean),retry_in_ms:expect.any(Number)}),
      expect.objectContaining({label:'gpt-oss-20b-groq',configured:true,cooling_down:expect.any(Boolean),retry_in_ms:expect.any(Number)})
    ]));
  });

});
