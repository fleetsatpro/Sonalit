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

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_MODEL_2 = process.env.GROQ_MODEL_2 || 'openai/gpt-oss-20b';

const OPEN_SOURCE_SLOTS = [
  { slot:1, key:'OPEN_SOURCE_API_KEY_1', base:'OPEN_SOURCE_BASE_URL_1', modelKey:'OPEN_SOURCE_MODEL_1', model:'Qwen/Qwen3.5-397B-A17B', label:'qwen3.5-397b-primary' },
  { slot:2, key:'OPEN_SOURCE_API_KEY_2', base:'OPEN_SOURCE_BASE_URL_2', modelKey:'OPEN_SOURCE_MODEL_2', model:'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8', label:'nemotron3-super-secondary' },
  { slot:3, key:'OPEN_SOURCE_API_KEY_3', base:'OPEN_SOURCE_BASE_URL_3', modelKey:'OPEN_SOURCE_MODEL_3', model:'deepseek-ai/DeepSeek-V3.2', label:'deepseek-v3.2-tertiary' },
  { slot:4, key:'OPEN_SOURCE_API_KEY_4', base:'OPEN_SOURCE_BASE_URL_4', modelKey:'OPEN_SOURCE_MODEL_4', model:'Qwen/Qwen3.5-122B-A10B', label:'qwen3.5-122b-quaternary' },
  { slot:5, key:'OPEN_SOURCE_API_KEY_5', base:'OPEN_SOURCE_BASE_URL_5', modelKey:'OPEN_SOURCE_MODEL_5', model:'Qwen/Qwen3.5-35B-A3B', label:'qwen3.5-35b-rescue' },
];

const COOLDOWN_MS = 60_000;
const states = Object.fromEntries([
  ...OPEN_SOURCE_SLOTS.map(s => [s.label, { downUntil:0 }]),
  ['gpt-oss-120b-groq',{downUntil:0}],
  ['gpt-oss-20b-groq',{downUntil:0}],
  ['anthropic-last-resort',{downUntil:0}],
]);
const clients = {};

function keyOk(k) { return !!(k && String(k).length >= 10); }
function hasAnthropic() { return keyOk(process.env.ANTHROPIC_API_KEY); }
function hasGroqFallback() { return keyOk(process.env.GROQ_API_KEY); }
function openSourceReady(key, baseUrl) {
  return !!baseUrl && (keyOk(key) || process.env.OPEN_SOURCE_ALLOW_UNAUTH === 'true');
}
function hasOpenSourceSlot(slotDef) {
  return openSourceReady(process.env[slotDef.key], process.env[slotDef.base]);
}
function hasOpenSourcePrimary() { return hasOpenSourceSlot(OPEN_SOURCE_SLOTS[0]); }
function hasOpenSourceSecondary() { return hasOpenSourceSlot(OPEN_SOURCE_SLOTS[1]); }
function hasAnyProvider() {
  return OPEN_SOURCE_SLOTS.some(hasOpenSourceSlot) || hasGroqFallback() || hasAnthropic();
}
function providerCapabilities() {
  return {
    open_source: OPEN_SOURCE_SLOTS.map(s => ({
      slot:s.slot,label:s.label,model:process.env[s.modelKey]||s.model,configured:hasOpenSourceSlot(s)
    })),
    gpt_oss_120b: hasGroqFallback(),
    anthropic_last_resort: hasAnthropic(),
    order: [...OPEN_SOURCE_SLOTS.map(s=>s.label),'gpt-oss-120b-groq','gpt-oss-20b-groq','anthropic-last-resort'],
  };
}

function getAnthropicClient() {
  if (!clients.anthropic) clients.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return clients.anthropic;
}
function getGroqClient() {
  if (!clients.groq) clients.groq = new OpenAI({ apiKey:process.env.GROQ_API_KEY, baseURL:'https://api.groq.com/openai/v1' });
  return clients.groq;
}
function getOpenAICompatClient(slotDef) {
  const key=slotDef.label;
  if (!clients[key]) clients[key] = new OpenAI({
    apiKey: process.env[slotDef.key],
    baseURL: process.env[slotDef.base],
  });
  return clients[key];
}

function isRetryable(err) {
  const s = err?.status;
  return s === 408 || s === 409 || s === 429 || s === 500 || s === 502 || s === 503 || s === 504 || s === 529 ||
    /overload|timeout|temporar|rate.?limit|quota|connection reset|econnreset/i.test(err?.message || '');
}

function normalizeAnthropicParams(input) {
  const params = { ...input, model: input.model || ANTHROPIC_MODEL };
  if (Array.isArray(params.tools)) params.tools = params.tools.map(t => {
    if (t?.type && String(t.type).startsWith('web_search')) return { ...t, type:'web_search_20250305', allowed_callers:undefined };
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
async function callOpenAICompat(slotDef,params) {
  const completion=await getOpenAICompatClient(slotDef).chat.completions.create({
    model:process.env[slotDef.modelKey]||slotDef.model,
    messages:[...(params.system?[{role:'system',content:systemToOpenAI(params.system)}]:[]),...messagesToOpenAI(params.messages)],
    ...(params.tools?.length?{tools:toolsToOpenAI(params.tools),tool_choice:'auto'}:{}),
    max_completion_tokens:Math.min(Number(params.max_tokens)||2048,8192),
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
  catch(err){if(isRetryable(err))state.downUntil=Date.now()+COOLDOWN_MS;throw err;}
}
async function createMessage(params) {
  const providers=[];
  for(const s of OPEN_SOURCE_SLOTS) if(hasOpenSourceSlot(s)) providers.push({name:s.label,fn:()=>callOpenAICompat(s,params)});
  if(hasGroqFallback()){
    providers.push({name:'gpt-oss-120b-groq',fn:()=>callGroq(params,GROQ_MODEL)});
    providers.push({name:'gpt-oss-20b-groq',fn:()=>callGroq(params,GROQ_MODEL_2)});
  }
  if(hasAnthropic())providers.push({name:'anthropic-last-resort',fn:()=>callAnthropic(params)});
  if(!providers.length)throw new Error('AI client: no configured provider');

  let lastErr;
  for(const provider of providers){
    try{return {...await attempt(provider.name,provider.fn),_provider:provider.name};}
    catch(err){lastErr=err;logger.warn('AI provider failed: '+provider.name+' ('+(err?.status||err?.message||'unknown')+'); trying next provider');}
  }
  throw lastErr||new Error('AI client: all providers failed');
}
module.exports={hasAnthropic,hasGroqFallback,hasOpenSourcePrimary,hasOpenSourceSecondary,hasAnyProvider,providerCapabilities,createMessage};
