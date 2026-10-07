'use strict';

/**
 * Sonalit AI provider fabric.
 *
 * Open-weight first. Every slot is independently circuit-broken so one bad
 * endpoint does not poison the rest of the swarm.
 *
 * Recommended 2026 open-weight candidates:
 *   Qwen/Qwen3.5-397B-A17B
 *   nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8
 *   deepseek-ai/DeepSeek-V3.2
 * Plus GPT-OSS 120B/20B as additional open-weight fallbacks.
 *
 * Endpoints remain environment-configured because Sonalit can self-host them
 * behind vLLM/SGLang or use a compatible inference service.
 */
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const logger = require('./logger');

// Keep one bounded timeout across every provider. The intelligence scheduler
// owns retries/circuit breaking, so SDK-level retries are disabled to avoid
// turning one degraded provider into multi-minute publication stalls.
const AI_REQUEST_TIMEOUT_MS = Math.max(5000, Math.min(120000, Number(process.env.AI_REQUEST_TIMEOUT_MS || 30000)));
const AI_SDK_OPTIONS = { timeout: AI_REQUEST_TIMEOUT_MS, maxRetries: 0 };

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_MODEL_2 = process.env.GROQ_MODEL_2 || 'openai/gpt-oss-20b';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-6.1-sol';
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || 'mistral-large-latest';

/*
 * Named open-weight rescue providers. Each is independently circuit-broken.
 * The provider keys are optional; when a key is present the corresponding
 * model becomes part of the production failover mesh automatically.
 *
 * Current production candidates:
 *   - Qwen3.5 397B A17B / OpenRouter
 *   - DeepSeek V3.2 / OpenRouter
 *   - Nemotron 3 Super 120B A12B / NVIDIA NIM
 *   - Qwen3 235B A22B Instruct 2507 / Cerebras
 *   - GLM 4.7 / Cerebras
 *   - GPT-OSS 120B / Cerebras
 *
 * The caller can also supply arbitrary vLLM/SGLang/OpenAI-compatible slots
 * through OPEN_SOURCE_API_KEY_n + OPEN_SOURCE_BASE_URL_n.
 */
const OPEN_WEIGHT_PROVIDERS = [
  {
    name:'qwen3.5-397b-openrouter',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_QWEN_MODEL',
    model:'qwen/qwen3.5-397b-a17b',
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'deepseek-v3.2-openrouter',
    key:'OPENROUTER_API_KEY',
    base:'https://openrouter.ai/api/v1',
    modelKey:'OPENROUTER_DEEPSEEK_MODEL',
    model:'deepseek/deepseek-v3.2',
    headers:{'HTTP-Referer':'https://www.sonalit.com','X-Title':'Sonalit Intelligence Centre'},
  },
  {
    name:'nemotron3-super-nvidia',
    key:'NVIDIA_API_KEY',
    base:'https://integrate.api.nvidia.com/v1',
    modelKey:'NVIDIA_NEMOTRON_MODEL',
    model:'nvidia/nemotron-3-super-120b-a12b',
  },
  {
    name:'qwen3-235b-cerebras',
    key:'CEREBRAS_API_KEY',
    base:'https://api.cerebras.ai/v1',
    modelKey:'CEREBRAS_QWEN_MODEL',
    model:'qwen-3-235b-a22b-instruct-2507',
  },
  {
    name:'glm47-cerebras',
    key:'CEREBRAS_API_KEY',
    base:'https://api.cerebras.ai/v1',
    modelKey:'CEREBRAS_GLM_MODEL',
    model:'zai-glm-4.7',
  },
  {
    name:'gpt-oss-120b-cerebras',
    key:'CEREBRAS_API_KEY',
    base:'https://api.cerebras.ai/v1',
    modelKey:'CEREBRAS_GPT_OSS_MODEL',
    model:'gpt-oss-120b',
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

function keyOk(k) { return !!(k && String(k).length >= 10); }
function hasAnthropic() { return keyOk(process.env.ANTHROPIC_API_KEY); }
function hasGroqFallback() { return keyOk(process.env.GROQ_API_KEY); }
function hasOpenAI() { return keyOk(process.env.OPENAI_API_KEY); }
function hasMistral() { return keyOk(process.env.MISTRAL_API_KEY); }
function hasOpenWeightProvider(def) { return keyOk(process.env[def.key]); }
function openSourceReady(key, baseUrl) {
  return !!baseUrl && (keyOk(key) || process.env.OPEN_SOURCE_ALLOW_UNAUTH === 'true');
}
function hasOpenSourceSlot(slotDef) {
  return openSourceReady(process.env[slotDef.key], process.env[slotDef.base]);
}
function hasOpenSourcePrimary() { return hasOpenSourceSlot(OPEN_SOURCE_SLOTS[0]); }
function hasOpenSourceSecondary() { return hasOpenSourceSlot(OPEN_SOURCE_SLOTS[1]); }
function hasAnyProvider() {
  return OPEN_WEIGHT_PROVIDERS.some(hasOpenWeightProvider) ||
    OPEN_SOURCE_SLOTS.some(hasOpenSourceSlot) ||
    hasGroqFallback() || hasOpenAI() || hasMistral() || hasAnthropic();
}
function providerCapabilities() {
  return {
    open_weight: OPEN_WEIGHT_PROVIDERS.map(p => ({
      label:p.name,
      model:process.env[p.modelKey]||p.model,
      configured:hasOpenWeightProvider(p),
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
  return s === 401 || s === 403 ||
    (s === 400 && /credit balance|billing|insufficient credit|invalid api key|authentication/i.test(err?.message || ''));
}

function normalizeAnthropicParams(input) {
  const params = { ...input, model: input.model || ANTHROPIC_MODEL };
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
function messagesToOpenAI(messages) {
  const out=[];
  for (const m of messages || []) {
    if (typeof m.content === 'string') { out.push({role:m.role,content:m.content}); continue; }
    if (!Array.isArray(m.content)) continue;
    if (m.role === 'assistant') {
      const text = m.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
      const calls = m.content.filter(b=>b.type==='tool_use').map(b=>({id:b.id,type:'function',function:{name:b.name,arguments:JSON.stringify(b.input??{})}}));
      const msg={role:'assistant',content:text||null}; if(calls.length)msg.tool_calls=calls; out.push(msg); continue;
    }
    const results=m.content.filter(b=>b.type==='tool_result');
    if(results.length) for(const tr of results) out.push({role:'tool',tool_call_id:tr.tool_use_id,content:typeof tr.content==='string'?tr.content:JSON.stringify(tr.content)});
    else { const text=m.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'); if(text)out.push({role:'user',content:text}); }
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
async function callOpenWeight(def,params) {
  const completion=await getOpenWeightClient(def).chat.completions.create({
    model:process.env[def.modelKey]||def.model,
    messages:[...(params.system?[{role:'system',content:systemToOpenAI(params.system)}]:[]),...messagesToOpenAI(params.messages)],
    ...(params.tools?.length?{tools:toolsToOpenAI(params.tools),tool_choice:'auto'}:{}),
    max_completion_tokens:Math.min(Number(params.max_tokens)||2048,8192),
  });
  return openAIResponseToAnthropicShape(completion);
}
async function callOpenAICompat(slotDef,params) {
  const completion=await getOpenAICompatClient(slotDef).chat.completions.create({
    model:process.env[slotDef.modelKey]||slotDef.model,
    messages:[...(params.system?[{role:'system',content:systemToOpenAI(params.system)}]:[]),...messagesToOpenAI(params.messages)],
    ...(params.tools?.length?{tools:toolsToOpenAI(params.tools),tool_choice:'auto'}:{}),
    max_completion_tokens:Math.min(Number(params.max_tokens)||2048,8192),
  });
  return openAIResponseToAnthropicShape(completion);
}
async function callOpenAI(params) {
  const completion=await getDirectOpenAIClient().chat.completions.create({
    model:OPENAI_MODEL, messages:[...(params.system?[{role:'system',content:systemToOpenAI(params.system)}]:[]),...messagesToOpenAI(params.messages)],
    ...(params.tools?.length?{tools:toolsToOpenAI(params.tools),tool_choice:'auto'}:{}),
    max_completion_tokens:Math.min(Number(params.max_tokens)||2048,8192),
  });
  return openAIResponseToAnthropicShape(completion);
}
async function callMistral(params) {
  const completion = await getMistralClient().chat.completions.create({
    model: MISTRAL_MODEL,
    messages: [...(params.system ? [{role:'system',content:systemToOpenAI(params.system)}] : []), ...messagesToOpenAI(params.messages)],
    ...(params.tools?.length ? {tools:toolsToOpenAI(params.tools),tool_choice:'auto'} : {}),
    max_tokens: Math.min(Number(params.max_tokens)||2048,8192),
  });
  return openAIResponseToAnthropicShape(completion);
}
async function callGroq(params,model) {
  const completion=await getGroqClient().chat.completions.create({
    model, messages:[...(params.system?[{role:'system',content:systemToOpenAI(params.system)}]:[]),...messagesToOpenAI(params.messages)],
    ...(params.tools?.length?{tools:toolsToOpenAI(params.tools),tool_choice:'auto'}:{}),
    max_completion_tokens:Math.min(Number(params.max_tokens)||2048,8192),
  });
  return openAIResponseToAnthropicShape(completion);
}
async function attempt(label,fn){
  const state=states[label]||{downUntil:0};
  if(Date.now()<state.downUntil)throw new Error(label+' provider cooling down');
  try{const result=await fn();state.downUntil=0;return result;}
  catch(err){if(isRetryable(err))state.downUntil=Date.now()+COOLDOWN_MS;else if(isPermanentCredentialFailure(err))state.downUntil=Date.now()+PERMANENT_FAILURE_COOLDOWN_MS;throw err;}
}
async function createResearchMessage(params) {
  // Web-grounded incident research is deliberately Anthropic-first because the
  // built-in web-search tool is executed by the model provider itself. When
  // Anthropic is unavailable, the caller can fall back to its pre-fetched
  // research packet through the normal provider fabric.
  if(hasAnthropic()){
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
        _provider:'anthropic-web-search'
      };
    }catch(err){
      logger.warn('AI research web-search provider failed: '+(err?.status||err?.message||'unknown')+'; falling back to provider fabric');
    }
  }
  return createMessage(params);
}

function buildProviders(params) {
  const providers = [];
  const addOpenWeight = (def) => {
    if (hasOpenWeightProvider(def)) providers.push({name:def.name,fn:()=>callOpenWeight(def,params),kind:'open-weight'});
  };

  /*
   * Per-agent routing hints are advisory, not exclusive. A preferred model
   * goes first, but the complete mesh remains available as failover.
   */
  for (const hint of Array.isArray(params.providerHints) ? params.providerHints : []) {
    const def=OPEN_WEIGHT_PROVIDERS.find(p=>p.name===hint);
    if(def) addOpenWeight(def);
  }
  for (const def of OPEN_WEIGHT_PROVIDERS) if (!providers.some(p=>p.name===def.name)) addOpenWeight(def);
  for (const s of OPEN_SOURCE_SLOTS) if(hasOpenSourceSlot(s)) providers.push({name:s.label,fn:()=>callOpenAICompat(s,params),kind:'open-source-slot'});
  if(hasGroqFallback()){
    providers.push({name:'gpt-oss-120b-groq',fn:()=>callGroq(params,GROQ_MODEL),kind:'open-weight'});
    providers.push({name:'gpt-oss-20b-groq',fn:()=>callGroq(params,GROQ_MODEL_2),kind:'open-weight'});
  }
  if(hasOpenAI())providers.push({name:'openai-direct',fn:()=>callOpenAI(params),kind:'closed-fallback'});
  if(hasMistral())providers.push({name:'mistral-rescue',fn:()=>callMistral(params),kind:'closed-fallback'});
  if(hasAnthropic())providers.push({name:'anthropic-last-resort',fn:()=>callAnthropic(params),kind:'closed-fallback'});
  return providers;
}

async function createMessage(params) {
  const providers=buildProviders(params);
  if(!providers.length)throw new Error('AI client: no configured provider');

  let lastErr;
  for(const provider of providers){
    try {
      return {
        ...await attempt(provider.name,provider.fn),
        _provider:provider.name,
        _provider_kind:provider.kind,
      };
    } catch(err) {
      lastErr=err;
      logger.warn('AI provider failed: '+provider.name+' ('+(err?.status||err?.message||'unknown')+'); trying next provider');
    }
  }
  throw lastErr||new Error('AI client: all providers failed');
}
module.exports={hasAnthropic,hasGroqFallback,hasOpenAI,hasMistral,hasOpenSourcePrimary,hasOpenSourceSecondary,hasAnyProvider,hasOpenWeightProvider,providerCapabilities,createMessage,createResearchMessage};
