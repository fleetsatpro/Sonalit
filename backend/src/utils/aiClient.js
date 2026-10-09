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
const { getRedis } = require('../config/redis');
const providerRadar = require('./aiProviderRadar');

const AI_REQUEST_TIMEOUT_MS = Math.max(5000, Math.min(120000, Number(process.env.AI_REQUEST_TIMEOUT_MS || 30000)));
const AI_SDK_OPTIONS = { timeout: AI_REQUEST_TIMEOUT_MS, maxRetries: 0 };

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_MODEL_2 = process.env.GROQ_MODEL_2 || 'openai/gpt-oss-20b';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-6.1-sol';
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-large-latest';
const GOOGLE_GEMINI_MODEL = process.env.GOOGLE_GEMINI_MODEL || 'gemini-3.8-flash';
const GOOGLE_GEMINI_REASONING_EFFORT = process.env.GOOGLE_GEMINI_REASONING_EFFORT || 'high';

const GEMINI_PROVIDER = {
  name:'google-gemini-3.8-flash',
  key:'GOOGLE_AI_API_KEY',
  base:'https://generativelanguage.googleapis.com/v1beta/openai/',
  modelKey:'GOOGLE_GEMINI_MODEL',
  model:GOOGLE_GEMINI_MODEL,
  qualityTier:'frontier-flash',
  free:true,
  freeRequiresOpenWeightOptIn:false,
  multimodal:true,
  reasoning:true,
  structuredOutputs:true,
  sensitiveDataBlocked:true,
};

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
  [GEMINI_PROVIDER.name,{downUntil:0}],
]);

const clients = {};
const openAIKeyCursors={cursor:0};
const openAIKeyStates=Object.create(null);
const geminiKeyCursors={cursor:0};
const geminiKeyStates=Object.create(null);
const modelCursors = Object.fromEntries(OPEN_WEIGHT_PROVIDERS.map(p=>[p.name,0]));
const modelDisabledUntil = Object.fromEntries(OPEN_WEIGHT_PROVIDERS.map(p=>[p.name,0]));
const concurrency = Object.create(null);
const OPENROUTER_MAX_CONCURRENCY = Math.max(1, Math.min(2, Number(process.env.INTEL_OPENROUTER_CONCURRENCY || 1)));
const PROVIDER_WAIT_MAX_MS = Math.max(0, Math.min(10000, Number(process.env.INTEL_PROVIDER_WAIT_MAX_MS || 5000)));
const MODEL_UNAVAILABLE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const RETRYABLE_COOLDOWN_BASE_MS = 15 * 1000;
const RETRYABLE_COOLDOWN_MAX_MS = 90 * 1000;
const FABRIC_FREE_QUOTA_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const PROVIDER_CIRCUIT_REDIS_ENABLED =
  String(process.env.INTEL_PERSIST_PROVIDER_CIRCUITS || 'true').toLowerCase() === 'true' &&
  Boolean(process.env.REDIS_URL) &&
  String(process.env.DISABLE_REDIS || 'false').toLowerCase() !== 'true';
const PROVIDER_CIRCUIT_REDIS_PREFIX = 'sonalit:intelligence:ai:circuit:v3:';
const PROVIDER_CIRCUIT_HYDRATION_TIMEOUT_MS = Math.max(250, Math.min(5000, Number(process.env.INTEL_PROVIDER_CIRCUIT_HYDRATION_TIMEOUT_MS || 2000)));
const providerCircuitPersistence = {
  enabled: PROVIDER_CIRCUIT_REDIS_ENABLED,
  hydrated: !PROVIDER_CIRCUIT_REDIS_ENABLED,
  available: PROVIDER_CIRCUIT_REDIS_ENABLED,
  hydrationPromise: null,
};
const FABRIC_QUOTA_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const FABRIC_QUOTA_MAX_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const FABRIC_AUTH_COOLDOWN_MS = 60 * 60 * 1000;
// A public, hinted rescue lane may be tested once after the normal failover
// mesh is exhausted, even if a persisted circuit is stale. Failed probes are
// throttled and re-enter the ordinary circuit policy; this is not a global reset.
const OPENROUTER_HALF_OPEN_MIN_INTERVAL_MS = Math.max(
  60_000,
  Math.min(60 * 60_000, Number(process.env.INTEL_OPENROUTER_HALF_OPEN_INTERVAL_MS || 15 * 60_000))
);
const halfOpenProbeNotBefore = Object.create(null);
let nextOpenRouterCircuitDiagnosticAt = 0;
let nextHalfOpenDiagnosticAt = 0;
const fabricStates = Object.create(null);


function sleepMs(ms){ return new Promise(resolve=>setTimeout(resolve,ms)); }
function providerCircuitKey(group){ return PROVIDER_CIRCUIT_REDIS_PREFIX+encodeURIComponent(String(group||'unknown')); }

async function hydrateFabricState(){
  if(!providerCircuitPersistence.enabled || providerCircuitPersistence.hydrated)return;
  const client=getRedis();
  if(!client){
    providerCircuitPersistence.available=false;
    providerCircuitPersistence.hydrated=true;
    return;
  }
  const groups=[...new Set(OPEN_WEIGHT_PROVIDERS.map(p=>providerGroup(p)).concat([providerGroup(GEMINI_PROVIDER),'groq','openai','mistral','anthropic','self-hosted']))];
  try{
    const values=await Promise.race([
      client.mget(groups.map(providerCircuitKey)),
      sleepMs(PROVIDER_CIRCUIT_HYDRATION_TIMEOUT_MS).then(()=>null)
    ]);
    if(Array.isArray(values)){
      const now=Date.now();
      values.forEach((raw,i)=>{
        const until=Number(raw||0);
        if(until>now){
          const group=groups[i];
          const state=fabricStates[group]||(fabricStates[group]={downUntil:0,failureCount:0});
          state.downUntil=Math.max(Number(state.downUntil||0),until);
          state.failureCount=Math.max(Number(state.failureCount||0),1);
        }
      });
    }else{
      providerCircuitPersistence.available=false;
      logger.warn('AI provider circuit hydration timed out; continuing with local circuit state.');
    }
  }catch(error){
    providerCircuitPersistence.available=false;
    logger.warn('AI provider circuit hydration unavailable: '+error.message);
  }finally{
    providerCircuitPersistence.hydrated=true;
  }
}

function startFabricHydration(){
  if(!providerCircuitPersistence.enabled)return Promise.resolve();
  if(!providerCircuitPersistence.hydrationPromise){
    providerCircuitPersistence.hydrationPromise=hydrateFabricState().catch(error=>{
      providerCircuitPersistence.available=false;
      providerCircuitPersistence.hydrated=true;
      logger.warn('AI provider circuit hydration failed: '+error.message);
    });
  }
  return providerCircuitPersistence.hydrationPromise;
}

async function persistFabricCooldown(group,until){
  if(!providerCircuitPersistence.enabled || !providerCircuitPersistence.available)return;
  const remaining=Math.max(1000,Number(until||0)-Date.now());
  if(remaining<=0)return;
  try{
    const client=getRedis();
    if(client)await Promise.race([
      client.set(providerCircuitKey(group),String(until),'PX',remaining),
      sleepMs(Math.min(1000,remaining)).then(()=>null)
    ]);
  }catch(error){
    providerCircuitPersistence.available=false;
    logger.warn('AI provider circuit persistence unavailable: '+error.message);
  }
}

async function clearFabricCooldown(group){
  if(!providerCircuitPersistence.enabled || !providerCircuitPersistence.available)return;
  try{
    const client=getRedis();
    if(client)await Promise.race([
      client.del(providerCircuitKey(group)),
      sleepMs(1000).then(()=>null)
    ]);
  }catch(error){
    providerCircuitPersistence.available=false;
    logger.warn('AI provider circuit clear unavailable: '+error.message);
  }
}

function keyOk(k) { return !!(k && String(k).length >= 10); }
function hasAnthropic() { return keyOk(process.env.ANTHROPIC_API_KEY); }
function hasGroqFallback() { return keyOk(process.env.GROQ_API_KEY); }
function getOpenAIKeyPool() {
  const pool=[];
  for(let i=1;i<=100;i+=1){
    const key=String(process.env['OPENAI_API_KEY_'+i]||'').trim();
    if(keyOk(key)&&!pool.includes(key))pool.push(key);
  }
  const legacy=String(process.env.OPENAI_API_KEY||'').trim();
  if(keyOk(legacy)&&!pool.includes(legacy))pool.push(legacy);
  return pool;
}
function hasOpenAI() { return getOpenAIKeyPool().length>0; }
function hasReadyOpenAIKey(){
  const keys=getOpenAIKeyPool();
  if(!keys.length)return false;
  return keys.some((_,index)=>Date.now()>=Number(openAIKeyStates[index]?.downUntil||0));
}
function getGeminiKeyPool() {
  const pool=[];
  for(let i=1;i<=100;i+=1){
    const key=String(process.env['GOOGLE_AI_API_KEY_'+i]||'').trim();
    if(keyOk(key)&&!pool.includes(key))pool.push(key);
  }
  const legacy=String(process.env.GEMINI_PROVIDER_KEY||process.env.GOOGLE_AI_API_KEY||'').trim();
  if(keyOk(legacy)&&!pool.includes(legacy))pool.push(legacy);
  return pool;
}
function hasMistral() { return keyOk(process.env.MISTRAL_API_KEY); }
function hasGoogleGemini() { return getGeminiKeyPool().length>0; }
function hasReadyGeminiKey(){
  const keys=getGeminiKeyPool();
  if(!keys.length)return false;
  return keys.some((_,index)=>Date.now()>=Number(geminiKeyStates[index]?.downUntil||0));
}
function hasOpenWeightProvider(def) { return keyOk(process.env[def.key]); }

function freeLanesEnabled() {
  return String(process.env.INTEL_ALLOW_FREE_OPEN_WEIGHT || 'false').toLowerCase() === 'true';
}

function freeProviderAllowed(def, params={}) {
  if (!def.free) return true;
  if (def.freeRequiresOpenWeightOptIn !== false && !freeLanesEnabled()) return false;
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
    (hasGoogleGemini() && freeProviderAllowed(GEMINI_PROVIDER, params)) ||
    OPEN_SOURCE_SLOTS.some(hasOpenSourceSlot) ||
    hasGroqFallback() || hasOpenAI() || hasMistral() || hasAnthropic();
}

function providerCapabilities() {
  return {
    free_open_weight_enabled:freeLanesEnabled(),
    circuit_persistence:{
      enabled:providerCircuitPersistence.enabled,
      hydrated:providerCircuitPersistence.hydrated,
      available:providerCircuitPersistence.available,
    },
    open_weight: OPEN_WEIGHT_PROVIDERS.map(p => ({
      label:p.name,
      model:resolvedOpenWeightModel(p),
      configured:hasOpenWeightProvider(p),
      active_for_public:hasOpenWeightProvider(p) && freeProviderAllowed(p,{dataClassification:'public'}),
      free:Boolean(p.free),
      multimodal:Boolean(p.multimodal),
      quality_tier:p.qualityTier,
    })),
    google_gemini: {
      label:GEMINI_PROVIDER.name,
      model:GOOGLE_GEMINI_MODEL,
      configured:hasGoogleGemini(),
      key_pool_size:getGeminiKeyPool().length,
      active_for_public:hasGoogleGemini() && freeProviderAllowed(GEMINI_PROVIDER,{dataClassification:'public'}),
      free:true,
      multimodal:true,
      reasoning:true,
      quality_tier:GEMINI_PROVIDER.qualityTier,
    },
    open_source: OPEN_SOURCE_SLOTS.map(s => ({
      slot:s.slot,label:s.label,model:process.env[s.modelKey]||s.model,configured:hasOpenSourceSlot(s)
    })),
    gpt_oss_120b: hasGroqFallback(),
    openai_direct: hasOpenAI(),
    openai_key_pool_size: getOpenAIKeyPool().length,
    mistral_rescue: hasMistral(),
    anthropic_last_resort: hasAnthropic(),
    order: [
      GEMINI_PROVIDER.name,
      ...OPEN_WEIGHT_PROVIDERS.map(p=>p.name),
      ...OPEN_SOURCE_SLOTS.map(s=>s.label),
      'gpt-oss-120b-groq','gpt-oss-20b-groq','openai-direct','mistral-rescue','anthropic-last-resort'
    ],
    radar: providerRadar.snapshot(),
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
function getDirectOpenAIClient(apiKey) {
  const keyId='openai:'+String(apiKey||'').slice(0,8);
  if (!clients[keyId]) clients[keyId] = new OpenAI({ apiKey, ...AI_SDK_OPTIONS });
  return clients[keyId];
}
function getMistralClient() {
  if (!clients.mistral) clients.mistral = new OpenAI({ apiKey: process.env.MISTRAL_API_KEY, baseURL: 'https://api.mistral.ai/v1', ...AI_SDK_OPTIONS });
  return clients.mistral;
}
function getGoogleGeminiClient(apiKey) {
  const keyId='gemini:'+String(apiKey||'').slice(0,8);
  if (!clients[keyId]) clients[keyId] = new OpenAI({
    apiKey,
    baseURL: GEMINI_PROVIDER.base,
    ...AI_SDK_OPTIONS,
  });
  return clients[keyId];
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
function providerGroup(provider){
  if(!provider)return 'unknown';
  if(provider.providerGroup)return provider.providerGroup;
  const name=String(provider.name||'');
  const base=String(provider.base||'');
  if(base.includes('generativelanguage.googleapis.com')||name===GEMINI_PROVIDER.name)return 'google-gemini';
  if(base.includes('openrouter.ai')){
    // Free OpenRouter models share an account but must not share a circuit.
    // A 429 on one model lane should quarantine only that lane; siblings remain
    // eligible for failover because model availability is independently scoped.
    return 'openrouter-'+(provider.free?'free':'paid')+':'+name;
  }
  if(base.includes('api.groq.com')||name.includes('-groq')){
    // Keep Groq model lanes independently circuit-broken. The 120B model can
    // exhaust its own TPD quota while the smaller 20B rescue lane is still usable.
    const model=String(provider.model||provider.modelKey||name).toLowerCase().replace(/[^a-z0-9]+/g,'-');
    return 'groq:'+model;
  }
  if(name==='openai-direct')return 'openai';
  if(name==='mistral-rescue')return 'mistral';
  if(name==='anthropic-last-resort')return 'anthropic';
  if(name.includes('open-source')||name.includes('primary')||name.includes('secondary')||name.includes('tertiary')||name.includes('quaternary')||name.includes('rescue'))return 'self-hosted';
  return name||'unknown';
}
function getErrorHeader(err,name){
  const headers=err?.headers||err?.response?.headers||err?.cause?.headers;
  if(!headers)return '';
  const target=String(name).toLowerCase();
  try{
    if(typeof headers.get==='function')return String(headers.get(name)||headers.get(target)||'').trim();
  }catch(_){}
  for(const [k,v] of Object.entries(headers||{}))if(String(k).toLowerCase()===target)return String(v||'').trim();
  return '';
}
function parseDurationMs(value){
  if(value==null)return 0;
  const raw=String(value).trim();
  if(!raw)return 0;
  if(/^\d+(?:\.\d+)?$/.test(raw)){
    const n=Number(raw);
    // Provider reset headers are not consistent about units: some emit Unix
    // seconds, others Unix milliseconds. Distinguish epoch-ms before the
    // epoch-seconds branch; multiplying an ms timestamp by 1000 falsely
    // quarantines a recovered free lane for the maximum cooldown.
    if(n>=1_000_000_000_000)return Math.max(0,n-Date.now());
    if(n>1_000_000_000)return Math.max(0,n*1000-Date.now());
    return n*1000;
  }
  const m=raw.match(/(?:(\d+(?:\.\d+)?)\s*d)?\s*(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?\s*(?:(\d+(?:\.\d+)?)\s*s)?/i);
  if(!m||!m[0].trim())return 0;
  return ((Number(m[1]||0)*86400)+(Number(m[2]||0)*3600)+(Number(m[3]||0)*60)+Number(m[4]||0))*1000;
}
function retryAfterMs(err,fallbackMs){
  const direct=parseDurationMs(getErrorHeader(err,'retry-after'));
  if(direct>0)return direct;
  const reset=parseDurationMs(getErrorHeader(err,'x-ratelimit-reset-requests'))||
    parseDurationMs(getErrorHeader(err,'x-ratelimit-reset'))||
    parseDurationMs(getErrorHeader(err,'ratelimit-reset'));
  return reset>0?reset:fallbackMs;
}
function safeProviderDiagnosticToken(value){
  const token=String(value==null?'':value).trim();
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(token)?token:'unknown';
}
function safeNumericErrorHeader(err,name){
  const value=getErrorHeader(err,name);
  return /^\d+(?:\.\d+)?$/.test(value)?value:'unknown';
}
function openRouterRateLimitDiagnostic(err){
  // OpenAI-compatible SDKs expose parsed response bodies under slightly
  // different wrappers. Read only stable metadata fields and rate headers;
  // never log raw provider messages, prompts, URLs or credentials.
  const outer=err?.error&&typeof err.error==='object'
    ? err.error
    : (err?.response?.data&&typeof err.response.data==='object'?err.response.data:{});
  const body=outer?.error&&typeof outer.error==='object'?outer.error:outer;
  const metadata=body?.metadata||outer?.metadata||err?.metadata||{};
  const errorType=safeProviderDiagnosticToken(metadata.error_type||body?.type);
  const providerCode=safeProviderDiagnosticToken(metadata.provider_code||body?.code);
  const retryMs=Math.max(0,Math.min(7*24*60*60*1000,retryAfterMs(err,0)));
  const remaining=safeNumericErrorHeader(err,'x-ratelimit-remaining');
  const limit=safeNumericErrorHeader(err,'x-ratelimit-limit');
  const reset=safeNumericErrorHeader(err,'x-ratelimit-reset-requests')!=='unknown'
    ? safeNumericErrorHeader(err,'x-ratelimit-reset-requests')
    : safeNumericErrorHeader(err,'x-ratelimit-reset');
  return 'error_type='+errorType+
    ' provider_code='+providerCode+
    ' retry_after_ms='+retryMs+
    ' rate_limit_remaining='+remaining+
    ' rate_limit_limit='+limit+
    ' rate_limit_reset='+reset;
}
function fabricCooldownMs(err,provider,state){
  if(providerGroup(provider)==='google-gemini')return 0;
  if(Number(err?.status)===429 || /rate.?limit|too many requests|quota/i.test(String(err?.message||''))){
    const headerMs=retryAfterMs(err,0);
    if(headerMs>0)return Math.min(FABRIC_QUOTA_MAX_COOLDOWN_MS,Math.max(15000,headerMs));
    if(providerGroup(provider).startsWith('openrouter-free:') || providerGroup(provider).startsWith('openrouter-paid:')){
      // OpenRouter lanes are independently circuit-broken. Keep account-level
      // concurrency shared, but never turn one model failure into a fleet-wide
      // quarantine. The provider state already cools the affected lane.
      return 0;
    }
    return Math.min(RETRYABLE_COOLDOWN_MAX_MS,RETRYABLE_COOLDOWN_BASE_MS*Math.pow(2,Math.min(Number(state.failureCount||0)-1,5)));
  }
  if(Number(err?.status)===402 || /credit balance|billing|insufficient credit|payment required/i.test(String(err?.message||''))){
    return FABRIC_QUOTA_COOLDOWN_MS;
  }
  if(Number(err?.status)===401 || Number(err?.status)===403 || /invalid api key|authentication/i.test(String(err?.message||''))){
    return FABRIC_AUTH_COOLDOWN_MS;
  }
  return 0;
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
function providerCooling(providerOrLabel){
  const label=typeof providerOrLabel==='string'?providerOrLabel:providerOrLabel?.name;
  const provider=typeof providerOrLabel==='string'?{name:label}:providerOrLabel;
  const state=states[label];
  const group=providerGroup(provider);
  const fabric=fabricStates[group];
  const modelBlocked=Number(modelDisabledUntil[label]||0);
  const isolateGemini=label===GEMINI_PROVIDER.name;
  return Boolean(
    (!isolateGemini && state && Date.now()<Number(state.downUntil||0)) ||
    (!isolateGemini && fabric && Date.now()<Number(fabric.downUntil||0)) ||
    modelBlocked>0 && Date.now()<modelBlocked
  );
}
function providerResumeAt(provider){
  const isolateGemini=provider.name===GEMINI_PROVIDER.name;
  const providerUntil=isolateGemini?0:Number(states[provider.name]?.downUntil||0);
  const fabricUntil=isolateGemini?0:Number(fabricStates[providerGroup(provider)]?.downUntil||0);
  const modelUntil=Number(modelDisabledUntil[provider.name]||0);
  return Math.max(providerUntil,fabricUntil,modelUntil);
}
async function recoverCoolingProviders(providers){
  const now=Date.now();
  const deadlines=providers.map(provider=>providerResumeAt(provider)).filter(ts=>ts>now);
  if(!deadlines.length)return providers.filter(provider=>!providerCooling(provider));
  const delay=Math.min(...deadlines)-now;
  if(PROVIDER_WAIT_MAX_MS<=0 || delay>PROVIDER_WAIT_MAX_MS)return [];
  await new Promise(resolve=>setTimeout(resolve,Math.max(25,delay+25)));
  return providers.filter(provider=>!providerCooling(provider));
}
async function withConcurrency(key,fn){
  const state=concurrency[key]||(concurrency[key]={active:0,queue:[]});
  const limit=String(key||'').startsWith('openrouter-')?OPENROUTER_MAX_CONCURRENCY:1;
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
  const key=def.base==='https://openrouter.ai/api/v1'
    ? (def.free?'openrouter-free':'openrouter-paid')
    : providerGroup(def);
  return withConcurrency(key,async()=>{
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
  const keys=getOpenAIKeyPool();
  if(!keys.length)throw new Error('OpenAI direct: no configured API keys');
  const start=openAIKeyCursors.cursor%keys.length;
  let lastErr;
  for(let offset=0;offset<keys.length;offset+=1){
    const index=(start+offset)%keys.length;
    const key=keys[index];
    const state=openAIKeyStates[index]||(openAIKeyStates[index]={downUntil:0,failureCount:0});
    if(Date.now()<Number(state.downUntil||0))continue;
    try{
      const completion=await getDirectOpenAIClient(key).chat.completions.create({
        model:OPENAI_MODEL,
        messages:[...(params.system?[{role:'system',content:systemToOpenAI(params.system)}]:[]),...messagesToOpenAI(params.messages)],
        ...(params.tools?.length?{tools:toolsToOpenAI(params.tools),tool_choice:'auto'}:{}),
        max_completion_tokens:Math.min(Number(params.max_tokens)||4096,16384),
      });
      state.downUntil=0;
      state.failureCount=0;
      openAIKeyCursors.cursor=(index+1)%keys.length;
      return openAIResponseToAnthropicShape(completion);
    }catch(err){
      lastErr=err;
      if(isRetryable(err)){
        state.failureCount=Math.min(Number(state.failureCount||0)+1,6);
        state.downUntil=Date.now()+Math.max(COOLDOWN_MS,Number(retryAfterMs(err,COOLDOWN_MS)));
      }else if(isPermanentCredentialFailure(err)){
        state.failureCount=Math.min(Number(state.failureCount||0)+1,6);
        state.downUntil=Date.now()+PERMANENT_FAILURE_COOLDOWN_MS;
      }
      logger.warn('OpenAI key pool member '+String(index+1)+' failed ('+(err?.status||err?.message||'unknown')+'); rotating to next key');
    }
  }
  throw lastErr||new Error('OpenAI direct: all key-pool members are cooling down or failed');
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
async function callGoogleGemini(params) {
  const keys=getGeminiKeyPool();
  if(!keys.length)throw new Error('Google Gemini: no configured API keys');
  const start=geminiKeyCursors.cursor%keys.length;
  let lastErr;
  for(let offset=0;offset<keys.length;offset+=1){
    const index=(start+offset)%keys.length;
    const key=keys[index];
    const state=geminiKeyStates[index]||(geminiKeyStates[index]={downUntil:0,failureCount:0});
    if(Date.now()<Number(state.downUntil||0))continue;
    try{
      const completion = await getGoogleGeminiClient(key).chat.completions.create({
        model:GOOGLE_GEMINI_MODEL,
        messages:[...(params.system?[{role:'system',content:systemToOpenAI(params.system)}]:[]),...messagesToOpenAI(params.messages)],
        ...(params.tools?.length?{tools:toolsToOpenAI(params.tools),tool_choice:'auto'}:{}),
        ...(params.responseFormat?{response_format:params.responseFormat}:{}),
        reasoning_effort:params.reasoningEffort||GOOGLE_GEMINI_REASONING_EFFORT,
        max_completion_tokens:Math.min(Number(params.max_tokens)||4096,16384),
      });
      state.downUntil=0;
      state.failureCount=0;
      geminiKeyCursors.cursor=(index+1)%keys.length;
      return openAIResponseToAnthropicShape(completion);
    }catch(err){
      lastErr=err;
      if(isRetryable(err)){
        state.failureCount=Math.min(Number(state.failureCount||0)+1,6);
        state.downUntil=Date.now()+Math.max(COOLDOWN_MS,Number(retryAfterMs(err,COOLDOWN_MS)));
      }else if(isPermanentCredentialFailure(err)){
        state.failureCount=Math.min(Number(state.failureCount||0)+1,6);
        state.downUntil=Date.now()+PERMANENT_FAILURE_COOLDOWN_MS;
      }
      logger.warn('Gemini key pool member '+String(index+1)+' failed ('+(err?.status||err?.message||'unknown')+'); rotating to next key');
    }
  }
  throw lastErr||new Error('Google Gemini: all key-pool members are cooling down or failed');
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
  const group=providerGroup(meta);
  const fabric=fabricStates[group]||(fabricStates[group]={downUntil:0,failureCount:0});
  const sharedCooling=label===GEMINI_PROVIDER.name?false:Date.now()<fabric.downUntil;
  const allowCircuitProbe=meta.allowCircuitProbe===true;
  if(label!==GEMINI_PROVIDER.name && !allowCircuitProbe && (Date.now()<state.downUntil || sharedCooling))throw new Error(label+' provider cooling down');
  const startedAt=Date.now();
  try{
    const result=await fn();
    providerRadar.recordSuccess(label,{latencyMs:Date.now()-startedAt});
    state.downUntil=0;
    state.failureCount=0;
    fabric.downUntil=0;
    fabric.failureCount=0;
    void clearFabricCooldown(group);
    return result;
  }catch(err){
    providerRadar.recordFailure(label,{status:err?.status,message:err?.message});
    if(isModelNotFound(err) && meta.modelDef){
      state.failureCount=0;
      state.downUntil=0;
    }else if(isRetryable(err)){
      state.failureCount=Math.min(Number(state.failureCount||0)+1,6);
      const delay=Math.min(RETRYABLE_COOLDOWN_MAX_MS,RETRYABLE_COOLDOWN_BASE_MS*Math.pow(2,state.failureCount-1));
      state.downUntil=Date.now()+delay;
      const groupDelay=fabricCooldownMs(err,meta,state);
      if(groupDelay){
        fabric.failureCount=Math.min(Number(fabric.failureCount||0)+1,6);
        const observedRetryDeadline=Date.now()+groupDelay;
        // A half-open probe is a fresh response from a lane previously marked
        // unavailable. Its current Retry-After/reset metadata must replace a
        // stale persisted group deadline; max(old,new) would keep a six-minute
        // provider retry hint hidden behind yesterday's 24-hour circuit.
        fabric.downUntil=allowCircuitProbe
          ? observedRetryDeadline
          : Math.max(Number(fabric.downUntil||0),observedRetryDeadline);
        await persistFabricCooldown(group,fabric.downUntil);
      }
    }else if(isPermanentCredentialFailure(err)){
      state.failureCount=Math.min(Number(state.failureCount||0)+1,6);
      state.downUntil=Date.now()+PERMANENT_FAILURE_COOLDOWN_MS;
      const groupDelay=fabricCooldownMs(err,meta,state);
      if(groupDelay){
        fabric.failureCount=Math.min(Number(fabric.failureCount||0)+1,6);
        fabric.downUntil=Math.max(Number(fabric.downUntil||0),Date.now()+groupDelay);
        await persistFabricCooldown(group,fabric.downUntil);
      }
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
  if(hasGoogleGemini() && freeProviderAllowed(GEMINI_PROVIDER,params)){
    providers.push({
      name:GEMINI_PROVIDER.name,
      fn:()=>callGoogleGemini(params),
      kind:'google-gemini',
      qualityTier:GEMINI_PROVIDER.qualityTier,
      free:true,
      providerGroup:providerGroup(GEMINI_PROVIDER),
    });
  }
  const addOpenWeight = (def) => {
    if (!hasOpenWeightProvider(def) || !freeProviderAllowed(def,params)) return;
    providers.push({
      name:def.name,
      fn:()=>callOpenWeight(def,params),
      kind:def.free?'open-weight-free':'open-weight',
      qualityTier:def.qualityTier,
      free:Boolean(def.free),
      modelDef:def,
      providerGroup:providerGroup(def),
    });
  };

  for (const hint of Array.isArray(params.providerHints) ? params.providerHints : []) {
    const def=OPEN_WEIGHT_PROVIDERS.find(p=>p.name===hint);
    if(def) addOpenWeight(def);
  }
  for (const def of OPEN_WEIGHT_PROVIDERS) if (!providers.some(p=>p.name===def.name)) addOpenWeight(def);

  for (const s of OPEN_SOURCE_SLOTS) {
    if(hasOpenSourceSlot(s)) {
      providers.push({name:s.label,fn:()=>callOpenAICompat(s,params),kind:'open-source-slot',free:false,qualityTier:'self-hosted',providerGroup:'self-hosted'});
    }
  }

  if(hasGroqFallback()){
    providers.push({name:'gpt-oss-120b-groq',fn:()=>callGroq(params,GROQ_MODEL),kind:'open-weight',free:false,qualityTier:'high-throughput',providerGroup:'groq'});
    providers.push({name:'gpt-oss-20b-groq',fn:()=>callGroq(params,GROQ_MODEL_2),kind:'open-weight',free:false,qualityTier:'rescue',providerGroup:'groq'});
  }
  if(hasOpenAI())providers.push({name:'openai-direct',fn:()=>callOpenAI(params),kind:'closed-fallback',free:false,qualityTier:'closed',providerGroup:'openai'});
  if(hasMistral())providers.push({name:'mistral-rescue',fn:()=>callMistral(params),kind:'closed-fallback',free:false,qualityTier:'closed',providerGroup:'mistral'});
  if(hasAnthropic())providers.push({name:'anthropic-last-resort',fn:()=>callAnthropic(params),kind:'closed-fallback',free:false,qualityTier:'closed',providerGroup:'anthropic'});
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

function hasReadyProvider(params={}){
  if(providerCircuitPersistence.enabled && !providerCircuitPersistence.hydrated)return false;
  return buildProviders(params).some(provider=>
    provider.name==='openai-direct' ? hasReadyOpenAIKey() :
    provider.name===GEMINI_PROVIDER.name ? hasReadyGeminiKey() :
    !providerCooling(provider)
  );
}

function rankProviders(providers,params={}){
  const hints=new Set(Array.isArray(params.providerHints)?params.providerHints.map(String):[]);
  return providers
    .map((provider,index)=>({provider,index,hinted:hints.has(provider.name)}))
    .sort((a,b)=>{
      if(a.hinted!==b.hinted)return a.hinted?-1:1;
      if(Boolean(params.preferFreeProviders)&&Boolean(a.provider.free)!==Boolean(b.provider.free))return a.provider.free?-1:1;
      const ah=providerRadar.routingScore(a.provider.name),bh=providerRadar.routingScore(b.provider.name);
      if(ah!==bh)return bh-ah;
      return a.index-b.index;
    })
    .map(x=>x.provider);
}

function providerResponse(result,provider){
  return {
    ...result,
    _provider:provider.name,
    _provider_kind:provider.kind,
    _quality_tier:provider.qualityTier,
    _free_provider:Boolean(provider.free),
    _provider_group:providerGroup(provider),
    _radar:providerRadar.status(provider.name),
  };
}

function logOpenRouterCircuitPosture(providers,params){
  const hints=new Set(Array.isArray(params.providerHints)?params.providerHints.map(String):[]);
  if(!params.preferFreeProviders || !hints.has('openrouter-free-router'))return;
  const openRouter=providers.filter(p=>String(providerGroup(p)).startsWith('openrouter-'));
  if(!openRouter.length)return;
  const cooling=openRouter.filter(providerCooling);
  if(!cooling.length)return;
  const now=Date.now();
  if(now<nextOpenRouterCircuitDiagnosticAt)return;
  nextOpenRouterCircuitDiagnosticAt=now+60_000;
  const coolingSummary=cooling.slice(0,12).map(p=>{
    const remaining=Math.max(0,providerResumeAt(p)-now);
    return p.name+':'+remaining+'ms';
  }).join(',');
  logger.warn(
    'AI provider routing: public OpenRouter rescue lanes are circuit-blocked; configured='+
    openRouter.length+', eligible='+String(openRouter.length-cooling.length)+
    ', cooling='+cooling.length+', lanes='+coolingSummary
  );
}

function halfOpenRouterBlockReason(provider,params,coolingAtStart,attempted){
  if(!provider || provider.name!=='openrouter-free-router' || provider.free!==true)return 'rescue-lane-not-configured';
  const hints=new Set(Array.isArray(params.providerHints)?params.providerHints.map(String):[]);
  const classification=String(
    params.dataClassification || process.env.INTEL_DEFAULT_DATA_CLASSIFICATION || 'internal'
  ).toLowerCase();
  if(params.preferFreeProviders!==true || !hints.has(provider.name))return 'rescue-lane-not-explicitly-hinted';
  if(classification!=='public' || params.allowFreeProviders===false)return 'public-free-lane-policy-blocked';
  if(!coolingAtStart.has(provider.name))return 'lane-not-cooling-at-request-start';
  if(attempted.has(provider.name))return 'lane-already-attempted-this-request';
  // A confirmed unavailable model stays quarantined; stale circuit state alone
  // is recoverable with a half-open probe.
  if(Date.now()<Number(modelDisabledUntil[provider.name]||0))return 'model-unavailable-quarantine';
  if(Date.now()<Number(halfOpenProbeNotBefore[provider.name]||0))return 'probe-interval-not-elapsed';
  // Do not re-check providerCooling() here: another concurrent request can
  // clear this circuit after our initial candidate snapshot/filter. This request
  // may still need a call, and it has not attempted this lane yet. The explicit
  // request policy and per-lane probe throttle above still constrain recovery.
  return null;
}

function logHalfOpenProbeSkipped(reason){
  const now=Date.now();
  if(now<nextHalfOpenDiagnosticAt)return;
  nextHalfOpenDiagnosticAt=now+60_000;
  logger.warn('AI provider half-open recovery probe skipped: reason='+reason);
}

async function tryHalfOpenOpenRouterRouter(providers,params,coolingAtStart,attempted){
  const provider=providers.find(p=>p.name==='openrouter-free-router');
  const blockReason=halfOpenRouterBlockReason(provider,params,coolingAtStart,attempted);
  if(blockReason){
    const hints=new Set(Array.isArray(params.providerHints)?params.providerHints.map(String):[]);
    if(params.preferFreeProviders===true && hints.has('openrouter-free-router'))logHalfOpenProbeSkipped(blockReason);
    return null;
  }
  const startedAt=Date.now();
  const oldCooldownMs=Math.max(0,providerResumeAt(provider)-startedAt);
  halfOpenProbeNotBefore[provider.name]=startedAt+OPENROUTER_HALF_OPEN_MIN_INTERVAL_MS;
  logger.warn('AI provider half-open recovery probe: provider='+provider.name+' prior_cooldown_ms='+oldCooldownMs);
  try{
    // Only the explicitly hinted dynamic free router is probed. Other provider
    // circuits remain intact, and data-classification policy is still required.
    const result=await attempt(provider.name,provider.fn,{...provider,allowCircuitProbe:true});
    delete halfOpenProbeNotBefore[provider.name];
    logger.info('AI provider half-open recovery probe succeeded: provider='+provider.name);
    return {response:providerResponse(result,provider),provider,error:null};
  }catch(error){
    const nextAt=Math.max(
      Date.now()+OPENROUTER_HALF_OPEN_MIN_INTERVAL_MS,
      providerResumeAt(provider)
    );
    halfOpenProbeNotBefore[provider.name]=nextAt;
    const rateLimitDetails=Number(error?.status)===429
      ? ' '+openRouterRateLimitDiagnostic(error)
      : '';
    logger.warn(
      'AI provider half-open recovery probe failed: provider='+provider.name+
      ' status='+(Number(error?.status)||'unknown')+
      ' retry_in_ms='+Math.max(0,nextAt-Date.now())+
      rateLimitDetails
    );
    return {response:null,provider,error};
  }
}

async function createMessage(params={}) {
  await Promise.all([startFabricHydration(),providerRadar.hydrate()]);
  const providers=rankProviders(buildProviders(params),params);
  if(!providers.length)throw new Error('AI client: no configured provider for current data-classification/free-provider policy');

  const coolingAtStart=new Set(providers.filter(providerCooling).map(provider=>provider.name));
  logOpenRouterCircuitPosture(providers,params);
  let eligibleProviders=providers.filter(provider=>!providerCooling(provider));
  if(!eligibleProviders.length){
    eligibleProviders=await recoverCoolingProviders(providers);
  }
  const attempted=new Set();
  let lastErr;
  if(!eligibleProviders.length){
    const halfOpen=await tryHalfOpenOpenRouterRouter(providers,params,coolingAtStart,attempted);
    if(halfOpen?.response)return halfOpen.response;
    if(halfOpen?.error)lastErr=halfOpen.error;
    throw lastErr||new Error('AI client: all configured providers are cooling down or temporarily unavailable');
  }

  for(const provider of eligibleProviders){
    if(providerCooling(provider))continue;
    let modelRetries=0;
    attempted.add(provider.name);
    while(true){
      if(providerCooling(provider))break;
      try{
        return providerResponse(await attempt(provider.name,provider.fn,provider),provider);
      }catch(err){
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

  // Do not leave the public research lane idle for the full persisted circuit
  // TTL when every non-cooled provider has failed. The explicitly hinted dynamic
  // router receives one half-open probe per bounded interval; success clears
  // only its own circuit, while failure re-establishes normal backoff.
  const halfOpen=await tryHalfOpenOpenRouterRouter(providers,params,coolingAtStart,attempted);
  if(halfOpen?.response)return halfOpen.response;
  if(halfOpen?.error)lastErr=halfOpen.error;
  throw lastErr||new Error('AI client: all providers failed');
}

module.exports={
  hasAnthropic,
  hasGroqFallback,
  hasOpenAI,
  hasMistral,
  hasGoogleGemini,
  hasOpenSourcePrimary,
  hasOpenSourceSecondary,
  hasAnyProvider,
  hasReadyProvider,
  hydrateFabricState,
  hasOpenWeightProvider,
  providerCapabilities,
  resolvedOpenWeightModel,
  isModelNotFound,
  openRouterRateLimitDiagnostic,
  createMessage,
  createResearchMessage,
  rankProviders,
  providerHealth: providerRadar.snapshot,
};


void startFabricHydration();
