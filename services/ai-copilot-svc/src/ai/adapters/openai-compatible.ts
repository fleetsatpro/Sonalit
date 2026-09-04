// OpenAI-compatible adapter — the self-hosting path (spec §5, "model
// sovereignty").
//
// vLLM, Ollama, TGI, llama.cpp's server and Groq all expose
// /v1/chat/completions and /v1/embeddings with the same wire format, so
// one adapter covers every open-weight deployment Sonalit might run.
// Standing up a self-hosted model is then an `ai_models` INSERT pointing
// at an endpoint — no new code, no redeploy of this service.
//
// Uses `fetch` rather than the `openai` SDK deliberately: the surface used
// here is two POST bodies, and self-hosted servers vary in which optional
// SDK-asserted fields they return (Ollama omits `usage` on some builds,
// vLLM returns tool_calls only when the model was launched with a parser).
// Hand-rolling the two calls keeps those quirks visible and handled here
// instead of surfacing as SDK type errors at runtime.

import type {
  AIModel,
  EmbeddingRequest,
  EmbeddingResponse,
  InferenceAdapter,
  InferenceRequest,
  InferenceResponse,
  StopReason,
  ToolCall,
} from '../types.js';

interface ChatCompletionResponse {
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
    finish_reason?: string;
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface EmbeddingApiResponse {
  data?: { embedding: number[]; index: number }[];
  usage?: { prompt_tokens?: number };
}

function endpointFor(model: AIModel): string {
  if (!model.endpoint) {
    throw new Error(`Model '${model.model_id}' is openai_compatible but has no endpoint`);
  }
  return model.endpoint.replace(/\/+$/, '');
}

function headersFor(model: AIModel): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Self-hosted endpoints on a private network commonly need no auth at
  // all, so a missing key is only an error when the row asked for one.
  if (model.api_key_env) {
    const key = process.env[model.api_key_env];
    if (!key) {
      throw new Error(`Model '${model.model_id}' requires ${model.api_key_env}, which is not set`);
    }
    headers['Authorization'] = `Bearer ${key}`;
  }
  return headers;
}

async function postJson<T>(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Body often carries the real cause (context overflow, model not
      // loaded); truncated so a verbose server error cannot flood logs.
      const detail = await res.text().catch(() => '');
      throw new Error(`HTTP ${String(res.status)}: ${detail.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function toOpenAIMessages(req: InferenceRequest): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (req.system) out.push({ role: 'system', content: req.system });

  for (const m of req.messages) {
    if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content });
      continue;
    }
    if (m.role === 'assistant' && 'tool_calls' in m && m.tool_calls.length > 0) {
      out.push({
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.input) },
        })),
      });
      continue;
    }
    out.push({ role: m.role, content: m.content });
  }
  return out;
}

function toStopReason(raw: string | undefined): StopReason {
  switch (raw) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'stop':
    default:
      return 'end_turn';
  }
}

/**
 * Open-weight models are markedly less reliable than frontier models at
 * emitting well-formed tool arguments — malformed JSON here is an
 * everyday occurrence, not an exceptional one. A call whose arguments
 * cannot be parsed is DROPPED rather than passed on with `{}`: an empty
 * argument object would let a tool run with defaults the model never
 * asked for, which is exactly the class of silent wrong action Rule 4
 * exists to prevent.
 */
function parseToolCalls(
  raw: { id: string; function: { name: string; arguments: string } }[] | undefined,
): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const tc of raw ?? []) {
    try {
      const parsed: unknown = JSON.parse(tc.function.arguments || '{}');
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
      calls.push({ id: tc.id, name: tc.function.name, input: parsed as Record<string, unknown> });
    } catch {
      process.stderr.write(
        `Dropped tool call '${tc.function.name}': arguments were not valid JSON\n`,
      );
    }
  }
  return calls;
}

export const openAICompatibleAdapter: InferenceAdapter = {
  provider: 'openai_compatible',

  async infer(model: AIModel, req: InferenceRequest): Promise<InferenceResponse> {
    const startedAt = Date.now();
    const res = await postJson<ChatCompletionResponse>(
      `${endpointFor(model)}/chat/completions`,
      headersFor(model),
      {
        model: model.provider_model,
        max_tokens: req.max_tokens ?? 2048,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: toOpenAIMessages(req),
        ...(req.tools && req.tools.length > 0
          ? {
              tools: req.tools.map((t) => ({
                type: 'function',
                function: { name: t.name, description: t.description, parameters: t.input_schema },
              })),
            }
          : {}),
      },
      req.timeout_ms ?? 60_000,
    );

    const choice = res.choices?.[0];
    if (!choice) {
      throw new Error(`Model '${model.model_id}' returned no choices`);
    }

    return {
      text: choice.message?.content ?? '',
      tool_calls: parseToolCalls(choice.message?.tool_calls),
      stop_reason: toStopReason(choice.finish_reason),
      model_id: model.model_id,
      model_name: model.name,
      provider_model: model.provider_model,
      model_version: model.version,
      input_tokens: res.usage?.prompt_tokens ?? 0,
      output_tokens: res.usage?.completion_tokens ?? 0,
      latency_ms: Date.now() - startedAt,
    };
  },

  async embed(model: AIModel, req: EmbeddingRequest): Promise<EmbeddingResponse> {
    const startedAt = Date.now();
    const res = await postJson<EmbeddingApiResponse>(
      `${endpointFor(model)}/embeddings`,
      headersFor(model),
      { model: model.provider_model, input: req.input },
      60_000,
    );

    const data = res.data ?? [];
    if (data.length !== req.input.length) {
      // Misalignment would silently attach the wrong vector to a chunk and
      // poison retrieval for as long as the index lives.
      throw new Error(
        `Embedding count mismatch for '${model.model_id}': sent ${String(req.input.length)}, received ${String(data.length)}`,
      );
    }

    // Servers are not required to return `data` in request order.
    const ordered = [...data].sort((a, b) => a.index - b.index);

    return {
      vectors: ordered.map((d) => d.embedding),
      model_id: model.model_id,
      model_name: model.name,
      provider_model: model.provider_model,
      model_version: model.version,
      input_tokens: res.usage?.prompt_tokens ?? 0,
      latency_ms: Date.now() - startedAt,
    };
  },
};
