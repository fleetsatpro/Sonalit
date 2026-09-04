// Anthropic adapter — translates the neutral inference interface to the
// Messages API and back.
//
// All Anthropic-specific knowledge in the AI plane lives in this file:
// content-block arrays, tool_use / tool_result blocks, and the stop_reason
// vocabulary. The router and every caller stay provider-agnostic.

import Anthropic from '@anthropic-ai/sdk';

import type {
  AIModel,
  InferenceAdapter,
  InferenceRequest,
  InferenceResponse,
  StopReason,
  ToolCall,
} from '../types.js';

const clients = new Map<string, Anthropic>();

function clientFor(model: AIModel): Anthropic {
  const envVar = model.api_key_env ?? 'ANTHROPIC_API_KEY';
  const apiKey = process.env[envVar];
  if (!apiKey) {
    throw new Error(`Model '${model.model_id}' requires ${envVar}, which is not set`);
  }
  const cacheKey = `${envVar}:${model.endpoint ?? 'default'}`;
  let client = clients.get(cacheKey);
  if (!client) {
    client = new Anthropic({ apiKey, ...(model.endpoint ? { baseURL: model.endpoint } : {}) });
    clients.set(cacheKey, client);
  }
  return client;
}

/**
 * Neutral messages -> Anthropic content blocks.
 *
 * The shape difference that matters: we carry tool results as a distinct
 * 'tool' role (the OpenAI convention, chosen because it is the more
 * explicit of the two), while Anthropic nests tool_result blocks inside a
 * 'user' turn. Consecutive tool results must merge into ONE user turn or
 * the API rejects the sequence — hence the accumulator below.
 */
function toAnthropicMessages(messages: InferenceRequest['messages']): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  let pendingToolResults: Anthropic.ToolResultBlockParam[] = [];

  const flush = (): void => {
    if (pendingToolResults.length > 0) {
      out.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const m of messages) {
    if (m.role === 'tool') {
      pendingToolResults.push({
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: m.content,
      });
      continue;
    }

    flush();

    if (m.role === 'assistant' && 'tool_calls' in m && m.tool_calls.length > 0) {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: 'text', text: m.content });
      for (const tc of m.tool_calls) {
        blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
      }
      out.push({ role: 'assistant', content: blocks });
      continue;
    }

    out.push({ role: m.role, content: m.content });
  }

  flush();
  return out;
}

function toStopReason(raw: string | null): StopReason {
  switch (raw) {
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    default:
      return 'end_turn';
  }
}

export const anthropicAdapter: InferenceAdapter = {
  provider: 'anthropic',

  async infer(model: AIModel, req: InferenceRequest): Promise<InferenceResponse> {
    const client = clientFor(model);
    const startedAt = Date.now();

    const res = await client.messages.create(
      {
        model: model.provider_model,
        max_tokens: req.max_tokens ?? 2048,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.system ? { system: req.system } : {}),
        messages: toAnthropicMessages(req.messages),
        ...(req.tools && req.tools.length > 0
          ? {
              tools: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.input_schema as Anthropic.Tool.InputSchema,
              })),
            }
          : {}),
      },
      { ...(req.timeout_ms ? { timeout: req.timeout_ms } : {}) },
    );

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const toolCalls: ToolCall[] = res.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: (b.input ?? {}) as Record<string, unknown> }));

    return {
      text,
      tool_calls: toolCalls,
      stop_reason: toStopReason(res.stop_reason),
      model_id: model.model_id,
      model_name: model.name,
      provider_model: model.provider_model,
      model_version: model.version,
      input_tokens: res.usage.input_tokens,
      output_tokens: res.usage.output_tokens,
      latency_ms: Date.now() - startedAt,
    };
  },
};
