/**
 * Sonalit AI provider fabric.
 *
 * Priority is deliberately open-source/open-weight first:
 *   1. OPEN_SOURCE_MODEL_1 on OPEN_SOURCE_BASE_URL_1 (e.g. Qwen3-235B-A22B-Instruct-2507 via vLLM)
 *   2. OPEN_SOURCE_MODEL_2 on OPEN_SOURCE_BASE_URL_2 (e.g. Qwen3-Next-80B-A3B-Instruct via vLLM)
 *   3. Groq GPT-OSS 120B (open-weight)
 *   4. Anthropic Claude (LAST RESORT)
 *
 * All providers expose one normalized Anthropic-shaped response to callers.
 */
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const logger = require('./logger');

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const OPEN_SOURCE_MODEL_1 = process.env.OPEN_SOURCE_MODEL_1 || 'Qwen/Qwen3-235B-A22B-Instruct-2507';
const OPEN_SOURCE_MODEL_2 = process.env.OPEN_SOURCE_MODEL_2 || 'Qwen/Qwen3-Next-80B-A3B-Instruct';

const COOLDOWN_MS = 60_000;
const anthropicState = { downUntil: 0 };
const groqState = { downUntil: 0 };
const os1State = { downUntil: 0 };
const os2State = { downUntil: 0 };

let anthropicClient = null;
let groqClient = null;
let os1Client = null;
let os2Client = null;

function keyOk(k) { return !!(k && String(k).length >= 10); }
function hasAnthropic() { return keyOk(process.env.ANTHROPIC_API_KEY); }
function hasGroqFallback() { return keyOk(process.env.GROQ_API_KEY); }
function openSourceReady(key, baseUrl) {
  return !!baseUrl && (keyOk(key) || process.env.OPEN_SOURCE_ALLOW_UNAUTH === 'true');
}
function hasOpenSourcePrimary() {
  return openSourceReady(process.env.OPEN_SOURCE_API_KEY_1, process.env.OPEN_SOURCE_BASE_URL_1);
}
function hasOpenSourceSecondary() {
  return openSourceReady(process.env.OPEN_SOURCE_API_KEY_2, process.env.OPEN_SOURCE_BASE_URL_2);
}
function hasAnyProvider() {
  return hasOpenSourcePrimary() || hasOpenSourceSecondary() || hasGroqFallback() || hasAnthropic();
}
function providerCapabilities() {
  return {
    open_source_primary: hasOpenSourcePrimary(),
    open_source_secondary: hasOpenSourceSecondary(),
    gpt_oss_120b: hasGroqFallback(),
    anthropic_last_resort: hasAnthropic(),
    order: ['qwen-primary','qwen-secondary','gpt-oss-120b-groq','anthropic-last-resort'],
  };
}

function getAnthropicClient() {
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropicClient;
}
function getGroqClient() {
  if (!groqClient) groqClient = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });
  return groqClient;
}
function getOpenAICompatClient(slot) {
  if (slot === 1) {
    if (!os1Client) os1Client = new OpenAI({
      apiKey: process.env.OPEN_SOURCE_API_KEY_1,
      baseURL: process.env.OPEN_SOURCE_BASE_URL_1,
    });
    return os1Client;
  }
  if (!os2Client) os2Client = new OpenAI({
    apiKey: process.env.OPEN_SOURCE_API_KEY_2,
    baseURL: process.env.OPEN_SOURCE_BASE_URL_2,
  });
  return os2Client;
}

function isRetryable(err) {
  const s = err?.status;
  return s === 408 || s === 409 || s === 429 || s === 500 || s === 502 || s === 503 || s === 504 || s === 529 ||
    /overload|timeout|temporar|rate.?limit|quota/i.test(err?.message || '');
}
function normalizeAnthropicParams(input) {
  const params = { ...input };
  params.model = params.model || ANTHROPIC_MODEL;
  if (Array.isArray(params.tools)) {
    let webSearch = false;
    params.tools = params.tools.map(t => {
      if (t?.type && String(t.type).startsWith('web_search')) {
        webSearch = true;
        return { ...t, type: 'web_search_20250305', allowed_callers: undefined };
      }
      return t;
    });
    if (webSearch && /^claude-sonnet-5/i.test(params.model)) params.model = ANTHROPIC_MODEL;
  }
  return params;
}
async function callAnthropic(params) {
  return getAnthropicClient().messages.create(normalizeAnthropicParams(params));
}

function toolsToOpenAI(tools) {
  return (tools || []).filter(t => t?.input_schema).map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}
function systemToOpenAI(system) {
  if (!system) return undefined;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) return system.map(b => b?.text).filter(Boolean).join('\n');
  return undefined;
}
function messagesToOpenAI(messages) {
  const out = [];
  for (const m of messages || []) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) continue;

    if (m.role === 'assistant') {
      const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const calls = m.content.filter(b => b.type === 'tool_use').map(b => ({
        id: b.id,
        type: 'function',
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      const msg = { role: 'assistant', content: text || null };
      if (calls.length) msg.tool_calls = calls;
      out.push(msg);
      continue;
    }

    const toolResults = m.content.filter(b => b.type === 'tool_result');
    if (toolResults.length) {
      for (const tr of toolResults) {
        out.push({
          role: 'tool',
          tool_call_id: tr.tool_use_id,
          content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content),
        });
      }
    } else {
      const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      if (text) out.push({ role: 'user', content: text });
    }
  }
  return out;
}
function openAIResponseToAnthropicShape(completion) {
  const choice = completion.choices?.[0];
  const message = choice?.message || {};
  const content = [];
  if (message.content) content.push({ type: 'text', text: message.content });
  for (const tc of message.tool_calls || []) {
    let input = {};
    try { input = JSON.parse(tc.function?.arguments || '{}'); } catch (_) {}
    content.push({
      type: 'tool_use',
      id: tc.id,
      name: tc.function?.name,
      input,
    });
  }
  return {
    content,
    stop_reason: (message.tool_calls?.length || 0) ? 'tool_use' : 'end_turn',
  };
}

async function callOpenAICompat(slot, { system, messages, tools, max_tokens, model }) {
  const client = getOpenAICompatClient(slot);
  const completion = await client.chat.completions.create({
    model,
    messages: [
      ...(system ? [{ role: 'system', content: systemToOpenAI(system) }] : []),
      ...messagesToOpenAI(messages),
    ],
    ...(tools?.length ? { tools: toolsToOpenAI(tools), tool_choice: 'auto' } : {}),
    max_completion_tokens: Math.min(Number(max_tokens) || 2048, 8192),
  });
  return openAIResponseToAnthropicShape(completion);
}
async function callGroq(params) {
  const completion = await getGroqClient().chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      ...(params.system ? [{ role: 'system', content: systemToOpenAI(params.system) }] : []),
      ...messagesToOpenAI(params.messages),
    ],
    ...(params.tools?.length ? { tools: toolsToOpenAI(params.tools), tool_choice: 'auto' } : {}),
    max_completion_tokens: Math.min(Number(params.max_tokens) || 2048, 8192),
  });
  return openAIResponseToAnthropicShape(completion);
}

async function attempt(label, fn, state, allowRetry = true) {
  if (Date.now() < state.downUntil) {
    throw new Error(label + ' provider cooling down');
  }
  try {
    const result = await fn();
    state.downUntil = 0;
    return result;
  } catch (err) {
    if (allowRetry && isRetryable(err)) {
      state.downUntil = Date.now() + COOLDOWN_MS;
    }
    throw err;
  }
}

async function createMessage(params) {
  const providers = [];

  if (hasOpenSourcePrimary()) {
    providers.push({
      name: 'qwen-primary',
      state: os1State,
      fn: () => callOpenAICompat(1, paramsWithModel(params, OPEN_SOURCE_MODEL_1)),
    });
  }
  if (hasOpenSourceSecondary()) {
    providers.push({
      name: 'qwen-secondary',
      state: os2State,
      fn: () => callOpenAICompat(2, paramsWithModel(params, OPEN_SOURCE_MODEL_2)),
    });
  }
  if (hasGroqFallback()) {
    providers.push({
      name: 'gpt-oss-120b-groq',
      state: groqState,
      fn: () => callGroq(params),
    });
  }
  if (hasAnthropic()) {
    providers.push({
      name: 'anthropic-last-resort',
      state: anthropicState,
      fn: () => callAnthropic(params),
    });
  }

  if (!providers.length) throw new Error('AI client: no configured provider');

  let lastErr;
  for (const provider of providers) {
    try {
      const response = await attempt(provider.name, provider.fn, provider.state);
      return { ...response, _provider: provider.name };
    } catch (err) {
      lastErr = err;
      logger.warn('AI provider failed: ' + provider.name + ' (' + (err?.status || err?.message || 'unknown') + '); trying next provider');
    }
  }
  throw lastErr || new Error('AI client: all providers failed');
}

function paramsWithModel(params, model) {
  const copy = { ...params };
  copy.model = model;
  delete copy.thinking;
  delete copy.output_config;
  return copy;
}

function isRetryableAnthropicError(err) {
  return isRetryable(err);
}

module.exports = {
  hasAnthropic,
  hasGroqFallback,
  hasOpenSourcePrimary,
  hasOpenSourceSecondary,
  hasAnyProvider,
  providerCapabilities,
  createMessage,
  isRetryableAnthropicError,
  getAnthropicClient,
};
