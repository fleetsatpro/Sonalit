// Shared AI client: Anthropic is the primary provider everywhere in this
// backend (AI Copilot dispatch, Risk Intel OSINT, route safety scoring —
// see ai.js, riskOsint.js, routeAnalyser.js), each of which used to
// instantiate `new Anthropic()` ad hoc with its own copy-pasted retry
// logic and no fallback at all: if ANTHROPIC_API_KEY hits a rate limit,
// runs out of quota, or Anthropic has an outage, every AI-backed feature
// goes down simultaneously with no degraded mode.
//
// This module is the one place that happens now. `createMessage()` takes
// the same params shape as `client.messages.create()` and ALWAYS returns
// an Anthropic-shaped response ({ content: [...], stop_reason }),
// regardless of which provider actually served it — callers don't need
// to know or care. If Anthropic fails (after a short retry for transient
// errors) and GROQ_API_KEY is configured, it falls back to an open-weight
// model via Groq's OpenAI-compatible API, translating tool schemas and
// message history in both directions.
//
// Real limitation to keep in mind: this is redundancy, not parity. Open-
// weight models are noticeably less reliable at sustained multi-turn tool
// use than Claude, so treat a Groq-served Copilot response as a "best
// effort while Anthropic is down" degraded mode, not a like-for-like swap
// — see ai.js's dispatch loop, which is the highest-risk caller of this.
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const logger = require('./logger');

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const CIRCUIT_COOLDOWN_MS = 60_000;

let anthropicClient = null;
let groqClient = null;
let anthropicDownUntil = 0;

function hasAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  return !!(key && key.length >= 20);
}

function hasGroqFallback() {
  const key = process.env.GROQ_API_KEY;
  return !!(key && key.length >= 20);
}

function getAnthropicClient() {
  if (!anthropicClient) anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return anthropicClient;
}

function getGroqClient() {
  if (!groqClient) groqClient = new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: 'https://api.groq.com/openai/v1' });
  return groqClient;
}

function isRetryableAnthropicError(err) {
  const status = err?.status;
  if (status === 529 || status === 429 || status === 500 || status === 503) return true;
  return (err?.message || '').includes('Overloaded');
}

async function callAnthropicWithRetry(params, maxRetries = 3) {
  const client = getAnthropicClient();
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await client.messages.create(params);
    } catch (err) {
      if (isRetryableAnthropicError(err) && attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 2000));
        continue;
      }
      throw err;
    }
  }
}

// ── Anthropic <-> OpenAI/Groq translation ──────────────────────────────────

// Anthropic tools carry `input_schema` directly; server-side tools like
// web_search have no input_schema and no open-weight equivalent, so they're
// dropped rather than mistranslated (callers using them should pass
// allowFallback: false anyway — see fetchClaudeForZones in riskOsint.js).
function toolsToOpenAI(tools) {
  return (tools || [])
    .filter(t => t.input_schema)
    .map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema } }));
}

function toolChoiceToOpenAI(toolChoice) {
  if (!toolChoice) return undefined;
  if (toolChoice.type === 'tool') return { type: 'function', function: { name: toolChoice.name } };
  if (toolChoice.type === 'any') return 'required';
  return 'auto';
}

// Anthropic's `system` is a string or an array of cache-controlled text
// blocks (prompt caching, e.g. ai.js's dispatch loop) — Groq has no
// equivalent, so this just flattens to plain text either way.
function systemToOpenAI(system) {
  if (!system) return undefined;
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) return system.map(b => b.text).filter(Boolean).join('\n');
  return undefined;
}

// Anthropic mixes tool_use/tool_result into content-block arrays under
// 'assistant'/'user' roles; OpenAI uses assistant.tool_calls plus a
// dedicated 'tool' role per result. This round-trips the accumulation
// pattern ai.js's dispatch loop already builds (see its `messages.push`
// calls) without that loop needing to know which provider is being used.
function messagesToOpenAI(messages) {
  const out = [];
  for (const m of messages || []) {
    if (typeof m.content === 'string') { out.push({ role: m.role, content: m.content }); continue; }
    if (!Array.isArray(m.content)) continue;

    if (m.role === 'assistant') {
      const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      const toolCalls = m.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      const msg = { role: 'assistant', content: text || null };
      if (toolCalls.length) msg.tool_calls = toolCalls;
      out.push(msg);
    } else {
      const toolResults = m.content.filter(b => b.type === 'tool_result');
      if (toolResults.length) {
        for (const tr of toolResults) {
          out.push({ role: 'tool', tool_call_id: tr.tool_use_id, content: typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content) });
        }
      } else {
        const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        if (text) out.push({ role: 'user', content: text });
      }
    }
  }
  return out;
}

// Normalizes a Groq/OpenAI chat-completion response back into the same
// shape Anthropic's messages.create() returns, so every existing caller's
// `response.content.find(b => b.type === 'tool_use')` / `stop_reason`
// checks keep working unmodified regardless of which provider answered.
function openAIResponseToAnthropicShape(completion) {
  const choice = completion.choices?.[0];
  const message = choice?.message || {};
  const content = [];
  if (message.content) content.push({ type: 'text', text: message.content });
  for (const tc of message.tool_calls || []) {
    let input = {};
    try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { /* leave as {} */ }
    content.push({ type: 'tool_use', id: tc.id, name: tc.function?.name, input });
  }
  return {
    content,
    stop_reason: choice?.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
  };
}

async function callGroq({ system, messages, tools, tool_choice, max_tokens }) {
  const client = getGroqClient();
  const openAiMessages = [
    ...(system ? [{ role: 'system', content: systemToOpenAI(system) }] : []),
    ...messagesToOpenAI(messages),
  ];
  const completion = await client.chat.completions.create({
    model: GROQ_MODEL,
    max_completion_tokens: max_tokens,
    messages: openAiMessages,
    ...(tools?.length ? { tools: toolsToOpenAI(tools) } : {}),
    ...(tool_choice ? { tool_choice: toolChoiceToOpenAI(tool_choice) } : {}),
  });
  return openAIResponseToAnthropicShape(completion);
}

// Main entrypoint — same params as `client.messages.create()` (model,
// max_tokens, system, messages, tools, tool_choice; Anthropic-only extras
// like `thinking`/`output_config` are simply ignored on the Groq path).
// Set `allowFallback: false` for calls using an Anthropic-native server
// tool (e.g. web_search) that has no Groq/open-weight equivalent.
async function createMessage(params, { allowFallback = true } = {}) {
  const circuitOpen = Date.now() < anthropicDownUntil;

  if (hasAnthropic() && !(circuitOpen && hasGroqFallback() && allowFallback)) {
    try {
      const response = await callAnthropicWithRetry(params);
      return { ...response, _provider: 'anthropic' };
    } catch (err) {
      if (!allowFallback || !hasGroqFallback()) throw err;
      logger.warn(`AI client: Anthropic failed (${err?.status || err.message}) — falling back to Groq (${GROQ_MODEL})`);
      anthropicDownUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    }
  }

  if (!allowFallback || !hasGroqFallback()) {
    throw new Error('AI client: no provider available (ANTHROPIC_API_KEY missing/invalid and no GROQ_API_KEY fallback configured)');
  }

  const response = await callGroq(params);
  return { ...response, _provider: 'groq' };
}

module.exports = {
  hasAnthropic, hasGroqFallback, createMessage, isRetryableAnthropicError,
  getAnthropicClient,
};
