'use strict';

/**
 * Sonalit AI provider fabric.
 *
 * Open-weight first. Every lane is independently circuit-broken and every
 * provider is capability/policy tagged so the newsroom can distinguish:
 *   - frontier open-weight reasoning
 *   - high-throughput rescue models
 *   - free/open research lanes
 *   - closed-model fallbacks
 *
 * IMPORTANT: free endpoints are opt-in. Several free provider terms explicitly
 * warn that prompts/outputs may be logged or used for improvement. Production
 * publication data therefore remains blocked from free lanes unless the caller
 * explicitly classifies the request as public and INTEL_ALLOW_FREE_OPEN_WEIGHT
 * is enabled.
 */
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const logger = require('./logger');

const AI_REQUEST_TIMEOUT_MS = Math.max(5000, Math.min(120000, Number(process.env.AI_REQUEST_TIMEOUT_MS || 30000)));
const AI_SDK_OPTIONS = { timeout: AI_REQUEST_TIMEOUT_MS, maxRetries: 0 };

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_MODEL_2 = process.env.GROQ_MODEL_2 || 'openai/gpt-oss-20b';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-6.1-sol';
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-large-latest';

/*
 * Named open-weight lanes. Model IDs are pinned rather than "latest" aliases
 * unless a provider is intentionally configured through an environment value.
 *
 * Free lanes are explicitly marked because they are useful for resilience and
 * zero-cost research workloads, but they must never silently receive
 * confidential Sonalit data.
 */
const OPEN_WEIGHT_PROVIDERS = [
  {
    name:'qwen3.5-397b-openrouter',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_QWEN_MODEL',
    model:'qwen/qwen3.5-397b-a17b',
    qualityTier:'frontier',
    free:false,
    multimodal:false,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'deepseek-v3.2-openrouter',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_DEEPSEEK_MODEL',
    model:'deepseek/deepseek-v3.2',
    qualityTier:'frontier',
    free:false,
    multimodal:false,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'deepseek-v4-flash-openrouter',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_DEEPSEEK_V4_MODEL',
    model:'deepseek/deepseek-v4-flash',
    qualityTier:'frontier-fast',
    free:false,
    multimodal:false,
    reasoning:true,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'openrouter-free-router',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_FREE_ROUTER_MODEL',
    model:'openrouter/free',
    qualityTier:'dynamic-rescue',
    free:true,
    multimodal:true,
    reasoning:true,
    structuredOutputs:true,
    sensitiveDataBlocked:true,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'apodex-1.1-mini-openrouter-free',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_APODEX_MODEL',
    model:'apodex/apodex-1.1-mini:free',
    qualityTier:'research-forecasting',
    free:true,
    multimodal:false,
    reasoning:true,
    structuredOutputs:true,
    sensitiveDataBlocked:true,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'gpt-oss-120b-openrouter-free',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_GPT_OSS_120B_FREE_MODEL',
    model:'openai/gpt-oss-120b:free',
    fallbackModels:['nvidia/nemotron-3-super-120b-a12b:free','nvidia/nemotron-3-ultra-550b-a55b:free','google/gemma-4-31b-it:free'],
    qualityTier:'frontier-reasoning',
    free:true,
    multimodal:false,
    reasoning:true,
    structuredOutputs:true,
    sensitiveDataBlocked:true,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'gpt-oss-20b-openrouter-free',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_GPT_OSS_20B_FREE_MODEL',
    model:'openai/gpt-oss-20b:free',
    fallbackModels:['z-ai/glm-4.5-air:free','nvidia/nemotron-3.5-lightning:free'],
    qualityTier:'fast-reasoning',
    free:true,
    multimodal:false,
    reasoning:true,
    structuredOutputs:true,
    sensitiveDataBlocked:true,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'glm-4.5-air-openrouter-free',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_GLM45_AIR_FREE_MODEL',
    model:'z-ai/glm-4.5-air:free',
    fallbackModels:['openai/gpt-oss-20b:free','nvidia/nemotron-3.5-lightning:free'],
    qualityTier:'agentic-fast',
    free:true,
    multimodal:false,
    reasoning:true,
    structuredOutputs:true,
    sensitiveDataBlocked:true,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'laguna-s21-openrouter-free',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_LAGUNA_MODEL',
    model:'poolside/laguna-s-2.1:free',
    qualityTier:'agentic-fast',
    free:true,
    multimodal:false,
    reasoning:true,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'gemma4-26b-openrouter-free',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_GEMMA_MODEL',
    model:'google/gemma-4-26b-a4b-it:free',
    qualityTier:'multimodal-rescue',
    free:true,
    multimodal:true,
    reasoning:true,
    structuredOutputs:true,
    sensitiveDataBlocked:true,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'nemotron3-nano-omni-openrouter-free',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_NEMOTRON_OMNI_MODEL',
    model:'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    qualityTier:'multimodal-specialist',
    free:true,
    multimodal:true,
    reasoning:true,
    sensitiveDataBlocked:true,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'nemotron3-ultra-openrouter-free',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_NEMOTRON_ULTRA_FREE_MODEL',
    model:'nvidia/nemotron-3-ultra-550b-a55b:free',
    qualityTier:'frontier-reasoning',
    free:true,
    multimodal:false,
    reasoning:true,
    sensitiveDataBlocked:true,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'ling3.0-flash-vl-openrouter-free',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_LING30_FLASH_VL_MODEL',
    model:'inclusionai/ling-3.0-flash-vl:free',
    fallbackModels:['google/gemma-4-26b-a4b-it:free','nvidia/nemotron-3-nano-omni-30b-a3b:free'],
    qualityTier:'multimodal-frontier',
    free:true,
    multimodal:true,
    reasoning:true,
    structuredOutputs:false,
    sensitiveDataBlocked:true,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'gemma4-31b-openrouter-free',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_GEMMA31_MODEL',
    model:'google/gemma-4-31b-it:free',
    qualityTier:'multimodal-reasoning',
    free:true,
    multimodal:true,
    reasoning:true,
    structuredOutputs:true,
    sensitiveDataBlocked:true,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'nemotron3-super-openrouter-free',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_NEMOTRON_SUPER_FREE_MODEL',
    model:'nvidia/nemotron-3-super-120b-a12b:free',
    qualityTier:'frontier-reasoning',
    free:true,
    multimodal:false,
    reasoning:true,
    sensitiveDataBlocked:true,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'nemotron3.5-lightning-openrouter-free',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_NEMOTRON_LIGHTNING_FREE_MODEL',
    model:'nvidia/nemotron-3.5-lightning:free',
    qualityTier:'high-throughput',
    free:true,
    multimodal:false,
    reasoning:true,
    sensitiveDataBlocked:true,
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'nemotron3-super-nvidia',
    key:'NVIDIA_API_KEY',
    base:'https://integrate.api.nvidia.com/v1',
    modelKey:'NVIDIA_NEMOTRON_MODEL',
    model:'nvidia/nemotron-3-super-120b-a12b',
    qualityTier:'frontier-reasoning',
    free:false,
    multimodal:false,
    reasoning:true,
  },
  {
    name:'nemotron3-ultra-550b-nvidia',
    key:'NVIDIA_API_KEY',
    base:'https://integrate.api.nvidia.com/v1',
    modelKey:'NVIDIA_NEMOTRON_ULTRA_MODEL',
    model:'nvidia/nemotron-3-ultra-550b-a55b',
    qualityTier:'frontier-reasoning',
    free:false,
    multimodal:false,
    reasoning:true,
  },
  {
    name:'nemotron3.5-lightning-30b-nvidia',
    key:'NVIDIA_API_KEY',
    base:'https://integrate.api.nvidia.com/v1',
    modelKey:'NVIDIA_NEMOTRON_LIGHTNING_MODEL',
    model:'nvidia/nemotron-3.5-lightning-30b-a3b',
    qualityTier:'high-throughput',
    free:false,
    multimodal:false,
    reasoning:true,
  },
  {
    name:'gpt-oss-120b-cerebras',
    key:'CEREBRAS_API_KEY',
    base:'https://api.cerebras.ai/v1',
    modelKey:'CEREBRAS_GPT_OSS_MODEL',
    model:'gpt-oss-120b',
    qualityTier:'high-throughput',
    free:false,
    multimodal:false,
    reasoning:true,
  },
];

const OPEN_SOURCE_SLOTS = [
  { slot:1, key:'OPEN_SOURCE_API_KEY_1', base:'OPEN_SOURCE_BASE_URL_1', modelKey:'OPEN_SOURCE_MODEL_1', model:'Qwen/Qwen3.5-397B-A17B', label:'qwen3.5-397b-primary' },
  { slot:2, key:'OPEN_SOURCE_API_KEY_2', base:'OPEN_SOURCE_BASE_URL_2', modelKey:'OPEN_SOURCE_MODEL_2', model:'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8', label:'nemotron3-super-secondary' },
  { slot:3, key:'OPEN_SOURCE_API_KEY_3', base:'OPEN_SOURCE_BASE_URL_3', modelKey:'OPEN_SOURCE_MODEL_3', model:'deepseek-ai/DeepSeek-V3.2', label:'deepseek-v3.2-tertiary' },
  { slot:4, key:'OPEN_SOURCE_API_KEY_4', base:'OPEN_SOURCE_BASE_URL_4', modelKey:'OPEN_SOURCE_MODEL_4', model:'Qwen/Qwen3.5-122B-A10B', label:'qwen3.5-122b-quaternary' },
  { slot:5, key:'OPEN_SOURCE_API_KEY_5', base:'OPEN_SOURCE_BASE_URL_5', modelKey:'OPEN_SOURCE_MODEL_5', model:'Qwen/Qwen3.5-35B-A3B', label:'qwen3.5-35b-rescue' },
];

const COOLDOWN_MS = 60_000;
const PERMANENT_FAILURE_COOLDOWN_MS = 15 * 60_000;
const states = Object.fromEntries([
  ...OPEN_SOURCE_SLOTS.map(s => [s.label, { downUntil:0 }]),
  ...OPEN_WEIGHT_PROVIDERS.map(p => [p.name,{downUntil:0}]),
  ['gpt-oss-120b-groq',{downUntil:0}],
  ['gpt-oss-20b-groq',{downUntil:0}],
  ['openai-direct',{downUntil:0}],
  ['mistral-rescue',{downUntil:0}],
  ['anthropic-last-resort',{downUntil:0}],
]);

const clients = {};
const modelCursors = Object.fromEntries(OPEN_WEIGHT_PROVIDERS.map(p=>[p.name,0]));
const modelDisabledUntil = Object.fromEntries(OPEN_WEIGHT_PROVIDERS.map(p=>[p.name,0]));
const concurrency = {
  openrouter: { active:0, queue:[] },
};
const OPENROUTER_MAX_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.INTEL_OPENROUTER_CONCURRENCY || 2)));
const PROVIDER_WAIT_MAX_MS = Math.max(0, Math.min(10000, Number(process.env.INTEL_PROVIDER_WAIT_MAX_MS || 5000)));
const MODEL_UNAVAILABLE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const RETRYABLE_COOLDOWN_BASE_MS = 15 * 1000;
const RETRYABLE_COOLDOWN_MAX_MS = 90 * 1000;


function keyOk(k) { return !!(k && String(k).length >= 10); }
function hasAnthropic() { return keyOk(process.env.ANTHROPIC_API_KEY); }
function hasGroqFallback() { return keyOk(process.env.GROQ_API_KEY); }
function hasOpenAI() { return keyOk(process.env.OPENAI_API_KEY); }
function hasMistral() { return keyOk(process.env.MISTRAL_API_KEY); }
function hasOpenWeightProvider(def) { return keyOk(process.env[def.key]); }

function freeLanesEnabled() {
  return String(process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT || 'false').toLowerCase() === 'true';
}

function freeProviderAllowed(def, params={}) {
  if (!def.free) return true;
  if (!freeLanesEnabled()) return false;
  if (params.allowFreeProviders === false) return false;
  const classification = String(
    params.dataClassification ||
    process.env.INTEL_DEFAULT_DATA_CLASSIFICATION ||
    'internal'
  ).toLowerCase();
  if (def.sensitiveDataBlocked && classification !== 'public') return false;
  if (classification !== 'public' && String(process.env.INTEL_ALLOW_FREE_CONFIDENTIAL || 'false').toLowerCase() !== 'true') return false;
  return true;
}

function openSourceReady(key, baseUrl) {
  return !!baseUrl && (keyOk(key) || process.env.OPEN_SOURCE_ALLOW_UNAUTH === 'true');
}
function hasOpenSourceSlot(slotDef) {
  return openSourceReady(process.env[slotDef.key], process.env[slotDef.base]);
}
function hasOpenSourcePrimary() { return hasOpenSourceSlot(OPEN_SOURCE_SLOTS[0]); }
function hasOpenSourceSecondary() { return hasOpenSourceSlot(OPEN_SOURCE_SLOTS[1]); }
function hasAnyProvider(params={}) {
  const openWeight = OPEN_WEIGHT_PROVIDERS.some(p => hasOpenWeightProvider(p) && freeProviderAllowed(p, params));
  return openWeight ||
    OPEN_SOURCE_SLOTS.some(hasOpenSourceSlot) ||
    hasGroqFallback() || hasOpenAI() || hasMistral() || hasAnthropic();
}

function providerCapabilities() {
  return {
    free_open_weight_enabled:freeLanesEnabled(),
    open_weight: OPEN_WEIGHT_PROVIDERS.map(p => ({
      label:p.name,
      model:resolvedOpenWeightModel(p),
      configured:hasOpenWeightProvider(p),
      active_for_public:hasOpenWeightProvider(p) && freeProviderAllowed(p,{dataClassification:'public'}),
      free:Boolean(p.free),
      multimodal:Boolean(p.multimodal),
      quality_tier:p.qualityTier,
    })),
    open_source: OPEN_SOURCE_SLOTS.map(s => ({
      slot:s.slot,label:s.label,model:process.env[s.modelKey]||s.model,configured:hasOpenSourceSlot(s)
    })),
    gpt_oss_120b: hasGroqFallback(),
    openai_direct: hasOpenAI(),
    mistral_rescue: hasMistral(),
    anthropic_last_resort: hasAnthropic(),
    order: [
      ...OPEN_WEIGHT_PROVIDERS.map(p=>p.name),
      ...OPEN_SOURCE_SLOTS.map(s=>s.label),
      'gpt-oss-120b-groq','gpt-oss-20b-groq','openai-direct','mistral-rescue','anthropic-last-resort'
    ],
  };
}

function getAnthropicClient() {
  if (!clients.anthropic) clients.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...AI_SDK_OPTIONS });
  return clients.anthropic;
}
function getGroqClient() {
  if (!clients.groq) clients.groq = new OpenAI({ apiKey:process.env.GROQ_API_KEY, baseURL:'https://api.groq.com/openai/v1', ...AI_SDK_OPTIONS });
  return clients.groq;
}
function getDirectOpenAIClient() {
  if (!clients.openai) clients.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, ...AI_SDK_OPTIONS });
  return clients.openai;
}
function getMistralClient() {
  if (!clients.mistral) clients.mistral = new OpenAI({ apiKey: process.env.MISTRAL_API_KEY, baseURL: 'https://api.mistral.ai/v1', ...AI_SDK_OPTIONS });
  return clients.mistral;
}
function getOpenWeightClient(def) {
  const key=def.name;
  if (!clients[key]) clients[key] = new OpenAI({
    apiKey: process.env[def.key],
    baseURL: def.base,
    defaultHeaders:def.headers,
    ...AI_SDK_OPTIONS,
  });
  return clients[key];
}
function getOpenAICompatClient(slotDef) {
  const key=slotDef.label;
  if (!clients[key]) clients[key] = new OpenAI({
    apiKey: process.env[slotDef.key],
    baseURL: process.env[slotDef.base],
    ...AI_SDK_OPTIONS,
  });
  return clients[key];
}

function isRetryable(err) {
  const s = err?.status;
  return s === 408 || s === 409 || s === 429 || s === 500 || s === 502 || s === 503 || s === 504 || s === 529 ||
    /overload|timeout|temporar|rate.?limit|quota|connection reset|econnreset/i.test(err?.message || '');
}
function isPermanentCredentialFailure(err) {
  const s = err?.status;
  return s === 400 || s === 401 || s === 402 || s === 403 ||
    /credit balance|billing|insufficient credit|invalid api key|authentication|payment required/i.test(err?.message || '');
}

function normalizeAnthropicParams(input) {
  const {
    providerHints,
    dataClassification,
    allowFreeProviders,
    max_web_searches,
    reasoningEffort,
    responseFormat,
    jsonMode,
    preferFreeProviders,
    ...anthropicInput
  } = input || {};
  const params = { ...anthropicInput, model: input.model || ANTHROPIC_MODEL };
  if (Array.isArray(params.tools)) params.tools = params.tools.map(t => {
    if (t?.type && String(t.type).startsWith('web_search')) return { ...t };
    return t;
  });
  return params;
}
async function callAnthropic(params) { return getAnthropicClient().messages.create(normalizeAnthropicParams(params)); }

function toolsToOpenAI(tools) {
  return (tools || []).filter(t => t?.input_schema).map(t => ({
    type:'function', function:{ name:t.name, description:t.description, parameters:t.input_schema }
  }));
}

function systemToOpenAI(system) {
  if (!system) return undefined;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) return system.map(b => b?.text).filter(Boolean).join('\n');
  return undefined;
}

function imageBlockToOpenAI(block) {
  if (!block?.source) return null;
  if (block.source.type === 'url' && block.source.url) {
    return { type:'image_url', image_url:{url:block.source.url} };
  }
  if (block.source.type === 'base64' && block.source.data) {
    const media = block.source.media_type || 'image/jpeg';
    return { type:'image_url', image_url:{url:'data:'+media+';base64,'+block.source.data} };
  }
  return null;
}

function contentToOpenAI(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const blocks=[];
  for (const b of content) {
    if (b?.type === 'text' && b.text) blocks.push({type:'text',text:b.text});
    else if (b?.type === 'image') {
      const image=imageBlockToOpenAI(b);
      if (image) blocks.push(image);
    }
  }
  return blocks;
}

function messagesToOpenAI(messages) {
  const out=[];
  for (const m of messages || []) {
    if (typeof m.content === 'string') { out.push({role:m.role,content:m.content}); continue; }
    if (!Array.isArray(m.content)) continue;
    if (m.role === 'assistant') {
      const text=m.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
      const calls=m.content.filter(b=>b.type==='tool_use').map(b=>({
        id:b.id,
        type:'function',
        function:{name:b.name,arguments:JSON.stringify(b.input??{})}
      }));
      const msg={role:'assistant',content:text||null};
      if(calls.length)msg.tool_calls=calls;
      out.push(msg);
      continue;
    }
    const results=m.content.filter(b=>b.type==='tool_result');
    if(results.length) {
      for(const tr of results) out.push({
        role:'tool',
        tool_call_id:tr.tool_use_id,
        content:typeof tr.content==='string'?tr.content:JSON.stringify(tr.content)
      });
    } else {
      const normalized=contentToOpenAI(m.content);
      if(normalized && (!Array.isArray(normalized) || normalized.length)) out.push({role:'user',content:normalized});
    }
  }
  return out;
}

function openAIResponseToAnthropicShape(completion) {
  const message=completion.choices?.[0]?.message||{};
  const content=[];
  if(message.content)content.push({type:'text',text:message.content});
  for(const tc of message.tool_calls||[]){
    let input={}; try{input=JSON.parse(tc.function?.arguments||'{}')}catch(_){}
    content.push({type:'tool_use',id:tc.id,name:tc.function?.name,input});
  }
  return {content,stop_reason:(message.tool_calls?.length||0)?'tool_use':'end_turn'};
}


function uniqueStrings(items){
  return [...new Set(items.map(v=>String(v||'').trim()).filter(Boolean))];
}
function modelCandidates(def){
  return uniqueStrings([
    process.env[def.modelKey],
    def.model,
    ...(Array.isArray(def.fallbackModels)?def.fallbackModels:[]),
    def.free ? 'openrouter/free' : null,
  ]);
}
function resolvedOpenWeightModel(def){
  const candidates=modelCandidates(def);
  const cursor=Math.max(0,Math.min(Number(modelCursors[def.name]||0),Math.max(0,candidates.length-1)));
  return candidates[cursor]||def.model;
}
function isModelNotFound(err){
  return Number(err?.status)===404 ||
    /model[^a-z0-9]*(not found|does not exist|unknown|invalid)|unknown model|no such model|model .* unavailable/i.test(String(err?.message||''));
}
function rotateModel(def){
  const candidates=modelCandidates(def);
  const current=Number(modelCursors[def.name]||0);
  if(current+1<candidates.length){
    modelCursors[def.name]=current+1;
    modelDisabledUntil[def.name]=0;
    logger.warn('AI model lane '+def.name+' rotated from unavailable model to '+resolvedOpenWeightModel(def));
    return true;
  }
  modelDisabledUntil[def.name]=Date.now()+MODEL_UNAVAILABLE_COOLDOWN_MS;
  return false;
}
function providerCooling(label){
  const state=states[label];
  const modelBlocked=Number(modelDisabledUntil[label]||0);
  return Boolean(
    (state && Date.now()<Number(state.downUntil||0)) ||
    modelBlocked>0 && Date.now()<modelBlocked
  );
}
function providerResumeAt(provider){
  const providerUntil=Number(states[provider.name]?.downUntil||0);
  const modelUntil=Number(modelDisabledUntil[provider.name]||0);
  return Math.max(providerUntil,modelUntil);
}
async function recoverCoolingProviders(providers){
  const now=Date.now();
  const deadlines=providers.map(provider=>providerResumeAt(provider)).filter(ts=>ts>now);
  if(!deadlines.length)return providers.filter(provider=>!providerCooling(provider.name));
  const delay=Math.min(...deadlines)-now;
  if(PROVIDER_WAIT_MAX_MS<=0 || delay>PROVIDER_WAIT_MAX_MS)return [];
  await new Promise(resolve=>setTimeout(resolve,Math.max(25,delay+25)));
  return providers.filter(provider=>!providerCooling(provider.name));
}
async function withConcurrency(key,fn){
  const state=concurrency[key];
  if(!state) return fn();
  const limit=key==='openrouter'?OPENROUTER_MAX_CONCURRENCY:1;
  if(state.active>=limit) await new Promise(resolve=>state.queue.push(resolve));
  state.active++;
  try{return await fn();}
  finally{
    state.active--;
    const next=state.queue.shift();
    if(next) next();
  }
}

function requestOptions(params, def) {
  const request = {
    model:resolvedOpenWeightModel(def),
    messages:[
      ...(params.system?[{role:'system',content:systemToOpenAI(params.system)}]:[]),
      ...messagesToOpenAI(params.messages)
    ],
    ...(params.tools?.length?{tools:toolsToOpenAI(params.tools),tool_choice:'auto'}:{}),
    ...(params.responseFormat && def.structuredOutputs ? {response_format:params.responseFormat} : {}),
    max_completion_tokens:Math.min(Number(params.max_tokens)||4096,16384),
  };
  if (def.base === 'https://openrouter.ai/api/v1' && params.reasoningEffort) {
    request.reasoning={effort:params.reasoningEffort};
  }
  return request;
}

async function callOpenWeight(def,params) {
  return withConcurrency(def.base==='https://openrouter.ai/api/v1'?'openrouter':'other',async()=>{
    const completion=await getOpenWeightClient(def).chat.completions.create(requestOptions(params,def));
    return openAIResponseToAnthropicShape(completion);
  });
}
async function callOpenAICompat(slotDef,params) {
  const completion=await getOpenAICompatClient(slotDef).chat.completions.create({
    model:process.env[slotDef.modelKey]||slotDef.model,
    messages:[...(params.system?[{role:'system',content:systemToOpenAI(params.system)}]:[]),...messagesToOpenAI(params.messages)],
    ...(params.tools?.length?{tools:toolsToOpenAI(params.tools),tool_choice:'auto'}:{}),
    ...(params.reasoningEffort?{reasoning_effort:params.reasoningEffort}:{}),
    max_completion_tokens:Math.min(Number(params.max_tokens)||4096,16384),
  });
  return openAIResponseToAnthropicShape(completion);
}
async function callOpenAI(params) {
  const completion=await getDirectOpenAIClient().chat.completions.create({
    model:OPENAI_MODEL,
    messages:[...(params.system?[{role:'system',content:systemToOpenAI(params.system)}]:[]),...messagesToOpenAI(params.messages)],
    ...(params.tools?.length?{tools:toolsToOpenAI(params.tools),tool_choice:'auto'}:{}),
    max_completion_tokens:Math.min(Number(params.max_tokens)||4096,16384),
  });
  return openAIResponseToAnthropicShape(completion);
}
async function callMistral(params) {
  const completion = await getMistralClient().chat.completions.create({
    model: MISTRAL_MODEL,
    messages: [...(params.system ? [{role:'system',content:systemToOpenAI(params.system)}] : []), ...messagesToOpenAI(params.messages)],
    ...(params.tools?.length ? {tools:toolsToOpenAI(params.tools),tool_choice:'auto'} : {}),
    max_tokens: Math.min(Number(params.max_tokens)||4096,16384),
  });
  return openAIResponseToAnthropicShape(completion);
}
async function callGroq(params,model) {
  const completion=await getGroqClient().chat.completions.create({
    model,
    messages:[...(params.system?[{role:'system',content:systemToOpenAI(params.system)}]:[]),...messagesToOpenAI(params.messages)],
    ...(params.tools?.length?{tools:toolsToOpenAI(params.tools),tool_choice:'auto'}:{}),
    max_completion_tokens:Math.min(Number(params.max_tokens)||4096,16384),
  });
  return openAIResponseToAnthropicShape(completion);
}

async function attempt(label,fn,meta={}){
  const state=states[label]||(states[label]={downUntil:0,failureCount:0});
  if(Date.now()<state.downUntil)throw new Error(label+' provider cooling down');
  try{
    const result=await fn();
    state.downUntil=0;
    state.failureCount=0;
    return result;
  }catch(err){
    if(isModelNotFound(err) && meta.modelDef){
      state.failureCount=0;
      state.downUntil=0;
    }else if(isRetryable(err)){
      state.failureCount=Math.min(Number(state.failureCount||0)+1,6);
      const delay=Math.min(RETRYABLE_COOLDOWN_MAX_MS,RETRYABLE_COOLDOWN_BASE_MS*Math.pow(2,state.failureCount-1));
      state.downUntil=Date.now()+delay;
    }else if(isPermanentCredentialFailure(err)){
      state.failureCount=Math.min(Number(state.failureCount||0)+1,6);
      state.downUntil=Date.now()+PERMANENT_FAILURE_COOLDOWN_MS;
    }
    throw err;
  }
}

async function createResearchMessage(params) {
  // Public publication runs prefer the resilient open-weight research fabric.
  // Keep Anthropic web search as an emergency path, not the first dependency,
  // because a depleted account should never stall otherwise healthy free lanes.
  if(hasAnthropic() && !params.preferFreeProviders){
    try{
      return {
        ...await attempt('anthropic-last-resort',()=>callAnthropic({
          ...params,
          tools:[...(params.tools||[]),{
            type:'web_search_20260318',
            name:'web_search',
            max_uses:Number(params.max_web_searches||6),
            allowed_callers:['direct'],
            response_inclusion:'excluded'
          }]
        })),
        _provider:'anthropic-web-search',
      };
    }catch(err){
      logger.warn('AI research web-search provider failed: '+(err?.status||err?.message||'unknown')+'; falling back to provider fabric');
    }
  }
  return createMessage(params);
}

function buildProviders(params={}) {
  const providers = [];
  const addOpenWeight = (def) => {
    if (!hasOpenWeightProvider(def) || !freeProviderAllowed(def,params)) return;
    providers.push({
      name:def.name,
      fn:()=>callOpenWeight(def,params),
      kind:def.free?'open-weight-free':'open-weight',
      qualityTier:def.qualityTier,
      free:Boolean(def.free),
      modelDef:def,
    });
  };

  for (const hint of Array.isArray(params.providerHints) ? params.providerHints : []) {
    const def=OPEN_WEIGHT_PROVIDERS.find(p=>p.name===hint);
    if(def) addOpenWeight(def);
  }
  for (const def of OPEN_WEIGHT_PROVIDERS) if (!providers.some(p=>p.name===def.name)) addOpenWeight(def);

  for (const s of OPEN_SOURCE_SLOTS) {
    if(hasOpenSourceSlot(s)) {
      providers.push({name:s.label,fn:()=>callOpenAICompat(s,params),kind:'open-source-slot',free:false,qualityTier:'self-hosted'});
    }
  }

  if(hasGroqFallback()){
    providers.push({name:'gpt-oss-120b-groq',fn:()=>callGroq(params,GROQ_MODEL),kind:'open-weight',free:false,qualityTier:'high-throughput'});
    providers.push({name:'gpt-oss-20b-groq',fn:()=>callGroq(params,GROQ_MODEL_2),kind:'open-weight',free:false,qualityTier:'rescue'});
  }
  if(hasOpenAI())providers.push({name:'openai-direct',fn:()=>callOpenAI(params),kind:'closed-fallback',free:false,qualityTier:'closed'});
  if(hasMistral())providers.push({name:'mistral-rescue',fn:()=>callMistral(params),kind:'closed-fallback',free:false,qualityTier:'closed'});
  if(hasAnthropic())providers.push({name:'anthropic-last-resort',fn:()=>callAnthropic(params),kind:'closed-fallback',free:false,qualityTier:'closed'});
  if(params.preferFreeProviders){
    const hints=new Set(Array.isArray(params.providerHints)?params.providerHints:[]);
    const free=providers.filter(p=>p.free);
    const hintedFree=free.filter(p=>hints.has(p.name));
    const otherFree=free.filter(p=>!hints.has(p.name));
    const nonFree=providers.filter(p=>!p.free);
    if(hintedFree.length>1){
      const cursor=Number(createMessage._freeHintCursor||0)%hintedFree.length;
      createMessage._freeHintCursor=cursor+1;
      providers.splice(0,providers.length,
        ...hintedFree.slice(cursor),
        ...hintedFree.slice(0,cursor),
        ...otherFree,
        ...nonFree
      );
    }else{
      providers.splice(0,providers.length,...hintedFree,...otherFree,...nonFree);
    }
  }
  return providers;
}

async function createMessage(params={}) {
  const providers=buildProviders(params);
  if(!providers.length)throw new Error('AI client: no configured provider for current data-classification/free-provider policy');

  let eligibleProviders=providers.filter(provider=>!providerCooling(provider.name));
  if(!eligibleProviders.length){
    eligibleProviders=await recoverCoolingProviders(providers);
  }
  if(!eligibleProviders.length)throw new Error('AI client: all configured providers are cooling down or temporarily unavailable');
  let lastErr;
  for(const provider of eligibleProviders){
    let modelRetries=0;
    while(true){
      try {
        return {
          ...await attempt(provider.name,provider.fn,provider),
          _provider:provider.name,
          _provider_kind:provider.kind,
          _quality_tier:provider.qualityTier,
          _free_provider:Boolean(provider.free),
        };
      } catch(err) {
        lastErr=err;
        if(isModelNotFound(err) && provider.modelDef && modelRetries<2 && rotateModel(provider.modelDef)){
          modelRetries++;
          continue;
        }
        if(!/provider cooling down/i.test(String(err?.message||''))){
          logger.warn('AI provider failed: '+provider.name+' ('+(err?.status||err?.message||'unknown')+'); trying next provider');
        }
        break;
      }
    }
  }
  throw lastErr||new Error('AI client: all providers failed');
}

module.exports={
  hasAnthropic,
  hasGroqFallback,
  hasOpenAI,
  hasMistral,
  hasOpenSourcePrimary,
  hasOpenSourceSecondary,
  hasAnyProvider,
  hasOpenWeightProvider,
  providerCapabilities,
  resolvedOpenWeightModel,
  isModelNotFound,
  createMessage,
  createResearchMessage,
};
